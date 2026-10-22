"use client";
import { motion } from "motion/react";
import { ArrowRight, CircleAlert, RefreshCw, Sparkles } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { useNav } from "@/lib/client/nav";
import { formatPKR } from "@/lib/money";
import type { OutingData } from "@/lib/client/types";
import { expenseTotal, memberLookup, SourceIcon, sourceLabel } from "./util";

export function ExpensesTab({ data }: { data: OutingData; onChanged: () => void }) {
  const nav = useNav();
  const id = data.outing.id;
  const m = memberLookup(data);
  const total = data.expenses.reduce((a, e) => a + expenseTotal(e), 0);
  const open = data.questions.filter((q) => q.status !== "answered" && q.blocking).length;
  const counts = {
    receipts: data.evidence.filter((e) => e.kind === "receipt").length,
    rides: data.evidence.filter((e) => e.kind === "ride").length,
    manual: data.expenses.filter((e) => e.source === "manual").length,
    story: data.expenses.filter((e) => e.source === "story").length,
  };
  const unprocessed = data.evidence.filter((e) => e.status === "uploaded").length;
  const changedSincePublish = data.plan && data.plan.draftRev !== data.outing.draftRev;
  const sourcesLine = [
    counts.receipts && `${counts.receipts} receipt${counts.receipts > 1 ? "s" : ""}`,
    counts.rides && `${counts.rides} ride screenshot${counts.rides > 1 ? "s" : ""}`,
    counts.manual && `${counts.manual} manual`,
    counts.story && `${counts.story} from your story`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (data.expenses.length === 0 && data.evidence.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-[24px] bg-paper-warm px-6 py-10 text-center">
        <motion.img src="/assets/wallet3d-cut.png" alt="" className="w-24" animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3 }} />
        <h3 className="t-card mt-4">Nothing here yet</h3>
        <p className="t-body-s mt-1 max-w-[270px] text-ink-2">Add every receipt and ride screenshot, then tell the story once. Or add an expense by hand.</p>
        <Button className="mt-5" size="M" onClick={() => nav.push(`/o/${id}/evidence`)}>
          Add evidence
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {changedSincePublish && (
        <Notice tone="lime" icon={<RefreshCw size={18} />}>
          <p className="t-label">Changed since version {data.plan!.version} was published</p>
          <p className="t-caption mt-0.5 text-ink-2">Already-paid amounts are kept; the difference is added as new entries.</p>
          {data.me.role === "organizer" && (
            <Button size="S" variant="ink" className="mt-2" onClick={() => nav.push(`/o/${id}/review`)}>
              Review & re-publish
            </Button>
          )}
        </Notice>
      )}

      {/* Summary: calm money surface */}
      <div className="surface p-4 ">
        <p className="t-overline text-ink-2">Total so far{data.outing.isSample ? " · sample" : ""}</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="t-amount-l text-[30px]">{formatPKR(total)}</span>
          {open > 0 && (
            <button onClick={() => nav.push(`/o/${id}/review`)} className="t-chip inline-flex h-8 items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-lime-tint px-3">
              <CircleAlert size={14} /> {open} to review
            </button>
          )}
        </div>
        <p className="t-caption mt-1 text-ink-2">{sourcesLine || "No sources yet"}</p>
      </div>

      {unprocessed > 0 && (
        <Notice tone="blue" icon={<Sparkles size={18} className="text-blue" />}>
          <p className="t-label">{unprocessed} new source{unprocessed > 1 ? "s" : ""} not read yet</p>
          <Button size="S" className="mt-2" onClick={() => nav.push(`/o/${id}/narrate`)}>
            Tell the story & read them
          </Button>
        </Notice>
      )}

      <ul className="divide-y divide-line">
        {data.expenses.map((e, i) => (
          <motion.li key={e.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <button className="flex w-full items-center gap-3 py-3.5 text-left" onClick={() => nav.push(`/o/${id}/expense/${e.id}`)}>
              <SourceIcon source={e.source} />
              <span className="min-w-0 flex-1">
                <span className="t-label block truncate text-[16px]">{e.title}</span>
                <span className="t-caption block truncate text-ink-2">
                  {e.payers.length ? `Paid by ${e.payers.map((p) => m.first(p.memberId)).join(" & ")}` : "Who paid?"} · {sourceLabel(e.source)}
                </span>
              </span>
              <span className="t-amount-m shrink-0 text-[17px]">{formatPKR(expenseTotal(e))}</span>
            </button>
          </motion.li>
        ))}
      </ul>

      {data.transfers.filter((t) => !t.settlement).length > 0 && (
        <div className="rounded-[16px] bg-paper-warm p-4">
          <p className="t-overline text-ink-2">Cash handoffs & change</p>
          {data.transfers
            .filter((t) => !t.settlement)
            .map((t) => (
              <p key={t.id} className="t-ui mt-1.5 text-[14px]">
                {m.first(t.from)} → {m.first(t.to)} {formatPKR(t.amount)} {t.onBehalfOf ? `for ${m.first(t.onBehalfOf)}` : t.kind === "change" ? "(change returned)" : "cash"}
              </p>
            ))}
        </div>
      )}

      <Button full icon={<ArrowRight size={20} />} onClick={() => nav.push(data.narrative || data.expenses.length ? `/o/${id}/review` : `/o/${id}/narrate`)}>
        {data.plan && !changedSincePublish ? "See the split" : "Review & split"}
      </Button>
    </div>
  );
}
