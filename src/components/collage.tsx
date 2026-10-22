"use client";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import clsx from "clsx";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { vt } from "@/lib/client/nav";

// ---------------------------------------------------------------------------
// Doodles (Figma: Doodle/star, squiggle, arrow, heart, burst, underline, circle)
// ---------------------------------------------------------------------------
export function Doodle({ kind, className, style, color = "currentColor", draw }: { kind: "star" | "squiggle" | "arrow" | "heart" | "burst" | "underline" | "circle" | "spark"; className?: string; style?: CSSProperties; color?: string; draw?: boolean }) {
  const paths: Record<string, { d: string; vb: string; fill?: boolean }> = {
    star: { d: "M24 4 L28.5 18 L43 19.5 L31.5 28.5 L35.5 43 L24 34.5 L12.5 43 L16.5 28.5 L5 19.5 L19.5 18 Z", vb: "0 0 48 48" },
    spark: { d: "M24 2 C25.5 16 32 22.5 46 24 C32 25.5 25.5 32 24 46 C22.5 32 16 25.5 2 24 C16 22.5 22.5 16 24 2 Z", vb: "0 0 48 48", fill: true },
    squiggle: { d: "M3 20 C10 4, 18 4, 22 14 S34 26, 40 12 S56 2, 62 16 S76 26, 84 10", vb: "0 0 88 28" },
    arrow: { d: "M6 40 C18 30, 34 18, 52 10 M40 6 L53 9 L47 22", vb: "0 0 60 48" },
    heart: { d: "M24 42 C8 30 2 20 8 12 C14 4 22 8 24 14 C26 8 34 4 40 12 C46 20 40 30 24 42 Z", vb: "0 0 48 48" },
    burst: { d: "M24 2 V12 M24 36 V46 M2 24 H12 M36 24 H46 M8 8 L15 15 M33 33 L40 40 M40 8 L33 15 M15 33 L8 40", vb: "0 0 48 48" },
    underline: { d: "M3 10 C30 2, 60 14, 96 6 S150 4, 176 8", vb: "0 0 180 16" },
    circle: { d: "M50 6 C80 4, 96 20, 94 38 C92 58, 66 70, 42 66 C16 62, 4 44, 8 26 C12 12, 30 4, 56 8", vb: "0 0 100 72" },
  };
  const p = paths[kind];
  return (
    <svg viewBox={p.vb} className={className} style={style} aria-hidden fill="none">
      <motion.path
        d={p.d}
        stroke={color}
        strokeWidth={p.fill ? 0 : 3}
        fill={p.fill ? color : "none"}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={draw ? { pathLength: 0 } : false}
        animate={draw ? { pathLength: 1 } : undefined}
        transition={{ duration: 1.1, ease: "easeInOut" }}
      />
    </svg>
  );
}

export function Tape({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={clsx("absolute block h-5 w-16 bg-[rgba(246,236,200,0.85)] shadow-sm", className)} style={{ clipPath: "polygon(4% 0,100% 6%,96% 100%,0 92%)", ...style }} />;
}

// ---------------------------------------------------------------------------
// Banners (presets: sea · chai · bowl · pink · uploaded photo)
// ---------------------------------------------------------------------------
export const BANNER_PRESETS = [
  { id: "sea", label: "Sea", img: "/assets/sea.png" },
  { id: "chai", label: "Chai", img: "/assets/chai.png" },
  { id: "bowl", label: "Food", img: "/assets/bowl.png" },
  { id: "pink", label: "Pattern", img: null },
] as const;

export function bannerImage(banner: string): string | null {
  if (banner.startsWith("photo:")) return `/api/photos/${banner.slice(6)}`;
  return BANNER_PRESETS.find((b) => b.id === banner)?.img ?? null;
}

/** Collage banner. Parallax on pointer/tilt when `interactive`; static under reduced motion. */
export function Banner({ banner, className, sticker, interactive, compact, vtName }: { banner: string; className?: string; sticker?: ReactNode; interactive?: boolean; compact?: boolean; vtName?: string }) {
  const img = bannerImage(banner);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 120, damping: 18 });
  const sy = useSpring(my, { stiffness: 120, damping: 18 });
  const photoX = useTransform(sx, (v) => v * 10);
  const photoY = useTransform(sy, (v) => v * 6);
  const paperX = useTransform(sx, (v) => v * -6);
  const doodleX = useTransform(sx, (v) => v * 16);
  useEffect(() => {
    if (!interactive) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      mx.set(Math.max(-1, Math.min(1, e.gamma / 30)));
      my.set(Math.max(-1, Math.min(1, (e.beta - 45) / 30)));
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [interactive, mx, my]);
  const onMove = (e: React.PointerEvent) => {
    if (!interactive) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const isPhoto = banner.startsWith("photo:");
  return (
    <div className={clsx("relative overflow-hidden bg-paper", className)} onPointerMove={onMove} onPointerLeave={() => (mx.set(0), my.set(0))} style={vtName ? vt(vtName) : undefined}>
      {/* torn coloured papers */}
      <motion.div style={{ x: paperX }} className="absolute inset-0">
        <span className="torn-x absolute -left-4 top-[18%] h-[60%] w-[30%] rotate-[-14deg] bg-blue" />
        <span className="torn-x absolute right-[6%] top-[6%] h-[46%] w-[26%] rotate-[10deg] bg-pink" />
        <span className="torn-x absolute bottom-[-6%] right-[-2%] h-[44%] w-[40%] rotate-[-4deg] bg-lime" />
        <span className="torn-x absolute left-[18%] top-[-8%] h-[30%] w-[34%] rotate-[4deg] bg-kraft/70" />
        {banner === "pink" && (
          <>
            <span className="torn-x absolute left-[28%] top-[24%] h-[56%] w-[46%] rotate-[3deg] bg-pink" />
            <span className="torn-x absolute left-[8%] bottom-[-10%] h-[40%] w-[70%] rotate-[-3deg] bg-lime" />
          </>
        )}
      </motion.div>
      {img && !isPhoto && (
        <motion.div style={{ x: photoX, y: photoY }} className={clsx("absolute left-1/2 top-[12%] -translate-x-1/2 rotate-[-3deg] bg-white p-[6px] pb-[14px] shadow-[0_8px_20px_rgba(17,17,20,0.25)]", compact ? "w-[62%]" : "w-[58%]")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" className="aspect-[2.2/1] w-full object-cover" draggable={false} />
          <Tape className="-left-5 -top-2 rotate-[-28deg]" />
          <Tape className="-right-5 -top-1 rotate-[24deg]" />
        </motion.div>
      )}
      {isPhoto && img && (
        // Uploaded photos fill the banner with a ≥85% solid backing for any text on top (none here).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      )}
      <motion.div style={{ x: doodleX }} className="pointer-events-none absolute inset-0 text-ink">
        <Doodle kind="star" className="absolute left-[30%] top-[6%] h-5 w-5" />
        <Doodle kind="star" className="absolute right-[20%] bottom-[22%] h-4 w-4" />
        <Doodle kind="squiggle" className="absolute left-[4%] top-[8%] h-6 w-16 rotate-[-12deg]" />
        <Doodle kind="arrow" className="absolute right-[6%] top-[38%] h-8 w-10 rotate-[20deg]" />
        <Doodle kind="spark" color="#ffffff" className="absolute left-[12%] bottom-[18%] h-5 w-5" />
      </motion.div>
      {sticker && <div className="absolute bottom-3 right-3 z-10">{sticker}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logos (Figma: Chai 3D · Star 3D · Initial · Sticker · Upload)
// ---------------------------------------------------------------------------
export function Logo({ type, value, name, size = 88, className, vtName, ring = true }: { type: string; value?: string | null; name?: string; size?: number; className?: string; vtName?: string; ring?: boolean }) {
  const initial = (name ?? "O").trim().replace(/^outing\s*/i, "")[0]?.toUpperCase() ?? "O";
  const inner = (() => {
    switch (type) {
      case "cup3d":
        // eslint-disable-next-line @next/next/no-img-element
        return <img src="/assets/cup3d-cut.png" alt="" className="h-[78%] w-auto object-contain" draggable={false} />;
      case "star3d":
        // eslint-disable-next-line @next/next/no-img-element
        return <img src="/assets/star3d-cut.png" alt="" className="h-[76%] w-auto object-contain" draggable={false} />;
      case "initial":
        return (
          <span className="flex h-full w-full items-center justify-center rounded-full bg-blue text-white" style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: size * 0.46 }}>
            {initial}
          </span>
        );
      case "sticker":
        return (
          <span className="flex h-full w-full items-center justify-center rounded-full bg-lime">
            <Doodle kind="star" className="h-[56%] w-[56%] text-ink" />
          </span>
        );
      case "upload":
        if (value)
          // eslint-disable-next-line @next/next/no-img-element
          return <img src={`/api/photos/${value}`} alt="" className="h-full w-full rounded-full object-cover" />;
        return <Upload size={size * 0.32} className="text-ink-2" />;
      default:
        return null;
    }
  })();
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff,#eeeeee)]", ring && "border-[3px] border-white shadow-[0_6px_18px_rgba(17,17,20,0.18)]", className)}
      style={{ width: size, height: size, ...(vtName ? vt(vtName) : {}) }}
      aria-hidden
    >
      {inner}
    </span>
  );
}
