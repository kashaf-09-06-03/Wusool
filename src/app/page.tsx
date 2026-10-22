"use client";
import { useState } from "react";
import useSWR from "swr";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Bell, Ellipsis, Link2, Plus, Sparkles } from "lucide-react";
import { Screen, useMe } from "@/components/shell";
import { Aura, AvatarStack, Button, ConfirmSheet, IconButton, Reveal, revealItem, Sheet, Skeleton, Sticker, TextField } from "@/components/ui";
import { Banner, Doodle, Logo } from "@/components/collage";
import { api, ApiError } from "@/lib/client/api";
import { useNav, vt } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { formatPKR } from "@/lib/money";
import type { HomeData } from "@/lib/client/types";

type Outing = HomeData["outings"][number];

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
  return (
    <Screen tabBar>
      {/* Header: wordmark + chrome star, greeting with a one-line money summary */}
      <header className="relative px-5 pb-2 pt-6">
        <Aura tones={["lime", "pink", "blue"]} />
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
            <motion.button whileTap={{ scale: 0.92 }} onClick={() => nav.push("/profile")} aria-label="Profile" className="chrome-ring flex h-11 w-11 items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-white">
              {me?.initials ?? ""}
            </motion.button>
          </div>
        </div>
        <Reveal className="relative mt-7">
          <motion.h1 variants={revealItem} className="t-hero">
            Salaam, {me?.name.split(" ")[0] ?? ""}.
          </motion.h1>
          <motion.p variants={revealItem} className="t-body mt-2 max-w-[300px] text-ink-2">
            {summaryLine(data)}
          </motion.p>
        </Reveal>
      </header>

      {/* Add Outing: the focal point (Fitts + isolation effect) */}
      <div className="px-4 pt-5">
        <AddOutingHero onClick={() => nav.push("/o/new")} />
        <button onClick={() => setPaste(true)} className="t-label mx-auto mt-4 flex items-center gap-2 text-[15px] text-ink-2 transition-colors hover:text-blue">
          <Link2 size={16} /> Have an invite link? Paste to join
        </button>
      </div>

      <section className="px-4 pt-7">
        <div className="mb-3 flex items-end justify-between px-1">
          <h2 className="t-h2 text-[26px]">My outings</h2>
          <span className="t-caption text-ink-2">
            {data ? `${data.counts.active} active · ${data.counts.settled} settled` : ""}
          </span>
        </div>

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
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, type: "spring", stiffness: 260, damping: 26 }}
              whileHover={{ y: -3 }}
              className="surface relative overflow-hidden"
            >
              <button className="block w-full text-left" onClick={() => nav.push(`/o/${o.id}`)} aria-label={`Open ${o.name}`}>
                <div className="relative h-[124px] p-2">
                  <Banner banner={o.banner} className="h-full rounded-[18px]" compact vtName={`banner-${o.id}`} sticker={o.receipts ? <Sticker color="pink" rotate={-5}>{o.receipts} receipt{o.receipts > 1 ? "s" : ""}</Sticker> : undefined} />
                  <div className="absolute -bottom-7 left-5">
                    <Logo type={o.logoType} value={o.logoValue} name={o.name} size={60} vtName={`logo-${o.id}`} />
                  </div>
                </div>
                <div className="px-5 pb-4 pt-9">
                  <p className="t-overline text-ink-2">
                    Outing {String(o.seq).padStart(3, "0")}
                    {o.isSample && <span className="ml-2 rounded-full bg-pink-tint px-1.5 py-0.5 text-pink-text">Sample</span>}
                    {o.status === "archived" && <span className="ml-2 rounded-full bg-paper-warm px-1.5 py-0.5">Archived</span>}
                  </p>
                  <h3 className="t-card mt-1" style={vt(`title-${o.id}`)}>
                    {o.name}
                  </h3>
                  <p className="t-caption mt-1 text-ink-2">{[o.date, o.place, `by ${o.organizerName}`].filter(Boolean).join(" · ")}</p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <AvatarStack people={o.members} extra={Math.max(0, o.memberCount - 3)} size={34} />
                    <MoneyLine money={o.money} />
                  </div>
                </div>
              </button>
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
          <p className="t-caption mt-1 text-ink-2">Only the organizer can rename or archive.</p>
        </div>
      </Sheet>

      <Sheet open={!!rename} onClose={() => setRename(null)} title="Rename outing" footer={<Button full loading={busy} onClick={() => rename && act(() => api(`/api/outings/${rename.o.id}`, "PATCH", { name: rename.name }), "Renamed")}>Save</Button>}>
        {rename && <TextField label="Outing name" value={rename.name} onChange={(v) => setRename({ ...rename, name: v })} maxLength={40} helper={`${rename.name.length}/40 · empty restores Outing ${String(rename.o.seq).padStart(3, "0")}`} autoFocus />}
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
function AddOutingHero({ onClick }: { onClick: () => void }) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [14, -14]), { stiffness: 150, damping: 14 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-18, 18]), { stiffness: 150, damping: 14 });
  const [spin, setSpin] = useState(0);
  return (
    <motion.button
      onClick={() => {
        setSpin((s) => s + 1);
        setTimeout(onClick, 220);
      }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
        my.set(((e.clientY - r.top) / r.height) * 2 - 1);
      }}
      onPointerLeave={() => (mx.set(0), my.set(0))}
      whileTap={{ scale: 0.97 }}
      className="gloss-blue relative flex h-[124px] w-full items-center gap-4 overflow-visible rounded-[30px] px-5 text-left text-white"
      style={{ perspective: 600, ...vt("add-outing") }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
        <span className="absolute -left-10 -top-16 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      </span>
      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/15">
        <Plus size={30} strokeWidth={2} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block text-[26px] font-bold leading-tight">Add Outing</span>
        <span className="t-ui block text-[15px] text-white/85">Start a split. We’ll name it for you.</span>
      </span>
      <motion.img
        src="/assets/star3d-cut.png"
        alt=""
        aria-hidden
        style={{ rotateX: rx, rotateY: ry }}
        animate={{ rotate: spin * 360 }}
        transition={{ rotate: { type: "spring", stiffness: 80, damping: 12 } }}
        className="pointer-events-none absolute -right-2 -top-7 w-[104px] drop-shadow-[0_14px_18px_rgba(17,17,20,0.3)]"
      />
      <span className="absolute -bottom-3 right-3">
        <Sticker color="lime" rotate={-8}>
          new ✦
        </Sticker>
      </span>
    </motion.button>
  );
}

/** A calm, specific one-liner instead of a dashboard: what matters right now. */
function summaryLine(data: HomeData | undefined): string {
  if (!data) return " ";
  if (!data.outings.length) return "Split your next outing in a minute: receipts in, a short story, done.";
  const owed = data.outings.reduce((a, o) => a + o.money.owed, 0);
  const owe = data.outings.reduce((a, o) => a + o.money.owe, 0);
  if (owe > 0 && owed > 0) return `You owe ${formatPKR(owe)} and you’re owed ${formatPKR(owed)}.`;
  if (owe > 0) return `You owe ${formatPKR(owe)} across your outings.`;
  if (owed > 0) return `You’re owed ${formatPKR(owed)} across your outings.`;
  const drafts = data.outings.filter((o) => !o.money.published).length;
  return drafts ? `${drafts} outing${drafts > 1 ? "s" : ""} waiting to be split.` : "All square. Sab clear.";
}
