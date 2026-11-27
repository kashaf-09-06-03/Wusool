"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { ChevronLeft, ChevronRight, Download, ImagePlus, Trash, X } from "lucide-react";
import { Avatar, Button, ConfirmSheet, IconButton, Notice, Sheet, TextField, initialsOf } from "@/components/ui";
import { api, ApiError, upload } from "@/lib/client/api";
import { useToast } from "@/lib/client/toast";
import type { OutingData, PhotoData } from "@/lib/client/types";

const REACTIONS = ["♥", "😂", "🔥", "😮"];

/** I1–I4 · Memories: members-only photos, kept completely separate from receipt evidence. */
export function MemoriesTab({ data, onChanged }: { data: OutingData; onChanged: () => void }) {
  const id = data.outing.id;
  const { data: res, mutate } = useSWR<{ photos: PhotoData[] }>(`/api/outings/${id}/photos`);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: File[] } | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const focus = useSearchParams().get("photo");
  const photos = res?.photos ?? [];

  useEffect(() => {
    if (focus && photos.length) {
      const i = photos.findIndex((p) => p.id === focus);
      if (i >= 0) setViewer(i);
    }
  }, [focus, photos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (files: File[]) => {
    const failed: File[] = [];
    setProgress({ done: 0, total: files.length, failed: [] });
    for (let i = 0; i < files.length; i++) {
      const form = new FormData();
      form.append("file", files[i]);
      try {
        const r = await upload<{ results: { ok: boolean; error?: string }[] }>(`/api/outings/${id}/photos`, form);
        if (!r.results[0]?.ok) failed.push(files[i]);
      } catch {
        failed.push(files[i]);
      }
      setProgress({ done: i + 1, total: files.length, failed });
      mutate();
    }
    if (failed.length) toast(`${failed.length} didn’t upload. Retry just those.`, "error");
    else {
      toast(`${files.length} photo${files.length > 1 ? "s" : ""} added`);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Button variant="glass" full icon={<ImagePlus size={20} />} onClick={() => input.current?.click()} disabled={data.outing.status === "archived"}>
        Add photos
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) send(files);
        }}
      />
      {progress && (
        <div className="rounded-[16px] bg-paper-warm p-3">
          <p className="t-label text-[14px]">
            Uploading {progress.done} of {progress.total}
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper">
            <motion.div className="h-full bg-blue" animate={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          {progress.failed.length > 0 && progress.done === progress.total && (
            <Button size="S" className="mt-2" onClick={() => send(progress.failed)}>
              Retry {progress.failed.length} failed
            </Button>
          )}
        </div>
      )}

      {res && photos.length === 0 && (
        <div className="flex flex-col items-center rounded-[24px] bg-paper-warm py-10 text-center">
          <motion.img src="/assets/heart3d-cut.png" alt="" className="w-24" animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.8 }} />
          <h3 className="t-card mt-3">Drop the first memory</h3>
          <p className="t-body-s mt-1 text-ink-2">Photos from the outing, just for the group.</p>
        </div>
      )}

      {/* Masonry grid */}
      <div className="columns-2 gap-2.5">
        {photos.map((p, i) => (
          <motion.button key={p.id} layoutId={`photo-${p.id}`} onClick={() => setViewer(i)} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }} className="relative mb-2.5 block w-full overflow-hidden rounded-[16px] bg-paper-warm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photos/${p.id}`} alt={`Photo by ${p.uploader.name}`} className="block w-full" loading="lazy" />
            <span className="absolute bottom-2 left-2">
              <Avatar initials={initialsOf(p.uploader.name)} color={p.uploader.color} size={26} />
            </span>
            {Object.keys(p.reactions).length > 0 && (
              <span className="glass-solid absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[12px]">
                {Object.entries(p.reactions)
                  .map(([e, n]) => `${e}${n}`)
                  .join(" ")}
              </span>
            )}
          </motion.button>
        ))}
      </div>

      <AnimatePresence>{viewer !== null && photos[viewer] && <Viewer photos={photos} index={viewer} setIndex={setViewer} data={data} onChanged={() => (mutate(), onChanged())} />}</AnimatePresence>
    </div>
  );
}

function Viewer({ photos, index, setIndex, data, onChanged }: { photos: PhotoData[]; index: number; setIndex: (i: number | null) => void; data: OutingData; onChanged: () => void }) {
  const p = photos[index];
  const toast = useToast();
  const [confirmDel, setConfirmDel] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [reason, setReason] = useState("");
  const isOrg = data.me.role === "organizer";
  const call = async (body: object, ok: string) => {
    try {
      await api(`/api/photos/${p.id}`, "POST", body);
      toast(ok);
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
    }
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -80 && index < photos.length - 1) setIndex(index + 1);
    else if (info.offset.x > 80 && index > 0) setIndex(index - 1);
    else if (Math.abs(info.offset.y) > 140) setIndex(null);
  };
  return (
    <motion.div className="fixed inset-0 z-[70] flex flex-col bg-ink" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-label="Photo viewer">
      <div className="flex items-center gap-3 p-4 text-white">
        <IconButton label="Close" surface="glass" onClick={() => setIndex(null)}>
          <X size={20} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <p className="t-label truncate">{p.uploader.name}</p>
          <p className="t-caption text-white/70">{new Date(p.createdAt).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
        <a href={`/api/photos/${p.id}`} download className="glass flex h-11 w-11 items-center justify-center rounded-full text-ink" aria-label="Save to phone">
          <Download size={19} />
        </a>
      </div>
      <motion.div key={p.id} layoutId={`photo-${p.id}`} drag dragSnapToOrigin onDragEnd={onDragEnd} className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/photos/${p.id}`} alt="" className="max-h-full max-w-full rounded-[12px] object-contain" draggable={false} />
        {index > 0 && (
          <button aria-label="Previous" onClick={() => setIndex(index - 1)} className="absolute left-2 hidden h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white sm:flex">
            <ChevronLeft />
          </button>
        )}
        {index < photos.length - 1 && (
          <button aria-label="Next" onClick={() => setIndex(index + 1)} className="absolute right-2 hidden h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white sm:flex">
            <ChevronRight />
          </button>
        )}
      </motion.div>
      <div className="flex flex-col gap-3 p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="flex justify-center gap-2">
          {REACTIONS.map((e) => (
            <motion.button key={e} whileTap={{ scale: 1.4 }} onClick={() => call({ react: e }, "Reacted")} aria-pressed={p.mine.includes(e)} className={`flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 text-[18px] ${p.mine.includes(e) ? "bg-white text-ink" : "bg-white/15 text-white"}`}>
              {e}
              {p.reactions[e] ? <span className="text-[13px]">{p.reactions[e]}</span> : null}
            </motion.button>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {isOrg ? (
            <Button size="S" variant="glass" onClick={async () => { try { await api(`/api/outings/${data.outing.id}`, "PATCH", { banner: `photo:${p.id}` }); toast("Banner updated. The Home card updates too."); onChanged(); } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn’t set banner", "error"); } }}>
              Set as outing banner
            </Button>
          ) : (
            <Button size="S" variant="glass" onClick={() => call({ suggestBanner: true }, "Suggested to the organizer")}>
              Suggest as banner
            </Button>
          )}
          {p.canDelete ? (
            <Button size="S" variant="glass" icon={<Trash size={15} />} onClick={() => setConfirmDel(true)}>
              {p.isUploader ? "Delete" : "Remove"}
            </Button>
          ) : p.removalRequested ? (
            <span className="t-caption self-center text-white/70">Removal requested</span>
          ) : (
            <Button size="S" variant="glass" onClick={() => setAskRemove(true)}>
              I’m in it: request removal
            </Button>
          )}
          {p.removalRequested && (p.isUploader || isOrg) && !p.removalRequested.byMe && (
            <>
              <Button size="S" variant="glass" onClick={() => call({ decide: "approve" }, "Removed")}>
                Approve removal
              </Button>
              <Button size="S" variant="glass" onClick={() => call({ decide: "decline" }, "Kept")}>
                Keep
              </Button>
            </>
          )}
        </div>
      </div>
      <ConfirmSheet
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title={p.isUploader ? "Delete this photo?" : "Remove this photo?"}
        body={p.isUploader ? "It’s deleted for everyone." : "The uploader will be notified."}
        confirmLabel={p.isUploader ? "Delete" : "Remove"}
        tone="danger"
        onConfirm={async () => {
          try {
            await api(`/api/photos/${p.id}`, "DELETE");
            toast("Photo removed");
            setConfirmDel(false);
            setIndex(null);
            onChanged();
          } catch (e) {
            toast(e instanceof ApiError ? e.message : "Couldn’t remove", "error");
          }
        }}
      />
      <Sheet open={askRemove} onClose={() => setAskRemove(false)} title="Request removal" footer={<Button full onClick={() => (call({ requestRemoval: reason }, "Request sent to the uploader and organizer"), setAskRemove(false))}>Send request</Button>}>
        <Notice tone="warm">Goes to the uploader (and the organizer). Reason is optional.</Notice>
        <div className="mt-3">
          <TextField label="Reason (optional)" value={reason} onChange={setReason} maxLength={200} />
        </div>
      </Sheet>
    </motion.div>
  );
}
