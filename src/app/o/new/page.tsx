"use client";
import { useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { Calendar, Check, ChevronDown, Pencil, Upload } from "lucide-react";
import clsx from "clsx";
import { Screen, TopBar, useMe } from "@/components/shell";
import { Button, press, TextField } from "@/components/ui";
import { BANNER_PRESETS, Banner, Logo } from "@/components/collage";
import { api, ApiError, upload } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import type { HomeData } from "@/lib/client/types";

const LOGOS = ["cup3d", "star3d", "initial", "sticker", "upload"] as const;

/** 03 · Create outing (B1): zero typing to proceed — auto-name, preselected look, everything optional. */
export default function CreateOuting() {
  const { me } = useMe();
  const { data } = useSWR<HomeData>(me ? "/api/home" : null);
  const nav = useNav();
  const toast = useToast();
  const seq = data?.nextSeq ?? 1;
  const autoName = `Outing ${String(seq).padStart(3, "0")}`;
  const [name, setName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [banner, setBanner] = useState<string>("sea");
  const [logo, setLogo] = useState<string>("cup3d");
  const [bannerFile, setBannerFile] = useState<{ file: File; url: string } | null>(null);
  const [logoFile, setLogoFile] = useState<{ file: File; url: string } | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [date, setDate] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState<"go" | "skip" | null>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const shown = (name ?? "").trim() || autoName;

  const create = async (skip: boolean) => {
    setBusy(skip ? "skip" : "go");
    try {
      const o = await api<{ id: string }>("/api/outings", "POST", {
        name: skip ? undefined : name?.trim() || undefined,
        banner: skip ? "pink" : banner === "upload" ? "sea" : banner,
        logoType: skip ? "initial" : logo === "upload" ? "initial" : logo,
        date: !skip && date.trim() ? date.trim() : null,
        place: !skip && place.trim() ? place.trim() : null,
      });
      // Uploaded banner/logo go to Memories, then become the header (I4).
      if (!skip && (bannerFile || logoFile)) {
        const patch: Record<string, string> = {};
        for (const [kind, f] of [["banner", bannerFile], ["logo", logoFile]] as const) {
          if (!f || (kind === "banner" && banner !== "upload") || (kind === "logo" && logo !== "upload")) continue;
          const form = new FormData();
          form.append("file", f.file);
          const r = await upload<{ results: { ok: boolean; id?: string }[] }>(`/api/outings/${o.id}/photos`, form);
          const id = r.results[0]?.id;
          if (id && kind === "banner") patch.banner = `photo:${id}`;
          if (id && kind === "logo") (patch.logoType = "upload"), (patch.logoValue = id);
        }
        if (Object.keys(patch).length) await api(`/api/outings/${o.id}`, "PATCH", patch);
      }
      nav.push(`/o/${o.id}/invite?new=1`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t create the outing", "error");
      setBusy(null);
    }
  };

  const pick = (kind: "banner" | "logo") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const v = { file: f, url: URL.createObjectURL(f) };
    if (kind === "banner") (setBannerFile(v), setBanner("upload"));
    else (setLogoFile(v), setLogo("upload"));
  };

  return (
    <Screen>
      <TopBar close="/" title="New outing" />
      <div className="px-4 pb-6">
        {/* Live header preview */}
        <motion.div layout className="overflow-hidden surface ">
          <div className="relative p-2">
            <AnimatePresence mode="popLayout">
              <motion.div key={banner + (bannerFile?.url ?? "")} initial={{ clipPath: "inset(0 100% 0 0 round 18px)" }} animate={{ clipPath: "inset(0 0% 0 0 round 18px)" }} transition={{ duration: 0.55, ease: [0.65, 0, 0.35, 1] }}>
                {banner === "upload" && bannerFile ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bannerFile.url} alt="" className="h-[150px] w-full rounded-[18px] object-cover" />
                ) : (
                  <Banner banner={banner} className="h-[150px] rounded-[18px]" interactive />
                )}
              </motion.div>
            </AnimatePresence>
            <motion.div key={logo} initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 400, damping: 15 }} className="absolute -bottom-9 left-5">
              {logo === "upload" && logoFile ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoFile.url} alt="" className="h-[84px] w-[84px] rounded-full border-[3px] border-white object-cover shadow-[0_6px_18px_rgba(17,17,20,0.18)]" />
              ) : (
                <Logo type={logo} name={shown} size={84} />
              )}
            </motion.div>
          </div>
          <div className="px-5 pb-5 pt-11">
            <div className="relative flex items-center gap-2">
              {editing ? (
                <input
                  autoFocus
                  aria-label="Outing name"
                  value={name ?? autoName}
                  maxLength={40}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setEditing(false)}
                  onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
                  className="t-title w-full border-b-2 border-blue bg-transparent outline-none"
                />
              ) : (
                <>
                  <h1 className="t-title whitespace-nowrap">{shown}</h1>
                  <motion.button {...press(0.88, 0.9)} aria-label="Rename" onClick={() => setEditing(true)} className="press-own flex h-11 w-11 items-center justify-center rounded-full bg-paper-warm">
                    <Pencil size={17} />
                  </motion.button>
                </>
              )}
            </div>
            <button onClick={() => setShowMeta((s) => !s)} className="t-ui mt-3 flex items-center gap-2 text-[14px] text-ink-2">
              <Calendar size={15} /> {date || place ? [date, place].filter(Boolean).join(" · ") : "Add date & place (optional)"}
              <ChevronDown size={15} className={clsx("transition-transform", showMeta && "rotate-180")} />
            </button>
            <AnimatePresence>
              {showMeta && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-3 pt-3">
                    <TextField label="Date" value={date} onChange={setDate} placeholder="Sat 18 Oct" maxLength={40} />
                    <TextField label="Place" value={place} onChange={setPlace} placeholder="Sea View" maxLength={60} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Banner presets (5 options, no nested menus — Hick) */}
        <h2 className="t-h3 mt-6">Banner</h2>
        <div className="mt-3 grid grid-cols-5 gap-2.5" role="radiogroup" aria-label="Banner">
          {BANNER_PRESETS.map((b) => (
            <Thumb key={b.id} selected={banner === b.id} onClick={() => setBanner(b.id)} label={b.label}>
              <Banner banner={b.id} className="h-full w-full" compact />
            </Thumb>
          ))}
          <Thumb selected={banner === "upload"} onClick={() => bannerInput.current?.click()} label="Upload banner" dashed>
            {bannerFile ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bannerFile.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Upload size={22} />
            )}
          </Thumb>
          <input ref={bannerInput} type="file" accept="image/*" hidden onChange={pick("banner")} />
        </div>

        <h2 className="t-h3 mt-6">Logo</h2>
        <div className="mt-3 flex justify-between" role="radiogroup" aria-label="Logo">
          {LOGOS.map((l) => (
            <motion.button
              key={l}
              {...press(0.9, 0.95)}
              role="radio"
              aria-checked={logo === l}
              aria-label={{ cup3d: "Chai 3D", star3d: "Star 3D", initial: "Initial", sticker: "Sticker", upload: "Upload logo" }[l]}
              onClick={() => (l === "upload" ? logoInput.current?.click() : setLogo(l))}
              className={clsx("press-own relative rounded-full p-[3px] transition-shadow duration-300", logo === l ? "ring-[3px] ring-ink" : "ring-0")}
            >
              {l === "upload" && logoFile ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoFile.url} alt="" className="h-[58px] w-[58px] rounded-full object-cover" />
              ) : l === "upload" ? (
                <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full border-2 border-dashed border-line-strong bg-paper-warm">
                  <Upload size={18} />
                </span>
              ) : (
                <Logo type={l} name={shown} size={58} ring={false} className="border border-line" />
              )}
            </motion.button>
          ))}
          <input ref={logoInput} type="file" accept="image/*" hidden onChange={pick("logo")} />
        </div>

        <div className="mt-8 flex flex-col gap-2">
          <Button full onClick={() => create(false)} loading={busy === "go"} disabled={!!busy}>
            Continue to invite
          </Button>
          <Button variant="text" size="M" full onClick={() => create(true)} loading={busy === "skip"} disabled={!!busy}>
            Skip, use the auto look
          </Button>
        </div>
      </div>
    </Screen>
  );
}

function Thumb({ selected, onClick, children, label, dashed }: { selected: boolean; onClick: () => void; children: React.ReactNode; label: string; dashed?: boolean }) {
  return (
    <motion.button
      {...press(0.92, 0.95)}
      onClick={onClick}
      role="radio"
      aria-checked={selected}
      aria-label={label}
      className={clsx("press-own relative flex aspect-square items-center justify-center overflow-hidden rounded-[14px] bg-paper-warm", selected ? "ring-[3px] ring-ink" : dashed ? "border-2 border-dashed border-line-strong" : "border border-line")}
    >
      {children}
      <AnimatePresence>
        {selected && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink bg-lime">
            <Check size={11} strokeWidth={3.5} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
