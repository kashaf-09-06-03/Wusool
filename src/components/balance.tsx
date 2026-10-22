"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { motion } from "motion/react";
import { ArrowRight, Bell, CheckCheck, CircleAlert, Heart, HandCoins, Send, Smartphone, Wallet } from "lucide-react";
import clsx from "clsx";
import { Amount, Avatar, Button, Chip, ConfirmSheet, Notice, Sheet, StatusChip, TextField, initialsOf, type StatusKey } from "./ui";
import { Burst, HeroPop } from "./fx";
import { api, ApiError, idemKey } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { formatPKR, parsePKR } from "@/lib/money";
import type { BalanceData, BalanceDetailData } from "@/lib/client/types";

const first = (n: string) => n.split(" ")[0];

export function BalanceRow({ b, onOpen, showOuting }: { b: BalanceData; onOpen: () => void; showOuting?: boolean }) {
  const other = b.direction === "owed" ? b.debtor : b.creditor;
  return (
    <motion.button layout onClick={onOpen} className="flex w-full items-center gap-3 py-3 text-left" whileTap={{ scale: 0.985 }}>
      {b.direction === "other" ? (
        <span className="flex items-center">
          <Avatar initials={initialsOf(b.debtor.name)} color={b.debtor.color} size={34} />
          <ArrowRight size={14} className="mx-0.5 text-ink-2" />
          <Avatar initials={initialsOf(b.creditor.name)} color={b.creditor.color} size={34} />
        </span>
      ) : (
        <Avatar initials={initialsOf(other.name)} color={other.color} size={42} />
      )}
      <span className="min-w-0 flex-1">
        <span className="t-label block truncate text-[16px]">
          {b.direction === "owed" ? `${first(b.debtor.name)} pays you` : b.direction === "owe" ? `You pay ${first(b.creditor.name)}` : `${first(b.debtor.name)} → ${first(b.creditor.name)}`}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusChip status={b.status as StatusKey} />
          {showOuting && <span className="t-caption truncate text-ink-2">{b.outing.name}</span>}
        </span>
      </span>
      <span className="text-right">
        <span className="t-amount-m block text-[17px]">{formatPKR(b.outstanding > 0 ? b.outstanding : b.amount)}</span>
        {b.outstanding > 0 && b.outstanding !== b.amount && <span className="t-caption text-ink-2">of {formatPKR(b.amount)}</span>}
      </span>
    </motion.button>
  );
}

/** G2: small-debt quick choice — “Ali owes you PKR 80. Wusool or Maaf?” */
export function QuickChoiceCard({ b, onWusool, onMaaf }: { b: BalanceData; onWusool: () => void; onMaaf: () => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, scale: 0.9 }} className="relative overflow-hidden rounded-[24px] border-[1.5px] border-ink bg-paper p-5 shadow-[3px_4px_0_rgba(17,17,20,0.9)]">
      <span aria-hidden className="torn-x absolute -right-6 -top-6 h-20 w-28 rotate-12 bg-lime" />
      <p className="t-overline relative text-ink-2">Below your {formatPKR(b.threshold)} threshold</p>
      <p className="t-h2 relative mt-1">
        {first(b.debtor.name)} owes you <span className="t-amount-l whitespace-nowrap">{formatPKR(b.outstanding - b.claimed)}</span>. Wusool or Maaf?
      </p>
      <p className="t-caption relative mt-1 text-ink-2">{b.outing.name}</p>
      <div className="relative mt-4 grid grid-cols-2 gap-2.5">
        <Button size="M" icon={<HandCoins size={18} />} onClick={onWusool}>
          Wusool
        </Button>
        <Button size="M" variant="maaf" icon={<Heart size={18} fill="currentColor" />} onClick={onMaaf}>
          Maaf
        </Button>
      </div>
    </motion.div>
  );
}

const REASONS = [
  ["wrong_amount", "Wrong amount"],
  ["not_mine", "Not mine"],
  ["already_paid", "Already paid"],
  ["wrong_recipient", "Wrong recipient"],
] as const;

/** Full lifecycle sheet for one balance (G1–G5). */
export function BalanceSheet({ id, onClose, onChanged, autoMaaf }: { id: string | null; onClose: () => void; onChanged: () => void; autoMaaf?: boolean }) {
  const { data, mutate, error } = useSWR<BalanceDetailData>(id ? `/api/balances/${id}` : null);
  const toast = useToast();
  const nav = useNav();
  const [mode, setMode] = useState<null | "pay" | "maaf" | "remind" | "dispute" | "wrong" | "wusool">(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [tone, setTone] = useState<"friendly" | "neutral">("friendly");
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("wrong_amount");
  const [msg, setMsg] = useState("");
  const [third, setThird] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [fx, setFx] = useState<{ kind: "maaf" | "confirm" | "wusool" | null; n: number }>({ kind: null, n: 0 });

  useEffect(() => {
    if (autoMaaf && data?.role === "creditor") setMode("maaf");
  }, [autoMaaf, data?.role]);
  useEffect(() => {
    setMode(null);
    setNote("");
  }, [id]);

  const act = async (action: object, ok: string, effect?: "maaf" | "confirm" | "wusool") => {
    if (!data) return;
    setBusy(true);
    try {
      await api(`/api/balances/${data.id}`, "POST", { action, expectedVersion: data.version, idempotencyKey: idemKey() });
      toast(ok);
      if (effect) setFx((f) => ({ kind: effect, n: f.n + 1 }));
      setMode(null);
      setNote("");
      setMsg("");
      await mutate();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_BALANCE") {
        toast("This balance changed (maybe already paid). Refreshed: nothing was applied.", "error");
        await mutate();
        onChanged();
      } else toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(false);
    }
  };

  const open = Boolean(id);
  const d = data;
  const canMark = d && d.role === "debtor" && d.outstanding - d.claimed > 0 && d.status !== "disputed";
  const forgivable = d ? d.outstanding - d.claimed : 0;

  return (
    <>
      <Sheet open={open && !mode} onClose={onClose} title={d ? (d.direction === "owed" ? `${first(d.debtor.name)} pays you` : d.direction === "owe" ? `You pay ${first(d.creditor.name)}` : `${first(d.debtor.name)} → ${first(d.creditor.name)}`) : "Balance"} subtitle={d?.outing.name} tall>
        {error && <Notice tone="pink">{error instanceof ApiError ? error.message : "Couldn’t load this balance."}</Notice>}
        {d && (
          <div className="flex flex-col gap-5 pb-4">
            <HeroPop src={fx.kind === "maaf" ? "/assets/heart3d-cut.png" : fx.kind === "wusool" ? "/assets/wallet3d-cut.png" : "/assets/popper3d-cut.png"} show={fx.kind !== null && fx.n > 0 && (d.status === "maaf" || d.status === "confirmed" || fx.kind === "wusool")} size={130} />
            <Burst trigger={fx.n} kind={fx.kind === "maaf" ? "hearts" : fx.kind === "wusool" ? "coins" : "confetti"} origin={{ x: 0.5, y: 0.45 }} />

            <div className="rounded-[20px] bg-paper-warm p-4">
              <div className="flex items-center justify-between">
                <StatusChip status={(d.superseded ? "superseded" : d.status) as StatusKey} />
                <span className="t-caption text-ink-2">v{d.version}</span>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className="t-caption text-ink-2">{d.outstanding > 0 ? "Still open" : "Settled"}</p>
                  <Amount value={d.outstanding > 0 ? d.outstanding : d.amount} className="t-amount-xl whitespace-nowrap text-[clamp(28px,9vw,40px)]" />
                </div>
                <div className="flex items-center gap-1">
                  <Avatar initials={initialsOf(d.debtor.name)} color={d.debtor.color} size={36} />
                  <ArrowRight size={16} />
                  <Avatar initials={initialsOf(d.creditor.name)} color={d.creditor.color} size={36} />
                </div>
              </div>
              <Progress d={d} />
              <dl className="t-caption mt-3 grid grid-cols-2 gap-y-1 text-ink-2">
                <dt>Total</dt>
                <dd className="text-right tabular text-ink">{formatPKR(d.amount)}</dd>
                {d.confirmed > 0 && (
                  <>
                    <dt>Confirmed received</dt>
                    <dd className="text-right tabular text-ink">{formatPKR(d.confirmed)}</dd>
                  </>
                )}
                {d.claimed > 0 && (
                  <>
                    <dt>Marked paid, waiting</dt>
                    <dd className="text-right tabular text-ink">{formatPKR(d.claimed)}</dd>
                  </>
                )}
                {d.forgiven > 0 && (
                  <>
                    <dt>Maaf (forgiven)</dt>
                    <dd className="text-right tabular text-ink">{formatPKR(d.forgiven)}</dd>
                  </>
                )}
              </dl>
            </div>

            {d.superseded && <Notice tone="warm">This balance was replaced when the outing was re-published. See the current one in Balances.</Notice>}

            {/* Debtor actions */}
            {!d.superseded && d.role === "debtor" && (
              <div className="flex flex-col gap-2">
                {d.claimed > 0 && <Notice tone="blue" icon={<CheckCheck size={18} className="text-blue" />}>You marked {formatPKR(d.claimed)} as paid. Waiting for {first(d.creditor.name)} to confirm it arrived.</Notice>}
                {canMark && (
                  <Button full icon={<Wallet size={20} />} onClick={() => (setAmount(String((d.outstanding - d.claimed) / 100)), setMode("pay"))}>
                    I paid {first(d.creditor.name)}
                  </Button>
                )}
                <p className="t-caption text-ink-2">Pay with your bank app or cash. Wusool records it; it never moves money.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="M" onClick={() => nav.push(`/o/${d.outing.id}/me`)}>
                    Why do I owe this?
                  </Button>
                  {d.status !== "disputed" && (
                    <Button variant="outline" size="M" onClick={() => setMode("dispute")}>
                      Something’s wrong
                    </Button>
                  )}
                </div>
                {d.status !== "disputed" && d.outstanding > 0 && (
                  <button className="t-label text-[14px] text-blue" onClick={() => setMode("wrong")}>
                    Paid the wrong person by mistake?
                  </button>
                )}
              </div>
            )}

            {/* Creditor actions */}
            {!d.superseded && d.role === "creditor" && (
              <div className="flex flex-col gap-2">
                {d.claimed > 0 && (
                  <div className="rounded-[18px] border-[1.5px] border-blue p-4">
                    <p className="t-label">
                      {first(d.debtor.name)} says they paid {formatPKR(d.claimed)}
                    </p>
                    <p className="t-caption mt-0.5 text-ink-2">Check your account first. A mark is a claim, not proof.</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button size="M" icon={<CheckCheck size={18} />} loading={busy} onClick={() => act({ type: "confirm" }, "Confirmed received", "confirm")}>
                        Received
                      </Button>
                      <Button size="M" variant="outline" onClick={() => act({ type: "not_received" }, "Marked as not received; a thread is open")}>
                        Not yet
                      </Button>
                    </div>
                  </div>
                )}
                {d.outstanding - d.claimed > 0 && d.status !== "disputed" && (
                  <>
                    {d.quickChoice && <p className="t-overline text-ink-2">Below your {formatPKR(d.threshold)} small-debt threshold</p>}
                    <div className="grid grid-cols-2 gap-2">
                      <Button size={d.quickChoice ? "L" : "M"} icon={<HandCoins size={18} />} onClick={() => setMode("wusool")}>
                        Wusool
                      </Button>
                      <Button size={d.quickChoice ? "L" : "M"} variant={d.quickChoice ? "maaf" : "outline"} icon={<Heart size={18} fill={d.quickChoice ? "currentColor" : "none"} />} onClick={() => setMode("maaf")}>
                        Maaf
                      </Button>
                    </div>
                    <Button variant="glass" size="M" icon={<Bell size={18} />} onClick={() => setMode("remind")} disabled={Boolean(d.nextReminderAt)}>
                      {d.nextReminderAt ? `Next reminder ${new Date(d.nextReminderAt).toLocaleString("en-PK", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Send a reminder"}
                    </Button>
                  </>
                )}
                {d.status !== "disputed" && d.outstanding > 0 && (
                  <button className="t-label text-[14px] text-blue" onClick={() => setMode("dispute")}>
                    Something’s wrong
                  </button>
                )}
              </div>
            )}

            {/* Dispute thread (G3) */}
            {d.dispute && d.dispute.status === "open" && (
              <div className="rounded-[20px] border-[1.5px] border-pink-text bg-pink-tint/50 p-4">
                <p className="t-label flex items-center gap-2 text-pink-text">
                  <CircleAlert size={18} /> Disputed: {REASONS.find((r) => r[0] === d.dispute!.reason)?.[1] ?? (d.dispute.reason === "not_received" ? "Not received" : d.dispute.reason)}
                </p>
                <p className="t-caption mt-0.5 text-ink-2">Raised by {d.dispute.openedBy}. Reminders are paused. The organizer can see this thread.</p>
                <div className="mt-3 flex flex-col gap-2">
                  {d.dispute.messages.map((mm, i) => (
                    <div key={i} className="rounded-[14px] bg-paper p-3">
                      <p className="t-caption font-semibold">{mm.name}</p>
                      <p className="t-ui text-[14px]">{mm.text}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Reply…" aria-label="Reply in thread" className="t-ui h-11 min-w-0 flex-1 rounded-full border-[1.5px] border-line-strong bg-paper px-4 outline-none focus:border-blue" />
                  <Button size="M" variant="ink" aria-label="Send" disabled={!msg.trim()} onClick={() => act({ type: "message", text: msg }, "Sent")} icon={<Send size={16} />} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(d.role === "creditor" || d.role === "organizer") && (
                    <Button size="S" variant="outline" onClick={() => act({ type: "resolve", resolution: "paid" }, "Payment confirmed", "confirm")}>
                      Payment confirmed
                    </Button>
                  )}
                  {d.role === "creditor" && (
                    <Button size="S" variant="outline" onClick={() => setMode("maaf")}>
                      Let it go (Maaf)
                    </Button>
                  )}
                  <Button size="S" variant="outline" onClick={() => act({ type: "resolve", resolution: "withdraw" }, "Dispute withdrawn")}>
                    Withdraw
                  </Button>
                  {d.role === "organizer" && (
                    <Button size="S" variant="outline" onClick={() => (act({ type: "resolve", resolution: "edit" }, "Resolved: edit the expense, then re-publish"), nav.push(`/o/${d.outing.id}`))}>
                      Fix the expense
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Audit history */}
            <details className="group rounded-[16px] bg-paper-warm p-4">
              <summary className="t-label cursor-pointer list-none">History ({d.events.length})</summary>
              <ol className="mt-3 flex flex-col gap-2.5">
                {d.events.map((e, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink" />
                    <span className="t-caption">
                      <b>{EVENT_LABEL[e.type] ?? e.type.replace(/_/g, " ")}</b>
                      {e.amount ? ` · ${formatPKR(e.amount)}` : ""}
                      {e.actor ? ` · ${e.actor}` : ""}
                      {e.note ? ` · “${e.note}”` : ""}
                      <span className="block text-ink-2">{new Date(e.created_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </div>
        )}
      </Sheet>

      {/* Mark Wusooled: full or partial */}
      <Sheet
        open={mode === "pay"}
        onClose={() => setMode(null)}
        title={`I paid ${d ? first(d.creditor.name) : ""}`}
        footer={
          <Button
            full
            loading={busy}
            onClick={() => {
              const v = parsePKR(amount);
              if (!v || v <= 0) return toast("Enter the amount you paid", "error");
              act({ type: "mark_paid", amount: v, note: note || undefined }, v < forgivable ? "Marked as partly paid" : "Marked Wusooled. They’ll confirm.");
            }}
          >
            Mark as paid
          </Button>
        }
      >
        {d && (
          <div className="flex flex-col gap-4 pb-3">
            <TextField label="Amount" prefix="PKR" value={amount} onChange={setAmount} inputMode="decimal" helper={`Full amount is ${formatPKR(d.outstanding - d.claimed)}. Paying part? Enter what you sent; the rest stays requested.`} />
            <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. JazzCash, ref 1234" maxLength={200} />
            <Notice tone="warm">This tells {first(d.creditor.name)} you paid. It isn’t proof: they’ll confirm once it arrives.</Notice>
          </div>
        )}
      </Sheet>

      {/* Wusool: explicit request */}
      <ConfirmSheet
        open={mode === "wusool"}
        onClose={() => setMode(null)}
        title={d ? `Request ${formatPKR(forgivable)} from ${first(d.debtor.name)}?` : ""}
        body={
          d ? (
            <span>
              {first(d.debtor.name)} gets a friendly in-app request with the breakdown{d.debtorReachable.whatsappRequest ? " and, because they opted in, a WhatsApp message (simulated in this prototype)" : ". They haven’t turned on WhatsApp, so it’s in-app only"}.
            </span>
          ) : null
        }
        confirmLabel="Send request"
        loading={busy}
        onConfirm={() => act({ type: "wusool" }, "Request sent", "wusool")}
      />

      {/* Maaf: forgive with explicit confirmation */}
      <ConfirmSheet
        open={mode === "maaf"}
        onClose={() => setMode(null)}
        title={d ? `Forgive ${first(d.debtor.name)}’s ${formatPKR(forgivable)}?` : ""}
        body={d ? `${first(d.debtor.name)} will be told in-app${d.debtorReachable.whatsappRequest ? " (and on WhatsApp, simulated)" : ""}. This is recorded in the history and can’t be silently undone.` : null}
        confirmLabel="Maaf ♥"
        tone="maaf"
        loading={busy}
        onConfirm={() => act({ type: "maaf", confirm: true }, "Maaf recorded ♥", "maaf")}
      />

      {/* Reminder: tone, preview, disclosure, rate limit */}
      <Sheet open={mode === "remind"} onClose={() => setMode(null)} title="Send a reminder" footer={<Button full loading={busy} icon={<Send size={18} />} onClick={() => act({ type: "remind", tone }, "Reminder sent")}>Send</Button>}>
        {d && (
          <div className="flex flex-col gap-4 pb-3">
            <div className="flex gap-2">
              <Chip selected={tone === "friendly"} onClick={() => setTone("friendly")}>
                Friendly
              </Chip>
              <Chip selected={tone === "neutral"} onClick={() => setTone("neutral")}>
                Neutral
              </Chip>
            </div>
            <div className="rounded-[18px] bg-paper-warm p-4">
              <p className="t-overline text-ink-2">Preview</p>
              <p className="t-body mt-1">
                {tone === "friendly" ? `Hey ${first(d.debtor.name)}! Small reminder about ${formatPKR(d.outstanding)} for ${d.outing.name} ✦ No rush, whenever you can.` : `Reminder: ${formatPKR(d.outstanding)} for ${d.outing.name} is still open.`}
              </p>
            </div>
            <Notice tone="blue" icon={<Smartphone size={18} className="text-blue" />}>
              {first(d.debtor.name)} will get this in-app{d.debtorReachable.whatsappReminder ? " and on WhatsApp (they opted in; simulated in this prototype)" : ". They haven’t opted in to WhatsApp, so nothing goes there"}. One reminder per 48 hours.
            </Notice>
          </div>
        )}
      </Sheet>

      {/* Dispute */}
      <Sheet open={mode === "dispute"} onClose={() => setMode(null)} title="What’s wrong?" footer={<Button full loading={busy} onClick={() => act({ type: "dispute", reason, note: note || undefined }, "Flagged. A shared thread is open.")}>Open a thread</Button>}>
        <div className="flex flex-col gap-4 pb-3">
          <div className="flex flex-wrap gap-2">
            {REASONS.map(([k, l]) => (
              <Chip key={k} selected={reason === k} onClick={() => setReason(k)}>
                {l}
              </Chip>
            ))}
          </div>
          <TextField label="Add a note (optional)" value={note} onChange={setNote} maxLength={300} />
          <p className="t-caption text-ink-2">Both of you and the organizer see the thread. No blame: it pauses reminders until it’s sorted.</p>
        </div>
      </Sheet>

      {/* Wrong recipient (G5) */}
      <Sheet
        open={mode === "wrong"}
        onClose={() => setMode(null)}
        title="Paid the wrong person?"
        footer={
          <Button
            full
            loading={busy}
            disabled={!third}
            onClick={() => {
              const v = parsePKR(amount);
              if (!v) return toast("Enter the amount", "error");
              act({ type: "third_party", memberId: third, amount: v }, "We asked them to confirm");
            }}
          >
            Ask them to confirm
          </Button>
        }
      >
        {d && (
          <div className="flex flex-col gap-4 pb-3">
            <p className="t-body-s text-ink-2">Who received it? We’ll ask them to confirm. If they do, correction entries move the debt to them.</p>
            <div className="flex flex-wrap gap-2">
              {d.otherMembers.map((m) => (
                <Chip key={m.id} selected={third === m.id} onClick={() => setThird(m.id)}>
                  {first(m.name)}
                </Chip>
              ))}
            </div>
            <TextField label="Amount sent" prefix="PKR" value={amount} onChange={setAmount} inputMode="decimal" />
          </div>
        )}
      </Sheet>
    </>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: "Requested",
  marked_paid: "Marked Wusooled",
  marked_partial: "Marked partly paid",
  confirmed_received: "Confirmed received",
  disputed: "Disputed",
  wusool_requested: "Wusool request sent",
  maaf: "Maaf",
  reminded: "Reminder sent",
  message: "Thread message",
  resolved_withdraw: "Dispute withdrawn",
  resolved_paid: "Payment confirmed",
  resolved_maaf: "Resolved with Maaf",
  resolved_edit: "Sent back for correction",
  superseded: "Replaced by a new version",
  wrong_recipient: "Wrong recipient reported",
  correction: "Correction entry",
  third_party_denied: "Third party didn’t confirm",
};

function Progress({ d }: { d: BalanceDetailData }) {
  const pct = (v: number) => `${Math.min(100, (v / d.amount) * 100)}%`;
  return (
    <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-paper" role="img" aria-label="Payment progress">
      <motion.span className="h-full bg-blue" initial={{ width: 0 }} animate={{ width: pct(d.confirmed) }} />
      <motion.span className="h-full bg-pink" initial={{ width: 0 }} animate={{ width: pct(d.forgiven) }} />
      <motion.span className={clsx("h-full bg-[repeating-linear-gradient(45deg,var(--color-blue)_0_4px,var(--color-blue-tint)_4px_8px)]")} initial={{ width: 0 }} animate={{ width: pct(d.claimed) }} />
    </div>
  );
}

/** G5: the third party confirms receipt. */
export function ThirdPartySheet({ balanceId, onClose, onDone }: { balanceId: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async (confirm: boolean) => {
    if (!balanceId) return;
    setBusy(true);
    try {
      await api(`/api/balances/${balanceId}/third-party`, "POST", { confirm });
      toast(confirm ? "Thanks. Correction entries added." : "Noted. The organizer will mediate.");
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!balanceId} onClose={onClose} title="Did you receive money meant for someone else?">
      <div className="flex flex-col gap-3 pb-4">
        <p className="t-body-s text-ink-2">If yes, your part gets recorded so you can pass it on. Nothing moves automatically.</p>
        <Button full loading={busy} onClick={() => go(true)}>
          Yes, I got it
        </Button>
        <Button full variant="outline" loading={busy} onClick={() => go(false)}>
          No, I didn’t
        </Button>
      </div>
    </Sheet>
  );
}
