import { Section, Reveal, JsonView } from "./primitives";

const CARDS = [
  {
    tag: "calldata",
    title: "No floats on the wire",
    body: "GenVM calldata has no float type. A stray 0.85 would fail to encode across the gl.nondet boundary and break consensus. Every number in TrueLogix is a canonical decimal string.",
    accent: "#38BDF8",
    demo: { confidence: "0.85", total_amount: "1200.00" },
  },
  {
    tag: "json safety",
    title: "Defensive parsing",
    body: "LLMs wrap JSON in prose, fences, and trailing commas. A coercion layer strips the noise, extracts the object, and repairs it — or fails loud with a typed error so validators reject rather than commit garbage.",
    accent: "#F59E0B",
    demo: { in: "```json\\n{ ..., }\\n```", out: "{ ... }" },
  },
  {
    tag: "equivalence",
    title: "Agree on meaning, not bytes",
    body: "Each agent uses a custom validator that compares only the consensus-critical projection — the facts, the failing rules, the final decision — so cosmetic drift is tolerated while substance must match.",
    accent: "#A78BFA",
    demo: { A: "(field_id, found, value)", B: "(rule_id, severity) + verdict", C: "final_decision + conflicts" },
  },
  {
    tag: "errors",
    title: "A taxonomy for failure",
    body: "Errors are tagged [EXPECTED], [EXTERNAL], [TRANSIENT], or [LLM_ERROR]. The prefix tells validators whether a failure is deterministic (must match) or transient (agree if both hit it), keeping failure paths in consensus too.",
    accent: "#34D399",
    demo: { EXPECTED: "must match", TRANSIENT: "agree if both", LLM_ERROR: "force rotate" },
  },
];

export default function ArchitectureInvariants() {
  return (
    <Section
      id="architecture"
      index="§3"
      eyebrow="architecture & invariants"
      title="The rules that make it hold"
      lead="Deterministic output isn't a nice-to-have here — it's what lets independent validators reach the same answer. Four invariants carry that weight."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {CARDS.map((c, i) => (
          <Reveal key={c.tag} delay={i * 70}>
            <div className="panel h-full p-6" style={{ borderColor: c.accent + "33" }}>
              <div className="mb-3 flex items-center gap-2.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: c.accent, boxShadow: `0 0 10px ${c.accent}` }} />
                <span className="font-mono text-[11px] uppercase tracking-kicker" style={{ color: c.accent }}>
                  {c.tag}
                </span>
              </div>
              <h3 className="font-display text-lg font-semibold text-chalk">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fog-bright">{c.body}</p>
              <div className="mt-4">
                <JsonView value={c.demo} className="text-[11.5px]" />
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
