"use client";
import { useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Receipt } from "lucide-react";
import { Button, Notice, Skeleton } from "@/components/ui";
import { BalanceRow, BalanceSheet, QuickChoiceCard } from "@/components/balance";
import { Burst } from "@/components/fx";
import { useNav } from "@/lib/client/nav";
import { formatPKR } from "@/lib/money";
import type { BalanceData, OutingData } from "@/lib/client/types";

export function SettleTab({ data, onChanged }: { data: OutingData; onChanged: () => void }) {
  const nav = useNav();
  const id = data.outing.id;
  const { data: bal, mutate } = useSWR<{ balances: BalanceData[] }>(data.plan ? `/api/outings/${id}/balances` : null, { refreshInterval: 8000 });
  const [open, setOpen] = useState<{ id: string; maaf?: boolean } | null>(null);
  const [celebrate] = useState(() => Date.now());

  if (!data.plan) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[24px] bg-paper-warm p-6 text-center">
          <h3 className="t-card">Not split yet</h3>
          <p className="t-body-s mx-auto mt-1 max-w-[280px] text-ink-2">
            {data.me.role === "organizer" ? "Review it, then publish. Nobody is notified until you do." : `${data.outing.organizerName.split(" ")[0]} will publish the split.`}
          </p>
          {data.expenses.length > 0 && (
            <Button className="mt-5" size="M" icon={<ArrowRight size={18} />} onClick={() => nav.push(`/o/${id}/review`)}>
              {data.me.role === "organizer" ? "Review & split" : "See the draft"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const list = bal?.balances ?? [];
  const mine = list.filter((b) => b.direction !== "other");
  const others = list.filter((b) => b.direction === "other");
  const quick = mine.filter((b) => b.quickChoice);
  const allSettled = list.length > 0 && list.every((b) => b.status === "confirmed" || b.status === "maaf");
  const refresh = () => (mutate(), onChanged());

  return (
    <div className="flex flex-col gap-4">
      {allSettled && (
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative overflow-hidden rounded-[24px] bg-blue p-6 text-center text-white">
          <Burst trigger={celebrate} />
          <motion.img src="/assets/popper3d-cut.png" alt="" className="mx-auto w-28" animate={{ rotate: [-8, 8, -8], y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.6 }} />
          <p className="t-card mt-3">Sab clear.</p>
          <p className="t-body-s mt-1 text-white/85">Every balance is confirmed or forgiven.</p>
        </motion.div>
      )}

      <div className="rounded-[20px] border border-line p-4">
        <p className="t-caption text-ink-2">
          {data.plan.allocation === "equal" ? "Equal split" : "Actual / individual"} · {data.plan.routing === "optimized" ? "Optimized" : "Original debts"}
        </p>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <p className="t-caption text-ink-2">{data.money.owed > 0 ? "You’re owed" : data.money.owe > 0 ? "You owe" : "Your position"}</p>
            <p className="t-amount-l">{data.money.owed > 0 ? formatPKR(data.money.owed) : data.money.owe > 0 ? formatPKR(data.money.owe) : "All square"}</p>
          </div>
          <Button size="S" variant="outline" icon={<Receipt size={15} />} onClick={() => nav.push(`/o/${id}/me`)}>
            My breakdown
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {quick.map((b) => (
          <QuickChoiceCard key={b.id} b={b} onWusool={() => setOpen({ id: b.id })} onMaaf={() => setOpen({ id: b.id, maaf: true })} />
        ))}
      </AnimatePresence>

      {!bal ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          {mine.length > 0 && (
            <div>
              <h3 className="t-label mb-1 text-[17px]">Yours</h3>
              <div className="divide-y divide-line">
                {mine.map((b) => (
                  <BalanceRow key={b.id} b={b} onOpen={() => setOpen({ id: b.id })} />
                ))}
              </div>
            </div>
          )}
          {others.length > 0 && (
            <div>
              <h3 className="t-label mb-1 text-[17px]">Everyone else</h3>
              <div className="divide-y divide-line">
                {others.map((b) => (
                  <BalanceRow key={b.id} b={b} onOpen={() => (data.me.role === "organizer" ? setOpen({ id: b.id }) : undefined)} />
                ))}
              </div>
            </div>
          )}
          {list.length === 0 && <Notice tone="warm">No transfers needed: everyone is square.</Notice>}
        </>
      )}

      <Button variant="text" size="M" onClick={() => nav.push(`/o/${id}/review`)}>
        See how it was split
      </Button>

      <BalanceSheet id={open?.id ?? null} autoMaaf={open?.maaf} onClose={() => setOpen(null)} onChanged={refresh} />
    </div>
  );
}
