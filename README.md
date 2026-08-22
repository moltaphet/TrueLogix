<div align="center">

# TrueLogix

### A 3-Agent Multi-Agent Consensus Engine on GenLayer

**Extract → Audit → Synthesize.** Turn raw data into a verifiable decision that independent validators re-run and agree on — a result you can audit, not just trust.

[![GenLayer](https://img.shields.io/badge/Built_on-GenLayer-34D399?style=flat-square)](https://genlayer.com)
[![Intelligent Contract](https://img.shields.io/badge/Intelligent_Contract-py--genlayer-38BDF8?style=flat-square)](https://sdk.genlayer.com)
[![Direct Tests](https://img.shields.io/badge/direct_tests-16%2F16_passing-34D399?style=flat-square)](tests/direct/test_true_logix_consensus.py)
[![Lint](https://img.shields.io/badge/genvm--lint-passing-34D399?style=flat-square)](contracts/true_logix_consensus.py)
[![Frontend](https://img.shields.io/badge/frontend-Vite_%2B_React_%2B_Tailwind-A78BFA?style=flat-square)](frontend/)
[![License](https://img.shields.io/badge/license-MIT-8A93A6?style=flat-square)](#license)

</div>

---

## Overview

Large language models don't return the same answer twice, and blockchains demand
agreement. **TrueLogix** bridges the two. It runs raw input through a pipeline of
three specialized agents on [GenLayer](https://genlayer.com), where **each step is
a separate on-chain consensus round**: a leader executes the step, every other
validator independently re-runs it, and they vote on whether the outcomes *mean the
same thing* — GenLayer's **equivalence principle**. Only after a step reaches
consensus does the next agent consume its output.

Splitting the work into three narrow jobs is the key idea. A single prompt asked to
"extract, judge, and decide" blurs three very different responsibilities. TrueLogix
gives each agent one checkable contract, which makes validator agreement practical
and every decision **auditable end-to-end**.

> **Why it matters:** the same mechanism that lets a blockchain agree on a token
> transfer now agrees on the output of non-deterministic AI — without trusting any
> single node.

---

## Architectural Blueprint

```
   raw source ─▶ ┌───────────┐    ┌───────────┐    ┌───────────┐ ─▶ final
   + schema      │  AGENT A  │─▶──│  AGENT B  │─▶──│  AGENT C  │    decision
   + rules       │ Extractor │    │  Auditor  │    │Synthesizer│    (+ record
                 └─────┬─────┘    └─────┬─────┘    └─────┬─────┘     on-chain)
                       │                │                │
                   validators       validators       validators
                    re-run &         re-run &         re-run &
                    vote ✓✓✓         vote ✓✓✓         vote ✓✓✓
```

Each agent is **one `gl.nondet` block** with a **custom validator function** that
compares only the *consensus-critical projection* of the output — so cosmetic drift
is tolerated while substance must match.

### Agent A — Extractor / Verifier `#38BDF8`

Pulls requested fields out of the source **verbatim**. It transcribes and verifies;
it never reasons, infers, or completes.

- **Consumes:** raw source material + an extraction schema.
- **Produces:** one entry per field — `{ evidence, field_id, found, value }`.
- **Guardrails:** verbatim-only (a value must appear literally in the source); no
  cross-field inference; no outside knowledge; ambiguous match → **abstain and
  flag**, never guess; every found value carries its exact evidence substring.
- **Consensus:** validators must reproduce the identical `(field_id, found, value)` set.

### Agent B — Logic / Risk Auditor `#F59E0B`

Evaluates Agent A's **verified facts** against a rule set. It applies rules
mechanically and completely, and invents nothing.

- **Consumes:** Agent A's payload + rule set + constraints.
- **Produces:** a discrete verdict per rule (`pass` / `fail` / `not_applicable`),
  severities, edge findings, and an `overall_verdict`.
- **Guardrails:** facts come **only** from Agent A (never re-reads the source); a
  missing fact becomes `not_applicable`, never a fabricated pass/fail; the rule set
  is closed and severities are fixed.
- **Gate:** `reject` if any critical rule fails → else `flag` on any fail/edge →
  else `accept`.
- **Consensus:** validators must agree on the failing `(rule_id, severity)` set and
  the `overall_verdict`.

### Agent C — Consensus Synthesizer `#A78BFA`

Reconciles A and B into a single final decision with an auditable conflict record.
It operates only on the two typed payloads — never the raw source.

- **Consumes:** the full validated envelopes of Agent A and Agent B.
- **Produces:** `final_decision` ∈ `{ approve, review, reject, escalate }`,
  `combined_confidence`, rationale codes, and resolved/unresolved conflicts.
- **Policy (deterministic):** `combined_confidence = 0.40·conf_A + 0.60·conf_B`;
  **B's verdict is a ceiling** (a `reject` can never be upgraded); a confidence
  floor caps an `approve` down to `review`; every tie has a declared tie-break.
- **Consensus:** validators must agree on `final_decision` and the conflict dispositions.

---

## Technical Highlights

### The determinism contract

Deterministic output isn't a nice-to-have — it's what lets independent validators
reach the same answer. Every agent inherits a shared contract: single JSON object,
lexicographically ordered keys, total schema (no omissions), closed enum
vocabularies, and **no wall-clock / randomness / UUIDs**. Two runs on the same
input are identical.

### No floats on the wire → decimal strings

**GenVM calldata has no float type.** A stray `0.85` would fail to encode the moment
it crosses the `gl.nondet` boundary and break consensus. Every number in TrueLogix
is a **canonical decimal string** — `"0.85"`, `"1200.00"` — which is both
calldata-safe and byte-deterministic. (This was discovered the hard way and is now
enforced in the schema validation.)

### JSON safety guards

LLMs wrap JSON in prose, code fences, and trailing commas. A defensive coercion
layer strips the noise, extracts the object, and repairs it — or fails **loud** with
a typed `[LLM_ERROR]` so validators reject rather than commit garbage. Schema
validation is hand-rolled (GenVM has no `jsonschema` package).

### Error taxonomy for consensus on failure

Errors are prefix-tagged so validators know how to compare them:

| Prefix | Meaning | Validator behavior |
|--------|---------|--------------------|
| `[EXPECTED]` | Business/validation logic (deterministic) | Must match exactly |
| `[EXTERNAL]` | Deterministic external failure | Must match exactly |
| `[TRANSIENT]` | Network / 5xx | Agree if both hit it |
| `[LLM_ERROR]` | Malformed / invalid LLM output | Disagree → force leader rotation |

### Equivalence principles — agree on meaning, not bytes

Because LLM output is never byte-identical, each agent uses a **custom validator**
(`gl.vm.run_nondet_unsafe`) rather than `strict_eq` (which is an anti-pattern for LLM
calls). The validator re-runs the leader and compares the semantically meaningful
fields only — the exact behavior GenLayer's `prompt_comparative` principle describes,
made cheaper and stricter.

### On-chain persistence

Every run persists a record keyed by a **deterministic `run_id`**: the three
validated envelopes, the final decision, and the combined confidence — queryable via
`get_run`, `get_latest`, and `get_run_count` for after-the-fact replay and audit.

---

## Project Structure

```
TrueLogix/
├── contracts/
│   └── true_logix_consensus.py    # TrueLogixConsensus intelligent contract
│                                   #   · evaluate() write · A→B→C orchestration
│                                   #   · custom validators · schema validation
├── agents/                         # Agent prompt specifications (the "source of truth")
│   ├── 00_determinism_contract.md  #   shared determinism rules (inlined at runtime)
│   ├── agent_a_extractor.md        #   Agent A system prompt + schema
│   ├── agent_b_auditor.md          #   Agent B system prompt + schema
│   ├── agent_c_synthesizer.md      #   Agent C system prompt + schema
│   └── README.md                   #   pipeline overview + equivalence mapping
├── tests/
│   └── direct/
│       └── test_true_logix_consensus.py   # 16 direct-mode tests (LLM/web mocked)
├── frontend/                       # Vite + React + TypeScript + Tailwind dashboard
│   ├── src/
│   │   ├── lib/                    #   simulator · genlayer wiring · wallet · runner
│   │   └── components/             #   hero · live demo · educational sections
│   └── README.md                   #   frontend-specific docs
├── requirements.txt                # genlayer-test + genvm-linter
└── README.md                       # you are here
```

---

## Local Development & Testing

### 1. Intelligent contract — lint & test

Requires Python 3.12+ (the direct-test SDK loads its own GenVM runner).

```bash
# From the repo root
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # genlayer-test + genvm-linter

# Lint (AST safety + SDK semantics) — must pass before tests
genvm-lint check contracts/true_logix_consensus.py

# Run the direct-mode suite (fast, in-memory, LLM/web mocked)
python -m pytest tests/direct/ -q
```

Expected:

```
16 passed
```

The suite covers all three consensus stages, the successful approve/reject paths,
malformed-JSON handling (hard revert **and** safe recovery), input-validation
reverts, and — via `run_validator` — consensus **agreement**, **disagreement**, and
leader-error → forced disagreement.

> **Note:** on some machines global pytest plugins can break collection under newer
> Python. If so, run inside the venv (which isolates them) or disable them:
> `python -m pytest tests/direct/ -q -p no:hydra_pytest -p no:langsmith_plugin -p no:anyio`

### 2. Frontend — interactive dashboard

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

By default the dashboard runs a **client-side simulation** that mirrors the
contract's exact weighting and decision logic — no wallet or gas required. Feed in a
record, watch the pipeline reach consensus, and inspect every JSON envelope it emits.

**Connect a wallet** (MetaMask / injected / GenLayer provider) and set a deployed
contract to run the pipeline **on-chain** — `Run consensus` then signs `evaluate()`
with your account:

```bash
cp .env.example .env    # set VITE_GENLAYER_CONTRACT + VITE_GENLAYER_NETWORK
npm install genlayer-js
```

See [`frontend/README.md`](frontend/README.md) for details.

---

## Ecosystem & Resources

| Resource | Link |
|----------|------|
| GenLayer | https://genlayer.com |
| GenLayer Docs | https://docs.genlayer.com |
| GenLayer SDK (Python + JS) | https://sdk.genlayer.com |
| GenLayer Studio | https://studio.genlayer.com |
| This repository | https://github.com/moltaphet/TrueLogix |

**Key concepts to read up on:** intelligent contracts, `gl.nondet` execution,
equivalence principles (`strict_eq`, `prompt_comparative`, `prompt_non_comparative`),
and calldata encoding.

---

## How It Fits Together

```
 source_material ─▶ Agent A ─▶ envelope_A ─┐
 rule_set ────────▶ Agent B ─▶ envelope_B ─┴─▶ Agent C ─▶ final decision + record
                       ▲
                envelope_A feeds B as the verified factual substrate
```

Each envelope passes its **own** validator consensus round before the next agent
consumes it. Three consensus rounds chain into one decision you can replay, inspect,
and audit.

---

## License

MIT.

<div align="center">

**Built on GenLayer** · deterministic consensus over non-deterministic work.

</div>
