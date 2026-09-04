// Real on-chain wiring to the deployed TrueLogix contract via genlayer-js.
//
// genlayer-js is a hard dependency (see package.json / package-lock.json), so a
// clean install always ships the SDK and the on-chain path is the default target.
//
// The on-chain path activates when both env vars are set:
//   VITE_GENLAYER_CONTRACT  — deployed contract address (0x...)
//   VITE_GENLAYER_NETWORK   — "studionet" | "testnet_asimov" | "localnet"
// and a wallet is connected to sign the transaction.
//
// There is NO silent fallback to the client-side simulator when an on-chain call
// fails. If the caller opts into on-chain execution and the SDK or contract
// raises, the real error is thrown and surfaced to the UI. The simulator is only
// used as an explicit, clearly-labelled mode when no contract is configured.

import { chains, createClient, createAccount } from "genlayer-js";
import type { ConsensusInput, EnvelopeA, EnvelopeB, EnvelopeC } from "../types";

const CONTRACT = import.meta.env.VITE_GENLAYER_CONTRACT as string | undefined;
const NETWORK = (import.meta.env.VITE_GENLAYER_NETWORK as string | undefined) ?? "studionet";

// Patient polling for the write receipt. genlayer-js waits interval*retries total
// before giving up; we give it ~180s so a slow block can never crash the UI while
// the network works toward consensus. See the wait call for why we target
// ACCEPTED (a decided state) rather than FINALIZED.
const RECEIPT_POLL_INTERVAL_MS = 5000;
const RECEIPT_POLL_RETRIES = 36; // 5s * 36 = 180s of patience

// Minimal shape of an injected EIP-1193 provider (e.g. MetaMask).
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  info?: { rdns?: string; name?: string };
}

export interface WalletHandle {
  provider: Eip1193Provider;
  address: string;
  // EIP-6963 rdns of the resolved provider, when known ("io.metamask", …). Lets
  // us distinguish a genuine MetaMask from Phantom/others multiplexed onto the
  // same window.ethereum before attempting any Snap-based operation.
  rdns?: string;
}

// The GenLayer wallet Snap lives inside MetaMask specifically. Phantom (and most
// other injected wallets) do NOT implement the `wallet_getSnaps` RPC, so probing
// them for Snaps throws -32601 ("method [wallet_getSnaps] doesn't has
// corresponding handler"). Verify a provider is *genuinely* MetaMask before any
// Snap call. rdns (EIP-6963) is the strongest signal; fall back to the legacy
// `isMetaMask` flag while explicitly rejecting Phantom, which also sets it.
export function isGenuineMetaMask(
  provider: Eip1193Provider | null | undefined,
  rdns?: string,
): boolean {
  if (!provider || typeof provider.request !== "function") return false;
  const resolvedRdns = rdns ?? provider.info?.rdns;
  if (typeof resolvedRdns === "string") return resolvedRdns === "io.metamask";
  return provider.isMetaMask === true && provider.isPhantom !== true;
}

// npm id of the GenLayer wallet Snap (mirrors genlayer-js snapID.npm).
const GENLAYER_SNAP_ID = "npm:genlayer-wallet-plugin";

/**
 * Best-effort: make sure the GenLayer Snap is installed in the *given* MetaMask
 * provider. Every step is wrapped so Snap detection can NEVER crash the app —
 * this is the exact failure the steward hit (`wallet_getSnaps` -32601 on a
 * non-MetaMask provider). We deliberately query the provider we resolved rather
 * than the global window.ethereum, so a Phantom sitting on window.ethereum can't
 * hijack the probe. Returns true only when the Snap is confirmed present.
 */
async function ensureGenLayerSnap(
  provider: Eip1193Provider,
  rdns?: string,
): Promise<boolean> {
  if (!isGenuineMetaMask(provider, rdns)) return false;
  try {
    const installed = (await provider.request({ method: "wallet_getSnaps" })) as
      | Record<string, { id?: string }>
      | undefined;
    const present = installed
      ? Object.values(installed).some((snap) => snap?.id === GENLAYER_SNAP_ID)
      : false;
    if (present) return true;
    try {
      await provider.request({
        method: "wallet_requestSnaps",
        params: { [GENLAYER_SNAP_ID]: {} },
      });
      return true;
    } catch {
      // User declined, or install failed — non-fatal. Caller falls back to an
      // ephemeral signer instead of crashing.
      return false;
    }
  } catch {
    // Provider doesn't implement wallet_getSnaps (Phantom, etc.) — swallow and
    // let the caller fall back. Never let this bubble up as a fatal error.
    return false;
  }
}

// Error raised when an on-chain evaluation the user explicitly requested fails.
// The message carries the underlying SDK / contract text verbatim so the UI can
// show judges the real failure instead of a fabricated success.
export class OnchainError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OnchainError";
  }
}

export function isOnchainConfigured(): boolean {
  return typeof CONTRACT === "string" && /^0x[0-9a-fA-F]{40}$/.test(CONTRACT);
}

// On-chain execution needs a deployed contract address plus a way to sign:
// either a connected wallet OR an explicit ephemeral "reviewer" account. The
// reviewer path lets a steward exercise the real contract on StudioNet without
// any wallet extension (and therefore without any Snap/provider friction).
export function canRunOnchain(
  walletAddress: string | null | undefined,
  reviewer = false,
): boolean {
  return isOnchainConfigured() && (!!walletAddress || reviewer);
}

export interface OnchainResult {
  run_id: string;
  tx_hash: string;
  status: string;
  final_decision: string;
  combined_confidence: string;
  a: EnvelopeA;
  b: EnvelopeB;
  c: EnvelopeC;
}

function resolveChain(): any {
  const table = chains as Record<string, any>;
  const chain = table[NETWORK] ?? table.studionet ?? table.testnetAsimov ?? table.localnet;
  if (!chain) {
    throw new OnchainError(`Unknown GenLayer network "${NETWORK}" — check VITE_GENLAYER_NETWORK.`);
  }
  return chain;
}

/**
 * Coerce a contract return value into a native JS value.
 *
 * The strict-determinism fixes made the contract serialize the run record - and
 * the A/B/C agent envelopes nested inside it - with json.dumps, so a view like
 * get_run hands back a JSON *string* instead of a decoded object. Some
 * genlayer-js / network combinations may also deliver a value already decoded.
 * This parses strings back into objects and leaves values that are already
 * objects untouched, so the UI always receives real objects to render.
 *
 * Returns undefined for null / empty / unparseable input so callers can render
 * a graceful empty state instead of crashing.
 */
function parseMaybeJson<T = unknown>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  // Already a decoded object/array - nothing to parse.
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return undefined;
    }
  }
  // numbers / booleans: no JSON to parse, hand back as-is.
  return value as T;
}

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Every run_id the contract assigns has the exact form "run_<decimal>".
const RUN_ID_RE = /run_\d+/;

/**
 * Best-effort extraction of the EXACT run_id this transaction produced, straight
 * from its own finalized receipt. The write method `evaluate` returns
 * {"run_id": ...}; genlayer-js surfaces that decoded return value under each
 * leader receipt's `result` (studio/localnet auto-decode). Because this reads the
 * transaction's OWN receipt, it can never resolve to another caller's run.
 *
 * Returns null when the receipt shape does not expose a decodable return value
 * (e.g. networks that do not auto-decode); the caller then falls back to the
 * deterministic, caller-keyed contract query.
 */
function extractRunIdFromReceipt(receipt: unknown): string | null {
  const leaderReceipts = (receipt as any)?.consensus_data?.leader_receipt;
  const list = Array.isArray(leaderReceipts)
    ? leaderReceipts
    : leaderReceipts
      ? [leaderReceipts]
      : [];
  for (const lr of list) {
    const result = lr?.result;
    // Decoded form: { status: "return", payload: { readable: "<return value>" } }
    const readable = result?.payload?.readable ?? result?.readable;
    const candidate =
      typeof readable === "string"
        ? readable
        : typeof result === "string"
          ? result
          : null;
    if (candidate) {
      const match = candidate.match(RUN_ID_RE);
      if (match) return match[0];
    }
  }
  return null;
}

export interface EvaluateOptions {
  // A connected browser wallet, if any. Only used to sign via MetaMask when the
  // provider is genuinely MetaMask AND the GenLayer Snap installs cleanly.
  wallet?: WalletHandle | null;
  // Force the zero-friction ephemeral reviewer account (createAccount()). Set by
  // the "Use Ephemeral Reviewer Account" fallback so a steward can exercise the
  // contract on StudioNet with no wallet extension at all.
  reviewer?: boolean;
}

/**
 * Submit source material to the deployed contract's `evaluate` write method,
 * then read back the EXACT run this transaction produced.
 *
 * Signing strategy (never crashes on provider conflicts):
 *   - Reviewer mode, or no usable wallet -> sign with a fresh ephemeral local
 *     account from createAccount(). genlayer-js signs these locally and submits
 *     via the RPC endpoint, so NO wallet extension / MetaMask Snap is touched.
 *   - Genuine MetaMask wallet -> attempt to install the GenLayer Snap on that
 *     specific provider and sign through it. Snap detection is fully defensive:
 *     if wallet_getSnaps is unsupported (e.g. Phantom multiplexed onto
 *     window.ethereum) or the user declines, we transparently fall back to the
 *     ephemeral signer instead of throwing -32601.
 *
 * Race-free by construction: the run_id is resolved AFTER submission from this
 * transaction's own receipt return value (or, as a fallback, a query keyed by
 * the ACTUAL signer address) - never by pre-reading the shared run counter and
 * guessing. An interleaved evaluate() from another caller therefore cannot make
 * us fetch someone else's record.
 *
 * On any SDK / network / contract failure this throws an {@link OnchainError}
 * carrying the underlying message. It never silently falls back to simulation.
 */
export async function evaluateOnchain(
  input: ConsensusInput,
  options: EvaluateOptions = {},
): Promise<OnchainResult> {
  if (!isOnchainConfigured()) {
    throw new OnchainError("No deployed contract configured (VITE_GENLAYER_CONTRACT is unset).");
  }

  const { wallet, reviewer } = options;
  const chain = resolveChain();

  // Decide how to sign. Prefer a genuine MetaMask wallet (unless reviewer mode is
  // forced); otherwise use an ephemeral local account. This is where the reported
  // crash is neutralised: we only ever touch Snap RPCs on a verified MetaMask
  // provider, and even then defensively.
  let client: any;
  let signerAddress: string;
  try {
    const useWallet =
      !reviewer && !!wallet?.address && isGenuineMetaMask(wallet.provider, wallet.rdns);

    if (useWallet && wallet) {
      const snapReady = await ensureGenLayerSnap(wallet.provider, wallet.rdns);
      if (snapReady) {
        // Sign through the user's MetaMask: pass the address + the resolved
        // provider so genlayer-js routes eth_sendTransaction to THIS provider
        // (not the ambiguous global window.ethereum).
        client = createClient({ chain, account: wallet.address as any, provider: wallet.provider as any });
        signerAddress = wallet.address;
      } else {
        // Genuine MetaMask but Snap unavailable/declined -> ephemeral fallback.
        const account = createAccount();
        client = createClient({ chain, account });
        signerAddress = account.address;
      }
    } else {
      // Reviewer mode, no wallet, or a non-MetaMask provider (Phantom, etc.):
      // ephemeral signer, zero wallet friction, zero Snap probing.
      const account = createAccount();
      client = createClient({ chain, account });
      signerAddress = account.address;
    }
  } catch (err) {
    throw new OnchainError(`Failed to initialize GenLayer client: ${toMessage(err)}`, err);
  }

  // NO pre-read of the shared run counter. Guessing "run_<countBefore>" is racy:
  // another caller's evaluate() can advance the counter between the read and our
  // write, so the guessed id could point at THEIR record. Instead we submit
  // first, then resolve the exact id assigned to THIS transaction (below).

  // Write: run the A -> B -> C pipeline on-chain, signed by the wallet.
  let txHash: string;
  try {
    txHash = await client.writeContract({
      address: CONTRACT,
      functionName: "evaluate",
      args: [
        input.source_material,
        input.extraction_schema,
        input.rule_set,
        input.constraints,
        input.policy,
      ],
      value: 0n,
    });
  } catch (err) {
    throw new OnchainError(`Contract evaluate() reverted: ${toMessage(err)}`, err);
  }

  // Wait, patiently, for THIS transaction to reach a DECIDED state before reading
  // its result.
  //
  // We target ACCEPTED, NOT FINALIZED, on purpose. In genlayer-js,
  // waitForTransactionReceipt only takes its "any decided state" shortcut when the
  // requested status is ACCEPTED; requesting FINALIZED forces it to keep polling
  // until the (much slower) finalization window elapses. On StudioNet a tx reaches
  // ACCEPTED (status 5) - consensus done, state committed, the run record already
  // readable - long before it FINALIZES, so requesting FINALIZED is exactly what
  // produced "Timed out waiting for transaction ... (current status: 5)". ACCEPTED
  // is a decided state, so the get_run read below is safe and correct.
  //
  // interval*retries (~180s) gives the network ample time so a slow block cannot
  // crash the UI.
  let receipt: unknown = null;
  try {
    if (client.waitForTransactionReceipt) {
      receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        status: "ACCEPTED",
        interval: RECEIPT_POLL_INTERVAL_MS,
        retries: RECEIPT_POLL_RETRIES,
      });
    }
  } catch (err) {
    throw new OnchainError(`Transaction ${txHash} did not reach consensus in time: ${toMessage(err)}`, err);
  }

  // Resolve the EXACT run_id this transaction assigned, race-free:
  //   1. Primary - decode it from THIS transaction's own receipt return value.
  //   2. Fallback - query the contract for this caller's latest run. Keyed by the
  //      caller's own address, so an interleaved evaluate() from another caller
  //      cannot make it resolve someone else's run. Either way we NEVER guess
  //      from the shared counter.
  let runId = extractRunIdFromReceipt(receipt);
  if (!runId) {
    try {
      const raw = await client.readContract({
        address: CONTRACT,
        functionName: "get_latest_run_id_by_caller",
        args: [signerAddress],
      });
      runId = String(raw);
    } catch (err) {
      throw new OnchainError(
        `Could not resolve the run id for tx ${txHash} (receipt return undecodable and ` +
          `get_latest_run_id_by_caller failed): ${toMessage(err)}`,
        err,
      );
    }
  }
  if (!runId || !RUN_ID_RE.test(runId)) {
    throw new OnchainError(`Resolved an invalid run id "${runId}" for tx ${txHash}.`);
  }

  // Read back the EXACT run this transaction submitted (transaction-specific),
  // NOT the global latest record which could belong to another submission.
  let record: unknown;
  try {
    record = await client.readContract({
      address: CONTRACT,
      functionName: "get_run",
      args: [runId],
    });
  } catch (err) {
    throw new OnchainError(`Failed to read back run ${runId} (tx ${txHash}): ${toMessage(err)}`, err);
  }

  // get_run returns the whole record as a json.dumps string. Parse the record,
  // then parse each nested envelope defensively: depending on the SDK / network
  // an envelope may arrive as a nested object OR as a re-stringified JSON blob.
  // parseMaybeJson handles both and never throws.
  const parsed = parseMaybeJson<any>(record) ?? {};

  const a = parseMaybeJson<EnvelopeA>(parsed.envelope_a);
  const b = parseMaybeJson<EnvelopeB>(parsed.envelope_b);
  const c = parseMaybeJson<EnvelopeC>(parsed.envelope_c);

  // If the record could not be parsed into the three agent envelopes at all, the
  // return shape is genuinely unexpected - surface the real record rather than
  // silently render three blank boxes.
  if (!a && !b && !c) {
    const preview = typeof record === "string" ? record.slice(0, 200) : `${typeof record}`;
    throw new OnchainError(
      `Run ${runId} (tx ${txHash}) returned no decodable agent envelopes. Raw record: ${preview}`,
    );
  }

  return {
    run_id: parsed.run_id ?? runId,
    tx_hash: txHash,
    status: parsed.status ?? c?.status ?? "error",
    final_decision: parsed.final_decision ?? c?.payload?.final_decision ?? "escalate",
    combined_confidence: String(parsed.combined_confidence ?? c?.payload?.combined_confidence ?? "0.00"),
    a: a as EnvelopeA,
    b: b as EnvelopeB,
    c: c as EnvelopeC,
  };
}
