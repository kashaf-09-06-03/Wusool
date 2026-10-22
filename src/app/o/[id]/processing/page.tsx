"use client";
import { use, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, RotateCcw, ShieldCheck } from "lucide-react";
import { Screen, TopBar, useMe } from "@/components/shell";
import { Button, ProgressStep } from "@/components/ui";
import { Doodle } from "@/components/collage";
import { useNav } from "@/lib/client/nav";
import type { OutingData } from "@/lib/client/types";

type StageId = "upload" | "extract" | "interpret" | "validate";
type Stage = { state: "done" | "active" | "pending" | "attention"; detail: string };
const TITLES: Record<StageId, string> = { upload: "Uploading sources", extract: "Extracting receipts", interpret: "Interpreting your story", validate: "Validating totals" };

/** 09 · Processing (E4): every stage visible, with real progress streamed from the server. */
export default function Processing({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const { data } = useSWR<OutingData>(me ? `/api/outings/${id}` : null);
  const nav = useNav();
  const [stages, setStages] = useState<Record<StageId, Stage>>({
    upload: { state: "active", detail: "Checking your sources…" },
    extract: { state: "pending", detail: "Items, quantities, tax, fees, discounts, totals" },
    interpret: { state: "pending", detail: "Payers, sharers, rides, handoffs" },
    validate: { state: "pending", detail: "Items must match receipt totals; balances must sum to zero" },
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [run, setRun] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!me) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setFailed(null);
    (async () => {
      try {
        const res = await fetch(`/api/outings/${id}/process`, { method: "POST", signal: ctl.signal });
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Couldn’t start processing.");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            if (ev.type === "stage") {
              setStages((s) => ({ ...s, [ev.stage]: { state: ev.state, detail: ev.detail } }));
              if (ev.notice) setNotice(ev.notice);
            } else if (ev.type === "done") {
              if (ev.notices?.[0]) setNotice(ev.notices[0]);
              setDone(true);
            } else if (ev.type === "error") setFailed(ev.message);
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed((e as Error).message || "Processing failed. Your uploads are kept.");
      }
    })();
    return () => ctl.abort();
  }, [id, me, run]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => nav.replace(`/o/${id}/review`), notice ? 1600 : 900);
    return () => clearTimeout(t);
  }, [done, nav, id, notice]);

  const caps = data?.capabilities;
  return (
    <Screen>
      <TopBar close={`/o/${id}`} onBack={() => (abort.current?.abort(), nav.push(`/o/${id}`))} title="Working on it" />
      <div className="flex flex-col gap-5 px-5 pb-10">
        <div className="relative flex flex-col items-center pt-2 text-center">
          <div className="relative h-36 w-36">
            <motion.span aria-hidden className="absolute inset-4 rounded-full chrome-anim opacity-50 blur-2xl" animate={{ scale: done ? 1.3 : [1, 1.15, 1] }} transition={{ repeat: done ? 0 : Infinity, duration: 2 }} />
            <motion.img
              src="/assets/star3d-cut.png"
              alt=""
              className="relative h-full w-full object-contain drop-shadow-[0_18px_24px_rgba(31,59,255,0.3)]"
              animate={done ? { rotate: 360, scale: [1, 1.25, 1] } : { rotate: [0, 360] }}
              transition={done ? { duration: 0.9, ease: [0.16, 1, 0.3, 1] } : { repeat: Infinity, duration: 3.2, ease: "linear" }}
            />
          </div>
          <AnimatePresence mode="wait">
            <motion.h1 key={done ? "d" : "w"} initial={{ opacity: 0, y: 10, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -10 }} className="t-title mt-3">
              {done ? "Got it." : "Reading your outing…"}
            </motion.h1>
          </AnimatePresence>
          <p className="t-body-s mt-2 max-w-[300px] text-ink-2">A few seconds. You’ll check everything before anything is shared.</p>
        </div>

        <motion.div layout className="surface px-4 py-1">
          {(Object.keys(TITLES) as StageId[]).map((k, i) => (
            <motion.div key={k} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className={i ? "border-t border-line" : ""}>
              <ProgressStep title={TITLES[k]} detail={stages[k].detail} state={stages[k].state} />
            </motion.div>
          ))}
        </motion.div>

        <AnimatePresence>
          {notice && (
            <motion.div initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex gap-3 rounded-[20px] border-[1.5px] border-ink bg-lime-tint p-4">
              <CircleAlert size={20} className="mt-0.5 shrink-0" />
              <p className="t-ui text-[15px]">{notice} We’ll ask you instead of guessing.</p>
            </motion.div>
          )}
        </AnimatePresence>

        {failed && (
          <div className="rounded-[20px] border-[1.5px] border-pink-text bg-pink-tint p-4">
            <p className="t-label text-pink-text">{failed}</p>
            <p className="t-caption mt-1">Finished files are kept. Nothing was shared.</p>
            <Button size="M" className="mt-3" icon={<RotateCcw size={17} />} onClick={() => setRun((r) => r + 1)}>
              Retry
            </Button>
          </div>
        )}

        <div className="flex gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-blue" />
          <p className="t-body-s">Wusool reads your story, but a separate calculator does the maths: exact to the paisa, every total checked against the receipts.</p>
        </div>
        {caps && (
          <p className="t-caption text-center text-ink-3">
            Receipts read with {caps.ocr === "claude-vision" ? "Claude vision" : caps.ocr === "gemini-vision" ? "Gemini vision" : "Tesseract OCR on this server"} · story read with {caps.interpreter === "claude" ? "Claude" : caps.interpreter === "gemini" ? "Gemini" : "the rule-based interpreter"}
          </p>
        )}
        <Button variant="glass" size="M" className="self-center" onClick={() => (abort.current?.abort(), nav.push(`/o/${id}`))}>
          Cancel
        </Button>
      </div>
    </Screen>
  );
}
