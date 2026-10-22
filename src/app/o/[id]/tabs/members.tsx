"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { Ellipsis, LogOut } from "lucide-react";
import { Avatar, Button, Chip, ConfirmSheet, Notice, Sheet, TextField, Toggle } from "@/components/ui";
import { InviteActions, LinkSettingsSheet, ManualAddSheet } from "@/components/invite";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import type { MemberData, OutingData } from "@/lib/client/types";

/** D1 manage members · D2 leave. Changes never break the ledger: blocked when entries exist. */
export function MembersTab({ data, onChanged }: { data: OutingData; onChanged: () => void }) {
  const toast = useToast();
  const nav = useNav();
  const isOrg = data.me.role === "organizer";
  const [sel, setSel] = useState<MemberData | null>(null);
  const [rename, setRename] = useState("");
  const [mode, setMode] = useState<null | "rename" | "merge" | "remove">(null);
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [leave, setLeave] = useState(false);
  const [settings, setSettings] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = data.outing.id;

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      onChanged();
      setMode(null);
      setSel(null);
      after?.();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {data.pending.length > 0 && isOrg && (
        <div className="rounded-[20px] border-[1.5px] border-ink bg-lime-tint p-4">
          <p className="t-label">Waiting for you · {data.pending.length}</p>
          {data.pending.map((p) => (
            <div key={p.id} className="mt-3 flex items-center gap-3">
              <Avatar initials={p.initials} color={p.color} />
              <span className="t-label min-w-0 flex-1 truncate">{p.name}</span>
              <Button size="S" variant="outline" onClick={() => run(() => api(`/api/outings/${id}/members/${p.id}`, "PATCH", { decision: "decline" }), "Declined")}>
                Decline
              </Button>
              <Button size="S" onClick={() => run(() => api(`/api/outings/${id}/members/${p.id}`, "PATCH", { decision: "approve" }), "Approved")}>
                Approve
              </Button>
            </div>
          ))}
        </div>
      )}

      <ul>
        {data.members.map((m, i) => (
          <motion.li key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
            <Avatar initials={m.initials} color={m.color} size={44} />
            <div className="min-w-0 flex-1">
              <p className="t-label truncate">
                {m.name}
                {m.id === data.me.id && " (you)"}
              </p>
              <p className="t-caption text-ink-2">
                {m.role === "organizer" ? "Organizer" : m.kind === "manual" ? `Manual guest${m.claimPending ? " · claim pending" : ""}` : "Joined via link"}
                {m.noBankAccount && " · no bank account"}
              </p>
            </div>
            {(isOrg || m.id === data.me.id) && (
              <button aria-label={`Manage ${m.name}`} onClick={() => (setSel(m), setRename(m.name))} className="flex h-11 w-11 items-center justify-center rounded-full bg-paper-warm">
                <Ellipsis size={18} />
              </button>
            )}
          </motion.li>
        ))}
      </ul>

      <div className="rounded-[24px] bg-paper-warm p-4">
        <p className="t-label mb-3">Invite more people</p>
        <InviteActions data={data} onSettings={() => setSettings(true)} onManual={() => setManual(true)} />
      </div>

      {data.me.role !== "organizer" && (
        <Button variant="danger" full icon={<LogOut size={18} />} onClick={() => setLeave(true)}>
          Leave outing
        </Button>
      )}

      {/* Member actions */}
      <Sheet open={!!sel && !mode} onClose={() => setSel(null)} title={sel?.name}>
        {sel && (
          <div className="flex flex-col gap-2 pb-3">
            <Button variant="outline" full onClick={() => setMode("rename")}>
              Correct name
            </Button>
            {(isOrg || sel.id === data.me.id) && <Toggle checked={sel.noBankAccount} onChange={(v) => run(() => api(`/api/outings/${id}/members/${sel.id}`, "PATCH", { noBankAccount: v }), v ? "Marked: no bank account" : "Updated")} label="No bank account" description="Optimized routing can keep their transfers as cash with the original person." />}
            {isOrg && sel.role !== "organizer" && (
              <>
                <Button variant="outline" full onClick={() => (setMergeFrom(null), setMode("merge"))}>
                  Merge with a duplicate
                </Button>
                <Button variant="danger" full onClick={() => setMode("remove")}>
                  Remove from outing
                </Button>
              </>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={mode === "rename"} onClose={() => setMode(null)} title="Correct name" footer={<Button full loading={busy} onClick={() => sel && run(() => api(`/api/outings/${id}/members/${sel.id}`, "PATCH", { name: rename }), "Name updated")}>Save</Button>}>
        <TextField label="Name" value={rename} onChange={setRename} maxLength={40} autoFocus />
      </Sheet>

      <Sheet open={mode === "merge"} onClose={() => setMode(null)} title={`Merge into ${sel?.name.split(" ")[0]}`} subtitle="Pick the duplicate entry. Their items and payments move over; one entry is kept." footer={<Button full disabled={!mergeFrom} loading={busy} onClick={() => sel && mergeFrom && run(() => api(`/api/outings/${id}/members/merge`, "POST", { intoId: sel.id, fromId: mergeFrom }), "Merged. Logged in history.")}>Confirm merge</Button>}>
        <div className="flex flex-wrap gap-2 pb-3">
          {data.members
            .filter((m) => m.id !== sel?.id && m.role !== "organizer")
            .map((m) => (
              <Chip key={m.id} selected={mergeFrom === m.id} onClick={() => setMergeFrom(m.id)}>
                {m.name}
              </Chip>
            ))}
        </div>
        {mergeFrom && <Notice tone="lime">Preview: {data.members.find((m) => m.id === mergeFrom)?.name}’s shares, payments and handoffs become {sel?.name}’s. This can’t be split apart later.</Notice>}
      </Sheet>

      <ConfirmSheet open={mode === "remove"} onClose={() => setMode(null)} title={`Remove ${sel?.name}?`} body="They lose access to this outing. If they have items or balances, reassign them or settle / Maaf first." confirmLabel="Remove" tone="danger" loading={busy} onConfirm={() => sel && run(() => api(`/api/outings/${id}/members/${sel.id}`, "DELETE"), "Removed. Logged in history.")} />

      <ConfirmSheet open={leave} onClose={() => setLeave(false)} title="Leave this outing?" body="Your history stays in the ledger. You can’t leave with open balances: settle, ask for Maaf, or mute it instead." confirmLabel="Leave" tone="danger" loading={busy} onConfirm={() => run(() => api(`/api/outings/${id}/leave`), "You left the outing", () => nav.push("/"))} />

      <LinkSettingsSheet open={settings} onClose={() => setSettings(false)} data={data} onChanged={onChanged} />
      <ManualAddSheet open={manual} onClose={() => setManual(false)} outingId={id} onDone={onChanged} />
    </div>
  );
}
