import { useState } from "react";
import ConduitDiagram from "./ConduitDiagram";
import { AGENT_META, JsonView, Reveal } from "./primitives";
import { runConsensus } from "../lib/consensus";
import { canRunOnchain } from "../lib/genlayer";
import { useWallet, shortAddress } from "../lib/wallet";
import { PRESETS } from "../lib/sampleData";
import type {
  AgentId,
  AnyEnvelope,
  ConsensusInput,
  EnvelopeC,
  FinalDecision,
  StagePhase,
} from "../types";

interface StageState {
  phase: StagePhase;
  envelope?: AnyEnvelope;
}

const EMPTY: Record<AgentId, StageState> = {
  A: { phase: "idle" },
  B: { phase: "idle" },
  C: { phase: "idle" },
};

const DECISION_STYLE: Record<FinalDecision, { label: string; color: string; note: string }> = {
  approve: { label: "APPROVE", color: "#34D399", note: "All rules cleared and confidence held above the floor." },
  review: { label: "REVIEW", color: "#F59E0B", note: "Flagged findings or low confidence — a human should look." },
  reject: { label: "REJECT", color: "#FB7185", note: "A critical rule failed. The audit ceiling forbids approval." },
  escalate: { label: "ESCALATE", color: "#A78BFA", note: "An upstream stage degraded — routed for manual handling." },
};

export default function DemoDashboard() {
  const [input, setInput] = useState<ConsensusInput>(PRESETS[0].input);
  const [stages, setStages] = useState<Record<AgentId, StageState>>(EMPTY);
  const [active, setActive] = useState<AgentId | null>(null);
  const [running, setRunning] = useState(false);
  const [final, setFinal] = useState<EnvelopeC | null>(null);
  const [runId, setRunId] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const wallet = useWallet();
  const walletConnected = wallet.status === "connected";
  const onchain = canRunOnchain(wallet.address); // wallet + deployed contract

  const patch = (k: keyof ConsensusInput) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) =>
    setInput((prev) => ({ ...prev, [k]: e.target.value }));

  async function run() {
    if (running) return;
    setRunning(true);
    setFinal(null);
    setError(null);
    setStages(EMPTY);
    setActive(null);
    const rid = runId + 1;
    setRunId(rid);

    const walletHandle =
      onchain && wallet.provider && wallet.address
        ? { provider: wallet.provider, address: wallet.address }
        : null;

    try {
      for await (const ev of runConsensus(input, { wallet: walletHandle })) {
        if (ev.phase === "running") setActive(ev.agent);
        setStages((prev) => ({
          ...prev,
          [ev.agent]: { phase: ev.phase, envelope: ev.envelope ?? prev[ev.agent].envelope },
        }));
        if (ev.agent === "C" && (ev.phase === "done" || ev.phase === "error") && ev.envelope) {
          setFinal(ev.envelope as EnvelopeC);
        }
      }
    } catch (err) {
      // On-chain failure — surface the real SDK / contract error verbatim rather
      // than silently substituting simulated data.
      setError(err instanceof Error ? err.message : String(err));
      setStages(EMPTY);
      setFinal(null);
    }
    setActive(null);
    setRunning(false);
  }

  function loadPreset(i: number) {
    if (running) return;
    setInput(PRESETS[i].input);
    setStages(EMPTY);
    setFinal(null);
    setError(null);
    setActive(null);
  }

  const completed = (["A", "B", "C"] as AgentId[]).filter((a) => stages[a].phase === "done");
  const locked = stages.C.phase === "done";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-8">
      {/* ---- Input panel ---- */}
      <Reveal className="panel flex flex-col p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="kicker">input · raw data</span>
          <ModeBadge onchain={onchain} walletConnected={walletConnected} />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => loadPreset(i)}
              disabled={running}
              className="chip transition-colors hover:border-fog hover:text-chalk disabled:opacity-50"
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>

        <Field label="Source material" hint="The raw document or record to evaluate">
          <textarea
            value={input.source_material}
            onChange={patch("source_material")}
            rows={4}
            className="ta"
            placeholder="Paste an invoice, application, or record…"
          />
        </Field>
        <Field label="Extraction schema" hint="field:type — number, enum(A|B), string, date">
          <textarea value={input.extraction_schema} onChange={patch("extraction_schema")} rows={2} className="ta" />
        </Field>
        <Field label="Rule set" hint="id: field <= N [severity]  ·  id: field in {A,B} [severity]">
          <textarea value={input.rule_set} onChange={patch("rule_set")} rows={3} className="ta" />
        </Field>
        <Field label="Constraints & policy" hint="Optional hard gates / weighting overrides">
          <input value={input.constraints} onChange={patch("constraints")} className="ip" placeholder="constraints (optional)" />
          <input value={input.policy} onChange={patch("policy")} className="ip mt-2" placeholder="policy (optional)" />
        </Field>

        <button onClick={run} disabled={running} className="btn btn-primary mt-5 w-full">
          {running ? "Running consensus…" : onchain ? "Run consensus on-chain" : "Run consensus"}
          {!running && <span aria-hidden>→</span>}
        </button>

        {onchain ? (
          <p className="mt-3 text-center font-mono text-[11px] leading-relaxed text-verify/90">
            Signs evaluate() with {shortAddress(wallet.address)}, then reads the stored record.
          </p>
        ) : walletConnected ? (
          <p className="mt-3 text-center font-mono text-[11px] leading-relaxed text-fog">
            Wallet connected. Set a deployed contract address (VITE_GENLAYER_CONTRACT) to submit on-chain — running the simulation meanwhile.
          </p>
        ) : (
          <button
            onClick={wallet.connect}
            className="mt-3 w-full text-center font-mono text-[11px] leading-relaxed text-fog transition-colors hover:text-chalk"
          >
            Client-side simulation — no gas needed.{" "}
            <span className="text-agentA underline decoration-dotted underline-offset-2">Connect a wallet</span> to run on-chain.
          </button>
        )}
      </Reveal>

      {/* ---- Pipeline visualization ---- */}
      <div className="flex min-w-0 flex-col gap-6">
        <div className="panel p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="kicker">pipeline · live</span>
            <span className="font-mono text-[11px] text-fog/70">
              {running ? `stage ${active ?? "…"} of A·B·C` : locked ? "consensus reached" : "idle"}
            </span>
          </div>
          <ConduitDiagram active={active} completed={completed} locked={locked} />
        </div>

        {error && <ErrorBanner message={error} />}

        {final && <DecisionCard env={final} />}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {(["A", "B", "C"] as AgentId[]).map((a) => (
            <AgentColumn key={a} agent={a} state={stages[a]} />
          ))}
        </div>
      </div>

      <FieldStyles />
    </div>
  );
}

function ModeBadge({ onchain, walletConnected }: { onchain: boolean; walletConnected: boolean }) {
  const label = onchain ? "on-chain" : walletConnected ? "wallet · sim" : "simulation";
  const color = onchain ? "#34D399" : walletConnected ? "#A78BFA" : "#38BDF8";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px]"
      style={{ borderColor: color + "66", color }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-chalk">{label}</span>
        <span className="font-mono text-[10px] text-fog">{hint}</span>
      </div>
      {children}
    </label>
  );
}

function AgentColumn({ agent, state }: { agent: AgentId; state: StageState }) {
  const meta = AGENT_META[agent];
  const { phase, envelope } = state;
  const running = phase === "running";
  const showEnvelope = (phase === "voting" || phase === "done" || phase === "error") && envelope;

  return (
    <div
      className={`panel flex min-w-0 flex-col p-5 transition-shadow duration-300 ${
        running ? meta.glow : ""
      }`}
      style={{ borderColor: running || phase === "done" ? meta.color + "66" : undefined }}
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color, boxShadow: `0 0 10px ${meta.color}` }} />
        <div className="min-w-0">
          <div className="font-display text-sm font-semibold text-chalk">{meta.name}</div>
          <div className="truncate font-mono text-[10px] text-fog">{meta.role}</div>
        </div>
        <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: phaseColor(phase, meta.color) }}>
          {phaseLabel(phase)}
        </span>
      </div>

      <div className="min-h-[288px]">
        {running && <Skeleton color={meta.color} />}
        {showEnvelope && <JsonView value={envelope} className="h-[288px]" />}
        {phase === "idle" && (
          <div className="flex h-[288px] items-center justify-center rounded-xl border border-dashed border-line font-mono text-[11px] text-fog">
            awaiting input
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="panel p-5" style={{ borderColor: "#FB718566" }} role="alert">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-display text-sm font-bold"
          style={{ background: "#FB71851f", color: "#FB7185", boxShadow: "0 0 0 1px #FB718555" }}
        >
          !
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-kicker text-fog">on-chain call failed</div>
          <p className="mt-1 break-words font-mono text-xs leading-relaxed text-fog-bright">{message}</p>
          <p className="mt-2 text-[11px] text-fog">
            The error above is reported directly from the contract or SDK. No simulated result was substituted.
          </p>
        </div>
      </div>
    </div>
  );
}

function DecisionCard({ env }: { env: EnvelopeC }) {
  const d = DECISION_STYLE[env.payload.final_decision];
  return (
    <div className="panel overflow-hidden p-0" style={{ borderColor: d.color + "55" }}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl font-display text-xl font-bold"
            style={{ background: d.color + "1f", color: d.color, boxShadow: `0 0 0 1px ${d.color}55` }}
          >
            {env.payload.final_decision === "approve" ? "✓" : env.payload.final_decision === "reject" ? "✕" : "!"}
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-kicker text-fog">final decision</div>
            <div className="font-display text-2xl font-semibold" style={{ color: d.color }}>
              {d.label}
            </div>
            <p className="mt-1 max-w-md text-sm text-fog-bright">{d.note}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-6 sm:flex-col sm:gap-2 sm:text-right">
          <Metric label="combined confidence" value={env.payload.combined_confidence} />
          <Metric
            label="rationale"
            value={env.payload.rationale_codes[0] ?? "—"}
            mono
          />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wide text-fog">{label}</div>
      <div className={`text-chalk ${mono ? "font-mono text-xs" : "font-display text-lg font-semibold"}`}>{value}</div>
    </div>
  );
}

function Skeleton({ color }: { color: string }) {
  return (
    <div className="space-y-2">
      {[100, 78, 90, 64].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-shimmer rounded"
          style={{
            width: `${w}%`,
            background: `linear-gradient(90deg, ${color}14 0%, ${color}33 50%, ${color}14 100%)`,
            backgroundSize: "200% 100%",
          }}
        />
      ))}
      <div className="pt-1 font-mono text-[10px]" style={{ color }}>
        › executing gl.nondet leader…
      </div>
    </div>
  );
}

function phaseLabel(p: StagePhase) {
  return p === "running" ? "running" : p === "voting" ? "voting" : p === "done" ? "consensus" : p === "error" ? "error" : "idle";
}
function phaseColor(p: StagePhase, accent: string) {
  return p === "done" ? "#34D399" : p === "error" ? "#FB7185" : p === "idle" ? "#8A93A6" : accent;
}

// Shared input styles injected once (keeps the form tidy without a CSS file bloat).
function FieldStyles() {
  return (
    <style>{`
      .ta, .ip {
        width: 100%;
        border-radius: 12px;
        border: 1px solid #2A3348;
        background: rgba(10,13,20,0.85);
        color: #F1F4FA;
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        line-height: 1.65;
        letter-spacing: 0.005em;
        padding: 12px 14px;
        caret-color: #34D399;
        resize: vertical;
        transition: border-color .18s, box-shadow .18s, background-color .18s;
      }
      .ta:hover, .ip:hover { border-color: #33405a; }
      .ta::placeholder, .ip::placeholder { color: #808b9e; opacity: 1; }
      .ta:focus, .ip:focus {
        outline: none;
        border-color: #34D399;
        background: rgba(8,10,15,0.95);
        box-shadow: 0 0 0 3px rgba(52,211,153,0.16);
      }
    `}</style>
  );
}
