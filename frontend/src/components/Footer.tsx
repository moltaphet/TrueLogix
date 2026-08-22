import { GITHUB_URL } from "./Nav";

export default function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-semibold tracking-tight text-chalk">
              True<span className="text-verify">Logix</span>
            </span>
            <span className="chip">v1.0</span>
          </div>
          <p className="mt-2 max-w-sm text-sm text-fog">
            A 3-agent multi-agent consensus engine on GenLayer. Extract, audit, synthesize — verifiably.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3 font-mono text-[12px]">
          <div className="flex flex-col gap-2">
            <span className="text-fog/60">build</span>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="text-fog-bright hover:text-chalk">
              GitHub ↗
            </a>
            <a href="https://sdk.genlayer.com" target="_blank" rel="noreferrer" className="text-fog-bright hover:text-chalk">
              SDK ↗
            </a>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-fog/60">learn</span>
            <a href="#overview" className="text-fog-bright hover:text-chalk">
              How it works
            </a>
            <a href="#faq" className="text-fog-bright hover:text-chalk">
              FAQ
            </a>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-fog/60">agents</span>
            <span className="text-agentA">A · Extractor</span>
            <span className="text-agentB">B · Auditor</span>
            <span className="text-agentC">C · Synthesizer</span>
          </div>
        </div>
      </div>
      <div className="border-t border-line/60">
        <div className="mx-auto max-w-6xl px-5 py-4">
          <p className="font-mono text-[11px] text-fog/60">
            Built on GenLayer · deterministic consensus over non-deterministic work.
          </p>
        </div>
      </div>
    </footer>
  );
}
