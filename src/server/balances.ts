import "server-only";
import { z } from "zod/v4";
import { all, get, newId, now, run, tx } from "./db";
import { AppError, bad, conflict, forbidden, notFound } from "./http";
import { getOuting, membersOf, type Member } from "./outings";
import { appUrl, logActivity, notify } from "./notify";
import { assertBalanceAccess, type BalanceRow, type BalanceStatus } from "./settlement";
import { formatPKR } from "@/lib/money";
import type { User } from "./auth";

const REMIND_GAP_MS = 48 * 3600 * 1000;

export const BalanceAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mark_paid"), amount: z.number().int().positive(), note: z.string().max(200).optional() }),
  z.object({ type: z.literal("confirm") }),
  z.object({ type: z.literal("not_received"), note: z.string().max(200).optional() }),
  z.object({ type: z.literal("wusool") }),
  z.object({ type: z.literal("maaf"), confirm: z.literal(true) }),
  z.object({ type: z.literal("remind"), tone: z.enum(["friendly", "neutral"]) }),
  z.object({ type: z.literal("dispute"), reason: z.enum(["wrong_amount", "not_mine", "already_paid", "wrong_recipient", "not_received"]), note: z.string().max(300).optional() }),
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal("resolve"), resolution: z.enum(["withdraw", "paid", "maaf", "edit"]), note: z.string().max(300).optional() }),
  z.object({ type: z.literal("third_party"), memberId: z.string(), amount: z.number().int().positive() }),
  z.object({ type: z.literal("third_party_confirm"), confirm: z.boolean() }),
]);
export type BalanceActionT = z.infer<typeof BalanceAction>;

export function outstanding(b: Pick<BalanceRow, "amount" | "confirmed" | "forgiven">) {
  return Math.max(0, b.amount - b.confirmed - b.forgiven);
}

/** Status is derived from amounts plus the disputed flag (Figma 05 settlement chips). */
export function deriveStatus(b: Pick<BalanceRow, "amount" | "claimed" | "confirmed" | "forgiven">, disputed: boolean): BalanceStatus {
  if (disputed) return "disputed";
  const settled = b.confirmed + b.forgiven;
  if (settled >= b.amount) return b.forgiven > 0 ? "maaf" : "confirmed";
  if (b.claimed > 0 && settled + b.claimed >= b.amount) return "marked";
  if (b.claimed > 0 || b.confirmed > 0) return "partial";
  return "requested";
}

function event(balanceId: string, type: string, actor: string | null, amount: number | null, note: string | null, idemKey: string | null) {
  run("INSERT INTO balance_events (id, balance_id, type, actor_member_id, amount, note, idem_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", newId("be_"), balanceId, type, actor, amount, note, idemKey, now());
}

function update(b: BalanceRow, patch: Partial<BalanceRow>, disputed?: boolean) {
  const next = { ...b, ...patch };
  const isDisputed = disputed ?? b.status === "disputed";
  const status = deriveStatus(next, isDisputed);
  run(
    "UPDATE balances SET claimed = ?, confirmed = ?, forgiven = ?, status = ?, prev_status = ?, version = version + 1, last_reminder_at = ?, updated_at = ? WHERE id = ?",
    next.claimed,
    next.confirmed,
    next.forgiven,
    status,
    isDisputed && b.status !== "disputed" ? b.status : patch.prev_status !== undefined ? patch.prev_status : b.prev_status,
    next.last_reminder_at,
    now(),
    b.id,
  );
  return status;
}

function openDispute(b: BalanceRow) {
  return get<{ id: string; reason: string; opened_by_member_id: string; status: string }>("SELECT * FROM disputes WHERE balance_id = ? AND status = 'open'", b.id);
}

export function performAction(balanceId: string, user: User, action: BalanceActionT, opts: { expectedVersion?: number; idempotencyKey?: string }) {
  const { b, me, role } = assertBalanceAccess(balanceId, user);
  // Idempotency: a replayed key (double tap, late WhatsApp button) changes nothing.
  if (opts.idempotencyKey && get("SELECT 1 FROM balance_events WHERE idem_key = ?", opts.idempotencyKey)) return { status: b.status, alreadyHandled: true, balance: b };
  if (b.superseded) throw conflict("This balance was replaced by a newer version of the outing. Refresh to see the current one.", "STALE_BALANCE");
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== b.version) throw conflict("This balance changed since you opened it. Refresh: nothing was applied.", "STALE_BALANCE", { current: b });
  const outing = getOuting(b.outing_id);
  const members = membersOf(b.outing_id, true);
  const userOf = (id: string) => members.find((m) => m.id === id)?.user_id ?? null;
  const first = (id: string) => (members.find((m) => m.id === id)?.name ?? "Someone").split(" ")[0];
  const debtor = b.debtor_member_id;
  const creditor = b.creditor_member_id;
  const left = outstanding(b);
  const idem = opts.idempotencyKey ?? null;
  const link = `/balances?focus=${b.id}`;
  const need = (r: string | string[]) => {
    if (!(Array.isArray(r) ? r : [r]).includes(role)) throw forbidden();
  };

  return tx(() => {
    let status: BalanceStatus = b.status;
    switch (action.type) {
      case "mark_paid": {
        need("debtor");
        if (b.status === "disputed") throw bad("This balance is disputed. Resolve the dispute first.");
        const room = left - b.claimed;
        if (room <= 0) throw conflict("You’ve already marked the full amount. Waiting for confirmation.", "NOTHING_TO_MARK");
        if (action.amount > room) throw bad(`You can mark at most ${formatPKR(room)}.`);
        status = update(b, { claimed: b.claimed + action.amount });
        event(b.id, action.amount === room ? "marked_paid" : "marked_partial", me.id, action.amount, action.note ?? null, idem);
        notify({
          userId: userOf(creditor),
          outingId: b.outing_id,
          type: "status",
          title: `${first(debtor)} says they paid you ${formatPKR(action.amount)}`,
          body: `${action.note ? `“${action.note}” · ` : ""}Check your account, then confirm. A mark is a claim, not proof.`,
          link,
          whatsapp: { text: `${first(debtor)} marked ${formatPKR(action.amount)} as paid for ${outing.name}. Confirm in Wusool once it arrives.` },
        });
        break;
      }
      case "confirm": {
        need("creditor");
        if (b.claimed <= 0) throw conflict("Nothing is waiting for confirmation.", "NOTHING_TO_CONFIRM");
        const amt = b.claimed;
        status = update(b, { claimed: 0, confirmed: b.confirmed + amt });
        event(b.id, "confirmed_received", me.id, amt, null, idem);
        notify({ userId: userOf(debtor), outingId: b.outing_id, type: "status", title: `${first(creditor)} confirmed ${formatPKR(amt)}`, body: status === "confirmed" ? "This balance is closed." : `${formatPKR(outstanding({ ...b, confirmed: b.confirmed + amt }))} still open.`, link });
        break;
      }
      case "not_received": {
        need("creditor");
        if (b.claimed <= 0) throw conflict("Nothing is waiting for confirmation.", "NOTHING_TO_CONFIRM");
        run("INSERT INTO disputes (id, balance_id, reason, opened_by_member_id, created_at) VALUES (?, ?, 'not_received', ?, ?)", newId("d_"), b.id, me.id, now());
        status = update(b, { claimed: 0 }, true);
        event(b.id, "disputed", me.id, b.claimed, action.note ?? "Not received yet", idem);
        notify({ userId: userOf(debtor), outingId: b.outing_id, type: "status", title: `${first(creditor)} hasn’t received it yet`, body: "A shared thread is open so you can sort it out. Reminders are paused.", link });
        break;
      }
      case "wusool": {
        need("creditor");
        if (left <= 0) throw conflict("This balance is already settled.", "ALREADY_SETTLED");
        if (b.status === "disputed") throw bad("Reminders and requests are paused while disputed.");
        event(b.id, "wusool_requested", me.id, left, null, idem);
        run("UPDATE balances SET version = version + 1, updated_at = ? WHERE id = ?", now(), b.id);
        notify({
          userId: userOf(debtor),
          outingId: b.outing_id,
          type: "request",
          title: `${first(creditor)} requested ${formatPKR(left)}`,
          body: `For ${outing.name}. Tap to see why, then pay outside Wusool and mark it paid.`,
          link,
          whatsapp: { text: `Salaam! ${first(creditor)} requested ${formatPKR(left)} for ${outing.name}. See the breakdown: ${appUrl(`/o/${outing.id}/me`)}` },
        });
        break;
      }
      case "maaf": {
        need("creditor");
        const forgivable = left - b.claimed;
        if (forgivable <= 0) throw conflict("Nothing left to forgive (any marked payment is still waiting for your confirmation).", "ALREADY_SETTLED");
        status = update(b, { forgiven: b.forgiven + forgivable }, false);
        run("UPDATE disputes SET status = 'resolved', resolution = 'maaf' WHERE balance_id = ? AND status = 'open'", b.id);
        event(b.id, "maaf", me.id, forgivable, null, idem);
        logActivity(b.outing_id, me.id, "maaf", `${first(creditor)} forgave ${first(debtor)}’s ${formatPKR(forgivable)} (Maaf)`);
        notify({
          userId: userOf(debtor),
          outingId: b.outing_id,
          type: "wusool_maaf",
          title: `${first(creditor)} said Maaf ♥`,
          body: `Your ${formatPKR(forgivable)} for ${outing.name} is forgiven. Nothing to pay.`,
          link,
          whatsapp: { text: `${first(creditor)} forgave your ${formatPKR(forgivable)} for ${outing.name} (Maaf). Nothing to pay.` },
        });
        break;
      }
      case "remind": {
        need("creditor");
        if (left <= 0) throw conflict("This balance is already settled.", "ALREADY_SETTLED");
        if (b.status === "disputed") throw bad("Reminders are paused while disputed.");
        if (b.last_reminder_at && Date.now() - new Date(b.last_reminder_at).getTime() < REMIND_GAP_MS) {
          const nextAt = new Date(new Date(b.last_reminder_at).getTime() + REMIND_GAP_MS);
          throw new AppError(429, "REMIND_TOO_SOON", `You reminded recently. Next reminder allowed ${nextAt.toLocaleString("en-PK", { weekday: "short", hour: "numeric", minute: "2-digit" })}.`, { nextAt: nextAt.toISOString() });
        }
        const text =
          action.tone === "friendly"
            ? `Hey ${first(debtor)}! Small reminder about ${formatPKR(left)} for ${outing.name} ✦ No rush, whenever you can.`
            : `Reminder: ${formatPKR(left)} for ${outing.name} is still open.`;
        run("UPDATE balances SET last_reminder_at = ?, version = version + 1, updated_at = ? WHERE id = ?", now(), now(), b.id);
        event(b.id, "reminded", me.id, left, action.tone, idem);
        const r = notify({ userId: userOf(debtor), outingId: b.outing_id, type: "reminder", title: `Reminder from ${first(creditor)}`, body: text, link, whatsapp: { text } });
        return { status: b.status, delivered: r, balance: get<BalanceRow>("SELECT * FROM balances WHERE id = ?", b.id) };
      }
      case "dispute": {
        need(["debtor", "creditor"]);
        if (b.status === "disputed") throw conflict("There’s already an open dispute.", "ALREADY_DISPUTED");
        if (left <= 0 && b.claimed <= 0) throw bad("This balance is already settled.");
        const disputeId = newId("d_");
        run("INSERT INTO disputes (id, balance_id, reason, opened_by_member_id, created_at) VALUES (?, ?, ?, ?, ?)", disputeId, b.id, action.reason, me.id, now());
        if (action.note) run("INSERT INTO dispute_messages (id, dispute_id, member_id, text, created_at) VALUES (?, ?, ?, ?, ?)", newId("dm_"), disputeId, me.id, action.note, now());
        status = update(b, {}, true);
        event(b.id, "disputed", me.id, null, `${action.reason}${action.note ? `: ${action.note}` : ""}`, idem);
        const other = me.id === debtor ? creditor : debtor;
        const organizer = members.find((m) => m.role === "organizer");
        for (const uid of new Set([userOf(other), organizer?.user_id ?? null]))
          notify({ userId: uid, outingId: b.outing_id, type: "status", title: `${first(me.id)} flagged a balance`, body: `${REASONS[action.reason]}. A shared thread is open; reminders are paused.`, link });
        break;
      }
      case "message": {
        const d = openDispute(b);
        if (!d) throw bad("There’s no open dispute on this balance.");
        run("INSERT INTO dispute_messages (id, dispute_id, member_id, text, created_at) VALUES (?, ?, ?, ?, ?)", newId("dm_"), d.id, me.id, action.text, now());
        event(b.id, "message", me.id, null, null, idem);
        const others = [debtor, creditor, members.find((m) => m.role === "organizer")?.id].filter((x): x is string => Boolean(x) && x !== me.id);
        for (const id of new Set(others)) notify({ userId: userOf(id), outingId: b.outing_id, type: "status", title: `${first(me.id)} replied in a dispute`, body: action.text.slice(0, 120), link });
        return { status: b.status, balance: b };
      }
      case "resolve": {
        const d = openDispute(b);
        if (!d) throw bad("There’s no open dispute.");
        if (action.resolution === "withdraw") {
          if (me.id !== d.opened_by_member_id && role !== "organizer") throw forbidden("Only the person who raised it (or the organizer) can withdraw it.");
          run("UPDATE disputes SET status = 'resolved', resolution = 'withdrawn' WHERE id = ?", d.id);
          status = update(b, {}, false);
        } else if (action.resolution === "paid") {
          need(["creditor", "organizer"]);
          run("UPDATE disputes SET status = 'resolved', resolution = 'payment_confirmed' WHERE id = ?", d.id);
          status = update(b, { claimed: 0, confirmed: b.confirmed + left }, false);
        } else if (action.resolution === "maaf") {
          need("creditor");
          run("UPDATE disputes SET status = 'resolved', resolution = 'maaf' WHERE id = ?", d.id);
          status = update(b, { forgiven: b.forgiven + left - b.claimed }, false);
        } else {
          need("organizer");
          run("UPDATE disputes SET status = 'resolved', resolution = 'edit' WHERE id = ?", d.id);
          status = update(b, {}, false);
          logActivity(b.outing_id, me.id, "dispute_edit", `${first(me.id)} will correct the expense and re-publish`);
        }
        event(b.id, `resolved_${action.resolution}`, me.id, null, action.note ?? null, idem);
        for (const id of [debtor, creditor]) if (id !== me.id) notify({ userId: userOf(id), outingId: b.outing_id, type: "status", title: "Dispute resolved", body: RESOLUTIONS[action.resolution], link });
        break;
      }
      case "third_party": {
        // G5: debtor paid the wrong person. Ask that person to confirm.
        need("debtor");
        if (!members.some((m) => m.id === action.memberId && m.status === "active")) throw bad("Pick someone in this outing.");
        if (action.memberId === creditor || action.memberId === debtor) throw bad("Pick the person who actually received it.");
        run("INSERT INTO disputes (id, balance_id, reason, opened_by_member_id, resolution, created_at) VALUES (?, ?, 'wrong_recipient', ?, ?, ?)", newId("d_"), b.id, me.id, JSON.stringify({ thirdParty: action.memberId, amount: action.amount }), now());
        status = update(b, {}, true);
        event(b.id, "wrong_recipient", me.id, action.amount, `Sent to ${first(action.memberId)} by mistake`, idem);
        notify({ userId: userOf(action.memberId), outingId: b.outing_id, type: "status", title: `Did you get ${formatPKR(action.amount)} from ${first(debtor)}?`, body: `${first(debtor)} says it was meant for ${first(creditor)}. Please confirm.`, link: `/balances?thirdParty=${b.id}` });
        notify({ userId: userOf(creditor), outingId: b.outing_id, type: "status", title: `${first(debtor)} paid ${first(action.memberId)} by mistake`, body: `We asked ${first(action.memberId)} to confirm. Reminders are paused.`, link });
        break;
      }
      case "third_party_confirm":
        throw bad("Use the third-party confirmation endpoint.");
    }
    return { status, balance: get<BalanceRow>("SELECT * FROM balances WHERE id = ?", b.id) };
  });
}

const REASONS: Record<string, string> = {
  wrong_amount: "Wrong amount",
  not_mine: "Not mine",
  already_paid: "Already paid",
  wrong_recipient: "Paid the wrong person",
  not_received: "Not received",
};
const RESOLUTIONS: Record<string, string> = {
  withdraw: "The dispute was withdrawn; the balance is back to its previous state.",
  paid: "Payment confirmed. The balance is closed.",
  maaf: "The creditor forgave the rest (Maaf).",
  edit: "The organizer will correct the expense and re-publish.",
};

/** G5: the third party confirms (or denies) receiving money meant for someone else. */
export function thirdPartyConfirm(balanceId: string, user: User, confirm: boolean) {
  const b = get<BalanceRow>("SELECT * FROM balances WHERE id = ?", balanceId);
  if (!b) throw notFound();
  const d = get<{ id: string; resolution: string }>("SELECT * FROM disputes WHERE balance_id = ? AND reason = 'wrong_recipient' AND status = 'open'", balanceId);
  if (!d) throw notFound("No open wrong-recipient case.");
  const info = JSON.parse(d.resolution) as { thirdParty: string; amount: number };
  const members = membersOf(b.outing_id, true);
  const me = members.find((m) => m.user_id === user.id && m.status === "active");
  if (!me || me.id !== info.thirdParty) throw forbidden("Only the person who received the money can confirm.");
  const first = (id: string) => (members.find((m) => m.id === id)?.name ?? "Someone").split(" ")[0];
  return tx(() => {
    if (!confirm) {
      run("UPDATE disputes SET resolution = ? WHERE id = ?", JSON.stringify({ ...info, denied: true }), d.id);
      run("INSERT INTO balance_events (id, balance_id, type, actor_member_id, amount, note, created_at) VALUES (?, ?, 'third_party_denied', ?, ?, ?, ?)", newId("be_"), b.id, me.id, info.amount, "Unconfirmed; organizer mediates", now());
      const org = members.find((m) => m.role === "organizer");
      notify({ userId: org?.user_id, outingId: b.outing_id, type: "status", title: "Wrong-recipient case needs you", body: `${first(me.id)} didn’t confirm receiving ${formatPKR(info.amount)}.`, link: `/balances?focus=${b.id}` });
      return { status: "disputed" as BalanceStatus };
    }
    // Correction entries: the debtor's debt is settled by the amount; the third party now owes the creditor.
    const amount = Math.min(info.amount, outstanding(b));
    run("UPDATE disputes SET status = 'resolved', resolution = ? WHERE id = ?", JSON.stringify({ ...info, confirmed: true }), d.id);
    const status = update(b, { confirmed: b.confirmed + amount, claimed: 0 }, false);
    run("INSERT INTO balance_events (id, balance_id, type, actor_member_id, amount, note, created_at) VALUES (?, ?, 'correction', ?, ?, ?, ?)", newId("be_"), b.id, me.id, amount, `${first(me.id)} received it on ${first(b.creditor_member_id)}’s behalf`, now());
    const nb = newId("b_");
    run(
      "INSERT INTO balances (id, outing_id, plan_id, debtor_member_id, creditor_member_id, amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?)",
      nb,
      b.outing_id,
      b.plan_id,
      me.id,
      b.creditor_member_id,
      amount,
      now(),
      now(),
    );
    run("INSERT INTO balance_events (id, balance_id, type, actor_member_id, amount, note, created_at) VALUES (?, ?, 'created', ?, ?, ?, ?)", newId("be_"), nb, me.id, amount, `Correction: ${first(me.id)} received ${first(b.debtor_member_id)}’s payment by mistake`, now());
    logActivity(b.outing_id, me.id, "correction", `${first(me.id)} confirmed receiving ${formatPKR(amount)} meant for ${first(b.creditor_member_id)}; correction entries added`);
    for (const id of [b.debtor_member_id, b.creditor_member_id])
      notify({ userId: members.find((m) => m.id === id)?.user_id, outingId: b.outing_id, type: "status", title: "Wrong-recipient fixed", body: `${first(me.id)} now owes ${first(b.creditor_member_id)} ${formatPKR(amount)}; ${first(b.debtor_member_id)}’s part is closed.`, link: `/balances` });
    return { status };
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function balanceDetail(balanceId: string, user: User) {
  const { b, me, role } = assertBalanceAccess(balanceId, user);
  const members = membersOf(b.outing_id, true);
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Former member";
  const events = all<{ type: string; actor_member_id: string | null; amount: number | null; note: string | null; created_at: string }>(
    "SELECT * FROM balance_events WHERE balance_id = ? ORDER BY created_at",
    b.id,
  ).map((e) => ({ ...e, actor: e.actor_member_id ? name(e.actor_member_id) : null }));
  const d = get<{ id: string; reason: string; status: string; opened_by_member_id: string; resolution: string | null }>("SELECT * FROM disputes WHERE balance_id = ? ORDER BY created_at DESC", b.id);
  const messages = d ? all<{ member_id: string; text: string; created_at: string }>("SELECT * FROM dispute_messages WHERE dispute_id = ? ORDER BY created_at", d.id).map((m) => ({ ...m, name: name(m.member_id) })) : [];
  // G4 disclosure: the creditor sees where a reminder would go (in-app always; WhatsApp only if the debtor opted in).
  const debtorUser = members.find((m) => m.id === b.debtor_member_id)?.user_id;
  const prefs = debtorUser ? get<{ whatsapp_enabled: number; t_reminder: number; t_request: number }>("SELECT whatsapp_enabled, t_reminder, t_request FROM notif_prefs WHERE user_id = ?", debtorUser) : undefined;
  const nextReminderAt = b.last_reminder_at ? new Date(new Date(b.last_reminder_at).getTime() + REMIND_GAP_MS).toISOString() : null;
  return {
    ...summarize(b, me, members, user),
    role,
    debtorReachable: { inApp: Boolean(debtorUser), whatsappReminder: role === "creditor" ? Boolean(prefs?.whatsapp_enabled && prefs.t_reminder) : null, whatsappRequest: role === "creditor" ? Boolean(prefs?.whatsapp_enabled && prefs.t_request) : null },
    nextReminderAt: nextReminderAt && new Date(nextReminderAt).getTime() > Date.now() ? nextReminderAt : null,
    otherMembers: members.filter((m) => m.status === "active" && m.id !== b.debtor_member_id && m.id !== b.creditor_member_id).map((m) => ({ id: m.id, name: m.name })),
    events,
    dispute: d ? { ...d, openedBy: name(d.opened_by_member_id), messages } : null,
  };
}

function summarize(b: BalanceRow, me: Member, members: Member[], user: User) {
  const outing = getOuting(b.outing_id);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "Former member";
  const threshold = get<{ threshold: number }>("SELECT threshold FROM users WHERE id = ?", user.id)!.threshold;
  const left = outstanding(b);
  const iAmCreditor = me.id === b.creditor_member_id;
  return {
    id: b.id,
    version: b.version,
    outing: { id: outing.id, name: outing.name, banner: outing.banner, logoType: outing.logo_type, status: outing.status },
    debtor: { id: b.debtor_member_id, name: name(b.debtor_member_id), color: members.find((m) => m.id === b.debtor_member_id)?.color ?? "ink" },
    creditor: { id: b.creditor_member_id, name: name(b.creditor_member_id), color: members.find((m) => m.id === b.creditor_member_id)?.color ?? "ink" },
    direction: iAmCreditor ? ("owed" as const) : me.id === b.debtor_member_id ? ("owe" as const) : ("other" as const),
    amount: b.amount,
    claimed: b.claimed,
    confirmed: b.confirmed,
    forgiven: b.forgiven,
    outstanding: left,
    status: b.status,
    superseded: Boolean(b.superseded),
    lastReminderAt: b.last_reminder_at,
    quickChoice: iAmCreditor && left > 0 && left - b.claimed > 0 && left < threshold && b.status !== "disputed",
    threshold,
    updatedAt: b.updated_at,
  };
}

export function myBalances(user: User) {
  const rows = all<BalanceRow & { member_id: string }>(
    `SELECT b.*, m.id AS member_id FROM balances b
     JOIN members m ON m.outing_id = b.outing_id AND m.user_id = ? AND m.status IN ('active','left')
     WHERE b.superseded = 0 AND (b.debtor_member_id = m.id OR b.creditor_member_id = m.id)
     ORDER BY b.updated_at DESC`,
    user.id,
  );
  const byOuting = new Map<string, Member[]>();
  return rows.map((r) => {
    if (!byOuting.has(r.outing_id)) byOuting.set(r.outing_id, membersOf(r.outing_id, true));
    const members = byOuting.get(r.outing_id)!;
    const me = members.find((m) => m.id === r.member_id)!;
    return summarize(r, me, members, user);
  });
}

/** Simulated WhatsApp interactive buttons (H4). Validated against the live ledger, idempotent. */
export function pressWhatsAppButton(messageId: string, user: User, button: "Wusool" | "Maaf") {
  const msg = get<{ id: string; to_user_id: string; balance_id: string | null; response: string | null }>("SELECT * FROM wa_messages WHERE id = ?", messageId);
  if (!msg || msg.to_user_id !== user.id) throw notFound();
  if (msg.response) return { reply: "Already handled ✓ Nothing changed.", alreadyHandled: true };
  if (!msg.balance_id) throw bad("This message has no actions.");
  const b = get<BalanceRow>("SELECT * FROM balances WHERE id = ?", msg.balance_id);
  if (!b || b.superseded || outstanding(b) - b.claimed <= 0) {
    run("UPDATE wa_messages SET response = ? WHERE id = ?", `${button} (stale)`, msg.id);
    return { reply: "This balance was already paid or changed. Nothing was applied. Open Wusool to see the latest.", alreadyHandled: true };
  }
  if (button === "Maaf") {
    // Maaf always needs explicit confirmation in the app (H4).
    run("UPDATE wa_messages SET response = ? WHERE id = ?", "Maaf → confirm in app", msg.id);
    return { reply: "Tap to confirm Maaf in Wusool. Nothing is forgiven until you confirm.", confirmLink: `/balances?focus=${b.id}&maaf=1` };
  }
  performAction(b.id, user, { type: "wusool" }, { idempotencyKey: `wa:${msg.id}` });
  run("UPDATE wa_messages SET response = ? WHERE id = ?", "Wusool", msg.id);
  return { reply: "Done. We sent the request in-app (and on WhatsApp only if they opted in)." };
}

/** All current balances in one outing (amounts and statuses only; no item details). */
export function outingBalances(outingId: string, user: User) {
  const members = membersOf(outingId, true);
  const me = members.find((m) => m.user_id === user.id && m.status === "active");
  if (!me) throw forbidden("You’re not a member of this outing.");
  return all<BalanceRow>("SELECT * FROM balances WHERE outing_id = ? AND superseded = 0 ORDER BY amount DESC", outingId).map((b) => summarize(b, me, members, user));
}
