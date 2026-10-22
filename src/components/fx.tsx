"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

/**
 * Celebration effects. All are decorative (aria-hidden), short, never cover amounts
 * for longer than the burst, and are skipped entirely under prefers-reduced-motion.
 */
const reduce = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Piece = { id: number; x: number; y: number; r: number; s: number; c: string; shape: "rect" | "star" | "circle" | "heart" | "coin" };

export function Burst({ trigger, kind = "confetti", origin = { x: 0.5, y: 0.5 }, count = 26 }: { trigger: number; kind?: "confetti" | "hearts" | "coins" | "stickers"; origin?: { x: number; y: number }; count?: number }) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  useEffect(() => {
    if (!trigger || reduce()) return;
    const colors = ["#1f3bff", "#ff2e93", "#c6f432", "#c9b8ff", "#111114"];
    const shapes: Piece["shape"][] = kind === "hearts" ? ["heart"] : kind === "coins" ? ["coin"] : kind === "stickers" ? ["star", "rect", "circle"] : ["rect", "circle", "star"];
    const next = Array.from({ length: count }, (_, i) => {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const d = 90 + Math.random() * 120;
      return { id: trigger * 1000 + i, x: Math.cos(a) * d, y: Math.sin(a) * d - 60, r: Math.random() * 540 - 270, s: 0.6 + Math.random() * 0.9, c: kind === "hearts" ? (i % 2 ? "#ff2e93" : "#c8006a") : kind === "coins" ? "#f5c542" : colors[i % colors.length], shape: shapes[i % shapes.length] };
    });
    setPieces(next);
    const t = setTimeout(() => setPieces([]), 1500);
    return () => clearTimeout(t);
  }, [trigger, kind, count]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[90]" style={{ perspective: 600 }}>
      <AnimatePresence>
        {pieces.map((p) => (
          <motion.span
            key={p.id}
            className="absolute"
            style={{ left: `${origin.x * 100}%`, top: `${origin.y * 100}%` }}
            initial={{ x: 0, y: 0, scale: 0, rotate: 0, opacity: 1 }}
            animate={{ x: p.x, y: [0, p.y, p.y + 220], scale: p.s, rotate: p.r, opacity: [1, 1, 0] }}
            transition={{ duration: 1.35, ease: [0.16, 1, 0.3, 1], times: [0, 0.45, 1] }}
          >
            <Shape p={p} />
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Shape({ p }: { p: Piece }) {
  if (p.shape === "heart")
    return (
      <svg width="22" height="20" viewBox="0 0 24 22">
        <path d="M12 21C4 15 0 10 3 5c2.5-4 7-3 9 1 2-4 6.5-5 9-1 3 5-1 10-9 16z" fill={p.c} />
      </svg>
    );
  if (p.shape === "coin") return <span className="block h-4 w-4 rounded-full border-2 border-[#b8860b] bg-[#f5c542]" />;
  if (p.shape === "star")
    return (
      <svg width="16" height="16" viewBox="0 0 48 48">
        <path d="M24 2 C25.5 16 32 22.5 46 24 C32 25.5 25.5 32 24 46 C22.5 32 16 25.5 2 24 C16 22.5 22.5 16 24 2 Z" fill={p.c} />
      </svg>
    );
  if (p.shape === "circle") return <span className="block h-2.5 w-2.5 rounded-full" style={{ background: p.c }} />;
  return <span className="block h-3 w-1.5 rounded-[2px]" style={{ background: p.c }} />;
}

/** A 3D object that pops in, floats and settles — for Maaf (heart), Wusool (wallet) and All settled (popper). */
export function HeroPop({ src, show, size = 160 }: { src: string; show: boolean; size?: number }) {
  const floaty = useMemo(() => (reduce() ? {} : { y: [0, -8, 0], rotate: [-4, 4, -4] }), []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div aria-hidden initial={{ scale: 0, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.4, opacity: 0, y: -40 }} transition={{ type: "spring", stiffness: 260, damping: 16 }} className="flex justify-center">
          <motion.img src={src} alt="" style={{ width: size }} animate={floaty} transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }} className="drop-shadow-[0_18px_24px_rgba(17,17,20,0.25)]" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
