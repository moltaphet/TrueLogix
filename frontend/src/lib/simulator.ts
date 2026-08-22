// Client-side simulation of the TrueLogix A -> B -> C pipeline.
// It mirrors the deterministic decision logic in
// contracts/true_logix_consensus.py so the demo teaches the real mechanism
// without a deployed contract or live LLM. Extraction is heuristic (no LLM),
// but the audit gate, weighting policy, and synthesis exactly follow the spec.

import type {
  ConsensusInput,
  EnvelopeA,
  EnvelopeB,
  EnvelopeC,
  FieldA,
  FinalDecision,
  OverallVerdict,
  RuleB,
  Severity,
  Verdict,
} from "../types";

const SCHEMA_VERSION = "1.0.0";

const round2 = (n: number): string => {
  // Banker's rounding to 2 dp, always emitted as a fixed 2-decimal STRING (D4).
  const x = n * 100;
  const floor = Math.floor(x);
  const diff = x - floor;
  let r: number;
  if (Math.abs(diff - 0.5) < 1e-9) r = floor % 2 === 0 ? floor : floor + 1;
  else r = Math.round(x);
  return (r / 100).toFixed(2);
};

// --- schema parsing --------------------------------------------------------
interface SchemaField {
  field_id: string;
  type: "number" | "enum" | "string" | "date";
  enum?: string[];
}

export function parseSchema(schema: string): SchemaField[] {
  return schema
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawId, rawType = "string"] = entry.split(":").map((p) => p.trim());
      const field_id = rawId.replace(/\s+/g, "_").toLowerCase();
      const enumMatch = rawType.match(/enum\s*\(([^)]*)\)/i);
      if (enumMatch) {
        return {
          field_id,
          type: "enum" as const,
          enum: enumMatch[1].split(/[|,]/).map((v) => v.trim()).filter(Boolean),
        };
      }
      if (/number|amount|int|float|decimal/i.test(rawType)) return { field_id, type: "number" as const };
      if (/date/i.test(rawType)) return { field_id, type: "date" as const };
      return { field_id, type: "string" as const };
    });
}

// --- Agent A: heuristic extraction -----------------------------------------
function extractField(source: string, f: SchemaField): FieldA {
  const notFound: FieldA = { evidence: null, field_id: f.field_id, found: false, value: null };

  if (f.type === "enum" && f.enum) {
    for (const opt of f.enum) {
      const re = new RegExp(`\\b${opt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const m = source.match(re);
      if (m) return { evidence: window(source, m.index ?? 0), field_id: f.field_id, found: true, value: opt };
    }
    return notFound;
  }

  if (f.type === "number") {
    const hit = extractNumber(source);
    if (hit) {
      const num = Number(hit.raw.replace(/[,\s]/g, ""));
      if (!Number.isNaN(num)) {
        const value = Number.isInteger(num) ? String(num) : num.toFixed(2);
        return { evidence: window(source, hit.index), field_id: f.field_id, found: true, value };
      }
    }
    return notFound;
  }

  if (f.type === "date") {
    const m = source.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
    if (m) return { evidence: window(source, m.index ?? 0), field_id: f.field_id, found: true, value: m[1] };
    return notFound;
  }

  // string: look for "field_id: value" or a labelled token, else a capitalized name.
  const label = f.field_id.replace(/_/g, "[ _]?");
  const kv = source.match(new RegExp(`${label}\\s*[:=]\\s*([^\\n,.;]+)`, "i"));
  if (kv) return { evidence: kv[0].trim(), field_id: f.field_id, found: true, value: kv[1].trim() };
  const cap = source.match(/\b([A-Z][A-Za-z]+(?:\s+(?:Ltd|Inc|LLC|Corp|Co)\.?)?)\b/);
  if (cap) return { evidence: window(source, cap.index ?? 0), field_id: f.field_id, found: true, value: cap[1].trim() };
  return notFound;
}

// Extract a "money-like" number, ignoring digits fused into identifiers such as
// "#A-90". Prefers values with a thousands separator or 2 decimals; falls back to
// a standalone integer. Boundary group avoids lookbehind for browser breadth.
function extractNumber(source: string): { raw: string; index: number } | null {
  const money = /(^|[^\w#$-])((?:\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?)|(?:\d+\.\d{1,2}))/;
  const m = money.exec(source);
  if (m) return { raw: m[2], index: (m.index ?? 0) + m[1].length };
  const intRe = /(^|[^\w#$-])(\d+)(?![\w])/;
  const mi = intRe.exec(source);
  if (mi) return { raw: mi[2], index: (mi.index ?? 0) + mi[1].length };
  return null;
}

function window(source: string, idx: number): string {
  const start = Math.max(0, idx - 12);
  return source.slice(start, Math.min(source.length, idx + 28)).replace(/\s+/g, " ").trim();
}

export function runAgentA(input: ConsensusInput): EnvelopeA {
  const schema = parseSchema(input.extraction_schema);
  if (schema.length === 0) {
    return {
      agent: "A",
      confidence: "0.00",
      payload: { ambiguous: [], fields: [] },
      schema_version: SCHEMA_VERSION,
      status: "error",
    };
  }
  const fields = schema
    .map((f) => extractField(input.source_material, f))
    .sort((a, b) => a.field_id.localeCompare(b.field_id));
  const found = fields.filter((f) => f.found).length;
  return {
    agent: "A",
    confidence: round2(found / schema.length),
    payload: { ambiguous: [], fields },
    schema_version: SCHEMA_VERSION,
    status: "ok",
  };
}

// --- Agent B: rule evaluation ----------------------------------------------
interface ParsedRule {
  rule_id: string;
  field: string;
  op: "<=" | ">=" | "<" | ">" | "in" | "present";
  rhs: string;
  severity: Severity;
}

export function parseRules(ruleSet: string): ParsedRule[] {
  return ruleSet
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw, i) => {
      const sevMatch = raw.match(/\[(none|low|medium|high|critical)\]/i);
      const severity = (sevMatch ? sevMatch[1].toLowerCase() : "medium") as Severity;
      const body = raw.replace(/\[[^\]]*\]/, "").trim();
      const idMatch = body.match(/^([a-z0-9_]+)\s*:/i);
      const rule_id = idMatch ? idMatch[1] : `r_${i}`;
      const expr = idMatch ? body.slice(idMatch[0].length).trim() : body;

      const inMatch = expr.match(/([a-z0-9_]+)\s+in\s*\{([^}]*)\}/i);
      if (inMatch) return { rule_id, field: inMatch[1], op: "in" as const, rhs: inMatch[2], severity };
      const cmp = expr.match(/([a-z0-9_]+)\s*(<=|>=|<|>)\s*([0-9.]+)/i);
      if (cmp) return { rule_id, field: cmp[1], op: cmp[2] as ParsedRule["op"], rhs: cmp[3], severity };
      const present = expr.match(/([a-z0-9_]+)\s+(?:present|found|required)/i);
      if (present) return { rule_id, field: present[1], op: "present" as const, rhs: "", severity };
      return { rule_id, field: expr.split(/\s+/)[0] || "unknown", op: "present" as const, rhs: "", severity };
    });
}

export function runAgentB(a: EnvelopeA, input: ConsensusInput): EnvelopeB {
  const rules = parseRules(input.rule_set);
  const byId = new Map(a.payload.fields.map((f) => [f.field_id, f]));
  const evaluated: RuleB[] = [];
  const edges: EnvelopeB["payload"]["edges"] = [];

  for (const r of rules) {
    const field = byId.get(r.field);
    let verdict: Verdict = "pass";
    let reason = "ok";
    let severity: Severity = "none";

    if (!field || !field.found || field.value === null) {
      verdict = "not_applicable";
      reason = "missing_input";
      if (r.op === "present") {
        edges.push({ edge_code: "missing_required_field", evidence_ref: [r.field] });
      }
    } else {
      const val = field.value;
      const num = Number(val);
      let pass = true;
      if (r.op === "present") pass = true;
      else if (r.op === "in") {
        const opts = r.rhs.split(/[|,]/).map((s) => s.trim());
        pass = opts.some((o) => o.toLowerCase() === val.toLowerCase());
      } else {
        const rhs = Number(r.rhs);
        pass =
          r.op === "<=" ? num <= rhs : r.op === ">=" ? num >= rhs : r.op === "<" ? num < rhs : num > rhs;
        if (!pass) edges.push({ edge_code: "value_out_of_range", evidence_ref: [r.field] });
      }
      if (!pass) {
        verdict = "fail";
        severity = r.severity;
        reason = r.op === "in" ? "constraint_violation" : "threshold_breach";
      }
    }
    evaluated.push({
      evidence_ref: [r.field],
      reason_code: reason,
      rule_id: r.rule_id,
      severity,
      verdict,
    });
  }

  evaluated.sort((x, y) => x.rule_id.localeCompare(y.rule_id));
  edges.sort((x, y) => x.edge_code.localeCompare(y.edge_code));

  const anyCritical = evaluated.some((r) => r.verdict === "fail" && r.severity === "critical");
  const anyFail = evaluated.some((r) => r.verdict === "fail");
  const overall: OverallVerdict = anyCritical
    ? "reject"
    : anyFail || edges.length > 0
    ? "flag"
    : "accept";

  const decidable = evaluated.filter((r) => r.verdict === "pass" || r.verdict === "fail").length;
  const confidence = rules.length === 0 ? "0.00" : round2(decidable / rules.length);

  return {
    agent: "B",
    confidence,
    payload: { edges, overall_verdict: overall, rules: evaluated },
    schema_version: SCHEMA_VERSION,
    status: "ok",
  };
}

// --- Agent C: synthesis (exact policy from the contract) -------------------
export function runAgentC(a: EnvelopeA, b: EnvelopeB): EnvelopeC {
  const wA = 0.4;
  const wB = 0.6;
  const approveFloor = 0.7;
  const cA = Number(a.confidence);
  const cB = Number(b.confidence);
  const combined = Number(round2(wA * cA + wB * cB));

  const degraded: string[] = [];
  if (a.status !== "ok") degraded.push("A");
  if (b.status !== "ok") degraded.push("B");

  const ceilingRank: Record<OverallVerdict, number> = { reject: 0, flag: 1, accept: 3 };
  const decisionByRank: FinalDecision[] = ["reject", "review", "review", "approve"];

  let rank = ceilingRank[b.payload.overall_verdict];
  const rationale: string[] = [];

  if (degraded.length > 0) {
    const c: EnvelopeC = {
      agent: "C",
      confidence: round2(combined),
      payload: {
        combined_confidence: round2(combined),
        degraded_inputs: degraded.sort(),
        final_decision: "escalate",
        rationale_codes: ["upstream_degraded"],
        resolved_conflicts: [],
        unresolved_conflicts: [],
      },
      schema_version: SCHEMA_VERSION,
      status: "ok",
    };
    return c;
  }

  if (b.payload.overall_verdict === "reject") rationale.push("audit_ceiling_reject");
  else if (b.payload.overall_verdict === "flag") rationale.push("audit_ceiling_flag");

  if (rank === 3 && combined < approveFloor) {
    rank = 1; // cap approve -> review
    rationale.push("confidence_floor_cap");
  }
  if (rationale.length === 0) rationale.push("clean_approve");

  const final: FinalDecision = decisionByRank[rank];

  // Record the fact/rule reconciliation that drove the ceiling, for auditability.
  const failing = b.payload.rules.filter((r) => r.verdict === "fail");
  const resolved = failing.length
    ? [
        {
          conflict_id: "c_0",
          conflict_type: "fact_vs_rule",
          evidence_ref: [...failing[0].evidence_ref].sort(),
          resolution_action: "defer_to_audit",
        },
      ]
    : [];

  return {
    agent: "C",
    confidence: round2(combined),
    payload: {
      combined_confidence: round2(combined),
      degraded_inputs: [],
      final_decision: final,
      rationale_codes: rationale.sort(),
      resolved_conflicts: resolved,
      unresolved_conflicts: [],
    },
    schema_version: SCHEMA_VERSION,
    status: "ok",
  };
}
