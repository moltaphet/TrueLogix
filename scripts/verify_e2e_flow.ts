/**
 * End-to-end verification script for TrueLogix on StudioNet.
 *
 * Answers the steward's three gating questions deterministically:
 *   1. Can the UI call the contract?   → writeContract() dispatches evaluate()
 *   2. Does the frontend call execute? → receipt poll confirms state committed
 *   3. Does the dapp poll results?     → readContract() returns the run record
 *
 * Signing: ephemeral in-memory account via createAccount() — identical to the
 * UI's Reviewer Mode. No MetaMask, no browser extension, no Snap required.
 *
 * Receipt target: ACCEPTED (status 5), NOT FINALIZED (status 7).
 * On StudioNet, ACCEPTED means consensus is reached and state is committed;
 * the run record is immediately readable. Waiting for FINALIZED causes a
 * "Timed out waiting for transaction (current status: 5)" error because the
 * finalization window outlasts the poll budget. ACCEPTED is the correct
 * decided state for reading back on-chain results.
 *
 * Run:  NODE_PATH=frontend/node_modules npx tsx scripts/verify_e2e_flow.ts
 * Exit: 0 on success, 1 on any failure (with the error message printed).
 *
 * NODE_PATH is required because genlayer-js lives in frontend/node_modules.
 * Run from the repo root (TrueLogix/).
 */

import { chains, createClient, createAccount } from "genlayer-js";

const CONTRACT   = "0x59986bF610dDb4749992AA45E9302414E9fc379d";
const EXPLORER   = "https://explorer-studio.genlayer.com";
const INTERVAL   = 5_000;   // ms between receipt polls
const RETRIES    = 36;      // 5s × 36 = 180s total patience
const RUN_ID_RE  = /run_\d+/;

// ---------------------------------------------------------------------------
// Helpers (mirrors genlayer.ts to stay in sync)
// ---------------------------------------------------------------------------

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function parseMaybeJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return undefined;
    try { return JSON.parse(t) as T; } catch { return undefined; }
  }
  return value as T;
}

function extractRunIdFromReceipt(receipt: unknown): string | null {
  const lr = (receipt as any)?.consensus_data?.leader_receipt;
  const list = Array.isArray(lr) ? lr : lr ? [lr] : [];
  for (const item of list) {
    const result = item?.result;
    const readable = result?.payload?.readable ?? result?.readable;
    const candidate = typeof readable === "string" ? readable
                    : typeof result  === "string" ? result : null;
    if (candidate) {
      const m = candidate.match(RUN_ID_RE);
      if (m) return m[0];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  TrueLogix — E2E Steward Verification   ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // Step 1 — ephemeral signer (Reviewer Mode equivalent)
  console.log("[1/5] Creating ephemeral account…");
  const account = createAccount();
  const signerAddress: string = (account as any).address;
  console.log(`      Signer : ${signerAddress}`);

  const chain = (chains as Record<string, any>).studionet;
  if (!chain) throw new Error("studionet chain not found in genlayer-js — upgrade the package.");
  console.log(`      Network: studionet\n`);

  const client = createClient({ chain, account }) as any;

  // Step 2 — dispatch evaluate()
  const input = {
    source_material: "Invoice #E2E-001 — Vendor: VerifyLab Ltd. Amount: $750.00. Date: 2025-09-05. Category: Software.",
    extraction_schema: "amount: number\ndate: date\ncategory: string\nvendor_name: string",
    rule_set: "R1: amount <= 5000 [low]\nR2: category in {Software,Hardware,Office Supplies} [medium]",
    constraints: "",
    policy: "",
  };

  console.log(`[2/5] Dispatching evaluate() → ${CONTRACT}…`);
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
    throw new Error(`writeContract failed: ${toMessage(err)}`);
  }
  console.log(`      tx_hash  : ${txHash}`);
  console.log(`      explorer : ${EXPLORER}/tx/${txHash}\n`);

  // Step 3 — poll for ACCEPTED receipt
  console.log(`[3/5] Polling receipt (ACCEPTED, up to ${RETRIES * INTERVAL / 1000}s)…`);
  let receipt: unknown = null;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: "ACCEPTED",
      interval: INTERVAL,
      retries: RETRIES,
    });
  } catch (err) {
    throw new Error(`waitForTransactionReceipt failed: ${toMessage(err)}`);
  }
  console.log("      Status   : ACCEPTED (consensus reached, state committed)\n");

  // Step 4 — resolve the exact run_id (race-free)
  console.log("[4/5] Resolving run_id…");
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
      throw new Error(`get_latest_run_id_by_caller failed: ${toMessage(err)}`);
    }
  }
  if (!runId || !RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid run_id resolved: "${runId}" — contract may not have recorded this run.`);
  }
  console.log(`      run_id   : ${runId}\n`);

  // Step 5 — read and decode the full run record
  console.log("[5/5] Reading finalized run record…");
  let record: unknown;
  try {
    record = await client.readContract({
      address: CONTRACT,
      functionName: "get_run",
      args: [runId],
    });
  } catch (err) {
    throw new Error(`get_run("${runId}") failed: ${toMessage(err)}`);
  }

  const parsed = parseMaybeJson<any>(record) ?? {};
  const decision   = parsed.final_decision   ?? "unknown";
  const confidence = parsed.combined_confidence ?? "unknown";
  const status     = parsed.status           ?? "unknown";

  console.log(`      status              : ${status}`);
  console.log(`      final_decision      : ${decision}`);
  console.log(`      combined_confidence : ${confidence}\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("══════════════════════════════════════════");
  console.log("  STEWARD GATING QUESTIONS — ALL PASSED  ");
  console.log("══════════════════════════════════════════");
  console.log(`  1. UI → contract call?     YES  (writeContract dispatched evaluate())`);
  console.log(`  2. Transaction executed?   YES  (receipt: ACCEPTED)`);
  console.log(`  3. Results polled?         YES  (get_run returned run record)\n`);
  console.log(`  tx_hash  : ${txHash}`);
  console.log(`  run_id   : ${runId}`);
  console.log(`  decision : ${decision}`);
  console.log(`  explorer : ${EXPLORER}/tx/${txHash}`);
  console.log("\nEXIT 0 — verification complete.");
}

main().catch((err) => {
  console.error("\n[FAILED]", err instanceof Error ? err.message : err);
  process.exit(1);
});
