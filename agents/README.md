# TrueLogix — Specialized Agent Prompts (Step 1)

Production-grade system prompts for the 3-agent consensus module on GenLayer.

| File | Agent | Job | `gl.nondet` equivalence principle |
|------|-------|-----|-----------------------------------|
| `00_determinism_contract.md` | (shared) | Invariants inlined into every prompt | — |
| `agent_a_extractor.md` | A — Extractor/Verifier | Verbatim fact extraction + anti-hallucination | `strict_eq` (→ `prompt_comparative` fallback) |
| `agent_b_auditor.md` | B — Logic/Risk Auditor | Rule compliance, edge cases, constraint gates | `prompt_comparative(fn, B_PRINCIPLE)` |
| `agent_c_synthesizer.md` | C — Consensus Synthesizer | Reconcile A+B, weight, resolve conflicts | `prompt_comparative(fn, C_PRINCIPLE)` |

## Design premise

In GenLayer, each agent is **one `gl.nondet` block**: the leader emits the output and every
validator re-executes the same function, then votes agree/disagree via the equivalence
principle. Consensus holds only if independent runs **converge**. Therefore every prompt's
first responsibility is to eliminate output variance — enforced by the shared **Determinism
Contract** (canonical key order, total schema, number/string canonicalization, closed
vocabularies, no wall-clock/random sources). This is what makes `strict_eq` achievable for A
and keeps the `prompt_comparative` judgments cheap and stable for B and C.

## Data flow

```
source_material ─▶ A ─▶ envelope_A ─┐
task_rules ─────▶ B ─▶ envelope_B ─┴─▶ C ─▶ final consensus decision
                    ▲
             envelope_A feeds B as the verified factual substrate
```

Each envelope passes its **own** validator consensus round before the next agent consumes it.

## Standard envelope (all agents)

```json
{ "agent": "A|B|C", "confidence": "0.00", "payload": {}, "schema_version": "1.0.0", "status": "ok" }
```

> Numbers are serialized as JSON **strings** (`"0.85"`, `"1200.00"`) — GenVM calldata has no
> float type, so a bare float would fail to encode across the `gl.nondet` boundary.

`status` ∈ `{ok, refused, error}`; on non-`ok`, `payload = {"code": <enum>, "detail": <str>}`.

## Next steps (not in this phase)

- **Step 2:** wire each prompt into a GenLayer intelligent contract — one `gl.nondet` block
  per agent, calling `gl.nondet.exec_prompt(...)` and wrapping with the mapped
  `gl.eq_principle.*`. Parse/validate the JSON envelope against the schema before persisting.
- **Step 3:** golden-input regression suite (direct-mode tests) asserting byte-identical A
  outputs and stable B/C verdicts across repeated executions.
