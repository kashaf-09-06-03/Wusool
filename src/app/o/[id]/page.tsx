"use client";
import { use, useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { ChevronLeft, Ellipsis, Mic, Plus, Share, Users } from "lucide-react";
import clsx from "clsx";
import { Screen, useMe } from "@/components/shell";
import { Button, ConfirmSheet, IconButton, Sheet, Skeleton, Sticker, TextField } from "@/components/ui";
import { OutingHeader } from "@/components/OutingHeader";
import { BANNER_PRESETS, Banner, Logo } from "@/components/collage";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import type { OutingData } from "@/lib/client/types";
import { ExpensesTab } from "./tabs/expenses";
import { SettleTab } from "./tabs/settle";
import { MembersTab } from "./tabs/members";
import { MemoriesTab } from "./tabs/memories";

const TABS = ["expenses", "settle", "members", "memories"] as const;
type Tab = (typeof TABS)[number];

/** 06 · Outing page: LinkedIn-style header + consistent tabs (Expenses / Settle / Members / Memories). */
export default function OutingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const { data, mutate, error } = useSWR<OutingData>(me ? `/api/outings/${id}` : null, { refreshInterval: 8000 });
  const search = useSearchParams();
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(search.get("tab") ?? "") ? (search.get("tab") as Tab) : "expenses");
  const nav = useNav();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [look, setLook] = useState(false);
  const [activity, setActivity] = useState(false);
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  if (error) {
    return (
      <Screen>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="t-title">Can’t open this outing</h1>
          <p className="t-body text-ink-2">{error instanceof ApiError ? error.message : "Check your connection."}</p>
          <Button onClick={() => nav.push("/")}>Go home</Button>
        </div>
      </Screen>
    );
  }

  const isOrg = data?.me.role === "organizer";
  const save = async (body: object, ok: string) => {
    setBusy(true);
    try {
      await api(`/api/outings/${id}`, "PATCH", body);
      toast(ok);
      await mutate();
      setRename(null);
      setLook(false);
      setArchive(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen tabBar>
      {!data ? (
        <div>
          <Skeleton className="h-[190px] rounded-none" />
          <div className="flex flex-col gap-3 p-5 pt-14">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-24" />
          </div>
        </div>
      ) : (
        <>
          <OutingHeader
            outing={data.outing}
            members={data.members}
            memberCount={data.members.length}
            onRename={isOrg ? () => setRename(data.outing.name) : undefined}
            sticker={data.outing.isSample ? <Sticker color="lime">sea breeze ✦</Sticker> : undefined}
            topLeft={
              <IconButton label="Back" surface="solid" onClick={() => nav.push("/")}>
                <ChevronLeft size={24} />
              </IconButton>
            }
            topRight={
              <>
                <IconButton label="Share invite" surface="solid" onClick={() => nav.push(`/o/${id}/invite`)}>
                  <Share size={19} />
                </IconButton>
                <IconButton label="More" surface="solid" onClick={() => setMenu(true)}>
                  <Ellipsis size={20} />
                </IconButton>
              </>
            }
          />

          <MiniBar name={data.outing.name} logoType={data.outing.logoType} logoValue={data.outing.logoValue} onBack={() => nav.push("/")} onMore={() => setMenu(true)} />

          {/* Primary actions directly under the header, within thumb reach */}
          <div className="flex items-center gap-2.5 px-4 pt-5">
            <Button size="M" icon={<Plus size={20} />} className="flex-1" onClick={() => nav.push(`/o/${id}/evidence`)} disabled={data.outing.status === "archived"}>
              Add expense
            </Button>
            <Button size="M" variant="glass" icon={<Users size={19} />} onClick={() => nav.push(`/o/${id}/invite`)}>
              Invite
            </Button>
            <IconButton label="Tell the story" onClick={() => nav.push(`/o/${id}/narrate`)} disabled={data.outing.status === "archived"}>
              <Mic size={20} />
            </IconButton>
          </div>

          {/* Outing tabs */}
          <div className="sticky top-[60px] z-20 bg-paper/90 px-4 pt-3 pb-3 backdrop-blur-md">
            <div role="tablist" aria-label="Outing sections" className="glass flex rounded-full p-1">
              {TABS.map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="relative h-11 flex-1 rounded-full">
                  {tab === t && <motion.span layoutId="outing-tab" className="absolute inset-0 rounded-full bg-paper shadow-[0_2px_10px_rgba(17,17,20,0.12)]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                  <span className={clsx("relative t-label text-[14px] capitalize", tab === t ? "text-ink" : "text-ink-2")}>{t}</span>
                  {t === "members" && data.pending.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-pink" />}
                </button>
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.18 }} className="px-4 pb-6">
              {tab === "expenses" && <ExpensesTab data={data} onChanged={() => mutate()} />}
              {tab === "settle" && <SettleTab data={data} onChanged={() => mutate()} />}
              {tab === "members" && <MembersTab data={data} onChanged={() => mutate()} />}
              {tab === "memories" && <MemoriesTab data={data} onChanged={() => mutate()} />}
            </motion.div>
          </AnimatePresence>

          {/* ⋯ menu */}
          <Sheet open={menu} onClose={() => setMenu(false)} title={data.outing.name}>
            <div className="flex flex-col gap-2 pb-3">
              {isOrg && (
                <>
                  <Button variant="outline" full onClick={() => (setMenu(false), setRename(data.outing.name))}>
                    Rename
                  </Button>
                  <Button variant="outline" full onClick={() => (setMenu(false), setLook(true))}>
                    Banner & logo
                  </Button>
                </>
              )}
              <Button variant="outline" full onClick={() => (setMenu(false), setActivity(true))}>
                Activity history
              </Button>
              <Button variant="outline" full onClick={() => (setMenu(false), save({ muted: !data.me.muted }, data.me.muted ? "Unmuted" : "Muted: no unread dots or WhatsApp for this outing"))}>
                {data.me.muted ? "Unmute this outing" : "Mute this outing"}
              </Button>
              {isOrg && (
                <Button variant="outline" full onClick={() => (setMenu(false), setArchive(true))}>
                  {data.outing.status === "archived" ? "Reopen outing" : "Archive outing"}
                </Button>
              )}
            </div>
          </Sheet>

          <Sheet open={rename !== null} onClose={() => setRename(null)} title="Rename outing" footer={<Button full loading={busy} onClick={() => save({ name: rename }, "Renamed. Everyone sees the new name.")}>Save</Button>}>
            {rename !== null && <TextField label="Outing name" value={rename} onChange={setRename} maxLength={40} autoFocus helper={`${rename.length}/40 · empty restores Outing ${String(data.outing.seq).padStart(3, "0")}`} onEnter={() => save({ name: rename }, "Renamed")} />}
          </Sheet>

          <LookSheet open={look} onClose={() => setLook(false)} data={data} busy={busy} onSave={(b) => save(b, "Saved. Everyone sees the new header.")} />

          <Sheet open={activity} onClose={() => setActivity(false)} title="Activity history" subtitle="Every change is kept. Nothing is silently rewritten.">
            <ol className="pb-4">
              {data.activity.map((a, i) => (
                <li key={i} className="flex gap-3 border-b border-line py-3 last:border-0">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue" />
                  <div>
                    <p className="t-ui text-[15px]">{a.text}</p>
                    <p className="t-caption text-ink-2">{new Date(a.created_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Sheet>

          <ConfirmSheet
            open={archive}
            onClose={() => setArchive(false)}
            title={data.outing.status === "archived" ? "Reopen this outing?" : "Archive this outing?"}
            body={data.outing.status === "archived" ? "More expenses can be added again." : data.money.owe || data.money.owed ? "Some balances are still open. They stay collectible: archiving never waives anything." : "It becomes read-only. Memories are kept."}
            confirmLabel={data.outing.status === "archived" ? "Reopen" : "Archive"}
            loading={busy}
            onConfirm={() => save({ archived: data.outing.status !== "archived" }, data.outing.status === "archived" ? "Reopened" : "Archived")}
          />
        </>
      )}
    </Screen>
  );
}

/** B3: banner & logo, with a live preview. Uploaded photos come from Memories (I4). */
function LookSheet({ open, onClose, data, onSave, busy }: { open: boolean; onClose: () => void; data: OutingData; onSave: (b: object) => void; busy: boolean }) {
  const [banner, setBanner] = useState(data.outing.banner);
  const [logo, setLogo] = useState(data.outing.logoType);
  return (
    <Sheet open={open} onClose={onClose} title="Banner & logo" footer={<Button full loading={busy} onClick={() => onSave({ banner, logoType: logo === "upload" ? data.outing.logoType : logo })}>Save</Button>}>
      <div className="relative mb-12">
        <Banner banner={banner} className="h-36 rounded-[18px]" />
        <div className="absolute -bottom-8 left-4">
          <Logo type={logo} value={data.outing.logoValue} name={data.outing.name} size={68} />
        </div>
      </div>
      <p className="t-label mb-2">Banner</p>
      <div className="grid grid-cols-4 gap-2">
        {BANNER_PRESETS.map((b) => (
          <button key={b.id} onClick={() => setBanner(b.id)} aria-pressed={banner === b.id} className={clsx("aspect-square overflow-hidden rounded-[14px]", banner === b.id ? "ring-[3px] ring-ink" : "border border-line")}>
            <Banner banner={b.id} className="h-full w-full" compact />
          </button>
        ))}
      </div>
      <p className="t-caption mt-2 text-ink-2">To use your own photo, add it in Memories and choose “Set as banner”.</p>
      <p className="t-label mb-2 mt-5">Logo</p>
      <div className="flex gap-3 pb-4">
        {["cup3d", "star3d", "initial", "sticker"].map((l) => (
          <button key={l} onClick={() => setLogo(l)} aria-pressed={logo === l} className={clsx("rounded-full p-[3px]", logo === l && "ring-[3px] ring-ink")}>
            <Logo type={l} name={data.outing.name} size={56} ring={false} className="border border-line" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Compact glass title bar that slides in once the big header has scrolled away. */
function MiniBar({ name, logoType, logoValue, onBack, onMore }: { name: string; logoType: string; logoValue: string | null; onBack: () => void; onMore: () => void }) {
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [230, 290], [0, 1]);
  const y = useTransform(scrollY, [230, 290], [-16, 0]);
  const [live, setLive] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setLive(v > 240));
  return (
    <motion.div style={{ opacity, y }} className={clsx("fixed inset-x-0 top-0 z-40 flex justify-center", !live && "pointer-events-none")} aria-hidden={!live}>
      <div className="flex h-[60px] w-full max-w-[480px] items-center gap-3 border-b border-ink/[0.06] bg-paper/80 px-4 backdrop-blur-xl">
        <IconButton label="Back" surface="plain" onClick={onBack}>
          <ChevronLeft size={22} />
        </IconButton>
        <Logo type={logoType} value={logoValue} name={name} size={30} ring={false} />
        <span className="t-label min-w-0 flex-1 truncate text-[16px]">{name}</span>
        <IconButton label="More" surface="plain" onClick={onMore}>
          <Ellipsis size={19} />
        </IconButton>
      </div>
    </motion.div>
  );
}
