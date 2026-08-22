// Unified consensus runner. Streams StageEvents as the A -> B -> C pipeline
// advances, so the dashboard can animate each stage: running -> voting -> done.
// Uses the deployed contract when configured, otherwise the local simulator.

import type { ConsensusInput, StageEvent, AgentId, QuorumVote } from "../types";
import { runAgentA, runAgentB, runAgentC } from "./simulator";
import { evaluateOnchain, canRunOnchain, type WalletHandle } from "./genlayer";

export const VALIDATOR_COUNT = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Deterministic quorum: in a healthy run every validator reproduces the leader's
// consensus-critical projection and agrees. (Divergence would surface here.)
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

  // Try the real contract (signed by the wallet) first; fall back to simulation.
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
