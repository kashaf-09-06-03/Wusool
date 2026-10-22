"use client";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { formatAmount } from "@/lib/money";

export interface GraphNode {
  id: string;
  label: string;
  initials: string;
  color: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  amount: number;
}

const FILL: Record<string, { bg: string; fg: string }> = {
  blue: { bg: "#1f3bff", fg: "#fff" },
  pink: { bg: "#ff2e93", fg: "#fff" },
  lime: { bg: "#c6f432", fg: "#111114" },
  ink: { bg: "#111114", fg: "#fff" },
  lilac: { bg: "#c9b8ff", fg: "#111114" },
};

/**
 * Debt graph: people are vertices, obligations are directed weighted edges (debtor → creditor).
 * A person involved in most edges is placed at the centre (hub); others sit on a circle.
 * Switching edge sets animates: removed arrows retract, new arrows draw in.
 */
export function DebtGraph({ nodes, edges, size = 320, mini, labels = true }: { nodes: GraphNode[]; edges: GraphEdge[]; size?: number; mini?: boolean; labels?: boolean }) {
  const layout = useMemo(() => {
    const deg: Record<string, number> = {};
    for (const e of edges) {
      deg[e.from] = (deg[e.from] ?? 0) + 1;
      deg[e.to] = (deg[e.to] ?? 0) + 1;
    }
    const active = nodes.filter((n) => deg[n.id] || !mini);
    const hub = active.length > 3 ? active.find((n) => (deg[n.id] ?? 0) >= Math.max(3, edges.length * 0.6)) : undefined;
    const ring = active.filter((n) => n !== hub);
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - (mini ? 16 : 40);
    const pos: Record<string, { x: number; y: number }> = {};
    if (hub) pos[hub.id] = { x: cx, y: cy };
    ring.forEach((n, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
      pos[n.id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    return { pos, active };
  }, [nodes, edges, size, mini]);

  const nodeR = mini ? 9 : 22;
  const key = (e: GraphEdge) => `${e.from}>${e.to}`;
  const curved = (e: GraphEdge) => {
    const a = layout.pos[e.from];
    const b = layout.pos[e.to];
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const start = { x: a.x + ux * (nodeR + 2), y: a.y + uy * (nodeR + 2) };
    const end = { x: b.x - ux * (nodeR + (mini ? 3 : 6)), y: b.y - uy * (nodeR + (mini ? 3 : 6)) };
    // Bend reciprocal or crossing edges slightly so they don't overlap.
    const bend = edges.some((o) => o.from === e.to && o.to === e.from) ? 18 : mini ? 0 : 8;
    const mx = (start.x + end.x) / 2 - uy * bend;
    const my = (start.y + end.y) / 2 + ux * bend;
    return { d: `M ${start.x} ${start.y} Q ${mx} ${my} ${end.x} ${end.y}`, mid: { x: (start.x + 2 * mx + end.x) / 4, y: (start.y + 2 * my + end.y) / 4 }, end, ux, uy };
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-label={`Debt graph with ${edges.length} transfers`}>
      <defs>
        <marker id={mini ? "arrow-mini" : "arrow"} viewBox="0 0 10 10" refX="7" refY="5" markerWidth={mini ? 5 : 7} markerHeight={mini ? 5 : 7} orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f3bff" />
        </marker>
      </defs>
      <AnimatePresence>
        {edges.map((e) => {
          const c = curved(e);
          if (!c) return null;
          return (
            <motion.g key={key(e)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.path d={c.d} fill="none" stroke="#1f3bff" strokeWidth={mini ? 1.6 : 2} markerEnd={`url(#${mini ? "arrow-mini" : "arrow"})`} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} exit={{ pathLength: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
              {labels && !mini && (
                <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ delay: 0.35, type: "spring", stiffness: 400, damping: 22 }} style={{ transformOrigin: `${c.mid.x}px ${c.mid.y}px` }}>
                  <rect x={c.mid.x - 37} y={c.mid.y - 11} width={74} height={22} rx={11} fill="#fff" stroke="#111114" strokeWidth={1} />
                  <text x={c.mid.x} y={c.mid.y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fontFamily="var(--font-ui)" fill="#111114" style={{ fontVariantNumeric: "tabular-nums" }}>
                    PKR {formatAmount(e.amount)}
                  </text>
                </motion.g>
              )}
            </motion.g>
          );
        })}
      </AnimatePresence>
      {layout.active.map((n) => {
        const p = layout.pos[n.id];
        if (!p) return null;
        const c = FILL[n.color] ?? FILL.ink;
        return (
          <motion.g key={n.id} animate={{ x: p.x, y: p.y }} initial={false} transition={{ type: "spring", stiffness: 160, damping: 20 }}>
            <circle r={nodeR} fill={c.bg} stroke="#fff" strokeWidth={mini ? 1.5 : 3} />
            {!mini && (
              <>
                <text y={4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill={c.fg} fontFamily="var(--font-ui)">
                  {n.initials}
                </text>
                <text y={nodeR + 14} textAnchor="middle" fontSize={11} fill="#5a5a66" fontFamily="var(--font-ui)">
                  {n.label}
                </text>
              </>
            )}
          </motion.g>
        );
      })}
    </svg>
  );
}
