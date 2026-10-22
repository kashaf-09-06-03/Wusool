"use client";
import { useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { CheckCheck, ChevronLeft, Share } from "lucide-react";
import { Screen, useMe } from "@/components/shell";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import type { WaMessage } from "@/lib/client/types";

/**
 * WhatsApp simulator (H2/H4). Shows exactly what an opted-in user would receive.
 * Nothing here is sent to WhatsApp: no Business Platform credentials are configured.
 * Interactive Wusool/Maaf buttons call the same validated, idempotent server actions.
 */
export default function WhatsAppSim() {
  const { me } = useMe();
  const { data, mutate } = useSWR<{ configured: boolean; messages: WaMessage[] }>(me ? "/api/wa" : null, { refreshInterval: 8000 });
  const nav = useNav();
  const toast = useToast();
  const [replies, setReplies] = useState<Record<string, { text: string; link?: string }>>({});

  const press = async (m: WaMessage, button: "Wusool" | "Maaf") => {
    try {
      const r = await api<{ reply: string; confirmLink?: string }>(`/api/wa/${m.id}`, "POST", { button });
      setReplies((x) => ({ ...x, [m.id]: { text: r.reply, link: r.confirmLink } }));
      mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t process", "error");
    }
  };

  return (
    <Screen bg="warm">
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-[#075E54] px-3 py-3 text-white">
        <button aria-label="Back" onClick={() => nav.back()} className="flex h-10 w-10 items-center justify-center">
          <ChevronLeft size={24} />
        </button>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/star3d-cut.png" alt="" className="h-7" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="t-label truncate">Wusool</p>
          <p className="t-caption text-white/80">Simulated business account</p>
        </div>
      </div>
      <div className="min-h-[calc(100dvh-64px)] bg-[#ECE5DD] px-3 py-4">
        <div className="mx-auto mb-4 max-w-[340px] rounded-[10px] bg-[#FFF3C4] px-3 py-2 text-center t-caption text-ink">
          PROTOTYPE SIMULATION · nothing here was sent to WhatsApp. These are the messages you’d get because you opted in. Buttons run the real, validated actions.
        </div>
        {data && data.messages.length === 0 && (
          <Notice tone="warm">
            No simulated messages yet. Turn on WhatsApp notifications in Profile; messages are only created for people who opted in.
          </Notice>
        )}
        <div className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {data?.messages.map((m) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex flex-col items-start gap-1">
                <div className="max-w-[85%] rounded-[10px] rounded-tl-none bg-white px-3 py-2 shadow-sm">
                  <p className="whitespace-pre-wrap t-ui text-[15px]">{m.text}</p>
                  <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-ink-2">
                    {new Date(m.created_at).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" })}
                    <span className="rounded bg-[#FFF3C4] px-1 text-[9px] font-bold text-ink">SIMULATED</span>
                  </p>
                </div>
                {m.buttons.length > 0 && (
                  <div className="flex w-[85%] gap-1.5">
                    {m.buttons.map((b) => (
                      <motion.button key={b} whileTap={{ scale: 0.95 }} disabled={Boolean(m.response)} onClick={() => press(m, b as "Wusool" | "Maaf")} className="flex-1 rounded-[10px] bg-white py-2.5 t-label text-[15px] text-[#00A884] shadow-sm disabled:opacity-50">
                        {b}
                      </motion.button>
                    ))}
                  </div>
                )}
                {(replies[m.id] || m.response) && (
                  <div className="ml-auto max-w-[85%] self-end rounded-[10px] rounded-tr-none bg-[#D9FDD3] px-3 py-2 shadow-sm">
                    <p className="t-ui text-[14px]">{replies[m.id]?.text ?? `You tapped: ${m.response}`}</p>
                    {replies[m.id]?.link && (
                      <button onClick={() => nav.push(replies[m.id]!.link!)} className="t-label mt-1 text-[14px] text-[#00A884] underline">
                        Open Wusool to confirm Maaf
                      </button>
                    )}
                    <CheckCheck size={14} className="ml-auto text-[#53BDEB]" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <p className="t-caption mt-6 flex items-center justify-center gap-1.5 text-ink-2">
          <Share size={13} /> Manual sharing (invite links, previews) opens your real WhatsApp with prefilled text.
        </p>
      </div>
    </Screen>
  );
}
