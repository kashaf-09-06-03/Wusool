"use client";
import { Mic, Pencil, Receipt, Smartphone } from "lucide-react";
import type { ExpenseData, OutingData } from "@/lib/client/types";

export const expenseTotal = (e: ExpenseData) => e.items.reduce((a, i) => a + i.lineTotal, 0) + e.charges.reduce((a, c) => a + c.amount, 0);

export function memberLookup(data: OutingData) {
  const all = [...data.members, ...data.pending];
  const byId = (id: string) => all.find((m) => m.id === id);
  return {
    byId,
    name: (id: string) => byId(id)?.name ?? "Former member",
    first: (id: string) => (byId(id)?.name ?? "Former member").split(" ")[0],
  };
}

export function SourceIcon({ source, size = 20 }: { source: string; size?: number }) {
  const Icon = source === "ride" ? Smartphone : source === "manual" ? Pencil : source === "story" ? Mic : Receipt;
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-paper-warm" aria-hidden>
      <Icon size={size} />
    </span>
  );
}

export const sourceLabel = (s: string) => ({ receipt: "Receipt", ride: "Ride screenshot", manual: "Manual", story: "From your story", sample: "Sample" })[s] ?? s;

export function participantsOf(e: ExpenseData): string[] {
  const ids: string[] = [];
  for (const it of e.items) for (const s of it.shares) if (!ids.includes(s.memberId)) ids.push(s.memberId);
  return ids;
}

/** True when every item is shared by the same people with equal weights. */
export function isUniformEqual(e: ExpenseData) {
  if (!e.items.length) return true;
  const key = (it: ExpenseData["items"][number]) => it.shares.map((s) => `${s.memberId}:${s.weight}`).sort().join(",");
  const k0 = key(e.items[0]);
  return e.items.every((it) => key(it) === k0) && e.items[0].shares.every((s) => s.weight === e.items[0].shares[0]?.weight);
}
