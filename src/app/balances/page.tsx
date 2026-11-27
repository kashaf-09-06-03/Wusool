"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { SlidersHorizontal } from "lucide-react";
import { Screen, useMe } from "@/components/shell";
import { Skeleton } from "@/components/ui";
import { BalanceRow, BalanceSheet, QuickChoiceCard, ThirdPartySheet } from "@/components/balance";
import { useNav } from "@/lib/client/nav";
import { formatPKR } from "@/lib/money";
import type { BalanceData } from "@/lib/client/types";

/** Balances tab (G1/G2): everything across outings; small debts get the quick Wusool/Maaf choice. */
export default function Balances() {
  const { me } = useMe();
  const { data, mutate, isLoading } = useSWR<{ balances: BalanceData[]; threshold: number }>(me ? "/api/balances" : null, { refreshInterval: 10000 });
  const search = useSearchParams();
  const nav = useNav();
  const [open, setOpen] = useState<{ id: string; maaf?: boolean } | null>(null);
  const [third, setThird] = useState<string | null>(null);

  useEffect(() => {
    const f = search.get("focus");
    if (f) setOpen({ id: f, maaf: search.get("maaf") === "1" });
    const t = search.get("thirdParty");
    if (t) setThird(t);
  }, [search]);

  const list = data?.balances ?? [];
  const isOpen = (b: BalanceData) => b.status !== "confirmed" && b.status !== "maaf";
  const quick = list.filter((b) => b.quickChoice);
  const owed = list.filter((b) => b.direction === "owed" && isOpen(b) && !b.quickChoice);
  const owe = list.filter((b) => b.direction === "owe" && isOpen(b));
  const closed = list.filter((b) => !isOpen(b));
  const owedSum = list.filter((b) => b.direction === "owed").reduce((a, b) => a + b.outstanding, 0);
  const oweSum = owe.reduce((a, b) => a + b.outstanding, 0);

  return (
    <Screen tabBar>
      <div className="px-5 pt-8">
        <h1 className="t-title">Balances</h1>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-[20px] bg-blue-tint p-4">
            <p className="t-caption text-ink-2">You’re owed</p>
            <p className="t-amount-l whitespace-nowrap text-[clamp(18px,5.4vw,24px)]">{formatPKR(owedSum)}</p>
          </div>
          <div className="rounded-[20px] bg-paper-warm p-4">
            <p className="t-caption text-ink-2">You owe</p>
            <p className="t-amount-l whitespace-nowrap text-[clamp(18px,5.4vw,24px)]">{formatPKR(oweSum)}</p>
          </div>
        </div>
        <button onClick={() => nav.push("/profile#threshold")} className="t-caption mt-3 flex items-center gap-1.5 text-blue">
          <SlidersHorizontal size={14} /> Small-debt threshold: {formatPKR(data?.threshold ?? 10000)}
        </button>
      </div>

      <div className="flex flex-col gap-5 px-5 pt-5">
        {isLoading && <Skeleton className="h-40" />}
        <AnimatePresence>
          {quick.map((b) => (
            <QuickChoiceCard key={b.id} b={b} onWusool={() => setOpen({ id: b.id })} onMaaf={() => setOpen({ id: b.id, maaf: true })} />
          ))}
        </AnimatePresence>
        {[
          ["You’re owed", owed],
          ["You owe", owe],
          ["Settled", closed],
        ].map(([title, rows]) =>
          (rows as BalanceData[]).length ? (
            <motion.section key={title as string} layout>
              <h2 className="t-label mb-1 text-[17px]">{title as string}</h2>
              <div className="divide-y divide-line">
                {(rows as BalanceData[]).map((b) => (
                  <BalanceRow key={b.id} b={b} showOuting onOpen={() => setOpen({ id: b.id })} />
                ))}
              </div>
            </motion.section>
          ) : null,
        )}
        {data && list.length === 0 && (
          <div className="flex flex-col items-center rounded-[24px] bg-paper-warm py-10 text-center">
            <motion.img src="/assets/wallet3d-cut.png" alt="" className="w-24" animate={{ rotate: [-4, 4, -4] }} transition={{ repeat: Infinity, duration: 3 }} />
            <h3 className="t-card mt-3">No balances yet</h3>
            <p className="t-body-s mt-1 max-w-[260px] text-ink-2">They appear when an organizer publishes a split you’re in.</p>
          </div>
        )}
      </div>
      <BalanceSheet id={open?.id ?? null} autoMaaf={open?.maaf} onClose={() => (setOpen(null), search.get("focus") && nav.replace("/balances"))} onChanged={() => mutate()} />
      <ThirdPartySheet balanceId={third} onClose={() => setThird(null)} onDone={() => mutate()} />
    </Screen>
  );
}
