"use client";
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import clsx from "clsx";
import { Check, CheckCheck, ChartPie, CircleAlert, Clock, Heart, Hourglass, Mic, Pencil, Receipt, Smartphone, X } from "lucide-react";
import { formatAmount, formatPKR } from "@/lib/money";

// ---------------------------------------------------------------------------
// Button — Style: Primary / Glass / Outline / Text / Maaf · Size: L / M
// ---------------------------------------------------------------------------
type BtnStyle = "primary" | "glass" | "outline" | "text" | "maaf" | "ink" | "danger";
interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: BtnStyle;
  size?: "L" | "M" | "S";
  icon?: ReactNode;
  loading?: boolean;
  full?: boolean;
  style?: React.CSSProperties;
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "primary", size = "L", icon, loading, full, className, children, disabled, onClick, ...rest }, ref) {
  const sizes = { L: "h-[58px] px-7 text-[17px] font-semibold gap-2.5", M: "h-12 px-5 text-[15.5px] font-semibold gap-2", S: "h-9 px-3.5 text-[13.5px] font-semibold gap-1.5" };
  const styles: Record<BtnStyle, string> = {
    primary: "gloss-blue text-white",
    glass: "glass text-ink",
    outline: "bg-paper text-ink ring-[1.5px] ring-inset ring-ink/85 hover:bg-paper-warm",
    text: "text-blue bg-transparent",
    maaf: "gloss-pink text-white",
    ink: "gloss-ink text-white",
    danger: "bg-paper text-pink-text ring-[1.5px] ring-inset ring-pink-text/80",
  };
  const [sweep, setSweep] = useState(0);
  const glossy = variant === "primary" || variant === "maaf" || variant === "ink";
  return (
    <motion.button
      ref={ref}
      whileTap={disabled || loading ? undefined : { scale: 0.96, y: 1 }}
      whileHover={disabled || loading ? undefined : { y: -1 }}
      transition={{ type: "spring", stiffness: 650, damping: 28 }}
      disabled={disabled || loading}
      onClick={(e) => {
        if (glossy) setSweep((s) => s + 1);
        onClick?.(e as React.MouseEvent<HTMLButtonElement>);
      }}
      className={clsx(
        "relative inline-flex select-none items-center justify-center overflow-hidden rounded-full font-[family-name:var(--font-ui)] tracking-[-0.01em] transition-[opacity,background-color]",
        sizes[size],
        styles[variant],
        full && "w-full",
        (disabled || loading) && "opacity-40 saturate-50",
        className,
      )}
      {...(rest as object)}
    >
      {glossy && sweep > 0 && <span key={sweep} aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/2 animate-sheen bg-gradient-to-r from-transparent via-white/45 to-transparent" />}
      <span className="relative inline-flex items-center gap-[inherit]">
        {loading ? <StarSpinner size={size === "L" ? 22 : 18} light={glossy} /> : icon}
        {children}
      </span>
    </motion.button>
  );
});

/** The brand's chrome star as a loader. */
export function StarSpinner({ size = 28, light, className }: { size?: number; light?: boolean; className?: string }) {
  return (
    <motion.svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-label="Loading" role="img" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }}>
      <defs>
        <linearGradient id="star-chrome" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light ? "#ffffff" : "#c9b8ff"} />
          <stop offset="0.35" stopColor={light ? "#dfe5ff" : "#7fe3ff"} />
          <stop offset="0.65" stopColor={light ? "#ffffff" : "#ffb3dd"} />
          <stop offset="1" stopColor={light ? "#c9d2ff" : "#c6f432"} />
        </linearGradient>
      </defs>
      <path d="M24 2 C25.5 16 32 22.5 46 24 C32 25.5 25.5 32 24 46 C22.5 32 16 25.5 2 24 C16 22.5 22.5 16 24 2 Z" fill="url(#star-chrome)" stroke={light ? "rgba(255,255,255,.6)" : "#111114"} strokeOpacity={light ? 1 : 0.15} />
    </motion.svg>
  );
}

/** Segmented control (glass track, ink thumb that slides). */
export function Segmented<T extends string>({ value, options, onChange, layoutId, size = "M", ariaLabel }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; layoutId: string; size?: "S" | "M"; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-full bg-ink/[0.06] p-1">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={clsx("relative flex-1 rounded-full px-3", size === "S" ? "h-8" : "h-10")}>
          {value === o.value && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-full bg-paper shadow-[0_2px_10px_-2px_rgba(17,17,20,0.25)]" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
          <span className={clsx("relative t-label", size === "S" ? "text-[12.5px]" : "text-[14px]", value === o.value ? "text-ink" : "text-ink-2")}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Soft drifting colour aura behind identity/hero areas. */
export function Aura({ tones = ["lime", "pink", "blue"], className }: { tones?: ("lime" | "pink" | "blue" | "lilac")[]; className?: string }) {
  const c = { lime: "#c6f432", pink: "#ff2e93", blue: "#1f3bff", lilac: "#c9b8ff" };
  const pos = ["left-[5%] top-[10%] h-48 w-48", "right-[0%] top-[0%] h-56 w-56", "left-[35%] top-[35%] h-40 w-40", "right-[25%] top-[45%] h-36 w-36"];
  return (
    <div aria-hidden className={clsx("aura", className)}>
      {tones.map((t, i) => (
        <span key={i} className={pos[i % pos.length]} style={{ background: c[t], opacity: t === "blue" ? 0.35 : 0.55, animationDelay: `${i * -3.5}s` }} />
      ))}
    </div>
  );
}

/** One orchestrated entrance per screen: children cascade in once. */
export function Reveal({ children, className, delay = 0, as = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "ul" | "section" }) {
  const M = motion[as];
  return (
    <M className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.055, delayChildren: delay } } }}>
      {children}
    </M>
  );
}
export const revealItem = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { type: "spring" as const, stiffness: 260, damping: 26 } },
};

export function IconButton({ label, onClick, children, surface = "glass", className, disabled }: { label: string; onClick?: () => void; children: ReactNode; surface?: "glass" | "solid" | "plain"; className?: string; disabled?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink",
        surface === "glass" && "glass",
        surface === "solid" && "glass-solid",
        surface === "plain" && "bg-paper-warm",
        disabled && "opacity-40",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// Chips, pills, stickers
// ---------------------------------------------------------------------------
export function Chip({ selected, onClick, children, className, icon }: { selected?: boolean; onClick?: () => void; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        "inline-flex h-11 items-center gap-1.5 rounded-full px-4 t-label text-[15px] transition-colors",
        selected ? "gloss-ink text-white" : "bg-paper text-ink ring-[1.5px] ring-inset ring-ink/15 hover:ring-ink/40",
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {selected && (
          <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden">
            <Check size={16} strokeWidth={3} className="text-lime" />
          </motion.span>
        )}
      </AnimatePresence>
      {icon}
      {children}
    </motion.button>
  );
}

export type Provenance = "receipt" | "ride" | "story" | "you" | "manual" | "unsure" | "upload" | "assumed" | "sample";
export function SourcePill({ kind, children }: { kind: Provenance; children?: ReactNode }) {
  const cfg: Record<Provenance, { label: string; cls: string; icon: ReactNode }> = {
    receipt: { label: "From receipt", cls: "bg-paper-warm text-ink border border-line", icon: <Receipt size={12} /> },
    ride: { label: "Ride screenshot", cls: "bg-paper-warm text-ink border border-line", icon: <Smartphone size={12} /> },
    upload: { label: "From upload", cls: "bg-paper-warm text-ink border border-line", icon: <Receipt size={12} /> },
    story: { label: "From your story", cls: "bg-blue-tint text-blue", icon: <Mic size={12} /> },
    you: { label: "Confirmed by you", cls: "bg-paper text-ink border-[1.5px] border-ink", icon: <Check size={12} strokeWidth={3} /> },
    manual: { label: "Manual", cls: "bg-paper-warm text-ink border border-line", icon: <Pencil size={12} /> },
    unsure: { label: "Unsure", cls: "bg-lime-tint text-ink border-[1.5px] border-ink", icon: <CircleAlert size={12} /> },
    assumed: { label: "Assumed: everyone", cls: "bg-lime-tint text-ink border border-dashed border-ink", icon: <CircleAlert size={12} /> },
    sample: { label: "Sample", cls: "bg-pink-tint text-pink-text", icon: null },
  };
  const c = cfg[kind];
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1 rounded-full px-2.5 t-overline text-[10px]", c.cls)}>
      {c.icon}
      {children ?? c.label}
    </span>
  );
}

export function Sticker({ children, color = "lime", rotate = -6, className }: { children: ReactNode; color?: "lime" | "pink" | "blue" | "chrome"; rotate?: number; className?: string }) {
  const bg = {
    lime: "bg-lime text-ink",
    pink: "bg-pink text-white",
    blue: "bg-blue text-white",
    chrome: "bg-[linear-gradient(120deg,#e8e8ef,#c9b8ff_30%,#9ef0ff_55%,#ffd6f0_75%,#e8e8ef)] text-ink",
  }[color];
  return (
    <span
      className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-ink px-3 py-1 t-sticker shadow-[2px_3px_0_rgba(17,17,20,0.9)]", bg, className)}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Settlement status chips (exact labels; icon + shape, never colour alone)
// ---------------------------------------------------------------------------
export type StatusKey = "requested" | "marked" | "confirmed" | "partial" | "disputed" | "maaf" | "superseded";
export function StatusChip({ status }: { status: StatusKey }) {
  const cfg: Record<StatusKey, { label: string; cls: string; icon: ReactNode }> = {
    requested: { label: "Requested", cls: "border-[1.5px] border-ink bg-paper text-ink", icon: <Clock size={13} /> },
    marked: { label: "Marked Wusooled", cls: "border-[1.5px] border-blue text-blue bg-[linear-gradient(90deg,var(--color-blue-tint)_50%,white_50%)]", icon: <Hourglass size={13} /> },
    confirmed: { label: "Confirmed received", cls: "bg-blue text-white", icon: <CheckCheck size={13} /> },
    partial: { label: "Partial", cls: "border-[1.5px] border-dashed border-ink bg-lime-tint text-ink", icon: <ChartPie size={13} /> },
    disputed: { label: "Disputed", cls: "border-[1.5px] border-pink-text bg-pink-tint text-pink-text", icon: <CircleAlert size={13} /> },
    maaf: { label: "Maaf", cls: "bg-pink text-white", icon: <Heart size={13} fill="currentColor" /> },
    superseded: { label: "Replaced", cls: "border border-line-strong bg-paper-warm text-ink-2", icon: <X size={13} /> },
  };
  const c = cfg[status];
  return (
    <motion.span layout key={status} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 26 }} className={clsx("inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 t-chip", c.cls)}>
      {c.icon}
      {c.label}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------
const AV = { blue: "bg-blue text-white", pink: "bg-pink text-white", lime: "bg-lime text-ink", ink: "bg-ink text-white", lilac: "bg-lilac text-ink" } as Record<string, string>;
export function Avatar({ initials, color = "ink", size = 36, ring = true, className }: { initials: string; color?: string; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      className={clsx("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold", AV[color] ?? AV.ink, ring && "ring-2 ring-white", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ people, extra, size = 36 }: { people: { initials: string; color: string }[]; extra?: number; size?: number }) {
  return (
    <span className="inline-flex items-center">
      {people.map((p, i) => (
        <span key={i} style={{ marginLeft: i ? -size * 0.22 : 0, zIndex: 10 - i }}>
          <Avatar initials={p.initials} color={p.color} size={size} />
        </span>
      ))}
      {extra ? (
        <span style={{ marginLeft: -size * 0.22, width: size, height: size }} className="inline-flex items-center justify-center rounded-full bg-paper-warm text-[13px] font-semibold text-ink ring-2 ring-white">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

export const initialsOf = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
};

// ---------------------------------------------------------------------------
// Text field (visible label, 52pt, helper; never placeholder-only)
// ---------------------------------------------------------------------------
export function TextField({
  label,
  value,
  onChange,
  helper,
  error,
  placeholder,
  type = "text",
  inputMode,
  autoFocus,
  prefix,
  maxLength,
  onEnter,
  name,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  helper?: ReactNode;
  error?: string | null;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoFocus?: boolean;
  prefix?: string;
  maxLength?: number;
  onEnter?: () => void;
  name?: string;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="t-label mb-1.5 block">
        {label}
      </label>
      <div className={clsx("flex h-[52px] items-center rounded-[16px] border-[1.5px] bg-paper px-4 transition-shadow focus-within:border-blue focus-within:shadow-[0_0_0_4px_rgba(31,59,255,0.12)]", error ? "border-pink-text" : "border-line-strong")}>
        {prefix && <span className="t-label mr-2 text-ink-2">{prefix}</span>}
        <input
          id={id}
          name={name}
          className="t-ui h-full w-full bg-transparent text-[17px] outline-none placeholder:text-ink-2/60"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          inputMode={inputMode}
          autoFocus={autoFocus}
          maxLength={maxLength}
          autoComplete={autoComplete}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          aria-invalid={Boolean(error)}
          aria-describedby={helper || error ? id + "-h" : undefined}
        />
      </div>
      {(error || helper) && (
        <p id={id + "-h"} className={clsx("t-caption mt-1.5", error ? "text-pink-text" : "text-ink-2")}>
          {error ?? helper}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option card (allocation / routing pickers)
// ---------------------------------------------------------------------------
export function OptionCard({ title, description, tag, tagTone = "lime", selected, onClick, children }: { title: string; description: ReactNode; tag?: string; tagTone?: "lime" | "ink"; selected: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      role="radio"
      aria-checked={selected}
      className={clsx("relative w-full rounded-[20px] p-4 text-left transition-[background-color,box-shadow] duration-300", selected ? "bg-blue-tint shadow-[inset_0_0_0_2px_var(--color-ink)]" : "bg-paper shadow-[inset_0_0_0_1.5px_rgba(17,17,20,0.14)] hover:shadow-[inset_0_0_0_1.5px_rgba(17,17,20,0.35)]")}
    >
      <div className="flex items-start gap-3">
        <span className={clsx("mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-ink bg-ink" : "border-line-strong bg-paper")}>
          <AnimatePresence>{selected && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check size={14} strokeWidth={3.5} className="text-lime" /></motion.span>}</AnimatePresence>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="t-label text-[17px]">{title}</span>
            {tag && <span className={clsx("rounded-full px-2 py-0.5 t-overline text-[10px]", tagTone === "lime" ? "bg-lime text-ink" : "bg-ink text-white")}>{tag}</span>}
          </span>
          <span className="t-ui mt-1 block text-[14px] text-ink-2">{description}</span>
        </span>
      </div>
      {children}
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet with grabber, drag-to-dismiss, dimmed backdrop
// ---------------------------------------------------------------------------
export function Sheet({ open, onClose, title, subtitle, children, footer, tall }: { open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  const y = useMotionValue(0);
  const backdrop = useTransform(y, [0, 400], [1, 0]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.focus(), 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
    else animate(y, 0, { type: "spring", stiffness: 500, damping: 40 });
  };
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true">
          <motion.div className="absolute inset-0 bg-ink/45" style={{ opacity: backdrop }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            ref={ref}
            tabIndex={-1}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            style={{ y }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className={clsx("relative flex w-full max-w-[480px] flex-col rounded-t-[28px] bg-paper shadow-[0_-12px_40px_rgba(17,17,20,0.2)] outline-none", tall ? "max-h-[94dvh]" : "max-h-[88dvh]")}
          >
            <div className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing">
              <span className="h-[5px] w-10 rounded-full bg-line-strong/60" />
            </div>
            {(title || subtitle) && (
              <div className="flex items-start gap-3 px-5 pb-3 pt-2">
                <div className="min-w-0 flex-1">
                  {title && <h2 className="t-h2">{title}</h2>}
                  {subtitle && <p className="t-caption mt-0.5 text-ink-2">{subtitle}</p>}
                </div>
                <IconButton label="Close" onClick={onClose} surface="solid">
                  <X size={20} />
                </IconButton>
              </div>
            )}
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-4" onPointerDownCapture={(e) => e.stopPropagation()}>
              {children}
            </div>
            {footer && <div className="border-t border-line bg-paper px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Confirmation dialog for high-impact actions (error prevention). */
export function ConfirmSheet({ open, onClose, title, body, confirmLabel, onConfirm, tone = "primary", loading, children }: { open: boolean; onClose: () => void; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; tone?: "primary" | "maaf" | "danger"; loading?: boolean; children?: ReactNode }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          <Button variant={tone === "danger" ? "danger" : tone} full onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
          <Button variant="text" size="M" full onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="t-body text-ink-2">{body}</div>
      {children}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Amounts — calm, unrotated, right-aligned; animated count when value changes
// ---------------------------------------------------------------------------
export function Amount({ value, className, signed, prefix = true }: { value: number; className?: string; signed?: boolean; prefix?: boolean }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setShown(value);
    const c = animate(from, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => c.stop();
  }, [value]);
  const text = prefix ? formatPKR(shown, { signed }) : formatAmount(shown, { signed });
  return <span className={clsx("tabular", className)}>{text}</span>;
}

// ---------------------------------------------------------------------------
// Progress step (Processing screen)
// ---------------------------------------------------------------------------
export function ProgressStep({ title, detail, state }: { title: string; detail: string; state: "done" | "active" | "pending" | "attention" }) {
  return (
    <div className="flex gap-3.5 py-3">
      <div className="relative mt-0.5 h-8 w-8 shrink-0">
        <AnimatePresence mode="popLayout" initial={false}>
          {state === "done" && (
            <motion.span key="d" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 22 }} className="absolute inset-0 flex items-center justify-center rounded-full bg-blue text-white">
              <Check size={18} strokeWidth={3} />
            </motion.span>
          )}
          {state === "active" && (
            <motion.span key="a" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute inset-0 flex items-center justify-center">
              <motion.span className="absolute inset-0 rounded-full border-[3px] border-dashed border-blue" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }} />
              <span className="h-3 w-3 rounded-full bg-blue" />
            </motion.span>
          )}
          {state === "pending" && (
            <motion.span key="p" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute inset-0 flex items-center justify-center rounded-full border-2 border-line-strong text-ink-2">
              <Clock size={16} />
            </motion.span>
          )}
          {state === "attention" && (
            <motion.span key="x" initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1] }} exit={{ scale: 0 }} className="absolute inset-0 flex items-center justify-center rounded-[10px] border-2 border-ink bg-lime text-ink">
              <CircleAlert size={17} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="t-label text-[16px]">{title}</span>
          <span className={clsx("t-chip shrink-0", state === "done" ? "text-blue" : state === "active" ? "text-blue" : state === "attention" ? "text-ink" : "text-ink-2")}>
            {{ done: "Done", active: "In progress", pending: "Waiting", attention: "Needs you" }[state]}
          </span>
        </div>
        <motion.p key={detail} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="t-caption mt-0.5 text-ink-2">
          {detail}
        </motion.p>
      </div>
    </div>
  );
}

export function Spinner({ size = 22, className }: { size?: number; className?: string }) {
  return <StarSpinner size={size} className={className} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("relative overflow-hidden rounded-[16px] bg-paper-warm", className)}><span className="absolute inset-y-0 left-0 w-1/2 animate-sheen bg-gradient-to-r from-transparent via-white/70 to-transparent" /></div>;
}

export function Notice({ tone = "lime", icon, children, className }: { tone?: "lime" | "pink" | "blue" | "warm"; icon?: ReactNode; children: ReactNode; className?: string }) {
  const cls = {
    lime: "bg-lime-tint border-[1.5px] border-ink",
    pink: "bg-pink-tint border-[1.5px] border-pink-text text-ink",
    blue: "bg-blue-tint",
    warm: "bg-paper-warm",
  }[tone];
  return (
    <div className={clsx("flex gap-3 rounded-[16px] p-4", cls, className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="t-ui min-w-0 flex-1 text-[15px]">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("flex cursor-pointer items-center gap-4 py-3", disabled && "opacity-50")}>
      <span className="min-w-0 flex-1">
        <span className="t-label block text-[16px]">{label}</span>
        {description && <span className="t-caption mt-0.5 block text-ink-2">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors", checked ? "bg-blue" : "bg-line-strong/50")}
      >
        <motion.span layout transition={{ type: "spring", stiffness: 700, damping: 35 }} className={clsx("absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow", checked ? "right-[2px]" : "left-[2px]")} />
      </button>
    </label>
  );
}
