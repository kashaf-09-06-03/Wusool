"use client";
import { use, useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Check, CheckCheck, CircleAlert, X } from "lucide-react";
import { Fab, Screen, TopBar, useMe } from "@/components/shell";
import { Avatar, Button, ConfirmSheet, Notice, Skeleton } from "@/components/ui";
import { Logo } from "@/components/collage";
import { Burst } from "@/components/fx";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { formatAmount, formatPKR } from "@/lib/money";
import type { OutingData, PreviewData } from "@/lib/client/types";
import { memberLookup } from "../tabs/util";

/** 12 · Confirm & publish (F3): one calm, final check. Publishing is blocked until everything reconciles. */
export default function Confirm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const { data } = useSWR<OutingData>(me ? `/api/outings/${id}` : null);
  const sp = useSearchParams();
  const allocation = (sp.get("allocation") as "actual" | "equal" | null) ?? data?.outing.allocation ?? "actual";
  const routing = (sp.get("routing") as "original" | "optimized" | null) ?? data?.outing.routing ?? "original";
  const rules = (() => {
    try {
      return sp.get("rules") ? JSON.parse(sp.get("rules")!) : (data?.outing.rules ?? {});
    } catch {
      return data?.outing.rules ?? {};
    }
  })();
  const qs = data ? `allocation=${allocation}&routing=${routing}&rules=${encodeURIComponent(JSON.stringify(rules))}&rev=${data.outing.draftRev}` : null;
  const { data: p } = useSWR<PreviewData>(qs ? `/api/outings/${id}/settlement?${qs}` : null);
  const nav = useNav();
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(0);

  if (!data || !p) {
    return (
      <Screen>
        <TopBar back={`/o/${id}/review`} title="Confirm & publish" />
        <div className="flex flex-col gap-4 px-5">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
          <Skeleton className="h-56" />
        </div>
      </Screen>
    );
  }
  const m = memberLookup(data);
  const edges = p.chosenEdges;
  const lineAnswers = data.questions.filter((q) => q.kind === "line" && q.status === "answered");
  const blockingQ = data.questions.filter((q) => q.blocking);
  const isOrg = data.me.role === "organizer";
  const republish = Boolean(p.published);

  const publish = async () => {
    setBusy(true);
    try {
      const r = await api<{ version: number }>(`/api/outings/${id}/publish`, "POST", { allocation, routing, rules, expectedRev: p.draftRev, confirm: true });
      setAsk(false);
      setStamp((s) => s + 1);
      toast(`Published${r.version > 1 ? ` (version ${r.version})` : ""}. Everyone has their breakdown.`);
      setTimeout(() => nav.replace(`/o/${id}?tab=settle`), 1400);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t publish", "error");
      setBusy(false);
      setAsk(false);
    }
  };

  const checks = [
    { ok: p.invariants.totalsMatch && !p.issues.some((i) => i.code === "TOTAL_MISMATCH"), text: `Totals match receipts · ${formatPKR(p.grandTotal)}` },
    { ok: p.invariants.netsSumToZero && p.invariants.edgesMatchNets, text: "Every balance sums to zero" },
    { ok: blockingQ.every((q) => q.status === "answered"), text: `${blockingQ.filter((q) => q.status === "answered").length} of ${blockingQ.length} questions answered` },
    ...lineAnswers.map((q) => ({ ok: true, text: `${q.text.replace(/\?$/, "").replace(/:.*$/, "")} price confirmed${typeof q.answer === "number" ? ` · ${formatPKR(q.answer)}` : ""}` })),
    ...(routing === "optimized" ? [{ ok: p.netsPreserved, text: "Optimized routing keeps every net amount" }] : []),
    { ok: true, text: p.roundingApplied ? "Rounding: whole rupees, within PKR 1 per person, shown in breakdowns" : "No rounding needed: every share is a whole rupee" },
  ];

  return (
    <Screen>
      <TopBar back={`/o/${id}/review`} title="Confirm & publish" />
      <Burst trigger={stamp} origin={{ x: 0.5, y: 0.8 }} count={40} />
      <AnimatePresence>
        {stamp > 0 && (
          <motion.div className="pointer-events-none fixed inset-0 z-[85] flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div initial={{ scale: 3, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: -12, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }} className="rounded-[18px] border-[3px] border-blue bg-paper/90 px-6 py-2.5 text-blue backdrop-blur-sm" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, letterSpacing: "-0.02em" }}>
              Published
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-col gap-5 px-5 pb-4">
        <div className="flex items-center gap-3">
          <Logo type={data.outing.logoType} value={data.outing.logoValue} name={data.outing.name} size={56} />
          <div>
            <h1 className="t-card">{data.outing.name}</h1>
            <p className="t-caption text-ink-2">
              {data.expenses.length} expense{data.expenses.length === 1 ? "" : "s"} · {data.members.length} people · {formatPKR(p.grandTotal)}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-[20px] border-[1.5px] border-ink">
          <div className="flex items-center justify-between p-4">
            <div>
              <p className="t-label text-[17px]">{allocation === "equal" ? "Equal split" : "Actual / individual"}</p>
              <p className="t-caption text-ink-2">{allocation === "equal" ? `Everyone pays ${formatPKR(p.equalShare)} of eligible expenses` : "Each person pays for what they had"}</p>
            </div>
            <button className="t-label text-blue" onClick={() => nav.push(`/o/${id}/review`)}>
              Change
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-line p-4">
            <div>
              <p className="t-label text-[17px]">
                {routing === "optimized" ? "Optimized" : "Original debts"} · {edges.length} transfer{edges.length === 1 ? "" : "s"}
              </p>
              <p className="t-caption text-ink-2">{routing === "optimized" ? "Net amounts unchanged for everyone" : "Pay back whoever paid for you"}</p>
            </div>
            <button className="t-label text-blue" onClick={() => nav.push(`/o/${id}/review`)}>
              Change
            </button>
          </div>
        </div>

        <section>
          <h2 className="t-label mb-1 text-[17px]">Who pays whom</h2>
          <ul className="divide-y divide-line">
            {edges.map((e, i) => (
              <motion.li key={`${e.from}-${e.to}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center gap-3 py-3">
                <Avatar initials={m.byId(e.from)?.initials ?? "?"} color={m.byId(e.from)?.color} size={32} />
                <span className="t-ui min-w-0 flex-1 text-[16px]">
                  {m.first(e.from)} → {m.first(e.to)}
                </span>
                <span className="t-amount-m text-[17px]">{formatPKR(e.amount)}</span>
              </motion.li>
            ))}
            {edges.length === 0 && <li className="t-caption py-3 text-ink-2">Nobody needs to pay anyone.</li>}
          </ul>
        </section>

        {republish && p.published?.prevNets && (
          <section className="rounded-[20px] border-[1.5px] border-ink bg-lime-tint p-4">
            <p className="t-label">What changes from version {p.published.version}</p>
            <p className="t-caption text-ink-2">Each person’s cost, before and after. Already-confirmed payments and Maaf are kept; only the difference becomes new balances.</p>
            <table className="mt-2 w-full t-ui text-[14px] tabular">
              <thead>
                <tr className="t-overline text-[10px] text-ink-2">
                  <th className="text-left font-bold">Person</th>
                  <th className="text-right font-bold">Before</th>
                  <th className="text-right font-bold">Now</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((mm) => {
                  const before = p.published!.prevNets![mm.id] ?? 0;
                  const now = p.consumed[mm.id] ?? 0;
                  return (
                    <tr key={mm.id}>
                      <td className="py-0.5">{mm.name.split(" ")[0]}</td>
                      <td className="text-right">{formatAmount(before)}</td>
                      <td className={`text-right ${before !== now ? "font-semibold" : ""}`}>{formatAmount(now)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <section className="rounded-[20px] bg-paper-warm p-4">
          <h2 className="t-label text-[17px]">Checked</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {checks.map((c, i) => (
              <motion.li key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 + i * 0.07 }} className="flex items-start gap-2.5 t-ui text-[15px]">
                {c.ok ? <Check size={18} className="mt-0.5 shrink-0 text-blue" strokeWidth={2.5} /> : <X size={18} className="mt-0.5 shrink-0 text-pink-text" strokeWidth={2.5} />}
                <span className={c.ok ? "" : "text-pink-text"}>{c.text}</span>
              </motion.li>
            ))}
          </ul>
        </section>

        {p.blockers.length > 0 && (
          <Notice tone="pink" icon={<CircleAlert size={18} className="text-pink-text" />}>
            <p className="t-label">Publishing is blocked</p>
            <ul className="t-caption mt-1 list-disc pl-4">
              {p.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <Button size="S" variant="ink" className="mt-2" onClick={() => nav.push(`/o/${id}/review`)}>
              Resolve in review
            </Button>
          </Notice>
        )}

        <Notice tone="blue" icon={<Bell size={18} className="text-blue" />}>
          Everyone sees only their own breakdown, in-app. {p.whatsappOptIns > 0 ? `${p.whatsappOptIns} also get it on WhatsApp (simulated).` : "Nobody has WhatsApp turned on."}
        </Notice>
      </div>
      <Fab>
        <Button full icon={<CheckCheck size={20} />} disabled={!isOrg || p.blockers.length > 0} onClick={() => setAsk(true)}>
          {republish ? `Re-publish to ${data.members.length} members` : `Publish to ${data.members.length} members`}
        </Button>
        <Button variant="text" size="M" full className="mt-1" onClick={() => nav.push(`/o/${id}`)}>
          Not yet
        </Button>
      </Fab>
      <ConfirmSheet open={ask} onClose={() => setAsk(false)} title="Publish this split?" body={`Everyone will see their own breakdown and who to pay. Balances start as “Requested”. ${republish ? "Earlier confirmed payments stay recorded." : ""}`} confirmLabel="Publish" loading={busy} onConfirm={publish} />
    </Screen>
  );
}
