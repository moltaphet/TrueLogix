// Real on-chain wiring to the deployed TrueLogix contract via genlayer-js.
//
// This path activates only when both env vars are set:
//   VITE_GENLAYER_CONTRACT  — deployed contract address (0x...)
//   VITE_GENLAYER_NETWORK   — "studionet" | "testnet_asimov" | "localnet"
// and the optional peer dependency `genlayer-js` is installed.
//
// genlayer-js is dynamically imported behind @vite-ignore so the static build
// never requires it; if it's absent or unconfigured, the app falls back to the
// deterministic client-side simulator (see consensus.ts).

import type { ConsensusInput, EnvelopeA, EnvelopeB, EnvelopeC } from "../types";

const CONTRACT = import.meta.env.VITE_GENLAYER_CONTRACT as string | undefined;
const NETWORK = (import.meta.env.VITE_GENLAYER_NETWORK as string | undefined) ?? "studionet";

export interface WalletHandle {
  provider: Eip1193Provider;
  address: string;
}

export function isOnchainConfigured(): boolean {
  return typeof CONTRACT === "string" && /^0x[0-9a-fA-F]{40}$/.test(CONTRACT);
}

// On-chain execution needs BOTH a deployed contract address AND a connected
// wallet to sign the transaction.
export function canRunOnchain(walletAddress: string | null | undefined): boolean {
  return isOnchainConfigured() && !!walletAddress;
}

export interface OnchainResult {
  run_id: string;
  status: string;
  final_decision: string;
  combined_confidence: string;
  a: EnvelopeA;
  b: EnvelopeB;
  c: EnvelopeC;
}

// Loads genlayer-js at runtime only. The indirection keeps Vite from trying to
// resolve/bundle the package at build time when it isn't installed.
async function loadSdk(): Promise<any> {
  const spec = "genlayer-js";
  return import(/* @vite-ignore */ spec);
}

/**
 * Submit source material to the deployed contract's `evaluate` write method,
 * signing with the connected browser wallet, and read back the stored record.
 * Returns null if on-chain mode isn't available so the caller can gracefully
 * fall back to the simulator.
 */
export async function evaluateOnchain(
  input: ConsensusInput,
  wallet?: WalletHandle | null,
): Promise<OnchainResult | null> {
  if (!isOnchainConfigured() || !wallet?.address) return null;
  try {
    const sdk = await loadSdk();
    const chains = sdk.chains ?? {};
    const chain = chains[NETWORK] ?? chains.studionet;

    // Bind a genlayer-js account to the connected EIP-1193 wallet so the tx is
    // signed by the user. Adapter names vary across SDK versions — try the known
    // ones defensively, then fall back to passing the address/provider directly.
    const account =
      sdk.createAccountFromProvider?.(wallet.provider, wallet.address) ??
      sdk.accountFromEthereum?.(wallet.provider) ??
      wallet.address;

    const client = sdk.createClient({ chain, account, provider: wallet.provider });
    if (client.connect) await client.connect(wallet.provider).catch(() => {});
    if (client.initializeConsensusSmartContract) await client.initializeConsensusSmartContract();

    // Write: run the A -> B -> C pipeline on-chain.
    const txHash = await client.writeContract({
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
    if (client.waitForTransactionReceipt) {
      await client.waitForTransactionReceipt({ hash: txHash, status: "FINALIZED" });
    }

    // Read: the full stored record for the latest run.
    const record = await client.readContract({
      address: CONTRACT,
      functionName: "get_latest",
      args: [],
    });
    const parsed = typeof record === "string" ? JSON.parse(record) : record;
    return {
      run_id: parsed.run_id,
      status: parsed.status,
      final_decision: parsed.final_decision,
      combined_confidence: String(parsed.combined_confidence),
      a: parsed.envelope_a,
      b: parsed.envelope_b,
      c: parsed.envelope_c,
    };
  } catch (err) {
    // Network / SDK / ABI mismatch — signal the caller to fall back cleanly.
    console.warn("[TrueLogix] on-chain evaluate failed, using simulator:", err);
    return null;
  }
}
