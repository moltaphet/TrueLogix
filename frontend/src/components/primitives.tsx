import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentId } from "../types";

export const AGENT_META: Record<
  AgentId,
  { name: string; role: string; color: string; text: string; ring: string; glow: string }
> = {
  A: {
    name: "Agent A",
    role: "Extractor / Verifier",
    color: "#38BDF8",
    text: "text-agentA",
    ring: "border-agentA/40",
    glow: "shadow-glowA",
  },
  B: {
    name: "Agent B",
    role: "Logic / Risk Auditor",
    color: "#F59E0B",
    text: "text-agentB",
    ring: "border-agentB/40",
    glow: "shadow-glowB",
  },
  C: {
    name: "Agent C",
    role: "Consensus Synthesizer",
    color: "#A78BFA",
    text: "text-agentC",
    ring: "border-agentC/40",
    glow: "shadow-glowC",
  },
};

/** Reveal children on scroll (respects reduced motion by showing immediately). */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return setShown(true);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setShown(true)),
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 0.6s cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 0.6s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

export function Section({
  id,
  index,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  index?: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="relative mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:py-28">
      <Reveal>
        <div className="mb-3 flex items-center gap-3">
          {index && <span className="font-mono text-xs text-fog/60">{index}</span>}
          <span className="kicker">{eyebrow}</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <h2 className="max-w-3xl font-display text-3xl font-semibold tracking-tight text-chalk sm:text-4xl">
          {title}
        </h2>
        {lead && <p className="mt-4 max-w-2xl text-balance text-fog-bright">{lead}</p>}
      </Reveal>
      <div className="mt-10">{children}</div>
    </section>
  );
}

/** Minimal JSON pretty-printer with token highlighting. */
export function JsonView({ value, className = "" }: { value: unknown; className?: string }) {
  // Be resilient to the contract handing back stringified JSON (the strict
  // determinism fixes serialize envelopes with json.dumps): parse a JSON string
  // back into an object so it pretty-prints instead of showing a quoted blob.
  // Never crash on undefined/null - show a small placeholder instead.
  let rendered: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    try {
      rendered = trimmed === "" ? null : JSON.parse(trimmed);
    } catch {
      rendered = value; // not JSON - display the raw string as-is
    }
  }
  const text = rendered === undefined || rendered === null ? "// no data" : JSON.stringify(rendered, null, 2);
  return (
    <pre
      className={`scroll-slim overflow-auto rounded-xl border border-line bg-ink-950/80 px-4 py-3.5 font-mono text-[12px] leading-[1.75] [tab-size:2] ${className}`}
    >
      <code dangerouslySetInnerHTML={{ __html: highlight(text) }} />
    </pre>
  );
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(json: string): string {
  return esc(json)
    .replace(/("(?:\\.|[^"\\])*")(\s*:)/g, '<span class="tok-key">$1</span><span class="tok-punc">$2</span>')
    .replace(/: ("(?:\\.|[^"\\])*")/g, ': <span class="tok-str">$1</span>')
    .replace(/\b(-?\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>')
    .replace(/\b(true|false)\b/g, '<span class="tok-bool">$1</span>')
    .replace(/\bnull\b/g, '<span class="tok-null">null</span>');
}

export function AgentDot({ agent, size = 10 }: { agent: AgentId; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block rounded-full"
      style={{ width: size, height: size, background: AGENT_META[agent].color, boxShadow: `0 0 12px ${AGENT_META[agent].color}` }}
    />
  );
}
