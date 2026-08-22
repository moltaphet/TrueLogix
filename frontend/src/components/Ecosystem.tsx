import { Section, Reveal } from "./primitives";
import { GITHUB_URL } from "./Nav";

const LINKS = [
  {
    label: "Source repository",
    desc: "Contracts, agent prompts, and the direct-mode test suite.",
    href: GITHUB_URL,
    tag: "github",
    accent: "#E6EAF2",
  },
  {
    label: "GenLayer docs",
    desc: "Intelligent contracts, gl.nondet, and equivalence principles.",
    href: "https://docs.genlayer.com",
    tag: "docs",
    accent: "#34D399",
  },
  {
    label: "GenLayer Studio",
    desc: "Deploy and interact with intelligent contracts in the browser.",
    href: "https://studio.genlayer.com",
    tag: "studio",
    accent: "#38BDF8",
  },
  {
    label: "GenLayer SDK",
    desc: "genlayer-js — wire this dashboard to a deployed instance.",
    href: "https://sdk.genlayer.com",
    tag: "sdk",
    accent: "#A78BFA",
  },
];

export default function Ecosystem() {
  return (
    <Section
      id="resources"
      index="§5"
      eyebrow="ecosystem & resources"
      title="Build on it, or read the source"
      lead="Everything you need to verify the claims on this page and take TrueLogix further."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LINKS.map((l, i) => (
          <Reveal key={l.label} delay={i * 60}>
            <a
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="panel group flex items-center gap-4 p-5 transition-all hover:-translate-y-0.5"
              style={{ borderColor: l.accent + "22" }}
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-mono text-xs"
                style={{ background: l.accent + "14", color: l.accent, boxShadow: `0 0 0 1px ${l.accent}33` }}
              >
                {l.tag.slice(0, 2)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-display text-[15px] font-semibold text-chalk">{l.label}</span>
                  <span className="font-mono text-[10px] text-fog">/{l.tag}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-fog-bright">{l.desc}</p>
              </div>
              <span className="font-mono text-fog transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-chalk" aria-hidden>
                ↗
              </span>
            </a>
          </Reveal>
        ))}
      </div>

      <Reveal delay={200}>
        <div className="mt-8 panel flex flex-col items-center gap-4 p-8 text-center">
          <div className="kicker">start here</div>
          <h3 className="max-w-xl font-display text-2xl font-semibold text-chalk">
            Run a decision through all three agents
          </h3>
          <p className="max-w-md text-sm text-fog-bright">
            No wallet, no setup. Feed in a record, watch the pipeline reach consensus, and inspect every envelope it emits.
          </p>
          <a href="#demo" className="btn btn-primary mt-1">
            Open the live demo →
          </a>
        </div>
      </Reveal>
    </Section>
  );
}
