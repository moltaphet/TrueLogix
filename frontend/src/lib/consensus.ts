// Unified consensus runner. Streams StageEvents as the A -> B -> C pipeline
// advances, so the dashboard can animate each stage: running -> voting -> done.
//
// When a contract + wallet are available the pipeline runs fully on-chain. If
// that on-chain call fails, the error PROPAGATES to the caller — the runner does
// NOT silently swap in the client-side simulator. The simulator is used only as
// an explicit mode when no contract/wallet is configured.

import type { ConsensusInput, StageEvent, AgentId } from "../types";
import { runAgentA, runAgentB, runAgentC } from "./simulator";
import { evaluateOnchain, canRunOnchain, type WalletHandle } from "./genlayer";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunOptions {
  // Per-stage pacing for the animation (ms). Set 0 for instant.
  stageDelay?: number;
  voteDelay?: number;
  // Connected wallet — enables the on-chain write path when a contract is set.
  wallet?: WalletHandle | null;
  // Reviewer/demo mode — run on-chain with an ephemeral account (no wallet).
  reviewer?: boolean;
  // Forwarded to evaluateOnchain — fires the moment writeContract resolves so
  // the UI can show the pending tx hash before the receipt poll even starts.
  onTxSubmitted?: (txHash: string) => void;
}

export async function* runConsensus(
  input: ConsensusInput,
  opts: RunOptions = {},
): AsyncGenerator<StageEvent> {
  const stageDelay = opts.stageDelay ?? 620;
  const voteDelay = opts.voteDelay ?? 520;
  const useOnchain = canRunOnchain(opts.wallet?.address, opts.reviewer);

  // Run on-chain when configured. Any failure throws out of this generator (see
  // evaluateOnchain -> OnchainError) so the UI can surface the real error — we do
  // NOT quietly fall back to the simulator and present mock data as if it were
  // an on-chain result.
  const onchain = useOnchain
    ? await evaluateOnchain(input, {
        wallet: opts.wallet,
        reviewer: opts.reviewer,
        onTxSubmitted: opts.onTxSubmitted,
      })
    : null;

  const agents: AgentId[] = ["A", "B", "C"];
  const envelopes = onchain
    ? { A: onchain.a, B: onchain.b, C: onchain.c }
    : (() => {
        const a = runAgentA(input);
        const b = runAgentB(a, input);
        const c = runAgentC(a, b);
        return { A: a, B: b, C: c };
      })();

  for (const agent of agents) {
    yield { agent, phase: "running", mode: onchain ? "onchain" : "simulation" };
    await sleep(stageDelay);

    const env = envelopes[agent];
    yield { agent, phase: "voting", envelope: env, mode: onchain ? "onchain" : "simulation" };
    await sleep(voteDelay);

    const healthy = env.status === "ok";
    yield {
      agent,
      phase: healthy ? "done" : "error",
      envelope: env,
      error: healthy ? undefined : "stage returned non-ok status",
      mode: onchain ? "onchain" : "simulation",
      // Surface the transaction hash on the final agent so the UI can link to the explorer.
      tx_hash: agent === "C" && onchain ? onchain.tx_hash : undefined,
    };
  }
}
