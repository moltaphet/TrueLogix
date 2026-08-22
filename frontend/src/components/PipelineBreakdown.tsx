import { useState } from "react";
import { Section, JsonView, AGENT_META } from "./primitives";
import type { AgentId } from "../types";

interface AgentDoc {
  consumes: string;
  produces: string;
  principle: string;
  guardrails: string[];
  sample: unknown;
}

const DOCS: Record<AgentId, AgentDoc> = {
  A: {
    consumes: "raw source material + extraction schema",
    produces: "verified facts — one entry per requested field",
    principle: "custom validator · identical (field_id, found, value) set",
    guardrails: [
      "Verbatim-only: a value must appear literally in the source.",
      "No inference across fields, no outside knowledge, no defaults.",
      "Ambiguous match → abstain and flag, never guess.",
      "Every found value carries its exact evidence substring.",
    ],
    sample: {
      agent: "A",
      confidence: "0.75",
      payload: {
        ambiguous: [],
        fields: [
          { evidence: "Total due: 1,200.00 USD", field_id: "currency", found: true, value: "USD" },
          { evidence: "Total due: 1,200.00 USD", field_id: "total_amount", found: true, value: "1200.00" },
          { evidence: null, field_id: "due_date", found: false, value: null },
        ],
      },
      schema_version: "1.0.0",
      status: "ok",
    },
  },
  B: {
    consumes: "Agent A's verified facts + rule set + constraints",
    produces: "a discrete verdict per rule + an overall gate",
    principle: "custom validator · same failing (rule_id, severity) + overall_verdict",
    guardrails: [
      "Facts come only from Agent A — never re-read the source.",
      "Missing fact → not_applicable, never a fabricated pass/fail.",
      "Rule set is closed; severities are fixed, never re-weighted.",
      "reject if any critical fails; else flag on any fail/edge; else accept.",
    ],
    sample: {
      agent: "B",
      confidence: "0.67",
      payload: {
        edges: [{ edge_code: "value_out_of_range", evidence_ref: ["total_amount"] }],
        overall_verdict: "reject",
        rules: [
          { evidence_ref: ["total_amount"], reason_code: "threshold_breach", rule_id: "r_amount_cap", severity: "critical", verdict: "fail" },
          { evidence_ref: ["currency"], reason_code: "ok", rule_id: "r_currency_allowed", severity: "none", verdict: "pass" },
        ],
      },
      schema_version: "1.0.0",
      status: "ok",
    },
  },
  C: {
    consumes: "the full validated envelopes of Agent A and Agent B",
    produces: "one final decision with an auditable conflict record",
    principle: "custom validator · same final_decision + conflict dispositions",
    guardrails: [
      "Operates only on A's and B's typed payloads — no raw source.",
      "B's verdict is a ceiling: a reject can never be upgraded.",
      "Confidence floor caps an approve down to review.",
      "Every tie has a declared, reproducible tie-break.",
    ],
    sample: {
      agent: "C",
      confidence: "0.70",
      payload: {
        combined_confidence: "0.70",
        degraded_inputs: [],
        final_decision: "reject",
        rationale_codes: ["audit_ceiling_reject"],
        resolved_conflicts: [
          { conflict_id: "c_0", conflict_type: "fact_vs_rule", evidence_ref: ["r_amount_cap", "total_amount"], resolution_action: "defer_to_audit" },
        ],
        unresolved_conflicts: [],
      },
      schema_version: "1.0.0",
      status: "ok",
    },
  },
};

const ORDER: AgentId[] = ["A", "B", "C"];

export default function PipelineBreakdown() {
  const [sel, setSel] = useState<AgentId>("A");
  const doc = DOCS[sel];
  const meta = AGENT_META[sel];

  return (
    <Section
      id="pipeline"
      index="§2"
      eyebrow="the agents"
      title="Three narrow contracts, in order"
      lead="Select an agent to see what it consumes, the guardrails it runs under, the exact envelope it emits, and how validators decide it reached consensus."
    >
      {/* selector tabs */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ORDER.map((a, i) => {
          const m = AGENT_META[a];
          const activeSel = a === sel;
          return (
            <button
              key={a}
              onClick={() => setSel(a)}
              className="panel group flex items-center gap-3 p-4 text-left transition-all"
              style={{ borderColor: activeSel ? m.color + "88" : undefined, boxShadow: activeSel ? `0 0 0 1px ${m.color}55, 0 0 40px -12px ${m.color}` : undefined }}
              aria-pressed={activeSel}
            >
              <span className="font-mono text-sm" style={{ color: activeSel ? m.color : "#8A93A6" }}>
                0{i + 1}
              </span>
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.color, boxShadow: activeSel ? `0 0 12px ${m.color}` : "none" }} />
              <span>
                <span className="block font-display text-sm font-semibold text-chalk">{m.name}</span>
                <span className="block font-mono text-[10px] text-fog">{m.role}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="panel p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: meta.color, boxShadow: `0 0 12px ${meta.color}` }} />
            <h3 className="font-display text-lg font-semibold text-chalk">
              {meta.name} — <span style={{ color: meta.color }}>{meta.role}</span>
            </h3>
          </div>

          <DefRow label="consumes" value={doc.consumes} />
          <DefRow label="produces" value={doc.produces} />
          <DefRow label="consensus" value={doc.principle} mono />

          <div className="mt-5">
            <div className="kicker mb-2">guardrails</div>
            <ul className="space-y-2">
              {doc.guardrails.map((g) => (
                <li key={g} className="flex gap-2.5 text-sm text-fog-bright">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="kicker">output envelope</span>
            <span className="font-mono text-[10px] text-fog/70">json · calldata-safe</span>
          </div>
          <JsonView value={doc.sample} className="max-h-[420px]" />
        </div>
      </div>
    </Section>
  );
}

function DefRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0 first:pt-0 sm:flex-row sm:gap-4">
      <span className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-wide text-fog">{label}</span>
      <span className={`text-sm text-chalk ${mono ? "font-mono text-[12px] text-fog-bright" : ""}`}>{value}</span>
    </div>
  );
}
