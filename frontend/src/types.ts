// Envelope shapes mirror TrueLogix/agents/*.md and contracts/true_logix_consensus.py.
// Numbers are decimal STRINGS — GenVM calldata has no float type.

export type AgentId = "A" | "B" | "C";
export type Status = "ok" | "refused" | "error";

export interface EnvelopeBase {
  agent: AgentId;
  confidence: string; // decimal string, e.g. "0.85"
  schema_version: string;
  status: Status;
}

export interface FieldA {
  evidence: string | null;
  field_id: string;
  found: boolean;
  value: string | null; // numbers are strings too, per D4
}

export interface EnvelopeA extends EnvelopeBase {
  agent: "A";
  payload: { ambiguous: string[]; fields: FieldA[] };
}

export type Verdict = "pass" | "fail" | "not_applicable";
export type Severity = "none" | "low" | "medium" | "high" | "critical";
export type OverallVerdict = "accept" | "flag" | "reject";

export interface RuleB {
  evidence_ref: string[];
  reason_code: string;
  rule_id: string;
  severity: Severity;
  verdict: Verdict;
}

export interface EnvelopeB extends EnvelopeBase {
  agent: "B";
  payload: {
    edges: { edge_code: string; evidence_ref: string[] }[];
    overall_verdict: OverallVerdict;
    rules: RuleB[];
  };
}

export type FinalDecision = "approve" | "review" | "reject" | "escalate";

export interface EnvelopeC extends EnvelopeBase {
  agent: "C";
  payload: {
    combined_confidence: string;
    degraded_inputs: string[];
    final_decision: FinalDecision;
    rationale_codes: string[];
    resolved_conflicts: {
      conflict_id: string;
      conflict_type: string;
      evidence_ref: string[];
      resolution_action: string;
    }[];
    unresolved_conflicts: { conflict_id: string; conflict_type: string; evidence_ref: string[] }[];
  };
}

export type AnyEnvelope = EnvelopeA | EnvelopeB | EnvelopeC;

export interface ConsensusInput {
  source_material: string;
  extraction_schema: string;
  rule_set: string;
  constraints: string;
  policy: string;
}

export type StagePhase = "idle" | "running" | "voting" | "done" | "error";

// A single event streamed from the consensus runner as the pipeline advances.
export interface StageEvent {
  agent: AgentId;
  phase: StagePhase;
  envelope?: AnyEnvelope;
  error?: string;
  mode: "simulation" | "onchain";
  // Populated on the final done event when running on-chain.
  tx_hash?: string;
}
