import { Section, Reveal } from "./primitives";

const STEPS = [
  {
    n: "01",
    title: "A leader runs the work",
    body: "For each agent, one validator is chosen as leader and executes the step — calling the LLM, parsing the answer, and producing a strict JSON envelope.",
  },
  {
    n: "02",
    title: "Validators re-run it",
    body: "Every other validator independently executes the same step and compares its result against the leader's — not byte-for-byte, but on the fields that actually matter.",
  },
  {
    n: "03",
    title: "They vote to agree",
    body: "Each validator returns a single boolean. If a quorum agrees, the step is finalized on-chain; if not, the leader rotates and the step re-runs.",
  },
  {
    n: "04",
    title: "The next agent begins",
    body: "Only after a step reaches consensus does the next agent consume its output. Three consensus rounds chain into one auditable decision.",
  },
];

export default function Overview() {
  return (
    <Section
      id="overview"
      index="§1"
      eyebrow="how it works"
      title="Consensus on non-deterministic work"
      lead="LLMs don't give the same answer twice, and blockchains demand agreement. GenLayer bridges the two with an equivalence principle: validators re-run a step and vote on whether the outcomes mean the same thing — not whether they're identical."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 80}>
            <div className="panel h-full p-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-verify">{s.n}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-chalk">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fog-bright">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={120}>
        <div className="mt-6 panel flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <div className="kicker mb-2">why three agents</div>
            <p className="text-sm leading-relaxed text-fog-bright">
              A single prompt asked to "extract, judge, and decide" blurs three very different jobs. TrueLogix
              splits them so each agent has one narrow contract: the Extractor never reasons, the Auditor never
              invents facts, and the Synthesizer never re-reads raw data. Narrow jobs are easier for validators
              to agree on — which makes consensus cheaper and the decision easier to audit.
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-3 sm:w-64">
            {[
              { k: "Extract", v: "facts only", c: "#38BDF8" },
              { k: "Audit", v: "rules only", c: "#F59E0B" },
              { k: "Synthesize", v: "decide only", c: "#A78BFA" },
            ].map((x) => (
              <div key={x.k} className="rounded-xl border border-line bg-ink-850 p-3 text-center">
                <div className="mx-auto mb-2 h-1.5 w-1.5 rounded-full" style={{ background: x.c, boxShadow: `0 0 10px ${x.c}` }} />
                <div className="font-display text-xs font-semibold text-chalk">{x.k}</div>
                <div className="mt-0.5 font-mono text-[9px] text-fog">{x.v}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
