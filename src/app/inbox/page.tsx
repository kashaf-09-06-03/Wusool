"use client";
import useSWR from "swr";
import { motion } from "motion/react";
import { Bell, Heart, Image as ImageIcon, Receipt, UserPlus, Wallet } from "lucide-react";
import clsx from "clsx";
import { Screen, useMe } from "@/components/shell";
import { Button, Skeleton } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import type { InboxItem } from "@/lib/client/types";

const ICON: Record<string, typeof Bell> = { breakdown: Receipt, request: Wallet, reminder: Bell, wusool_maaf: Heart, status: Wallet, member: UserPlus, photo: ImageIcon };

/** H5 · In-app inbox: the durable source of truth for every change, deep-linking to the item. */
export default function Inbox() {
  const { me } = useMe();
  const { data, mutate } = useSWR<{ items: InboxItem[] }>(me ? "/api/inbox" : null, { refreshInterval: 10000 });
  const nav = useNav();
  const items = data?.items ?? [];
  const groups = items.reduce<Record<string, InboxItem[]>>((acc, i) => {
    const k = i.outingName || "Wusool";
    (acc[k] ??= []).push(i);
    return acc;
  }, {});
  const unread = items.filter((i) => !i.read).length;

  const open = async (i: InboxItem) => {
    if (!i.read) api("/api/inbox", "POST", { ids: [i.id] }).then(() => mutate());
    if (i.link) nav.push(i.link);
  };

  return (
    <Screen tabBar>
      <div className="flex items-end justify-between px-5 pt-8">
        <h1 className="t-title">Inbox</h1>
        {unread > 0 && (
          <Button size="S" variant="text" onClick={async () => (await api("/api/inbox", "POST", {}), mutate())}>
            Mark all read
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-6 px-5 pt-4">
        {!data && <Skeleton className="h-48" />}
        {data && items.length === 0 && (
          <div className="rounded-[24px] bg-paper-warm py-12 text-center">
            <Bell size={28} className="mx-auto text-ink-2" />
            <p className="t-card mt-3">All quiet</p>
            <p className="t-body-s mt-1 text-ink-2">Breakdowns, requests and Wusool/Maaf updates show up here.</p>
          </div>
        )}
        {Object.entries(groups).map(([outing, rows]) => (
          <section key={outing}>
            <h2 className="t-overline mb-2 text-ink-2">{outing}</h2>
            <ul className="flex flex-col gap-2">
              {rows.map((i, idx) => {
                const Icon = ICON[i.type] ?? Bell;
                return (
                  <motion.li key={i.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.02 }}>
                    <button onClick={() => open(i)} className={clsx("flex w-full gap-3 rounded-[18px] p-3.5 text-left", i.read ? "bg-paper" : "bg-blue-tint")}>
                      <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", i.type === "wusool_maaf" ? "bg-pink text-white" : "bg-paper-warm")}>
                        <Icon size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="t-label truncate text-[15px]">{i.title}</span>
                          {!i.read && <span className="t-overline shrink-0 rounded-full bg-pink px-1.5 py-0.5 text-[9px] text-white">New</span>}
                        </span>
                        <span className="t-caption block text-ink-2">{i.body}</span>
                        <span className="t-caption mt-0.5 block text-ink-2/70">{new Date(i.created_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</span>
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Screen>
  );
}
