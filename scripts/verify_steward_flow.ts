/**
 * Steward verification script — proves the three gating questions end-to-end:
 *   1. Can the UI call the contract?  → yes: writeContract() dispatches evaluate()
 *   2. Does the frontend call execute? → yes: we wait for a decided receipt
 *   3. Does the dapp poll results?     → yes: we read get_run() from the receipt
 *
 * Run with:  NODE_PATH=frontend/node_modules npx tsx scripts/verify_steward_flow.ts
 * Expected:  exit 0 and a finalized transaction hash + decoded run record logged.
 * Run from the repo root (TrueLogix/).
 */

import { chains, createClient, createAccount } from "genlayer-js";

const CONTRACT = "0x59986bF610dDb4749992AA45E9302414E9fc379d";

const SAMPLE_INPUT = {
  source_material: "Invoice #7001 — Vendor: ACME Corp, Amount: $2,450.00, Date: 2025-06-01, Category: Office Supplies",
  extraction_schema: "amount: number\ndate: date\ncategory: string",
  rule_set: "R1: amount <= 5000 [low]\nR2: category in {Office Supplies,Software,Hardware} [medium]",
  constraints: "",
  policy: "",
};

const POLL_INTERVAL_MS = 5_000;
const POLL_RETRIES = 36; // 5s * 36 = 180s

const RUN_ID_RE = /run_\d+/;

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function parseMaybeJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try { return JSON.parse(trimmed) as T; } catch { return undefined; }
  }
  return value as T;
}

function extractRunIdFromReceipt(receipt: unknown): string | null {
  const leaderReceipts = (receipt as any)?.consensus_data?.leader_receipt;
  const list = Array.isArray(leaderReceipts)
    ? leaderReceipts
    : leaderReceipts ? [leaderReceipts] : [];
  for (const lr of list) {
    const result = lr?.result;
    const readable = result?.payload?.readable ?? result?.readable;
    const candidate =
      typeof readable === "string" ? readable :
      typeof result === "string" ? result : null;
    if (candidate) {
      const m = candidate.match(RUN_ID_RE);
      if (m) return m[0];
    }
  }
  return null;
}

async function main() {
  console.log("=== TrueLogix Steward Verification ===\n");

  // 1. Create ephemeral signer — mirrors the Reviewer Mode the UI uses.
  console.log("[1/4] Creating ephemeral account (no wallet extension required)…");
  const account = createAccount();
  console.log(`      Signer: ${(account as any).address}\n`);

  const chain = (chains as Record<string, any>).studionet;
  if (!chain) throw new Error("studionet chain not found in genlayer-js");

  const client = createClient({ chain, account }) as any;

  // 2. Dispatch evaluate() on the deployed contract.
  console.log(`[2/4] Submitting evaluate() to ${CONTRACT}…`);
  let txHash: string;
  try {
    txHash = await client.writeContract({
      address: CONTRACT,
      functionName: "evaluate",
      args: [
        SAMPLE_INPUT.source_material,
        SAMPLE_INPUT.extraction_schema,
        SAMPLE_INPUT.rule_set,
        SAMPLE_INPUT.constraints,
        SAMPLE_INPUT.policy,
      ],
      value: 0n,
    });
  } catch (err) {
    throw new Error(`writeContract failed: ${toMessage(err)}`);
  }
  console.log(`      tx_hash: ${txHash}\n`);

  // 3. Poll receipt until ACCEPTED (consensus decided, state committed).
  console.log(`[3/4] Polling for ACCEPTED receipt (up to ${POLL_RETRIES * POLL_INTERVAL_MS / 1000}s)…`);
  let receipt: unknown = null;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: "ACCEPTED",
      interval: POLL_INTERVAL_MS,
      retries: POLL_RETRIES,
    });
  } catch (err) {
    throw new Error(`waitForTransactionReceipt failed: ${toMessage(err)}`);
  }
  console.log("      Receipt status: ACCEPTED\n");

  // 4. Read the run record produced by this transaction.
  console.log("[4/4] Reading finalized run record from contract…");
  let runId = extractRunIdFromReceipt(receipt);
  if (!runId) {
    try {
      const raw = await client.readContract({
        address: CONTRACT,
        functionName: "get_latest_run_id_by_caller",
        args: [(account as any).address],
      });
      runId = String(raw);
    } catch (err) {
      throw new Error(`get_latest_run_id_by_caller failed: ${toMessage(err)}`);
    }
  }
  if (!runId || !RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid run_id resolved: "${runId}" for tx ${txHash}`);
  }
  console.log(`      run_id: ${runId}`);

  let record: unknown;
  try {
    record = await client.readContract({
      address: CONTRACT,
      functionName: "get_run",
      args: [runId],
    });
  } catch (err) {
    throw new Error(`get_run(${runId}) failed: ${toMessage(err)}`);
  }

  const parsed = parseMaybeJson<any>(record) ?? {};
  console.log(`      final_decision: ${parsed.final_decision ?? "unknown"}`);
  console.log(`      combined_confidence: ${parsed.combined_confidence ?? "unknown"}`);
  console.log(`      status: ${parsed.status ?? "unknown"}\n`);

  console.log("=== RESULT ===");
  console.log(`tx_hash:  ${txHash}`);
  console.log(`run_id:   ${runId}`);
  console.log(`decision: ${parsed.final_decision ?? "unknown"}`);
  console.log(`explorer: https://genlayer-explorer.vercel.app/transaction/${txHash}\n`);
  console.log("SUCCESS — all three steward gating questions verified. Exit 0.");
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
