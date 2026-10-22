"use client";
import { use, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { Camera, CheckCheck, ChevronDown, CircleAlert, Image as ImageIcon, Lock, Pencil, Smartphone, User, X } from "lucide-react";
import clsx from "clsx";
import { Fab, Screen, TopBar, useMe } from "@/components/shell";
import { Avatar, Button, Chip, Sheet } from "@/components/ui";
import { api, ApiError, upload } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { formatPKR } from "@/lib/money";
import type { EvidenceData, OutingData } from "@/lib/client/types";
import { expenseTotal, memberLookup } from "../tabs/util";

type Kind = "receipt" | "ride" | "other";
const KIND_LABEL: Record<string, string> = { receipt: "Restaurant receipt", ride: "Ride screenshot", other: "Other" };

/** 07 · Add evidence (E1): many sources, clearly attributed; manual entry is the fallback. */
export default function Evidence({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const { data, mutate } = useSWR<OutingData>(me ? `/api/outings/${id}` : null);
  const nav = useNav();
  const toast = useToast();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const shots = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ name: string; state: "up" | "ok" | "err"; msg?: string }[]>([]);
  const [payerFor, setPayerFor] = useState<EvidenceData | null>(null);
  const [privacy, setPrivacy] = useState<null | (() => void)>(null);
  const [dups, setDups] = useState<string[]>([]);

  const ensurePrivacy = (go: () => void) => {
    let agreed = false;
    try {
      agreed = localStorage.getItem("wusool.receiptNote") === "1";
    } catch {
      /* storage blocked: ask each time */
    }
    if (agreed) go();
    else setPrivacy(() => go);
  };

  const send = async (files: File[], kind: Kind) => {
    if (!files.length) return;
    setUploading(files.map((f) => ({ name: f.name, state: "up" })));
    const form = new FormData();
    for (const f of files) form.append("file", f);
    form.append("kind", kind);
    try {
      const r = await upload<{ results: { name: string; ok: boolean; id?: string; duplicateOf?: string | null; error?: string }[] }>(`/api/outings/${id}/evidence`, form);
      setUploading(r.results.map((x) => ({ name: x.name, state: x.ok ? "ok" : "err", msg: x.error })));
      const d = r.results.filter((x) => x.duplicateOf).map((x) => x.id!);
      if (d.length) setDups(d);
      const ok = r.results.filter((x) => x.ok).length;
      if (ok) toast(`${ok} source${ok > 1 ? "s" : ""} added`);
      await mutate();
      setTimeout(() => setUploading((u) => u.filter((x) => x.state === "err")), 1600);
    } catch (e) {
      setUploading((u) => u.map((x) => ({ ...x, state: "err", msg: e instanceof ApiError ? e.message : "Upload failed" })));
    }
  };

  const setPayer = async (ev: EvidenceData, memberId: string) => {
    try {
      await api(`/api/evidence/${ev.id}`, "PATCH", { payerMemberId: memberId });
      setPayerFor(null);
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
    }
  };
  const setKind = async (ev: EvidenceData) => {
    const next: Kind = ev.kind === "receipt" ? "ride" : ev.kind === "ride" ? "other" : "receipt";
    await api(`/api/evidence/${ev.id}`, "PATCH", { kind: next });
    mutate();
  };
  const remove = async (evId: string) => {
    try {
      await api(`/api/evidence/${evId}`, "DELETE");
      setDups((d) => d.filter((x) => x !== evId));
      toast("Removed");
      mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t remove", "error");
    }
  };

  const m = data ? memberLookup(data) : null;
  const manual = data?.expenses.filter((e) => e.source === "manual" && !e.evidenceId) ?? [];
  const sources = (data?.evidence.length ?? 0) + manual.length;
  const picker = (ref: React.RefObject<HTMLInputElement | null>) => () => ensurePrivacy(() => ref.current?.click());

  return (
    <Screen>
      <TopBar back={`/o/${id}`} title="Add evidence" collapse />
      <div className="px-5">
        <h1 className="t-title">What do you have?</h1>
        <p className="t-body-s mt-2 text-ink-2">Add every receipt and ride screenshot from the outing. You’ll tell the rest of the story next.</p>

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {[
            { icon: Camera, t: "Camera", s: "Snap a receipt", on: picker(camera) },
            { icon: ImageIcon, t: "Gallery", s: "Pick several", on: picker(gallery) },
            { icon: Smartphone, t: "Screenshot", s: "Rides, transfers", on: picker(shots) },
          ].map(({ icon: Icon, t, s, on }) => (
            <motion.button key={t} whileTap={{ scale: 0.95 }} onClick={on} className="flex flex-col items-start rounded-[18px] border border-line bg-paper-warm p-3.5 text-left">
              <Icon size={22} />
              <span className="t-label mt-5 text-[16px]">{t}</span>
              <span className="t-caption text-ink-2">{s}</span>
            </motion.button>
          ))}
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (send([...(e.target.files ?? [])], "receipt"), (e.target.value = ""))} />
        <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => (send([...(e.target.files ?? [])], "receipt"), (e.target.value = ""))} />
        <input ref={shots} type="file" accept="image/*" multiple hidden onChange={(e) => (send([...(e.target.files ?? [])], "ride"), (e.target.value = ""))} />

        <div className="mt-3 flex items-center gap-3">
          <Button variant="outline" size="M" icon={<Pencil size={17} />} onClick={() => nav.push(`/o/${id}/expense/new`)}>
            Manual expense
          </Button>
          <span className="t-caption text-ink-2">No receipt? Add it by hand.</span>
        </div>

        <AnimatePresence>
          {uploading.map((u, i) => (
            <motion.div key={u.name + i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className={clsx("mt-3 flex items-center gap-3 rounded-[14px] px-3 py-2.5", u.state === "err" ? "bg-pink-tint" : "bg-blue-tint")}>
              <span className="t-caption min-w-0 flex-1 truncate">{u.name}</span>
              <span className="t-chip">{u.state === "up" ? "Uploading…" : u.state === "ok" ? "Added ✓" : u.msg ?? "Failed"}</span>
              {u.state === "err" && (
                <button aria-label="Dismiss" onClick={() => setUploading((x) => x.filter((_, j) => j !== i))}>
                  <X size={16} />
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="t-label text-[17px]">Added · {sources} source{sources === 1 ? "" : "s"}</h2>
          <span className="t-caption flex items-center gap-1 text-ink-2">
            <Lock size={13} /> Members only · never in Memories
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {data?.evidence.map((ev) => {
              const needsPayer = !ev.payerMemberId && !(ev.expenseId && data.expenses.find((x) => x.id === ev.expenseId)?.payers.length);
              const exp = data.expenses.find((x) => x.id === ev.expenseId);
              const payerId = ev.payerMemberId ?? exp?.payers[0]?.memberId ?? null;
              const isDup = dups.includes(ev.id);
              return (
                <motion.div key={ev.id} layout initial={{ opacity: 0, y: 20, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, x: -60 }} className={clsx("flex gap-3 rounded-[20px] border p-3", needsPayer ? "border-[1.5px] border-ink bg-lime-tint" : "border-line bg-paper")}>
                  <a href={`/api/evidence/${ev.id}/file`} target="_blank" rel="noreferrer" className="block h-[84px] w-[64px] shrink-0 overflow-hidden rounded-[10px] border border-line bg-paper-warm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/evidence/${ev.id}/file`} alt={`${KIND_LABEL[ev.kind]} preview`} className="h-full w-full object-cover" />
                  </a>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => setKind(ev)} className="t-overline text-ink-2" title="Tap to change type">
                      {KIND_LABEL[ev.kind]} ⌄
                    </button>
                    <p className="t-label mt-0.5 truncate text-[16px]">{exp?.title ?? ev.vendor ?? ev.name ?? "Untitled"}</p>
                    <button onClick={() => setPayerFor(ev)} className={clsx("t-chip mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-full px-3", needsPayer ? "border-[1.5px] border-ink bg-lime" : "bg-paper-warm")}>
                      {needsPayer ? <CircleAlert size={14} /> : <User size={14} />}
                      {needsPayer ? "Who paid?" : `Paid by ${m!.first(payerId!)}`}
                      <ChevronDown size={14} />
                    </button>
                    {ev.status === "unreadable" || ev.status === "failed" ? <p className="t-caption mt-1 text-pink-text">Couldn’t read it. Retake, crop, or add it by hand.</p> : null}
                    {isDup && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="t-caption text-pink-text">Looks like a duplicate.</span>
                        <button className="t-chip text-blue" onClick={() => remove(ev.id)}>
                          Discard
                        </button>
                        <button className="t-chip text-ink-2" onClick={() => setDups((d) => d.filter((x) => x !== ev.id))}>
                          Keep both
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end justify-between">
                    <button aria-label="Remove source" onClick={() => remove(ev.id)} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2">
                      <X size={16} />
                    </button>
                    {needsPayer ? <span className="t-chip">Needs you</span> : ev.status === "processed" ? <CheckCheck size={20} className="text-blue" aria-label="Read" /> : <span className="t-caption text-ink-2">Ready</span>}
                  </div>
                </motion.div>
              );
            })}
            {manual.map((e) => (
              <motion.button key={e.id} layout onClick={() => nav.push(`/o/${id}/expense/${e.id}`)} className="flex items-center gap-3 rounded-[20px] border border-line p-3 text-left">
                <span className="flex h-[64px] w-[64px] items-center justify-center rounded-[10px] bg-paper-warm">
                  <Pencil size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="t-overline block text-ink-2">Manual</span>
                  <span className="t-label block truncate">
                    {e.title} · {formatPKR(expenseTotal(e))}
                  </span>
                  <span className="t-caption text-ink-2">Paid by {e.payers.map((p) => m!.first(p.memberId)).join(" & ")}</span>
                </span>
                <CheckCheck size={20} className="text-blue" />
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <Fab>
        <Button full onClick={() => nav.push(`/o/${id}/narrate`)} disabled={!sources}>
          Next: tell the story
        </Button>
      </Fab>

      <Sheet open={!!payerFor} onClose={() => setPayerFor(null)} title="Who paid?" subtitle={payerFor ? KIND_LABEL[payerFor.kind] : undefined}>
        <div className="flex flex-wrap gap-2 pb-4">
          {data?.members.map((mm) => (
            <Chip key={mm.id} selected={payerFor?.payerMemberId === mm.id} onClick={() => payerFor && setPayer(payerFor, mm.id)} icon={<Avatar initials={mm.initials} color={mm.color} size={24} ring={false} />}>
              {mm.name.split(" ")[0]}
            </Chip>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={!!privacy}
        onClose={() => setPrivacy(null)}
        title="Before you upload receipts"
        footer={
          <Button
            full
            onClick={() => {
              try {
                localStorage.setItem("wusool.receiptNote", "1");
              } catch {
                /* ignore */
              }
              const go = privacy;
              setPrivacy(null);
              go?.();
            }}
          >
            I agree
          </Button>
        }
      >
        <ul className="t-body-s flex flex-col gap-2 pb-3 text-ink-2">
          <li>• Receipts are visible to members of this outing only, never in Memories or outside the group.</li>
          <li>• You can limit your uploads to the payer and organizer in Profile → Privacy.</li>
          <li>• We read amounts and items from the image to build the split. You check everything before anyone is notified.</li>
        </ul>
      </Sheet>
    </Screen>
  );
}
