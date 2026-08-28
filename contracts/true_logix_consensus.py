# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
TrueLogix - Multi-Agent Consensus Orchestrator (Step 2)

Orchestrates the A -> B -> C pipeline inside a single write transaction. Only the
part that genuinely needs an LLM runs as a nondet consensus block; the rest is
deterministic Python that every validator computes identically.

Design note on where non-determinism lives
------------------------------------------
Extraction (Agent A) is inherently fuzzy, so it MUST call an LLM. Auditing A's
verified facts against the rule set (Agent B) and synthesizing the final decision
(Agent C) are pure functions of A's output -- so they are computed
deterministically in the transaction's consensus-critical path, NOT via an LLM.
This minimizes the non-deterministic surface to a single stage:

  * Agent A: LLM extraction inside `gl.vm.run_nondet_unsafe`. Each validator
    re-runs the leader and compares only the consensus-critical projection
    (status + the set of (field_id, found) pairs -- see section 4), so per-field
    value / evidence / confidence text may drift without breaking consensus.
  * Agent B: DETERMINISTIC rule evaluation in pure Python (section 4b).
  * Agent C: DETERMINISTIC synthesis in pure Python (section 4b).

Because B and C are byte-identical across every validator, they can never be the
source of a disagreement (Status 3) or a leader rotation. Only Agent A's field
extraction can vary, and its projection is loose enough to absorb non-semantic
noise. `strict_eq` on the LLM call is deliberately avoided: LLM output is not
byte-reproducible, so it would fail consensus even on semantically equal answers.

The deterministic B/C logic mirrors frontend/src/lib/simulator.ts so the
client-side demo and the on-chain contract produce the same decisions.
"""

from genlayer import *

import json
import re

# ---------------------------------------------------------------------------
# Error classification prefixes (see write-contract error taxonomy).
# Validators use these to decide whether a failure is deterministic (must match)
# or non-deterministic (agree/rotate).
# ---------------------------------------------------------------------------
ERROR_EXPECTED = "[EXPECTED]"    # business/validation logic - exact match required
ERROR_EXTERNAL = "[EXTERNAL]"    # deterministic external failure - exact match
ERROR_TRANSIENT = "[TRANSIENT]"  # network/5xx - agree if both transient
ERROR_LLM = "[LLM_ERROR]"        # malformed/invalid LLM output - force rotation

SCHEMA_VERSION = "1.0.0"

# Closed vocabularies (mirror agents/*.md schemas) -------------------------------
STATUS_SET = {"ok", "refused", "error"}
B_VERDICT_SET = {"pass", "fail", "not_applicable"}
B_SEVERITY_SET = {"none", "low", "medium", "high", "critical"}
B_OVERALL_SET = {"accept", "flag", "reject"}
C_DECISION_SET = {"approve", "review", "reject", "escalate"}
C_RESOLUTION_SET = {
    "defer_to_facts",
    "defer_to_audit",
    "flag_integrity_mismatch",
    "require_human_review",
}


# ===========================================================================
# 1. PROMPTS - runtime-canonical extraction of TrueLogix/agents/*.md
#    (the markdown files are the human spec; these constants are what the
#    contract actually loads/interpolates at execution time)
# ===========================================================================

DETERMINISM_CONTRACT = """\
--- DETERMINISM CONTRACT v1.0.0 (mandatory) ---
D0. Emit EXACTLY ONE JSON object. First char '{', last char '}'. No markdown
    fences, no prose, no chain-of-thought. On failure, still emit one JSON object
    using the error envelope.
D1. At every level, object keys are ordered lexicographically ascending (ASCII).
D2. Emit EVERY schema key. Unknown/absent -> explicit sentinel (null/false/[]/
    enum member). Never omit a key; never guess a plausible value.
D3. Trim whitespace; collapse internal whitespace runs to one space; apply NFC.
    Labels you author are lowercase snake_case. Extracted values are verbatim
    (casing/characters preserved), never translated/corrected/reformatted.
D4. ALL numbers are serialized as JSON STRINGS (GenVM calldata has no float type):
    emit "0.85" and "1200.00", never 0.85 or 1200.00. Integers: digits only, no
    leading zeros ("7", "-3", "0"). Decimals: fixed precision (default 2), '.'
    separator, no thousands separators, no scientific notation, banker's rounding
    ("1200.00"). Booleans stay real JSON booleans (lowercase true/false).
D5. Arrays sorted deterministically by the documented sort key; no duplicates.
D6. Enum fields accept ONLY listed members; unmatched -> the schema fallback member.
D7. No wall-clock, dates, randomness, UUIDs, node identity, model name, or any
    environment-derived value. Identifiers are derived from content/index only.
    Two runs on the same input MUST be identical; if any rule conflicts with that,
    identical output wins.
D8. Envelope: {"agent","confidence","payload","schema_version","status"}.
    confidence: decimal STRING in ["0.00","1.00"] from the agent rubric (e.g. "0.85").
    status: ok|refused|error. schema_version fixed "%s". On status!=ok:
    payload={"code":<enum>,"detail":<str>}, confidence "0.00".
--- END DETERMINISM CONTRACT ---""" % SCHEMA_VERSION

AGENT_A_SYSTEM = """\
You are Agent A (Extractor/Verifier) in the TrueLogix consensus module on GenLayer.
Extract requested fields from SOURCE_MATERIAL EXACTLY as they appear. You transcribe
and verify; you never reason, infer, compute, translate, or complete.

Anti-hallucination guardrails (highest priority):
1. Verbatim-only: a field value may contain only a span contiguously present in
   SOURCE_MATERIAL. If the fact is not literally present, value=null, found=false.
2. No external knowledge; no defaults; no plausibility fill.
3. No cross-field inference (do not derive one field from another).
4. Every found=true field carries `evidence`: the exact source substring holding it.
5. Ambiguity -> abstain: if multiple distinct spans could satisfy a field and no
   disambiguation rule is given, found=false, value=null, add field_id to `ambiguous`.
6. Type discipline: numeric values are emitted as JSON STRINGS per D4 (e.g.
   "value":"1200.00"), representation only, not meaning; dates copied verbatim;
   enum fields map only to an exact allowed member else null.

Confidence: round(found_count / requested_count, 2), emitted as a decimal STRING
(e.g. "0.75"). If requested_count==0 -> status="error",
payload={"code":"empty_schema","detail":...}.

Payload schema (agent "A"), keys sorted:
{"ambiguous":[field_id...],
 "fields":[{"evidence":<str|null>,"field_id":<str>,"found":<bool>,"value":<str|null>}]}
fields sorted ascending by field_id; ambiguous sorted ascending.
Error codes: empty_schema | empty_source | malformed_schema | source_exceeds_limit."""


def _assemble_prompt(system: str, sections: list) -> str:
    """Compose determinism contract + agent system prompt + runtime inputs."""
    parts = [DETERMINISM_CONTRACT, system]
    parts.extend(sections)
    parts.append('Return ONLY the JSON envelope object. No other text.')
    return "\n\n".join(parts)


def build_prompt_a(source_material: str, extraction_schema: str) -> str:
    return _assemble_prompt(
        AGENT_A_SYSTEM,
        [f"SOURCE_MATERIAL:\n{source_material}", f"EXTRACTION_SCHEMA:\n{extraction_schema}"],
    )




# ===========================================================================
# 2. STRICT CANONICAL SERIALIZATION (consensus determinism)
#    LLMs emit object keys AND array elements in arbitrary order, and that order
#    differs from one validator to the next. json.dumps(sort_keys=True) fixes the
#    key order but NOT the array element order, so two validators can serialize
#    the exact same semantic envelope into two different byte strings. That byte
#    drift is what leaves execution stuck in COMMITTING with leader rotation.
#
#    _canonicalize recursively rewrites the object into an order-independent form:
#    dict keys are sorted by json.dumps(sort_keys=True); list elements are sorted
#    by their own canonical serialization. After this, ALL validators dump the
#    identical deterministic byte string and reach consensus instantly.
# ===========================================================================

def _canonicalize(obj):
    """Return an order-independent copy of `obj`: every list is sorted by each
    element's own canonical form so array ordering cannot vary across validators.
    Dict key ordering is handled by json.dumps(sort_keys=True) at dump time."""
    if isinstance(obj, dict):
        return {k: _canonicalize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        items = [_canonicalize(v) for v in obj]
        return sorted(items, key=lambda v: json.dumps(v, sort_keys=True, ensure_ascii=False))
    return obj


def _canonical_json(obj) -> str:
    """Serialize `obj` to the single deterministic byte string every validator
    must agree on: object keys lexicographically sorted AND array elements sorted
    into a canonical order. Use this for anything returned from or persisted by
    the contract so consensus is byte-for-byte reproducible."""
    return json.dumps(_canonicalize(obj), sort_keys=True, ensure_ascii=False)


# ===========================================================================
# 2b. JSON PARSING SAFEGUARDS
# ===========================================================================

def _coerce_to_dict(raw) -> dict:
    """
    Turn an exec_prompt result into a dict. Accepts an already-parsed dict, or a
    string containing a JSON object (possibly wrapped in prose / code fences).
    Raises an LLM-class UserError on anything unrecoverable.
    """
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        raise gl.vm.UserError(f"{ERROR_LLM} exec_prompt returned {type(raw).__name__}, expected dict/str")

    text = raw.strip()
    # Strip a leading ```json / ``` fence if the model added one despite instructions.
    if text.startswith("```"):
        text = text.strip("`")
        if text[:4].lower() == "json":
            text = text[4:]
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1 or last < first:
        raise gl.vm.UserError(f"{ERROR_LLM} No JSON object found in LLM output")
    text = text[first:last + 1]
    # Remove trailing commas before } or ]
    text = re.sub(r",\s*([}\]])", r"\1", text)
    try:
        obj = json.loads(text)
    except (ValueError, TypeError) as e:
        raise gl.vm.UserError(f"{ERROR_LLM} JSON parse failed: {str(e)[:120]}")
    if not isinstance(obj, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} Top-level JSON is {type(obj).__name__}, expected object")
    return obj


# ===========================================================================
# 3. SCHEMA VALIDATION (hand-rolled; GenVM has no jsonschema package)
#    Any violation raises an LLM-class UserError so validators force rotation
#    rather than committing malformed state.
# ===========================================================================

def _fail(msg: str):
    raise gl.vm.UserError(f"{ERROR_LLM} schema: {msg}")


def _req(obj: dict, key: str, types):
    if key not in obj:
        _fail(f"missing key '{key}'")
    if not isinstance(obj[key], types):
        _fail(f"key '{key}' has wrong type")
    return obj[key]


# Numbers are serialized as JSON strings (calldata has no float type). A confidence
# or combined_confidence must be a canonical decimal string, e.g. "0.85".
_DECIMAL_RE = re.compile(r"^-?\d+(\.\d+)?$")


def _is_decimal_str(x) -> bool:
    return isinstance(x, str) and _DECIMAL_RE.match(x) is not None


def _validate_envelope_common(env: dict, expected_agent: str) -> dict:
    if not isinstance(env, dict):
        _fail("envelope is not an object")
    agent = _req(env, "agent", str)
    if agent != expected_agent:
        _fail(f"agent '{agent}' != expected '{expected_agent}'")
    status = _req(env, "status", str)
    if status not in STATUS_SET:
        _fail(f"invalid status '{status}'")
    if _req(env, "schema_version", str) != SCHEMA_VERSION:
        _fail("schema_version mismatch")
    conf = _req(env, "confidence", str)
    if not _is_decimal_str(conf) or not (0.0 <= float(conf) <= 1.0):
        _fail("confidence must be a decimal string in [0,1]")
    payload = _req(env, "payload", dict)
    if status != "ok":
        code = _req(payload, "code", str)
        _req(payload, "detail", str)
        if not code:
            _fail("empty error code")
    return env


def _validate_str_list(obj: dict, key: str):
    val = _req(obj, key, list)
    for item in val:
        if not isinstance(item, str):
            _fail(f"'{key}' must be a list of strings")
    return val


def _validate_a(env: dict) -> dict:
    _validate_envelope_common(env, "A")
    if env["status"] != "ok":
        return env
    p = env["payload"]
    _validate_str_list(p, "ambiguous")
    fields = _req(p, "fields", list)
    for f in fields:
        if not isinstance(f, dict):
            _fail("fields entry not an object")
        _req(f, "field_id", str)
        _req(f, "found", bool)
        if "evidence" not in f or not isinstance(f["evidence"], (str, type(None))):
            _fail("field.evidence must be str|null")
        # Values are verbatim strings (numbers included, per D4) or null.
        if "value" not in f or not isinstance(f["value"], (str, type(None))):
            _fail("field.value must be str|null")
    return env


def _validate_b(env: dict) -> dict:
    _validate_envelope_common(env, "B")
    if env["status"] != "ok":
        return env
    p = env["payload"]
    ov = _req(p, "overall_verdict", str)
    if ov not in B_OVERALL_SET:
        _fail(f"invalid overall_verdict '{ov}'")
    for e in _req(p, "edges", list):
        if not isinstance(e, dict):
            _fail("edge not an object")
        _req(e, "edge_code", str)
        _validate_str_list(e, "evidence_ref")
    for r in _req(p, "rules", list):
        if not isinstance(r, dict):
            _fail("rule not an object")
        _req(r, "rule_id", str)
        if _req(r, "verdict", str) not in B_VERDICT_SET:
            _fail("invalid rule.verdict")
        if _req(r, "severity", str) not in B_SEVERITY_SET:
            _fail("invalid rule.severity")
        _req(r, "reason_code", str)
        _validate_str_list(r, "evidence_ref")
    return env


def _validate_c(env: dict) -> dict:
    _validate_envelope_common(env, "C")
    if env["status"] != "ok":
        return env
    p = env["payload"]
    if _req(p, "final_decision", str) not in C_DECISION_SET:
        _fail("invalid final_decision")
    if not _is_decimal_str(_req(p, "combined_confidence", str)):
        _fail("combined_confidence must be a decimal string")
    for d in _validate_str_list(p, "degraded_inputs"):
        if d not in ("A", "B"):
            _fail("degraded_inputs must be subset of {A,B}")
    _validate_str_list(p, "rationale_codes")
    for c in _req(p, "resolved_conflicts", list):
        if not isinstance(c, dict):
            _fail("resolved_conflict not an object")
        _req(c, "conflict_id", str)
        _req(c, "conflict_type", str)
        if _req(c, "resolution_action", str) not in C_RESOLUTION_SET:
            _fail("invalid resolution_action")
        _validate_str_list(c, "evidence_ref")
    for c in _req(p, "unresolved_conflicts", list):
        if not isinstance(c, dict):
            _fail("unresolved_conflict not an object")
        _req(c, "conflict_id", str)
        _req(c, "conflict_type", str)
        _validate_str_list(c, "evidence_ref")
    return env


# ===========================================================================
# 4. CONSENSUS-CRITICAL PROJECTION FOR AGENT A (the only nondet/LLM stage)
#    Robust-semantic equivalence: each validator json.loads both its own and the
#    leader's envelope and compares ONLY the deterministic outcome fields,
#    tolerating the per-field value / evidence / confidence text that inevitably
#    drifts across independent LLM runs. This clears Status 3 (validators voting
#    "disagree") while still verifying every validator extracted the same facts:
#
#      * Agent A: status + the set of (field_id, found) pairs.
#
#    (Agents B and C are deterministic Python -- section 4b -- so they need no
#    projection: every validator computes them byte-identically.)
#    Status is carried implicitly: a non-ok envelope routes to _nonok_key, so a
#    leader/validator status mismatch always fails equality.
# ===========================================================================

def _nonok_key(env: dict):
    # Deterministic errors must match on the same code; keeps failure paths in consensus.
    return ("__status__", env.get("status"), env.get("payload", {}).get("code"))


def _key_a(env: dict):
    if env.get("status") != "ok":
        return _nonok_key(env)
    fields = env["payload"]["fields"]
    # Agree on WHICH fields were found; tolerate the extracted value / evidence
    # text, which is inherently noisy across independent LLM runs.
    found_set = frozenset((f["field_id"], bool(f["found"])) for f in fields)
    return ("A", found_set)




# ===========================================================================
# 4b. DETERMINISTIC AGENTS B AND C (pure Python, NO LLM)
#     Only Agent A (fuzzy extraction) needs an LLM and therefore a nondet
#     consensus block. Auditing A's verified facts against the rule set (B) and
#     synthesizing the final decision (C) are pure functions of A's output, so we
#     compute them in the transaction's deterministic path: every validator runs
#     identical Python and agrees byte-for-byte -- no LLM divergence, no leader
#     rotation, no Status 3 for B or C. This mirrors the reference logic in
#     frontend/src/lib/simulator.ts so the demo and the chain stay in lockstep.
# ===========================================================================

_SEVERITY_RE = re.compile(r"\[(none|low|medium|high|critical)\]", re.IGNORECASE)
_RULE_ID_RE = re.compile(r"^([a-z0-9_]+)\s*:", re.IGNORECASE)
_RULE_IN_RE = re.compile(r"([a-z0-9_]+)\s+in\s*\{([^}]*)\}", re.IGNORECASE)
_RULE_CMP_RE = re.compile(r"([a-z0-9_]+)\s*(<=|>=|<|>)\s*([0-9.]+)", re.IGNORECASE)
_RULE_PRESENT_RE = re.compile(r"([a-z0-9_]+)\s+(?:present|found|required)", re.IGNORECASE)


def _round2(n: float) -> str:
    """Banker's rounding to 2 decimals, emitted as a fixed 2-decimal STRING (D4).
    All inputs here are confidences in [0, 1], so x is always non-negative."""
    x = n * 100.0
    floor = int(x)
    diff = x - floor
    if abs(diff - 0.5) < 1e-9:
        r = floor if floor % 2 == 0 else floor + 1
    else:
        r = int(x + 0.5)
    return "%.2f" % (r / 100.0)


def _to_number(text):
    """Parse a numeric string the way JS Number() does for our inputs: return a
    float, or None on failure. None mirrors NaN -- every ordering comparison
    against it is False, so an unparseable value fails a threshold rule."""
    try:
        return float(str(text).strip())
    except (ValueError, TypeError):
        return None


def _parse_rules(rule_set: str) -> list:
    """Parse the rule DSL into structured rules. Grammar (per entry, ';'/newline
    separated): '<id>: <field> <op> <rhs> [severity]' where op is one of
    <= >= < > , 'in {a,b}', or a bare 'present'/'found'/'required'."""
    entries = [e.strip() for e in re.split(r"[;\n]+", rule_set) if e.strip()]
    rules = []
    for i, raw in enumerate(entries):
        sev_m = _SEVERITY_RE.search(raw)
        severity = sev_m.group(1).lower() if sev_m else "medium"
        body = re.sub(r"\[[^\]]*\]", "", raw, count=1).strip()
        id_m = _RULE_ID_RE.match(body)
        rule_id = id_m.group(1) if id_m else ("r_%d" % i)
        expr = body[id_m.end():].strip() if id_m else body

        in_m = _RULE_IN_RE.search(expr)
        if in_m:
            rules.append({"rule_id": rule_id, "field": in_m.group(1), "op": "in",
                          "rhs": in_m.group(2), "severity": severity})
            continue
        cmp_m = _RULE_CMP_RE.search(expr)
        if cmp_m:
            rules.append({"rule_id": rule_id, "field": cmp_m.group(1), "op": cmp_m.group(2),
                          "rhs": cmp_m.group(3), "severity": severity})
            continue
        pres_m = _RULE_PRESENT_RE.search(expr)
        if pres_m:
            rules.append({"rule_id": rule_id, "field": pres_m.group(1), "op": "present",
                          "rhs": "", "severity": severity})
            continue
        parts = expr.split()
        rules.append({"rule_id": rule_id, "field": parts[0] if parts else "unknown",
                      "op": "present", "rhs": "", "severity": severity})
    return rules


def _compute_agent_b(envelope_a: dict, rule_set: str, constraints: str) -> dict:
    """Agent B, deterministic: evaluate each parsed rule against Agent A's fields.
    A rule whose field A did not find is 'not_applicable' (never a fabricated
    pass/fail). overall_verdict gates on critical failures / any failure / edges."""
    rules = _parse_rules(rule_set)
    fields = envelope_a.get("payload", {}).get("fields", [])
    by_id = {}
    for f in fields:
        fid = f.get("field_id")
        by_id[fid] = f
        if isinstance(fid, str):
            by_id.setdefault(fid.lower(), f)

    evaluated = []
    edges = []
    for r in rules:
        field = by_id.get(r["field"])
        if field is None and isinstance(r["field"], str):
            field = by_id.get(r["field"].lower())
        verdict = "pass"
        reason = "ok"
        severity = "none"
        val = field.get("value") if field else None
        if field is None or not field.get("found") or val is None:
            verdict = "not_applicable"
            reason = "missing_input"
            if r["op"] == "present":
                edges.append({"edge_code": "missing_required_field", "evidence_ref": [r["field"]]})
        else:
            op = r["op"]
            passed = True
            if op == "present":
                passed = True
            elif op == "in":
                opts = [s.strip().lower() for s in re.split(r"[|,]", r["rhs"])]
                passed = str(val).lower() in opts
            else:
                num = _to_number(val)
                rhs = _to_number(r["rhs"])
                if num is None or rhs is None:
                    passed = False
                elif op == "<=":
                    passed = num <= rhs
                elif op == ">=":
                    passed = num >= rhs
                elif op == "<":
                    passed = num < rhs
                else:
                    passed = num > rhs
                if not passed:
                    edges.append({"edge_code": "value_out_of_range", "evidence_ref": [r["field"]]})
            if not passed:
                verdict = "fail"
                severity = r["severity"]
                reason = "constraint_violation" if op == "in" else "threshold_breach"
        evaluated.append({
            "evidence_ref": [r["field"]],
            "reason_code": reason,
            "rule_id": r["rule_id"],
            "severity": severity,
            "verdict": verdict,
        })

    evaluated.sort(key=lambda x: x["rule_id"])
    edges.sort(key=lambda x: x["edge_code"])

    any_critical = any(r["verdict"] == "fail" and r["severity"] == "critical" for r in evaluated)
    any_fail = any(r["verdict"] == "fail" for r in evaluated)
    if any_critical:
        overall = "reject"
    elif any_fail or len(edges) > 0:
        overall = "flag"
    else:
        overall = "accept"

    decidable = sum(1 for r in evaluated if r["verdict"] in ("pass", "fail"))
    confidence = "0.00" if len(rules) == 0 else _round2(decidable / len(rules))

    return {
        "agent": "B",
        "confidence": confidence,
        "payload": {"edges": edges, "overall_verdict": overall, "rules": evaluated},
        "schema_version": SCHEMA_VERSION,
        "status": "ok",
    }


def _compute_agent_c(envelope_a: dict, envelope_b: dict, policy: str) -> dict:
    """Agent C, deterministic: weight A's and B's confidence, apply B's verdict as
    a ceiling, cap approve below the confidence floor, and record the driving
    fact/rule conflict. Any degraded upstream input -> escalate."""
    w_a = 0.40
    w_b = 0.60
    approve_floor = 0.70
    c_a = _to_number(envelope_a.get("confidence"))
    c_b = _to_number(envelope_b.get("confidence"))
    if c_a is None:
        c_a = 0.0
    if c_b is None:
        c_b = 0.0
    combined_str = _round2(w_a * c_a + w_b * c_b)
    combined = float(combined_str)

    degraded = []
    if envelope_a.get("status") != "ok":
        degraded.append("A")
    if envelope_b.get("status") != "ok":
        degraded.append("B")

    if len(degraded) > 0:
        degraded.sort()
        return {
            "agent": "C",
            "confidence": combined_str,
            "payload": {
                "combined_confidence": combined_str,
                "degraded_inputs": degraded,
                "final_decision": "escalate",
                "rationale_codes": ["upstream_degraded"],
                "resolved_conflicts": [],
                "unresolved_conflicts": [],
            },
            "schema_version": SCHEMA_VERSION,
            "status": "ok",
        }

    ceiling_rank = {"reject": 0, "flag": 1, "accept": 3}
    decision_by_rank = ["reject", "review", "review", "approve"]
    overall = envelope_b.get("payload", {}).get("overall_verdict", "accept")
    rank = ceiling_rank.get(overall, 1)
    rationale = []
    if overall == "reject":
        rationale.append("audit_ceiling_reject")
    elif overall == "flag":
        rationale.append("audit_ceiling_flag")

    if rank == 3 and combined < approve_floor:
        rank = 1
        rationale.append("confidence_floor_cap")
    if len(rationale) == 0:
        rationale.append("clean_approve")
    rationale.sort()

    final_decision = decision_by_rank[rank]

    failing = [r for r in envelope_b.get("payload", {}).get("rules", []) if r.get("verdict") == "fail"]
    resolved = []
    if failing:
        ev = list(failing[0].get("evidence_ref", []))
        ev.sort()
        resolved.append({
            "conflict_id": "c_0",
            "conflict_type": "fact_vs_rule",
            "evidence_ref": ev,
            "resolution_action": "defer_to_audit",
        })

    return {
        "agent": "C",
        "confidence": combined_str,
        "payload": {
            "combined_confidence": combined_str,
            "degraded_inputs": [],
            "final_decision": final_decision,
            "rationale_codes": rationale,
            "resolved_conflicts": resolved,
            "unresolved_conflicts": [],
        },
        "schema_version": SCHEMA_VERSION,
        "status": "ok",
    }


# ===========================================================================
# 5. LEADER-ERROR HANDLING FOR VALIDATORS
# ===========================================================================

def _normalize_caller(addr: str) -> str:
    """
    Normalize a caller address for use as a lookup key. Hex addresses are
    lowercased so lookups are case-insensitive (wallets may return checksummed or
    lowercase hex for the same account).
    """
    return addr.strip().lower()


def _handle_leader_error(leaders_res, leader_fn) -> bool:
    leader_msg = getattr(leaders_res, "message", "") or ""
    try:
        leader_fn()
        # Leader errored but validator succeeded -> disagree.
        return False
    except gl.vm.UserError as e:
        v_msg = getattr(e, "message", None) or str(e)
        if v_msg.startswith(ERROR_EXPECTED) or v_msg.startswith(ERROR_EXTERNAL):
            return v_msg == leader_msg          # deterministic: exact match
        if v_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
            return True                         # both transient: agree
        return False                            # LLM/unknown: disagree, rotate
    except Exception:
        return False


# ===========================================================================
# 6. THE CONTRACT / ORCHESTRATOR
# ===========================================================================

class TrueLogixConsensus(gl.Contract):
    owner: Address
    run_count: u256
    # run_id (str) -> full JSON record {a, b, c, final_decision, ...}
    records: TreeMap[str, str]
    # append-only compact index for enumeration
    history: DynArray[str]
    # caller address (lowercase hex) -> that caller's most recently assigned run_id.
    # This lets a frontend fetch the EXACT run its own transaction produced without
    # ever pre-reading (and racing on) the shared run_count. An interleaved
    # evaluate() from another caller cannot corrupt this lookup because it is keyed
    # by the caller's own address, not by the global counter.
    latest_run_by_caller: TreeMap[str, str]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.run_count = u256(0)

    # ---- internal generic nondet runner -----------------------------------
    def _run_agent(self, prompt: str, validate_fn, key_fn) -> str:
        """
        Execute one agent as a gl.nondet block with a custom validator.

        Returns the validated envelope as a **canonical JSON string**. The nondet
        boundary is calldata-encoded, and GenVM calldata cannot encode Python
        floats (confidence, numeric field values, combined_confidence). Passing a
        string across the boundary is therefore both float-safe and byte-canonical;
        the orchestrator json.loads() it at each hop.

        leader_fn:    calls the LLM, parses + schema-validates, returns canonical JSON.
        validator_fn: re-runs the leader and compares the consensus-critical
                      projection (key_fn). Byte drift in non-critical fields is
                      tolerated; disagreement on the projection fails consensus.
        """
        def leader_fn() -> str:
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            # SDK compatibility: older runners return a Lazy[str|dict] that must be
            # resolved via .get(); newer runners return the value directly.
            if type(raw).__name__ == "Lazy":
                raw = raw.get()
            env = _coerce_to_dict(raw)
            validate_fn(env)
            # Emit the strict canonical byte string (keys AND array elements
            # sorted) so every validator returns the identical bytes for a
            # semantically identical envelope -> instant consensus, no rotation.
            return _canonical_json(env)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)
            try:
                mine = leader_fn()
            except gl.vm.UserError:
                # Validator could not produce a valid envelope though leader did.
                return False
            try:
                leader_env = json.loads(leaders_res.calldata)
                return key_fn(leader_env) == key_fn(json.loads(mine))
            except Exception:
                return False

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    # ---- public orchestrator ----------------------------------------------
    @gl.public.write
    def evaluate(
        self,
        source_material: str,
        extraction_schema: str,
        rule_set: str,
        constraints: str = "",
        policy: str = "",
    ) -> dict:
        """
        Run the full A -> B -> C consensus pipeline and persist the result.

        Each stage is an independent gl.nondet consensus block; a stage only
        proceeds once the previous one has reached validator agreement.
        Returns a compact summary; the full record is stored on-chain.
        """
        if not isinstance(source_material, str) or source_material.strip() == "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} source_material must be a non-empty string")
        if not isinstance(extraction_schema, str) or extraction_schema.strip() == "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} extraction_schema must be a non-empty string")
        if not isinstance(rule_set, str) or rule_set.strip() == "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} rule_set must be a non-empty string")

        # Stage A - extract & verify facts. The ONLY LLM/nondet stage; returns a
        # canonical JSON string that the orchestrator parses back into a dict.
        envelope_a = json.loads(self._run_agent(
            build_prompt_a(source_material, extraction_schema),
            _validate_a,
            _key_a,
        ))

        # Stage B - audit A's facts against the rules. DETERMINISTIC: computed in
        # pure Python, identically by every validator (no LLM, no nondet block),
        # so it can never be the source of a consensus disagreement.
        envelope_b = _compute_agent_b(envelope_a, rule_set, constraints)
        _validate_b(envelope_b)

        # Stage C - synthesize the final decision from A and B. DETERMINISTIC too.
        envelope_c = _compute_agent_c(envelope_a, envelope_b, policy)
        _validate_c(envelope_c)

        # Derive a deterministic run_id from the persisted counter (no randomness).
        # The counter is only advanced here, atomically inside this transaction, so
        # the run_id assigned below is unambiguously THIS transaction's run_id.
        run_id = "run_" + str(int(self.run_count))
        self.run_count = u256(int(self.run_count) + 1)
        caller_key = self._caller_key()

        c_payload = envelope_c.get("payload", {})
        final_decision = c_payload.get("final_decision", "escalate")
        # Already a canonical decimal string (calldata has no float type).
        combined_conf = c_payload.get("combined_confidence", "0.00")

        record = {
            "run_id": run_id,
            "status": envelope_c.get("status", "error"),
            "final_decision": final_decision,
            "combined_confidence": combined_conf,
            "envelope_a": envelope_a,
            "envelope_b": envelope_b,
            "envelope_c": envelope_c,
            "requested_by": self._sender_str(),
        }
        record_json = _canonical_json(record)
        self.records[run_id] = record_json
        self.history.append(run_id)
        # Record this caller's most recent run so the frontend can resolve the
        # exact run by caller address (race-free) instead of guessing from a
        # pre-read of the shared counter.
        self.latest_run_by_caller[caller_key] = run_id

        # The assigned run_id is returned so callers that can decode the write
        # transaction's return value read their exact run directly from the receipt.
        return {
            "run_id": run_id,
            "status": envelope_c.get("status", "error"),
            "final_decision": final_decision,
            "combined_confidence": combined_conf,
        }

    # ---- views -------------------------------------------------------------
    @gl.public.view
    def get_run(self, run_id: str) -> str:
        if run_id not in self.records:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown run_id '{run_id}'")
        return self.records[run_id]

    @gl.public.view
    def get_latest(self) -> str:
        if len(self.history) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} no runs recorded")
        return self.records[self.history[-1]]

    @gl.public.view
    def get_latest_run_id_by_caller(self, caller: str) -> str:
        """
        Return the run_id most recently assigned to `caller`.

        Deterministic and race-free: the lookup is keyed by the caller's own
        address, so an interleaved evaluate() from a different caller cannot make
        this return someone else's run. The frontend uses this to fetch the exact
        run its transaction produced without pre-reading the shared run counter.
        """
        key = _normalize_caller(caller)
        if key not in self.latest_run_by_caller:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} no runs recorded for caller '{caller}'")
        return self.latest_run_by_caller[key]

    @gl.public.view
    def get_latest_run_by_caller(self, caller: str) -> str:
        """Full JSON record for `caller`'s most recent run (see get_latest_run_id_by_caller)."""
        run_id = self.get_latest_run_id_by_caller(caller)
        return self.records[run_id]

    @gl.public.view
    def get_run_count(self) -> int:
        return int(self.run_count)

    # ---- helpers -----------------------------------------------------------
    def _sender_str(self) -> str:
        try:
            return gl.message.sender_address.as_hex
        except Exception:
            return str(gl.message.sender_address)

    def _caller_key(self) -> str:
        return _normalize_caller(self._sender_str())
