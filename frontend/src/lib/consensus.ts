// Unified consensus runner. Streams StageEvents as the A -> B -> C pipeline
// advances, so the dashboard can animate each stage: running -> voting -> done.
//
// When a contract + wallet are available the pipeline runs fully on-chain. If
// that on-chain call fails, the error PROPAGATES to the caller — the runner does
// NOT silently swap in the client-side simulator. The simulator is used only as
// an explicit mode when no contract/wallet is configured.

import type { ConsensusInput, StageEvent, AgentId, QuorumVote } from "../types";
import { runAgentA, runAgentB, runAgentC } from "./simulator";
import { evaluateOnchain, canRunOnchain, type WalletHandle } from "./genlayer";

// Number of validators the deployed contract re-runs each stage across. Used
// only to size the ILLUSTRATIVE quorum visualization below — this is not live
// per-validator vote data (the contract returns an agreed result, not a tally).
export const VALIDATOR_COUNT = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Synthetic quorum strip for the UI animation. This is a fixed illustration of a
// healthy consensus, NOT a live count of validator votes returned by the chain.
function quorum(agree: boolean): QuorumVote[] {
  return Array.from({ length: VALIDATOR_COUNT }, () => ({ agree }));
}

export interface RunOptions {
  // Per-stage pacing for the animation (ms). Set 0 for instant.
  stageDelay?: number;
  voteDelay?: number;
  // Connected wallet — enables the on-chain write path when a contract is set.
  wallet?: WalletHandle | null;
}

export async function* runConsensus(
  input: ConsensusInput,
  opts: RunOptions = {},
): AsyncGenerator<StageEvent> {
  const stageDelay = opts.stageDelay ?? 620;
  const voteDelay = opts.voteDelay ?? 520;
  const useOnchain = canRunOnchain(opts.wallet?.address);

  // Run on-chain when configured. Any failure throws out of this generator (see
  // evaluateOnchain -> OnchainError) so the UI can surface the real error — we do
  // NOT quietly fall back to the simulator and present mock data as if it were
  // an on-chain result.
  const onchain = useOnchain ? await evaluateOnchain(input, opts.wallet) : null;

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
    yield { agent, phase: "voting", envelope: env, votes: quorum(true), mode: onchain ? "onchain" : "simulation" };
    await sleep(voteDelay);

    const healthy = env.status === "ok";
    yield {
      agent,
      phase: healthy ? "done" : "error",
      envelope: env,
      votes: quorum(true),
      error: healthy ? undefined : "stage returned non-ok status",
      mode: onchain ? "onchain" : "simulation",
    };
  }
}
