import { useState } from "react";
import { Section } from "./primitives";

const FAQS = [
  {
    q: "How is this different from calling one LLM three times?",
    a: "Each call here is a separate on-chain consensus round. A leader runs the step, every other validator re-runs it, and they vote before the result is accepted — so no single node's answer is trusted. Splitting extraction, audit, and synthesis also gives each step a narrow, checkable contract, which is what makes validator agreement practical.",
  },
  {
    q: "What happens when the LLM misbehaves?",
    a: "Malformed output is first repaired by a defensive JSON layer (fences stripped, trailing commas removed). If it still can't be parsed or fails schema validation, the step raises a typed [LLM_ERROR] and validators disagree with a broken leader — forcing leader rotation instead of committing bad state. A missing fact never becomes a guess; it becomes an explicit not_applicable.",
  },
  {
    q: "Why are all the numbers strings?",
    a: "GenVM's calldata encoding has no float type. If an agent emitted a bare 0.85, it would fail to encode the moment it crossed the gl.nondet boundary, and the step would never reach consensus. Serializing every number as a canonical decimal string (\"0.85\") is both calldata-safe and byte-deterministic.",
  },
  {
    q: "How do validators agree if LLMs are non-deterministic?",
    a: "They don't compare raw text. Each agent ships a custom validator that projects the envelope down to its consensus-critical fields — the extracted values for A, the failing rules and overall verdict for B, the final decision and conflict dispositions for C — and compares those. Cosmetic differences are ignored; substance must match.",
  },
  {
    q: "What actually gets stored on-chain?",
    a: "Every run persists a record keyed by a deterministic run_id: the three validated envelopes, the final decision, and the combined confidence. It's queryable through view methods (get_run, get_latest, get_run_count), so any decision can be replayed and audited after the fact.",
  },
  {
    q: "Can I use this without deploying the contract?",
    a: "Yes — this dashboard runs a client-side simulation that mirrors the contract's exact weighting and decision logic, so you can explore the pipeline with no wallet or gas. Set VITE_GENLAYER_CONTRACT and install genlayer-js to switch the same UI to a deployed instance.",
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section
      id="faq"
      index="§4"
      eyebrow="faq"
      title="Questions, answered plainly"
      lead="The things people ask first about multi-agent validation, LLM failure handling, and what lives on-chain."
    >
      <div className="mx-auto max-w-3xl divide-y divide-line overflow-hidden rounded-2xl border border-line bg-ink-800/50">
        {FAQS.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
                aria-expanded={isOpen}
              >
                <span className="font-mono text-xs text-verify">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 font-display text-[15px] font-medium text-chalk">{f.q}</span>
                <span
                  className="font-mono text-lg text-fog transition-transform duration-200"
                  style={{ transform: isOpen ? "rotate(45deg)" : "none" }}
                  aria-hidden
                >
                  +
                </span>
              </button>
              <div
                className="grid transition-all duration-300 ease-out"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 pl-[3.25rem] text-sm leading-relaxed text-fog-bright">{f.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
