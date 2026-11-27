"use client";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
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

/**
 * Welcome hero: the chrome star lands, then the four objects that make up an outing (the chai cup, the
 * Maaf heart, the Wusool wallet, the all-settled popper) spring out from behind it into a loose orbit.
 * Afterwards each drifts at its own depth with the pointer or the phone's tilt, so the cluster feels like
 * objects in space rather than a flat illustration. One orchestrated moment; nothing loops loudly.
 */
const ORBIT = [
  { src: "/assets/cup3d-cut.png", x: -122, y: -78, size: 70, rotate: -12, depth: 1.5, delay: 0.42, float: 0 },
  { src: "/assets/heart3d-cut.png", x: 120, y: -100, size: 60, rotate: 14, depth: 1.1, delay: 0.5, float: -1.6 },
  { src: "/assets/wallet3d-cut.png", x: -116, y: 96, size: 72, rotate: 10, depth: 1.2, delay: 0.58, float: -3.1 },
  { src: "/assets/popper3d-cut.png", x: 126, y: 82, size: 66, rotate: -16, depth: 1.7, delay: 0.66, float: -4.4 },
];

function usePointerTilt() {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  useEffect(() => {
    if (reduce()) return;
    const onMove = (e: PointerEvent) => {
      mx.set((e.clientX / window.innerWidth) * 2 - 1);
      my.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    // Phones: tilt drives the same values (no permission prompt is requested; iOS simply won't send events).
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      mx.set(Math.max(-1, Math.min(1, e.gamma / 25)));
      my.set(Math.max(-1, Math.min(1, (e.beta - 45) / 25)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("deviceorientation", onTilt);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, [mx, my]);
  return { x: useSpring(mx, { stiffness: 50, damping: 16 }), y: useSpring(my, { stiffness: 50, damping: 16 }) };
}

function Drift({ tilt, depth, children }: { tilt: { x: MotionValue<number>; y: MotionValue<number> }; depth: number; children: React.ReactNode }) {
  const x = useTransform(tilt.x, (v) => v * depth * 12);
  const y = useTransform(tilt.y, (v) => v * depth * 10);
  return <motion.div style={{ x, y }}>{children}</motion.div>;
}

export function Constellation() {
  const tilt = usePointerTilt();
  const rotateY = useTransform(tilt.x, [-1, 1], [-16, 16]);
  const rotateX = useTransform(tilt.y, [-1, 1], [12, -12]);
  return (
    <div aria-hidden className="relative mx-auto h-[300px] w-full max-w-[360px]" style={{ perspective: 800 }}>
      {/* Soft halo the star sits in; it blooms as the star lands. */}
      <motion.div
        className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(31,59,255,0.18),rgba(201,184,255,0.12)_55%,transparent)]"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      />
      {ORBIT.map((o) => (
        <div key={o.src} className="absolute left-1/2 top-1/2" style={{ marginLeft: -o.size / 2, marginTop: -o.size / 2 }}>
          <Drift tilt={tilt} depth={o.depth}>
            <motion.div
              initial={{ x: 0, y: 0, scale: 0.2, opacity: 0, rotate: 0 }}
              animate={{ x: o.x, y: o.y, scale: 1, opacity: 1, rotate: o.rotate }}
              transition={{ type: "spring", stiffness: 150, damping: 14, mass: 0.9, delay: o.delay, opacity: { duration: 0.25, delay: o.delay } }}
            >
              <img src={o.src} alt="" draggable={false} className="animate-float drop-shadow-[0_14px_16px_rgba(17,17,20,0.18)]" style={{ width: o.size, animationDelay: `${o.float}s` }} />
            </motion.div>
          </Drift>
        </div>
      ))}
      <div className="absolute left-1/2 top-1/2 -ml-[78px] -mt-[78px]">
        <Drift tilt={tilt} depth={0.5}>
          <motion.img
            src="/assets/star3d-cut.png"
            alt=""
            draggable={false}
            initial={{ scale: 0.3, rotate: -100, opacity: 0, y: -30 }}
            animate={{ scale: 1, rotate: 0, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 130, damping: 13, mass: 1, opacity: { duration: 0.3 } }}
            style={{ rotateX, rotateY, width: 156 }}
            className="drop-shadow-[0_24px_30px_rgba(31,59,255,0.28)]"
          />
        </Drift>
      </div>
    </div>
  );
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
