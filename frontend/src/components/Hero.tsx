import { useEffect, useState } from "react";
import ConduitDiagram from "./ConduitDiagram";
import type { AgentId } from "../types";

const CYCLE: AgentId[] = ["A", "B", "C"];

export default function Hero() {
  // Ambient loop of the pipeline in the hero; frozen if reduced motion.
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(4);
      return;
    }
    const t = setInterval(() => setStep((s) => (s + 1) % 5), 1100);
    return () => clearInterval(t);
  }, []);

  const active = step < 3 ? CYCLE[step] : null;
  const completed = CYCLE.slice(0, Math.min(step, 3));
  const locked = step >= 4;

  return (
    <section id="top" className="relative overflow-hidden pb-8 pt-28 sm:pt-32">
      <div className="pointer-events-none absolute inset-0 bg-grid [background-size:44px_44px] opacity-[0.5] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-radial-fade" />

      <div className="relative mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-ink-800/60 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulseRing rounded-full bg-verify opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-verify" />
            </span>
            <span className="font-mono text-[11px] tracking-wide text-fog-bright">
              Multi-agent consensus · built on GenLayer
            </span>
          </div>

          <h1 className="text-balance font-display text-4xl font-semibold leading-[1.05] tracking-tight text-chalk sm:text-6xl">
            Three agents. One
            <span className="relative whitespace-nowrap">
              {" "}
              verifiable{" "}
              <span className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full bg-gradient-to-r from-agentA via-agentB to-agentC" />
            </span>
            decision.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-fog-bright">
            TrueLogix runs raw data through a specialized pipeline — an Extractor, a Risk Auditor, and a
            Synthesizer — where every step is re-run by independent validators and must agree before the
            next begins. The result is a decision you can audit, not just trust.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="#demo" className="btn btn-primary">
              Run the live demo
              <span aria-hidden>→</span>
            </a>
            <a href="#overview" className="btn btn-ghost">
              How consensus works
            </a>
          </div>
        </div>

        {/* Signature: the live consensus conduit */}
        <div className="relative mx-auto mt-14 max-w-4xl panel p-5 sm:p-8">
          <div className="mb-3 flex items-center justify-between">
            <span className="kicker">pipeline · gl.nondet</span>
            <span className="font-mono text-[11px] text-fog/70">leader → validators → consensus</span>
          </div>
          <ConduitDiagram active={active} completed={completed} locked={locked} />
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-ink-850 px-4 py-5 text-center">
              <div className="font-display text-2xl font-semibold text-chalk">{s.value}</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-fog">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const STATS = [
  { value: "3", label: "specialized agents" },
  { value: "5×", label: "validator re-runs" },
  { value: "100%", label: "deterministic output" },
  { value: "0", label: "floats in calldata" },
];
