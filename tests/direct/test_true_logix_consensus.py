"""
Direct-mode test suite for contracts/true_logix_consensus.py (Step 3).

Covered:
  * All three consensus stages (A -> B -> C) execute and produce typed envelopes.
  * Successful execution paths: clean-approve and audit-driven reject.
  * Agent B provably consumes Agent A's payload.
  * Malformed-LLM-JSON handling: hard revert (unrecoverable) and safe recovery
    (fenced / trailing-comma output the JSON safeguards clean up).
  * Deterministic input-validation reverts.
  * Consensus AGREEMENT and DISAGREEMENT for Agent A via its captured custom
    validator (run_validator), plus leader-error -> forced disagreement.
  * Agents B and C are deterministic pure Python (no nondet block), so they emit
    no validator and can never be a disagreement source.
  * Deterministic run_id sequencing / persistence.

Notes on the framework (gltest direct mode):
  - `direct_vm.mock_llm(pattern, response)` matches a regex against the prompt and
    returns `response`; JSON strings are auto-parsed to a dict for exec_prompt.
  - Direct mode runs LEADER functions only. Validator logic (our consensus
    disagreement checks) is exercised explicitly via `direct_vm.run_validator`,
    which re-runs the captured leader against the *current* mocks — so swapping a
    mock between `evaluate()` and `run_validator()` simulates a validator seeing a
    divergent LLM answer.
  - Each `evaluate()` captures exactly ONE validator: index 0 = Agent A (the only
    nondet/LLM stage). Agents B and C are deterministic Python, so they register
    no validator.
"""

import json

import pytest

CONTRACT = "contracts/true_logix_consensus.py"

# Unique, regex-safe substrings present only in each agent's assembled prompt.
A_PAT = r"Extractor/Verifier"
B_PAT = r"Logic/Risk Auditor"
C_PAT = r"Consensus Synthesizer"


# --------------------------------------------------------------------------- #
# Envelope builders (valid per the agents/*.md schemas)                        #
# --------------------------------------------------------------------------- #
def env_a(fields=None, ambiguous=None, confidence="1.00"):
    if fields is None:
        fields = [
            {"evidence": "Total due: 500.00 USD", "field_id": "currency",
             "found": True, "value": "USD"},
            {"evidence": "Total due: 500.00 USD", "field_id": "total_amount",
             "found": True, "value": "500.00"},  # numbers are decimal strings (D4)
            {"evidence": "Vendor: Acme", "field_id": "vendor_name",
             "found": True, "value": "Acme"},
        ]
    return json.dumps({
        "agent": "A",
        "confidence": confidence,
        "payload": {"ambiguous": ambiguous or [], "fields": fields},
        "schema_version": "1.0.0",
        "status": "ok",
    })


def env_b(overall="accept", rules=None, edges=None, confidence="1.00"):
    if rules is None:
        rules = [
            {"evidence_ref": ["currency"], "reason_code": "ok",
             "rule_id": "r_currency_allowed", "severity": "none", "verdict": "pass"},
            {"evidence_ref": ["total_amount"], "reason_code": "ok",
             "rule_id": "r_amount_cap", "severity": "none", "verdict": "pass"},
        ]
    return json.dumps({
        "agent": "B",
        "confidence": confidence,
        "payload": {"edges": edges or [], "overall_verdict": overall, "rules": rules},
        "schema_version": "1.0.0",
        "status": "ok",
    })


def env_c(decision="approve", cc="0.85", rationale=None, resolved=None, unresolved=None):
    return json.dumps({
        "agent": "C",
        "confidence": cc,
        "payload": {
            "combined_confidence": cc,
            "degraded_inputs": [],
            "final_decision": decision,
            "rationale_codes": rationale or ["clean_approve"],
            "resolved_conflicts": resolved or [],
            "unresolved_conflicts": unresolved or [],
        },
        "schema_version": "1.0.0",
        "status": "ok",
    })


# --------------------------------------------------------------------------- #
# Mock wiring helpers                                                          #
# --------------------------------------------------------------------------- #
def _llm(s: str) -> str:
    """
    Faithfully simulate the GenVM LLM host.

    GenVM calldata has NO float type, so exec_prompt(response_format="json") returns
    the model's answer as a STRING (the JSON text), never a parsed dict — the
    contract json.loads() it itself. gltest's mock auto-json.loads() a JSON string
    exactly once, so we wrap one extra level here; after that single unwrap, the
    contract receives the envelope *text* (with any decimals safely inside a string).
    """
    return json.dumps(s)


def mock_all(direct_vm, a=None, b=None, c=None):
    direct_vm.mock_llm(A_PAT, _llm(a if a is not None else env_a()))
    direct_vm.mock_llm(B_PAT, _llm(b if b is not None else env_b()))
    direct_vm.mock_llm(C_PAT, _llm(c if c is not None else env_c()))


SRC = "Invoice #A-90. Total due: 500.00 USD. Vendor: Acme"
SCHEMA = "total_amount:number(2); currency:enum(USD|EUR); vendor_name:string"
RULES = "r_currency_allowed: currency in {USD,EUR} [high]; r_amount_cap: total_amount<=1000 [critical]"


def _run(contract):
    return contract.evaluate(SRC, SCHEMA, RULES, "", "")


# --------------------------------------------------------------------------- #
# 1. Successful path — all three stages, clean approve                         #
# --------------------------------------------------------------------------- #
def test_pipeline_clean_approve(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm)

    result = _run(contract)

    assert result["run_id"] == "run_0"
    assert result["status"] == "ok"
    assert result["final_decision"] == "approve"
    # Deterministic Agent C: combined = 0.40*c_a + 0.60*c_b. Both A (mocked "1.00")
    # and the computed B ("1.00", every rule decidable and passing) are fully
    # confident, so combined = 0.40 + 0.60 = "1.00". (Agent C is pure Python now,
    # so the mocked env_c confidence is intentionally ignored.)
    assert result["combined_confidence"] == "1.00"
    assert contract.get_run_count() == 1


def test_all_three_stages_executed_and_stored(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm)

    _run(contract)
    record = json.loads(contract.get_latest())

    # Each stage produced a well-formed, correctly-tagged envelope.
    assert record["envelope_a"]["agent"] == "A"
    assert record["envelope_b"]["agent"] == "B"
    assert record["envelope_c"]["agent"] == "C"
    assert record["envelope_a"]["status"] == "ok"
    assert record["envelope_b"]["payload"]["overall_verdict"] == "accept"
    assert record["envelope_c"]["payload"]["final_decision"] == "approve"


# --------------------------------------------------------------------------- #
# 2. Stage B provably consumes Stage A's payload                               #
# --------------------------------------------------------------------------- #
def test_stage_b_consumes_agent_a_payload(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice

    # B mock only matches if A's extracted field_id ("total_amount") is present in
    # the prompt B receives — i.e. A's payload was interpolated into B's prompt.
    direct_vm.mock_llm(A_PAT, _llm(env_a()))
    direct_vm.mock_llm(r"Logic/Risk Auditor(?s:.)*total_amount", _llm(env_b()))
    direct_vm.mock_llm(C_PAT, _llm(env_c()))

    result = _run(contract)  # would raise MockNotFoundError if B lacked A's data
    assert result["final_decision"] == "approve"


# --------------------------------------------------------------------------- #
# 3. Successful path — audit-driven rejection                                  #
# --------------------------------------------------------------------------- #
def test_pipeline_reject_flow(direct_vm, direct_deploy, direct_alice):
    # Agents B and C are deterministic pure Python, so a rejection is driven by the
    # FACTS Agent A extracts, not by a mocked B/C envelope. Here A extracts a
    # total_amount that breaches the critical `r_amount_cap: total_amount<=1000`
    # rule, so B computes overall_verdict=reject and C synthesizes final=reject.
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    over_cap_fields = [
        {"evidence": "Total due: 1500.00 USD", "field_id": "currency",
         "found": True, "value": "USD"},
        {"evidence": "Total due: 1500.00 USD", "field_id": "total_amount",
         "found": True, "value": "1500.00"},  # > 1000 cap -> critical fail
        {"evidence": "Vendor: Acme", "field_id": "vendor_name",
         "found": True, "value": "Acme"},
    ]
    mock_all(direct_vm, a=env_a(fields=over_cap_fields))

    result = _run(contract)

    assert result["final_decision"] == "reject"
    record = json.loads(contract.get_latest())
    assert record["envelope_b"]["payload"]["overall_verdict"] == "reject"
    assert record["envelope_c"]["payload"]["rationale_codes"] == ["audit_ceiling_reject"]
    # The critical breach is recorded as a fact-vs-rule conflict resolved by the audit.
    resolved = record["envelope_c"]["payload"]["resolved_conflicts"]
    assert resolved and resolved[0]["resolution_action"] == "defer_to_audit"


# --------------------------------------------------------------------------- #
# 4. Malformed JSON — unrecoverable output reverts with [LLM_ERROR]            #
# --------------------------------------------------------------------------- #
def test_malformed_json_agent_a_reverts(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm, a="I could not find any JSON here, sorry.")

    with direct_vm.expect_revert("[LLM_ERROR]"):
        _run(contract)


def test_malformed_json_wrong_agent_tag_reverts(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    # Valid JSON, but schema-invalid: agent "Z" where "A" is required.
    bad = json.dumps({"agent": "Z", "confidence": "1.00", "payload": {},
                      "schema_version": "1.0.0", "status": "ok"})
    mock_all(direct_vm, a=bad)

    with direct_vm.expect_revert("[LLM_ERROR]"):
        _run(contract)


# --------------------------------------------------------------------------- #
# 5. Malformed JSON — safeguards RECOVER fenced + trailing-comma output        #
# --------------------------------------------------------------------------- #
def test_malformed_json_recovered_by_safeguards(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice

    # Real JSON wrapped in a ```json fence with a trailing comma before ']'.
    # Strict json.loads fails (so the mock is delivered as a raw string), and the
    # contract's _coerce_to_dict must strip the fence and the trailing comma.
    messy_a = (
        "```json\n"
        '{"agent":"A","confidence":"1.00","payload":{"ambiguous":[],"fields":['
        '{"evidence":"Total due: 500.00 USD","field_id":"currency","found":true,"value":"USD"},'
        ']},"schema_version":"1.0.0","status":"ok"}'
        "\n```"
    )
    mock_all(direct_vm, a=messy_a)

    result = _run(contract)  # succeeds only if the safeguards recovered A's JSON
    assert result["status"] == "ok"
    assert result["final_decision"] == "approve"


# --------------------------------------------------------------------------- #
# 6. Deterministic input-validation reverts (no LLM involved)                  #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("src,schema,rules", [
    ("", SCHEMA, RULES),        # empty source
    (SRC, "   ", RULES),        # blank schema
    (SRC, SCHEMA, ""),          # empty rule set
])
def test_input_validation_reverts(direct_vm, direct_deploy, direct_alice, src, schema, rules):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("[EXPECTED]"):
        contract.evaluate(src, schema, rules, "", "")


# --------------------------------------------------------------------------- #
# 7. Consensus AGREEMENT — validators reproduce the leader projection          #
# --------------------------------------------------------------------------- #
def test_consensus_agreement_agent_a(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm)

    _run(contract)  # captures exactly one validator: Agent A (index 0)

    # Agent A is the ONLY nondet stage (B and C are deterministic Python). With the
    # mocks unchanged the validator re-runs the leader, derives the identical
    # consensus-critical projection, and agrees.
    assert direct_vm.run_validator(index=0) is True   # Agent A


# --------------------------------------------------------------------------- #
# 8. Consensus DISAGREEMENT — divergent LLM answer fails validation            #
# --------------------------------------------------------------------------- #
def test_consensus_disagreement_agent_a(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm)
    _run(contract)

    # Agent A's consensus-critical projection (_key_a) is the SET of
    # (field_id, found) pairs — extracted values are deliberately tolerated so
    # benign LLM noise never breaks consensus. So a disagreement requires a change
    # to WHICH fields were found: here the validator fails to extract total_amount
    # (found flips to false), changing the projection, so it must DISAGREE.
    divergent_fields = [
        {"evidence": "Total due: 500.00 USD", "field_id": "currency",
         "found": True, "value": "USD"},
        {"evidence": None, "field_id": "total_amount",
         "found": False, "value": None},
        {"evidence": "Vendor: Acme", "field_id": "vendor_name",
         "found": True, "value": "Acme"},
    ]
    direct_vm.clear_mocks()
    mock_all(direct_vm, a=env_a(fields=divergent_fields))

    assert direct_vm.run_validator(index=0) is False


def test_agents_b_and_c_are_deterministic_no_validator(direct_vm, direct_deploy, direct_alice):
    # Agents B and C are pure Python computed inside the transaction's
    # deterministic path — they are NOT nondet blocks. A single evaluate()
    # therefore captures exactly ONE validator (Agent A, index 0); there is no
    # Agent B or Agent C validator, so B/C can never vote "disagree" or trigger a
    # leader rotation. This is what previously made an Agent-B disagreement test
    # meaningless.
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm)

    _run(contract)

    assert direct_vm.run_validator(index=0) is True   # Agent A is the sole validator
    with pytest.raises(IndexError):
        direct_vm.run_validator(index=1)               # no Agent B validator exists


def test_consensus_leader_error_forces_disagree(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm)
    _run(contract)

    # Leader reported an error but this validator produces a valid envelope ->
    # must DISAGREE (never ratify a broken leader result).
    assert direct_vm.run_validator(
        index=0, leader_error=Exception("[TRANSIENT] upstream LLM timeout")
    ) is False


# --------------------------------------------------------------------------- #
# 9. Deterministic run_id sequencing / persistence                            #
# --------------------------------------------------------------------------- #
def test_run_id_deterministic_sequence(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm)

    r0 = _run(contract)
    r1 = _run(contract)

    assert r0["run_id"] == "run_0"
    assert r1["run_id"] == "run_1"
    assert contract.get_run_count() == 2
    assert json.loads(contract.get_run("run_1"))["run_id"] == "run_1"


def test_get_run_unknown_reverts(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("unknown run_id"):
        contract.get_run("run_999")


# --------------------------------------------------------------------------- #
# 10. Race-free exact readback: resolve a caller's exact run by address        #
#     (no pre-read of the shared counter), even when another caller interleaves #
# --------------------------------------------------------------------------- #
def test_latest_run_by_caller_is_exact_and_race_free(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    mock_all(direct_vm)

    # Alice submits run_0. Her caller address is recorded in the run under
    # "requested_by" (the exact string the contract keys the caller index by).
    direct_vm.sender = direct_alice
    alice_run = _run(contract)["run_id"]
    assert alice_run == "run_0"
    alice_addr = json.loads(contract.get_run("run_0"))["requested_by"]

    # Bob interleaves and submits run_1, advancing the shared counter. A frontend
    # that had pre-read the counter as 0 for Alice would now mis-fetch run_1.
    direct_vm.sender = direct_bob
    bob_run = _run(contract)["run_id"]
    assert bob_run == "run_1"
    bob_addr = json.loads(contract.get_run("run_1"))["requested_by"]
    assert alice_addr != bob_addr

    # Each caller still resolves THEIR OWN exact run purely from their address,
    # independent of the shared counter's current value.
    assert contract.get_latest_run_id_by_caller(alice_addr) == "run_0"
    assert json.loads(contract.get_latest_run_by_caller(alice_addr))["run_id"] == "run_0"
    assert contract.get_latest_run_id_by_caller(bob_addr) == "run_1"
    assert json.loads(contract.get_latest_run_by_caller(bob_addr))["run_id"] == "run_1"


def test_latest_run_by_caller_is_case_insensitive(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    mock_all(direct_vm)
    _run(contract)

    addr = json.loads(contract.get_run("run_0"))["requested_by"]
    assert contract.get_latest_run_id_by_caller(addr.upper()) == "run_0"
    assert contract.get_latest_run_id_by_caller(addr.lower()) == "run_0"


def test_latest_run_by_caller_unknown_reverts(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("no runs recorded for caller"):
        contract.get_latest_run_id_by_caller("0x000000000000000000000000000000000000dead")
