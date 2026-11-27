"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Bell, ChevronRight, Ellipsis, Link2, Plus, Sparkles, Wallet } from "lucide-react";
import { Screen, useMe } from "@/components/shell";
import { Aura, AvatarStack, Button, ConfirmSheet, haptic, IconButton, press, Sheet, Skeleton, TextField } from "@/components/ui";
import { Banner, Doodle, Logo } from "@/components/collage";
import { api, ApiError } from "@/lib/client/api";
import { useNav, vt } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { formatPKR } from "@/lib/money";
import type { HomeData } from "@/lib/client/types";

type Outing = HomeData["outings"][number];

/**
 * The opening "assembly" plays once per app launch (module state survives client-side navigation but not a
 * reload), so coming back to Home later is instant instead of re-animating every time.
 */
let introPlayed = false;
const IOS = [0.32, 0.72, 0, 1] as const;

export default function Home() {
  const { me } = useMe();
  const { data, mutate, isLoading } = useSWR<HomeData>(me ? "/api/home" : null, { refreshInterval: 20000 });
  const nav = useNav();
  const toast = useToast();
  const [menu, setMenu] = useState<Outing | null>(null);
  const [rename, setRename] = useState<{ o: Outing; name: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "archive" | "leave"; o: Outing } | null>(null);
  const [paste, setPaste] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSample = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/api/sample");
      nav.push(`/o/${r.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t load the sample", "error");
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      await mutate();
      setConfirm(null);
      setRename(null);
      setMenu(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(false);
    }
  };

  const outings = data?.outings ?? [];
  const [intro] = useState(() => !introPlayed);
  useEffect(() => {
    introPlayed = true;
  }, []);
  const at = (d: number) => (intro ? d : 0);
  return (
    <Screen tabBar>
      {/* Header: wordmark + chrome star, greeting, and the way into balances */}
      <header className="relative px-5 pb-2 pt-6">
        <Aura tones={["lime", "pink", "blue"]} />
        <FloatingDots intro={intro} />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.img src="/assets/star3d-cut.png" alt="" className="h-7 w-7" initial={{ rotate: -180, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 160, damping: 12 }} />
            <span className="t-card text-[22px]">Wusool</span>
          </div>
          <div className="flex items-center gap-2">
            <IconButton label={`Inbox${data?.unread ? `, ${data.unread} unread` : ""}`} onClick={() => nav.push("/inbox")} surface="solid">
              <span className="relative">
                <Bell size={19} />
                {(data?.unread ?? 0) > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-pink ring-2 ring-white" />}
              </span>
            </IconButton>
            <motion.button {...press(0.88, 0.9)} onClick={() => nav.push("/profile")} aria-label="Profile" className="press-own chrome-ring flex h-11 w-11 items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-white">
              {me?.initials ?? ""}
            </motion.button>
          </div>
        </div>
        {/* The greeting rises out of a mask, like a line of type being set. */}
        <div className="relative mt-7 overflow-hidden pb-1">
          <motion.h1 initial={{ y: intro ? "105%" : 12, opacity: intro ? 1 : 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: intro ? 0.8 : 0.35, ease: IOS, delay: at(0.12) }} className="t-hero">
            Salaam, {me?.name.split(" ")[0] ?? ""}.
          </motion.h1>
        </div>
        <motion.div initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: at(0.32) }} className="relative mt-4">
          <DebtsButton data={data} onClick={() => nav.push("/balances")} />
        </motion.div>
      </header>

      {/* Add Outing: the focal point (Fitts + isolation effect) */}
      <div className="px-4 pt-5" style={{ perspective: 900 }}>
        <motion.div
          initial={intro ? { opacity: 0, y: 40, rotateX: 22, scale: 0.94 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 170, damping: 22, delay: at(0.4) }}
          style={{ transformOrigin: "50% 100%" }}
        >
          <AddOutingHero onClick={() => nav.push("/o/new")} intro={intro} />
        </motion.div>
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: at(0.62) }} onClick={() => setPaste(true)} className="t-label mx-auto mt-4 flex items-center gap-2 text-[15px] text-ink-2">
          <Link2 size={16} /> Join with an invite link
        </motion.button>
      </div>

      <section className="px-4 pt-7" style={{ perspective: 1000 }}>
        <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: IOS, delay: at(0.66) }} className="t-h2 mb-3 px-1 text-[26px]">
          My outings
        </motion.h2>

        {isLoading && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        )}

        {data && outings.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[24px] border border-line bg-paper p-6 text-center shadow-[var(--elev-1)]">
            <Banner banner="pink" className="absolute inset-x-0 top-0 h-28 opacity-90" />
            <div className="relative mt-16">
              <motion.img src="/assets/popper3d-cut.png" alt="" className="mx-auto w-24" animate={{ rotate: [-6, 6, -6] }} transition={{ repeat: Infinity, duration: 3 }} />
              <h3 className="t-card mt-3">No outings yet</h3>
              <p className="t-body-s mx-auto mt-1 max-w-[260px] text-ink-2">Tap Add Outing after your next dinner, or try the labelled sample to see how it works.</p>
              <Button variant="outline" size="M" className="mt-4" onClick={loadSample} loading={busy} icon={<Sparkles size={18} />}>
                Load the sample outing
              </Button>
            </div>
          </motion.div>
        )}

        <div className="flex flex-col gap-4">
          {outings.map((o, i) => (
            <motion.article
              key={o.id}
              // Intro: cards fly up and tip forward into place one after another, like a deck being dealt.
              initial={intro ? { opacity: 0, y: 70, rotateX: 28, scale: 0.94 } : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
              transition={intro ? { type: "spring", stiffness: 160, damping: 22, delay: 0.72 + i * 0.09 } : { delay: i * 0.05, type: "spring", stiffness: 320, damping: 32, mass: 0.8 }}
              style={{ transformOrigin: "50% 0%" }}
              className="surface relative overflow-hidden"
            >
              <motion.button {...press(0.975, 0.97)} className={`${press().className} block w-full text-left`} onClick={() => nav.push(`/o/${o.id}`)} aria-label={`Open ${o.name}`}>
                <div className="relative h-[124px] p-2">
                  <Banner banner={o.banner} className="h-full rounded-[18px]" compact vtName={`banner-${o.id}`} />
                  <div className="absolute -bottom-7 left-5">
                    <Logo type={o.logoType} value={o.logoValue} name={o.name} size={60} vtName={`logo-${o.id}`} />
                  </div>
                </div>
                <div className="px-5 pb-4 pt-9">
                  <h3 className="t-card flex items-center gap-2" style={vt(`title-${o.id}`)}>
                    {o.name}
                    {o.isSample && <span className="t-chip rounded-full bg-pink-tint px-2 py-0.5 font-[family-name:var(--font-ui)] text-pink-text">Sample</span>}
                    {o.status === "archived" && <span className="t-chip rounded-full bg-paper-warm px-2 py-0.5 font-[family-name:var(--font-ui)] text-ink-2">Archived</span>}
                  </h3>
                  <p className="t-caption mt-1 text-ink-2">{[o.date, o.place, `by ${o.organizerName}`].filter(Boolean).join(" · ")}</p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <AvatarStack people={o.members} extra={Math.max(0, o.memberCount - 3)} size={34} />
                    <MoneyLine money={o.money} />
                  </div>
                </div>
              </motion.button>
              <div className="absolute right-3 top-3">
                <IconButton label={`More for ${o.name}`} surface="solid" onClick={() => setMenu(o)}>
                  <Ellipsis size={20} />
                </IconButton>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      {/* Card ⋯ menu (A2): Rename · Archive · Leave */}
      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name}>
        <div className="flex flex-col gap-2 pb-2">
          <Button variant="outline" full onClick={() => menu && (setRename({ o: menu, name: menu.name }), setMenu(null))}>
            Rename
          </Button>
          <Button variant="outline" full onClick={() => menu && (setConfirm({ kind: "archive", o: menu }), setMenu(null))}>
            {menu?.status === "archived" ? "Reopen" : "Archive"}
          </Button>
          <Button variant="danger" full onClick={() => menu && (setConfirm({ kind: "leave", o: menu }), setMenu(null))}>
            Leave outing
          </Button>
        </div>
      </Sheet>

      <Sheet open={!!rename} onClose={() => setRename(null)} title="Rename outing" footer={<Button full loading={busy} onClick={() => rename && act(() => api(`/api/outings/${rename.o.id}`, "PATCH", { name: rename.name }), "Renamed")}>Save</Button>}>
        {rename && <TextField label="Outing name" value={rename.name} onChange={(v) => setRename({ ...rename, name: v })} maxLength={40} autoFocus />}
      </Sheet>

      <ConfirmSheet
        open={confirm?.kind === "archive"}
        onClose={() => setConfirm(null)}
        title={confirm?.o.status === "archived" ? "Reopen this outing?" : "Archive this outing?"}
        body={confirm?.o.status === "archived" ? "It becomes active again and more expenses can be added." : confirm && (confirm.o.money.owe || confirm.o.money.owed) ? "Some balances are still open. They stay collectible: archiving never waives anything." : "It becomes read-only. Memories are kept."}
        confirmLabel={confirm?.o.status === "archived" ? "Reopen" : "Archive anyway"}
        loading={busy}
        onConfirm={() => confirm && act(() => api(`/api/outings/${confirm.o.id}`, "PATCH", { archived: confirm.o.status !== "archived" }), confirm.o.status === "archived" ? "Reopened" : "Archived")}
      />
      <ConfirmSheet
        open={confirm?.kind === "leave"}
        onClose={() => setConfirm(null)}
        title="Leave this outing?"
        body="Your history stays in the ledger. You can’t leave while you have open balances: settle, ask for Maaf, or mute it instead."
        confirmLabel="Leave"
        tone="danger"
        loading={busy}
        onConfirm={() => confirm && act(() => api(`/api/outings/${confirm.o.id}/leave`), "You left the outing")}
      />

      <Sheet open={paste} onClose={() => setPaste(false)} title="Paste an invite link" footer={<Button full onClick={() => { const m = link.match(/\/j\/([A-Za-z0-9-]+)/) ?? link.trim().match(/^([A-Za-z0-9]{3}-[A-Za-z0-9]{4})$/); if (m) nav.push(`/j/${m[1]}`); else toast("That doesn’t look like a Wusool invite link", "error"); }}>Open invite</Button>}>
        <TextField label="Invite link" value={link} onChange={setLink} placeholder="wusool.app/j/7Kx-93Q" autoFocus />
      </Sheet>
    </Screen>
  );
}

function MoneyLine({ money }: { money: Outing["money"] }) {
  if (!money.published) return <span className="t-caption text-right text-ink-2">Not split yet</span>;
  if (money.settled) return <span className="t-label text-right text-blue">Sab clear ✓</span>;
  if (money.owed > 0)
    return (
      <span className="text-right">
        <span className="t-caption block text-ink-2">You’re owed</span>
        <span className="t-amount-m text-[18px]">{formatPKR(money.owed)}</span>
      </span>
    );
  if (money.owe > 0)
    return (
      <span className="text-right">
        <span className="t-caption block text-ink-2">You owe</span>
        <span className="t-amount-m text-[18px]">{formatPKR(money.owe)}</span>
      </span>
    );
  return <span className="t-caption text-ink-2">All square</span>;
}

/** 358 × 120 tappable hero. The 3D star tilts with the pointer / device. */
function AddOutingHero({ onClick, intro }: { onClick: () => void; intro?: boolean }) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [14, -14]), { stiffness: 150, damping: 14 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-18, 18]), { stiffness: 150, damping: 14 });
  const [spin, setSpin] = useState(0);
  return (
    <motion.button
      onClick={() => {
        // No artificial delay: the star starts its spin and the page push begins on the same frame.
        haptic();
        setSpin((s) => s + 1);
        onClick();
      }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
        my.set(((e.clientY - r.top) / r.height) * 2 - 1);
      }}
      onPointerLeave={() => (mx.set(0), my.set(0))}
      {...press(0.97, 0.93)}
      className="press-own gloss-blue relative flex h-[104px] w-full items-center gap-4 overflow-visible rounded-[30px] px-5 text-left text-white"
      style={{ perspective: 600, ...vt("add-outing") }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
        <span className="absolute -left-10 -top-16 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      </span>
      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/15">
        <Plus size={30} strokeWidth={2} />
      </span>
      <span className="relative block min-w-0 flex-1 text-[26px] font-bold leading-tight">Add Outing</span>
      <motion.img
        src="/assets/star3d-cut.png"
        alt=""
        aria-hidden
        style={{ rotateX: rx, rotateY: ry }}
        initial={intro ? { y: -70, scale: 0.4, opacity: 0, rotate: -140 } : false}
        animate={{ y: 0, scale: 1, opacity: 1, rotate: spin * 360 }}
        transition={{ rotate: { type: "spring", stiffness: 80, damping: 12, delay: intro && !spin ? 0.62 : 0 }, default: { type: "spring", stiffness: 160, damping: 13, delay: intro ? 0.62 : 0 } }}
        className="pointer-events-none absolute -right-2 -top-7 w-[104px] drop-shadow-[0_14px_18px_rgba(17,17,20,0.3)]"
      />
    </motion.button>
  );
}

/** Opens Balances. Shows a small status dot so the button carries meaning without printing amounts on Home. */
function DebtsButton({ data, onClick }: { data: HomeData | undefined; onClick: () => void }) {
  const owe = data?.outings.reduce((a, o) => a + o.money.owe, 0) ?? 0;
  const owed = data?.outings.reduce((a, o) => a + o.money.owed, 0) ?? 0;
  const tone = owe > 0 ? "bg-pink" : owed > 0 ? "bg-lime" : null;
  return (
    <motion.button {...press(0.96, 0.95)} onClick={onClick} className="press-own glass-solid inline-flex h-12 items-center gap-3 rounded-full pl-1.5 pr-4">
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white">
        <Wallet size={17} />
        {tone && <span className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-white ${tone}`} aria-hidden />}
      </span>
      <span className="t-label text-[15px]">See your debts</span>
      <ChevronRight size={17} className="-ml-1 text-ink-3" />
    </motion.button>
  );
}

/** Opening assembly only: a few small coloured dots pop in around the star, drift, then fade away. */
function FloatingDots({ intro }: { intro: boolean }) {
  if (!intro) return null;
  const dots = [
    { c: "#c6f432", s: 10, x: "78%", y: 92, d: 0.18 },
    { c: "#ff2e93", s: 7, x: "62%", y: 150, d: 0.26 },
    { c: "#1f3bff", s: 6, x: "88%", y: 176, d: 0.34 },
    { c: "#c9b8ff", s: 12, x: "70%", y: 206, d: 0.42 },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {dots.map((d, i) => (
        <motion.span
          key={i}
          className="absolute block"
          style={{ left: d.x, top: d.y }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1, 1, 0.6], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 2.6, times: [0, 0.18, 0.7, 1], ease: "easeOut", delay: d.d }}
        >
          <span className="block animate-float rounded-full" style={{ width: d.s, height: d.s, background: d.c, animationDelay: `${i * -1.4}s` }} />
        </motion.span>
      ))}
    </div>
  );
}
