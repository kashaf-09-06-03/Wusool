"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Link2, Plus, RefreshCw, Share, Users } from "lucide-react";
import clsx from "clsx";
import { Avatar, Button, Chip, ConfirmSheet, Sheet, Sticker, TextField, Toggle } from "./ui";
import { Burst } from "./fx";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "@/lib/client/toast";
import type { OutingData } from "@/lib/client/types";

export function inviteUrl(token: string) {
  if (typeof window === "undefined") return `/j/${token}`;
  return `${window.location.origin}/j/${token}`;
}
export function inviteMessage(outingName: string, organizer: string, token: string) {
  return `${organizer} invited you to split “${outingName}” on Wusool. Tap to join (no install needed): ${inviteUrl(token)}`;
}

function expiryText(expiresAt: string | null) {
  if (!expiresAt) return "Open until settled";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.round(ms / 864e5);
  if (days >= 1) return `Expires in ${days} day${days > 1 ? "s" : ""}`;
  return `Expires in ${Math.max(1, Math.round(ms / 36e5))} h`;
}

/** Primary invite actions. Copying or sharing is never treated as consent to WhatsApp notifications. */
export function InviteActions({ data, onSettings, onManual, compact }: { data: OutingData; onSettings: () => void; onManual: () => void; compact?: boolean }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [burst, setBurst] = useState(0);
  const token = data.invite?.token;
  const url = token ? inviteUrl(token) : "";
  const display = url.replace(/^https?:\/\//, "");

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard can be blocked (http on a phone); fall back to a selectable prompt.
      window.prompt("Copy this invite link", url);
    }
    setCopied(true);
    setBurst((b) => b + 1);
    toast("Copied. Paste it in your group.");
    setTimeout(() => setCopied(false), 2400);
  };
  const share = () => {
    if (!token) return;
    const text = inviteMessage(data.outing.name, data.me.name.split(" ")[0], token);
    // wa.me prefills text in WhatsApp (app or web). Nothing is sent automatically.
    const w = window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    if (!w) {
      copy();
      toast("Couldn’t open WhatsApp, so the link was copied instead.", "info");
    }
  };

  if (!data.invite) return <p className="t-caption text-pink-text">No active invite link. Open Settings to create a new one.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative rounded-[20px] border border-line bg-paper-warm p-4">
        <motion.span
          className="absolute -right-1 -top-5 origin-bottom-right"
          initial={{ scale: 0, rotate: -40, y: 12 }}
          animate={copied ? { scale: [1, 1.18, 1], rotate: [-6, 6, -4], y: [0, -10, 0] } : { scale: 1, rotate: -6, y: [0, -3, 0] }}
          transition={copied ? { duration: 0.6, ease: "easeOut" } : { scale: { type: "spring", stiffness: 380, damping: 14, delay: 0.35 }, rotate: { type: "spring", stiffness: 200, damping: 10, delay: 0.35 }, y: { repeat: Infinity, duration: 3.2, ease: "easeInOut", delay: 1 } }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={copied ? "c" : "p"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="block">
              <Sticker color={copied ? "pink" : "lime"} rotate={0}>
                {copied ? "now paste it ✦" : "paste in the group chat ✦"}
              </Sticker>
            </motion.span>
          </AnimatePresence>
        </motion.span>
        <div className="flex items-center gap-2.5">
          <Link2 size={20} className="shrink-0 text-blue" />
          <span className="t-label truncate text-[17px]" data-testid="invite-url">
            {display}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="t-caption text-ink-2">
            {expiryText(data.invite.expiresAt)}
            {data.invite.requireApproval && " · approval on"}
          </span>
          {data.me.role === "organizer" && (
            <button onClick={onSettings} className="t-label text-[14px] text-blue">
              Settings ›
            </button>
          )}
        </div>
      </div>
      <Button full onClick={copy} icon={<AnimatePresence mode="wait" initial={false}>{copied ? <motion.span key="c" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }}><Check size={22} strokeWidth={3} /></motion.span> : <motion.span key="i" initial={{ scale: 0 }} animate={{ scale: 1 }}><Copy size={20} /></motion.span>}</AnimatePresence>} className="h-16">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={copied ? "y" : "n"} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}>
            {copied ? "Copied!" : "Copy invite link"}
          </motion.span>
        </AnimatePresence>
      </Button>
      <Burst trigger={burst} kind="stickers" origin={{ x: 0.5, y: 0.55 }} />
      <Button variant="glass" full icon={<Share size={20} />} onClick={share}>
        Share to WhatsApp
      </Button>
      <p className="t-caption text-ink-2">Opens WhatsApp with the message prefilled. Nothing is sent automatically, and sharing doesn’t turn on WhatsApp notifications.</p>
      {!compact && (
        <a href={`/welcome?add=1&next=${encodeURIComponent(`/j/${token}`)}`} className="t-caption mt-1 inline-flex items-center gap-1.5 self-start rounded-full bg-paper-warm px-3 py-2 text-ink-2 hover:text-ink">
          <Users size={14} /> No WhatsApp handy? Test the link as a friend on this device
        </a>
      )}
      {!compact && (
        <div className="mt-1 flex items-center gap-3">
          <Button variant="outline" size="M" icon={<Plus size={18} />} onClick={onManual}>
            Add manually
          </Button>
          <span className="t-caption text-ink-2">Backup: for friends without the link</span>
        </div>
      )}
    </div>
  );
}

/** B4 backup: add someone by hand, with duplicate detection. */
export function ManualAddSheet({ open, onClose, outingId, onDone }: { open: boolean; onClose: () => void; outingId: string; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [dup, setDup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async (force = false) => {
    setBusy(true);
    try {
      await api(`/api/outings/${outingId}/members`, "POST", { name, force });
      toast(`${name.trim()} added. They can claim this later via the link.`);
      setName("");
      setDup(null);
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "POSSIBLE_DUPLICATE") setDup(e.message);
      else toast(e instanceof ApiError ? e.message : "Couldn’t add", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add someone manually" subtitle="For friends without the link. They show as “added by you” and can claim it later.">
      <div className="flex flex-col gap-4 pb-3">
        <TextField label="Name" value={name} onChange={(v) => (setName(v), setDup(null))} autoFocus maxLength={40} onEnter={() => name.trim() && add()} />
        <AnimatePresence>
          {dup && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-[16px] border-[1.5px] border-ink bg-lime-tint p-4">
              <p className="t-label">{dup}</p>
              <div className="mt-3 flex gap-2">
                <Button size="M" variant="outline" onClick={onClose}>
                  Same person
                </Button>
                <Button size="M" variant="ink" onClick={() => add(true)} loading={busy}>
                  Different person
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!dup && (
          <Button full onClick={() => add()} loading={busy} disabled={!name.trim()}>
            Add
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** B5: expiry, approval, pending requests, revoke & regenerate (confirmed). */
export function LinkSettingsSheet({ open, onClose, data, onChanged }: { open: boolean; onClose: () => void; data: OutingData; onChanged: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = data.outing.id;
  const set = async (body: object, msg: string) => {
    try {
      await api(`/api/outings/${id}/invite`, "PATCH", body);
      toast(msg);
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
    }
  };
  const expiry = !data.invite?.expiresAt ? "settled" : new Date(data.invite.expiresAt).getTime() - Date.now() <= 864e5 + 6e4 ? "24h" : "7d";
  const decide = async (memberId: string, decision: "approve" | "decline") => {
    try {
      await api(`/api/outings/${id}/members/${memberId}`, "PATCH", { decision });
      toast(decision === "approve" ? "Approved" : "Declined");
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t update", "error");
    }
  };
  return (
    <>
      <Sheet open={open && !confirm} onClose={onClose} title="Link settings">
        <div className="flex flex-col gap-5 pb-4">
          <div>
            <p className="t-label mb-2">Link expires</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["24h", "24 h"],
                  ["7d", "7 days"],
                  ["settled", "Until settled"],
                ] as const
              ).map(([k, l]) => (
                <Chip key={k} selected={expiry === k} onClick={() => set({ expiry: k }, "Expiry saved. New joins are blocked after it.")}>
                  {l}
                </Chip>
              ))}
            </div>
          </div>
          <Toggle checked={Boolean(data.invite?.requireApproval)} onChange={(v) => set({ requireApproval: v }, v ? "New joins will wait for you" : "Approval off")} label="Require approval" description="New joins wait until you approve them." />
          {data.pending.length > 0 && (
            <div>
              <p className="t-label mb-2">Pending requests · {data.pending.length}</p>
              {data.pending.map((p) => (
                <div key={p.id} className="flex items-center gap-3 border-t border-line py-3">
                  <Avatar initials={p.initials} color={p.color} />
                  <span className="t-label min-w-0 flex-1 truncate">{p.name}</span>
                  <Button size="S" variant="outline" onClick={() => decide(p.id, "decline")}>
                    Decline
                  </Button>
                  <Button size="S" onClick={() => decide(p.id, "approve")}>
                    Approve
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button variant="danger" full icon={<RefreshCw size={18} />} onClick={() => setConfirm(true)}>
            Revoke & make a new link
          </Button>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Revoke this link?"
        body="The old link stops working for everyone. People already in the outing stay in."
        confirmLabel="Revoke & regenerate"
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/outings/${id}/invite`, "POST");
            toast("Old link dead, new link ready. Copy the new one.");
            onChanged();
            setConfirm(false);
          } catch (e) {
            toast(e instanceof ApiError ? e.message : "Couldn’t revoke", "error");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

export function Roster({ data, live }: { data: OutingData; live?: boolean }) {
  const ago = (iso: string) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short" });
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="t-label text-[17px]">Joined so far · {data.members.length}</h3>
        {live && (
          <span className="t-caption flex items-center gap-1.5 text-ink-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-lime" />
              <span className="relative h-2.5 w-2.5 rounded-full border border-ink/30 bg-lime" />
            </span>
            Live: updates as people join
          </span>
        )}
      </div>
      <ul>
        <AnimatePresence initial={false}>
          {data.members.map((m) => (
            <motion.li key={m.id} layout initial={{ opacity: 0, x: -24, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28 }} className="flex items-center gap-3 py-2.5">
              <Avatar initials={m.initials} color={m.color} size={42} />
              <div className="min-w-0 flex-1">
                <p className="t-label truncate">
                  {m.name}
                  {m.id === data.me.id && " (you)"}
                </p>
                <p className={clsx("t-caption", m.kind === "manual" ? "text-ink-2" : "text-ink-2")}>
                  {m.role === "organizer" ? "Organizer" : m.kind === "manual" ? `Added by hand${m.claimPending ? " · claim pending" : ""}` : `Joined via link · ${ago(m.createdAt)}`}
                </p>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
