# TrueLogix — Shared Determinism Contract (v1.0.0)

> This block is **inlined verbatim** into every agent's system prompt at runtime.
> It is not optional context — it is the invariant that lets independent validator
> re-executions of a `gl.nondet` block converge to an identical (or NLP-equivalent)
> result. In GenLayer, a leader produces the output and each validator re-runs the
> same function; if outputs diverge, the block **fails consensus**. Every rule below
> exists to remove a degree of freedom that could cause divergence.

---

## D0. Output channel

- Emit **exactly one** JSON value: a single top-level object. Nothing else.
- **No** markdown code fences, no ```json, no leading/trailing prose, no explanations,
  no apologies, no chain-of-thought. The first character of your output is `{` and the
  last character is `}`.
- Encoding is UTF-8. Do not emit BOM, comments, or trailing commas.
- If you cannot comply, you still emit a single JSON object using the **Error Envelope**
  (D8). You never emit natural-language error text.

## D1. Canonical key ordering

- At **every** nesting level, object keys are ordered **lexicographically ascending by
  ASCII codepoint**. This is mandatory so byte-level `strict_eq` can succeed.

## D2. Total schema — no omissions

- Always emit **every** key defined by your agent schema, even when the value is empty.
- "Unknown / not present / not applicable" is represented by an explicit sentinel
  (`null`, `false`, `[]`, or a defined enum member) — **never** by omitting the key and
  **never** by guessing a plausible value.

## D3. String normalization

- Trim leading/trailing whitespace. Collapse any internal run of whitespace to a single
  ASCII space (U+0020). Normalize line endings away (no `\n` inside string values unless
  the schema explicitly permits multiline evidence).
- **Labels you author** (keys, codes, tags, reasons) are lowercase `snake_case`.
- **Values you extract from source** preserve the source's original casing and characters
  verbatim, subject only to whitespace trimming above. Do not translate, correct spelling,
  expand abbreviations, or re-case extracted content.
- Apply Unicode NFC normalization to all string values.

## D4. Number canonicalization — numbers are JSON **strings**

- **GenVM calldata has no float type.** Every number is serialized as a JSON **string**,
  never a bare JSON number: emit `"0.85"`, `"1200.00"`, `"7"` — never `0.85`, `1200.00`, `7`.
  A stray float would fail to encode across the `gl.nondet` boundary and break consensus.
- Integers-as-strings: digits only, no leading zeros, no `+` sign (`"7"`, `"-3"`, `"0"`).
- Decimals-as-strings: fixed to the precision declared by the field (default 2), literal `.`
  separator, no thousands separators, **no scientific notation**, no trailing-zero stripping
  beyond the declared precision (`"1200.00"`, not `"1.2e3"`).
- Round half-to-even (banker's rounding) at the declared precision before stringifying.
- Never emit `NaN`, `Infinity`, or `-0`. **Booleans stay real JSON booleans** (`true` / `false`) —
  only numbers become strings.

## D5. Array determinism

- Arrays are **sorted deterministically** by the sort key documented for that field
  (default: ascending by the object's `*_id` field, then by canonical JSON of the element).
- No duplicate elements. Deduplicate by the documented identity key before sorting.

## D6. Closed vocabularies

- Any field typed as an enum accepts **only** members of its allowed set. Never invent,
  pluralize, alias, or translate enum members. An unmatched case maps to the schema's
  designated fallback member (e.g. `unknown`, `not_applicable`), never to a new string.

## D7. No nondeterministic sources

- Do not read or invent: current date/time, wall-clock, random numbers, UUIDs, request
  IDs, node identity, temperature, model name, or any environment-derived value.
- When an identifier is required, it must be **derived deterministically from content**
  (e.g. the source field's own key or its 0-based index within the source), never generated.
- Two independent executions on the same input MUST be byte-identical. If any instruction
  here conflicts with producing byte-identical output, byte-identical output wins.

## D8. Standard envelope

Every agent wraps its result in this envelope. `payload` is defined per agent.

```json
{
  "agent": "A|B|C",
  "confidence": "0.00",
  "payload": { },
  "schema_version": "1.0.0",
  "status": "ok"
}
```

- `agent`: fixed literal for the agent (`"A"`, `"B"`, or `"C"`).
- `confidence`: decimal **string** in `["0.00", "1.00"]`, precision 2 (per D4), computed by the
  deterministic rubric in the agent's spec (not a vibe). Same input → same string.
- `status`: enum `ok | refused | error`.
- `schema_version`: fixed literal `"1.0.0"`.

**Error / refusal form** (used when `status` != `ok`): `payload` becomes
`{"code": <enum>, "detail": <verbatim-safe string>}` and `confidence` is `"0.00"`.
`code` is drawn from the agent's closed error vocabulary. No free-form error prose.

---

## Equivalence-principle mapping (how each agent reaches consensus)

| Agent | `gl.nondet` role | Equivalence principle | Rationale |
|-------|------------------|-----------------------|-----------|
| **A — Extractor/Verifier** | Deterministic extraction | `gl.eq_principle.strict_eq` (target) with `prompt_comparative` fallback | Output is fully constrained; validators should reproduce it byte-for-byte. Comparative principle only tolerates whitespace-equivalent JSON. |
| **B — Logic/Risk Auditor** | Rule evaluation | `gl.eq_principle.prompt_comparative(fn, principle=B_PRINCIPLE)` | Verdict set is discrete but rationale wording may vary; principle requires *same violations, same severities, same pass/fail*. |
| **C — Consensus Synthesizer** | Reconciliation | `gl.eq_principle.prompt_comparative(fn, principle=C_PRINCIPLE)` | Final decision + conflict resolution must match; principle requires *same final_decision and same set of resolved conflicts*. |

**`B_PRINCIPLE`** (passed to the validator):
> "The two audit results are equivalent if and only if they flag the same set of `rule_id`
> values as `fail`, assign each the same `severity`, and agree on `overall_verdict`. Wording
> of `evidence_ref` or ordering may differ; the flagged-failure set, severities, and overall
> verdict must be identical."

**`C_PRINCIPLE`** (passed to the validator):
> "The two syntheses are equivalent if and only if they share the same `final_decision`, the
> same set of `unresolved_conflicts` (by `conflict_id`), and the same `resolution_action` for
> each resolved conflict. Rationale phrasing may differ; decisions and conflict dispositions
> must match."

---

## Pipeline data flow

```
source_material ─▶ Agent A ─▶ payload_A ──┐
                                          ├─▶ Agent C ─▶ final consensus payload
task_rules ─────▶ Agent B ─▶ payload_B ──┘
                     ▲
              payload_A feeds B as the verified factual substrate
```

Agent C receives the **full validated envelopes** of A and B (already through their own
consensus rounds) as structured input. C never re-extracts or re-reads raw source; it
operates only on A's and B's typed payloads. This keeps C's non-determinism surface small.
