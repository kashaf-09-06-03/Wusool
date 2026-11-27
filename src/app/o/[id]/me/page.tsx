"use client";
import { use, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Eye, Receipt } from "lucide-react";
import clsx from "clsx";
import { Screen, TopBar, useMe } from "@/components/shell";
import { Amount, Button, Notice, Skeleton, StatusChip, type StatusKey } from "@/components/ui";
import { BalanceSheet } from "@/components/balance";
import { useNav } from "@/lib/client/nav";
import { formatPKR } from "@/lib/money";
import type { BreakdownData } from "@/lib/client/types";

type Published = Extract<BreakdownData, { published: true }>;

/** F4 · My breakdown & “Why do I owe this?”: only my items, every rupee explained. */
export default function MyBreakdown({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const { data, mutate } = useSWR<BreakdownData>(me ? `/api/outings/${id}/me` : null);
  const nav = useNav();
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!data) {
    return (
      <Screen>
        <TopBar back={`/o/${id}`} title="My breakdown" />
        <div className="flex flex-col gap-4 px-5">
          <Skeleton className="h-36" />
          <Skeleton className="h-60" />
        </div>
      </Screen>
    );
  }
  if (!data.published) {
    return (
      <Screen>
        <TopBar back={`/o/${id}`} title="My breakdown" />
        <div className="px-5">
          <Notice tone="warm">Your breakdown appears once the organizer publishes the split. You’ll get it in-app.</Notice>
        </div>
      </Screen>
    );
  }
  const d = data as Published;
  const owe = d.transfers.filter((t) => t.iOwe && t.status !== "superseded");
  const owed = d.transfers.filter((t) => !t.iOwe && t.status !== "superseded");

  return (
    <Screen>
      <TopBar back={`/o/${id}`} title="My breakdown" />
      <div className="flex flex-col gap-5 px-5 pb-10">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="rounded-[24px] bg-ink p-5 text-white">
          <p className="t-caption text-white/70">{d.net < 0 ? "You owe in total" : d.net > 0 ? "You’re owed in total" : "You’re all square"}</p>
          <Amount value={Math.abs(d.net)} className="t-amount-xl" />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/15 pt-3">
            <div>
              <p className="t-caption text-white/70">Your share</p>
              <p className="t-amount-m">{formatPKR(d.consumed)}</p>
            </div>
            <div>
              <p className="t-caption text-white/70">You paid</p>
              <p className="t-amount-m">{formatPKR(d.paid)}</p>
            </div>
          </div>
        </motion.div>

        {(owe.length > 0 || owed.length > 0) && (
          <section>
            <h2 className="t-label mb-1 text-[17px]">{owe.length ? "Pay to" : "You receive from"}</h2>
            <ul className="divide-y divide-line">
              {[...owe, ...owed].map((t) => (
                <li key={t.balanceId}>
                  <button className="flex w-full items-center gap-3 py-3 text-left" onClick={() => setOpen(t.balanceId)}>
                    <span className="t-label min-w-0 flex-1">{t.iOwe ? `Pay ${t.other.split(" ")[0]}` : `${t.other.split(" ")[0]} pays you`}</span>
                    <StatusChip status={t.status as StatusKey} />
                    <span className="t-amount-m">{formatPKR(t.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {d.routing === "optimized" && d.original.length > 0 && (
              <div className="mt-2 rounded-[16px] bg-blue-tint p-3.5">
                <p className="t-label text-[14px]">Why these transfers?</p>
                <p className="t-caption mt-1">
                  Originally: {d.original.map((o) => (o.iOwe ? `you → ${o.to.split(" ")[0]} ${formatPKR(o.amount)}` : `${o.from.split(" ")[0]} → you ${formatPKR(o.amount)}`)).join(" · ")}. Optimized routing only removes middle steps; your total ({formatPKR(Math.abs(d.net))}) is exactly the same.
                </p>
              </div>
            )}
          </section>
        )}

        <section>
          <h2 className="t-h3">Why do I owe this?</h2>
          <div className="mt-3 flex flex-col gap-2.5">
            {d.expenses.map((e) => {
              if (!e) return null;
              const isOpen = expanded === e.expenseId;
              return (
                <div key={e.expenseId} className="overflow-hidden rounded-[20px] border border-line">
                  <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setExpanded(isOpen ? null : e.expenseId)} aria-expanded={isOpen}>
                    <span className="min-w-0 flex-1">
                      <span className="t-label block">{e.title}</span>
                      <span className="t-caption text-ink-2">
                        Paid by {e.payers.map((p) => (p.isMe ? "you" : p.name.split(" ")[0])).join(" & ")} · total {formatPKR(e.total)}
                      </span>
                    </span>
                    <span className="t-amount-m">{formatPKR(e.myTotal)}</span>
                    <ChevronDown size={18} className={clsx("shrink-0 transition-transform", isOpen && "rotate-180")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="border-t border-line bg-paper-warm p-4">
                          <ul className="flex flex-col gap-2">
                            {e.items.map((it, i) => (
                              <li key={i} className="flex justify-between gap-3 t-ui text-[14px]">
                                <span className="min-w-0">
                                  {it.label}
                                  <span className="t-caption block text-ink-2">
                                    {it.kind === "equal"
                                      ? "Equal split of this expense across everyone"
                                      : it.sharedWith.length === 0
                                        ? "Just you"
                                        : `Shared with ${it.sharedWith.join(", ")} · your ${it.weight === 1 && it.totalWeight ? `1/${it.totalWeight}` : `${it.weight}/${it.totalWeight}`}`}
                                  </span>
                                </span>
                                <span className="tabular font-semibold">{formatPKR(it.amount)}</span>
                              </li>
                            ))}
                            {e.charges.map((c, i) => (
                              <li key={`c${i}`} className="flex justify-between gap-3 t-ui text-[14px]">
                                <span className="min-w-0">
                                  {c.label}
                                  <span className="t-caption block text-ink-2">
                                    Pro-rata: your items {formatPKR(e.chargeBasis.myItemSubtotal)} of {formatPKR(e.chargeBasis.itemSubtotal)} ({e.chargeBasis.itemSubtotal ? ((e.chargeBasis.myItemSubtotal / e.chargeBasis.itemSubtotal) * 100).toFixed(1) : 0}%)
                                  </span>
                                </span>
                                <span className="tabular font-semibold">{formatPKR(c.amount)}</span>
                              </li>
                            ))}
                            {e.rounding !== 0 && (
                              <li className="flex justify-between gap-3 t-ui text-[14px]">
                                <span className="min-w-0">
                                  Rounding to whole rupees
                                  <span className="t-caption block text-ink-2">So everyone transfers whole rupees; within PKR 1 of your exact share overall.</span>
                                </span>
                                <span className="tabular font-semibold">{formatPKR(e.rounding, { signed: true })}</span>
                              </li>
                            )}
                          </ul>
                          <div className="mt-3 flex justify-between border-t border-line pt-2 t-label">
                            <span>Your part</span>
                            <span className="tabular">{formatPKR(e.myTotal)}</span>
                          </div>
                          {e.evidenceId && (
                            <a href={`/api/evidence/${e.evidenceId}/file`} target="_blank" rel="noreferrer" className="t-chip mt-3 inline-flex items-center gap-1.5 text-blue">
                              <Receipt size={14} /> See the source receipt
                            </a>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>

        <div className="rounded-[18px] border border-line p-4">
          <p className="t-label">Still looks wrong?</p>
          <p className="t-caption mt-0.5 text-ink-2">Open a dispute. Reminders pause while the organizer fixes it.</p>
          <div className="mt-3 flex gap-2">
            {owe[0] && (
              <Button size="S" variant="outline" onClick={() => setOpen(owe[0].balanceId)}>
                Something’s wrong
              </Button>
            )}
            <Button size="S" variant="text" icon={<Eye size={15} />} onClick={() => nav.push(`/o/${id}/review`)}>
              See the whole split
            </Button>
          </div>
        </div>
      </div>
      <BalanceSheet id={open} onClose={() => setOpen(null)} onChanged={() => mutate()} />
    </Screen>
  );
}
