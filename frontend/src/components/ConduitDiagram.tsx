import type { AgentId } from "../types";
import { AGENT_META } from "./primitives";

interface Props {
  active?: AgentId | null; // stage currently running
  completed?: AgentId[]; // stages that finished
  locked?: boolean; // consensus reached
  compact?: boolean;
}

const NODES: { id: AgentId; x: number }[] = [
  { id: "A", x: 118 },
  { id: "B", x: 360 },
  { id: "C", x: 602 },
];
const NODE_W = 150;
const NODE_H = 82;
const CY = 104;
const CONSENSUS_X = 812;

export default function ConduitDiagram({ active, completed = [], locked = false, compact = false }: Props) {
  const isDone = (id: AgentId) => completed.includes(id);
  const isActive = (id: AgentId) => active === id;

  return (
    <div className="w-full">
      <svg viewBox="0 0 900 208" className="w-full" role="img" aria-label="Agent A to B to C consensus pipeline">
        <defs>
          <linearGradient id="conduit" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="50%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#A78BFA" />
          </linearGradient>
          <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* connectors */}
        {NODES.map((n, i) => {
          const nextX = i < NODES.length - 1 ? NODES[i + 1].x : CONSENSUS_X;
          const x1 = n.x + NODE_W / 2;
          const x2 = nextX - (i < NODES.length - 1 ? NODE_W / 2 : 66);
          const flowing = isActive(n.id) || (isDone(n.id) && (i === NODES.length - 1 ? locked : isActive(NODES[i + 1].id) || isDone(NODES[i + 1].id)));
          return (
            <g key={`c-${n.id}`}>
              <line x1={x1} y1={CY} x2={x2} y2={CY} stroke="#1E2436" strokeWidth={2} />
              <line
                x1={x1}
                y1={CY}
                x2={x2}
                y2={CY}
                stroke={flowing ? "url(#conduit)" : "#2A3348"}
                strokeWidth={2}
                strokeDasharray="6 8"
                className={flowing ? "animate-flow" : ""}
                opacity={flowing ? 0.95 : 0.5}
              />
            </g>
          );
        })}

        {/* agent nodes */}
        {NODES.map((n) => {
          const meta = AGENT_META[n.id];
          const activeNow = isActive(n.id);
          const done = isDone(n.id);
          return (
            <g key={n.id} transform={`translate(${n.x - NODE_W / 2}, ${CY - NODE_H / 2})`}>
              {(activeNow || done) && (
                <rect x={-2} y={-2} width={NODE_W + 4} height={NODE_H + 4} rx={16} fill={meta.color} opacity={activeNow ? 0.22 : 0.1} filter="url(#soft)" />
              )}
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={14}
                fill="#0E121B"
                stroke={activeNow || done ? meta.color : "#1E2436"}
                strokeWidth={activeNow ? 2 : 1.25}
                className={activeNow ? "animate-pulseRing" : ""}
              />
              <circle cx={20} cy={22} r={5} fill={meta.color} />
              <text x={34} y={26} fill="#E6EAF2" fontFamily="'Space Grotesk', sans-serif" fontSize={15} fontWeight={600}>
                {meta.name}
              </text>
              <text x={16} y={50} fill="#8A93A6" fontFamily="'JetBrains Mono', monospace" fontSize={10.5}>
                {meta.role}
              </text>
              <text x={16} y={68} fill={activeNow ? meta.color : done ? "#34D399" : "#3b4556"} fontFamily="'JetBrains Mono', monospace" fontSize={10}>
                {activeNow ? "› running" : done ? "✓ consensus" : "idle"}
              </text>
            </g>
          );
        })}

        {/* consensus lock */}
        <g transform={`translate(${CONSENSUS_X - 60}, ${CY - 42})`}>
          <rect
            width={124}
            height={84}
            rx={16}
            fill={locked ? "#0c2019" : "#0E121B"}
            stroke={locked ? "#34D399" : "#1E2436"}
            strokeWidth={locked ? 2 : 1.25}
            className={locked ? "animate-pulseRing" : ""}
          />
          {locked && <rect x={-3} y={-3} width={130} height={90} rx={18} fill="#34D399" opacity={0.14} filter="url(#soft)" />}
          <text x={62} y={34} textAnchor="middle" fill={locked ? "#34D399" : "#8A93A6"} fontFamily="'Space Grotesk',sans-serif" fontSize={13} fontWeight={700}>
            CONSENSUS
          </text>
          <text x={62} y={56} textAnchor="middle" fill={locked ? "#E6EAF2" : "#3b4556"} fontFamily="'JetBrains Mono',monospace" fontSize={10}>
            {locked ? "quorum · locked" : "awaiting quorum"}
          </text>
        </g>
      </svg>
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[11px] text-fog">
          <Legend color="#38BDF8" label="extract" />
          <Legend color="#F59E0B" label="audit" />
          <Legend color="#A78BFA" label="synthesize" />
          <Legend color="#34D399" label="validator consensus" />
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
