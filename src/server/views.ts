import "server-only";
import { all, get, now, run, tx } from "./db";
import { activeInvite, getOuting, initials, membersOf, memberForUser, requireMember, type Member } from "./outings";
import { listEvidence, loadExpenses } from "./expenses";
import { latestNarrative, listQuestions } from "./pipeline";
import { latestPlan, outingSummaryForMember } from "./settlement";
import { claudeAvailable } from "./ai/claude";
import { geminiAvailable } from "./ai/gemini";
import { sttEngine } from "./ai/transcribe";
import { WHATSAPP_INTEGRATION_CONFIGURED } from "./notify";
import type { User } from "./auth";
import type { ParsedReceipt } from "@/lib/interpret/receipt";

export function publicMember(m: Member) {
  return { id: m.id, name: m.name, initials: initials(m.name), color: m.color, kind: m.kind, status: m.status, role: m.role, isUser: Boolean(m.user_id), claimPending: Boolean(m.claim_user_id), noBankAccount: Boolean(m.no_bank_account), muted: Boolean(m.muted), createdAt: m.created_at };
}

export function homeView(user: User) {
  const rows = all<{ id: string; member_id: string; role: string }>(
    "SELECT o.id, m.id AS member_id, m.role FROM outings o JOIN members m ON m.outing_id = o.id WHERE m.user_id = ? AND m.status = 'active' ORDER BY o.created_at DESC",
    user.id,
  );
  const outings = rows.map((r) => {
    const o = getOuting(r.id);
    const members = membersOf(o.id);
    const organizer = members.find((m) => m.role === "organizer");
    const money = outingSummaryForMember(o.id, r.member_id);
    const receipts = get<{ n: number }>("SELECT COUNT(*) AS n FROM evidence WHERE outing_id = ?", o.id)!.n;
    return {
      id: o.id,
      seq: o.seq,
      name: o.name,
      banner: o.banner,
      logoType: o.logo_type,
      logoValue: o.logo_value,
      date: o.date,
      place: o.place,
      status: o.status,
      isSample: Boolean(o.is_sample),
      organizerName: organizer?.name.split(" ")[0] ?? "",
      members: members.slice(0, 3).map(publicMember),
      memberCount: members.length,
      receipts,
      money,
    };
  });
  const active = outings.filter((o) => o.status === "active" && !o.money.settled).length;
  const settled = outings.filter((o) => o.money.settled || o.status === "archived").length;
  const unread = get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0", user.id)!.n;
  const nextSeq = (get<{ n: number }>("SELECT COUNT(*) AS n FROM outings WHERE organizer_user_id = ?", user.id)?.n ?? 0) + 1;
  return { user: { id: user.id, name: user.name, color: user.color, initials: initials(user.name) }, outings, counts: { active, settled }, unread, nextSeq };
}

export function outingView(outingId: string, user: User) {
  const { outing, me } = requireMember(outingId, user);
  const all_ = membersOf(outingId, true);
  const members = all_.filter((m) => m.status === "active");
  const pending = me.role === "organizer" ? all_.filter((m) => m.status === "pending") : [];
  const evidence = listEvidence(outingId);
  const plan = latestPlan(outingId);
  // J2: after publishing, items that belong only to a member who chose "hide my items" are
  // shown to other members as "Private item" (the organizer still sees them to correct mistakes).
  const hiders = new Set(
    all_.filter((m) => m.user_id && m.id !== me.id && get<{ hide_items: number }>("SELECT hide_items FROM users WHERE id = ?", m.user_id)?.hide_items).map((m) => m.id),
  );
  const expenses = loadExpenses(outingId).map((e) =>
    plan && me.role !== "organizer"
      ? { ...e, items: e.items.map((i) => (i.shares.length === 1 && hiders.has(i.shares[0].memberId) ? { ...i, name: "Private item", raw: null } : i)) }
      : e,
  );
  const invite = activeInvite(outingId);
  const questions = listQuestions(outingId);
  const narrative = latestNarrative(outingId);
  const transfers = all<{ id: string; from_member: string; to_member: string; amount: number; on_behalf_of: string | null; kind: string; source: string; balance_id: string | null }>(
    "SELECT * FROM transfers WHERE outing_id = ? ORDER BY created_at",
    outingId,
  );
  const activity = all<{ text: string; created_at: string; type: string }>("SELECT text, created_at, type FROM activity WHERE outing_id = ? ORDER BY created_at DESC LIMIT 40", outingId);
  const unread = get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0", user.id)!.n;
  return {
    me: publicMember(me),
    unread,
    outing: {
      id: outing.id,
      seq: outing.seq,
      name: outing.name,
      banner: outing.banner,
      logoType: outing.logo_type,
      logoValue: outing.logo_value,
      date: outing.date,
      place: outing.place,
      status: outing.status,
      isSample: Boolean(outing.is_sample),
      allocation: outing.allocation,
      routing: outing.routing,
      rules: JSON.parse(outing.rules || "{}"),
      draftRev: outing.draft_rev,
      organizerName: members.find((m) => m.role === "organizer")?.name ?? "",
    },
    invite: invite ? { token: invite.token, expiresAt: invite.expires_at, requireApproval: Boolean(invite.require_approval) } : null,
    members: members.map(publicMember),
    pending: pending.map(publicMember),
    evidence: evidence.map((e) => {
      const parsed = e.parsed ? (JSON.parse(e.parsed) as ParsedReceipt) : null;
      return {
        id: e.id,
        kind: e.kind,
        name: e.original_name,
        payerMemberId: e.payer_member_id,
        status: e.status,
        engine: e.engine,
        vendor: parsed?.vendor ?? parsed?.provider ?? null,
        total: parsed?.total ?? null,
        notes: parsed?.notes ?? [],
        ocrText: e.ocr_text,
        expenseId: expenses.find((x) => x.evidenceId === e.id)?.id ?? null,
        createdAt: e.created_at,
      };
    }),
    expenses,
    transfers: transfers.map((t) => ({ id: t.id, from: t.from_member, to: t.to_member, amount: t.amount, onBehalfOf: t.on_behalf_of, kind: t.kind, source: t.source, settlement: Boolean(t.balance_id) })),
    questions,
    narrative,
    plan: plan ? { version: plan.version, publishedAt: plan.published_at, allocation: plan.allocation, routing: plan.routing, draftRev: (JSON.parse(plan.snapshot) as { draftRev: number }).draftRev } : null,
    money: outingSummaryForMember(outingId, me.id),
    activity,
    capabilities: capabilities(),
  };
}

export function capabilities() {
  return {
    ocr: claudeAvailable() ? "claude-vision" : geminiAvailable() ? "gemini-vision" : "tesseract",
    interpreter: claudeAvailable() ? "claude" : geminiAvailable() ? "gemini" : "rules",
    stt: sttEngine(),
    whatsapp: WHATSAPP_INTEGRATION_CONFIGURED ? "configured" : "simulated",
    sms: "prototype-code-on-screen",
  };
}

export function profileView(user: User) {
  const prefs = get<Record<string, number | string | null>>("SELECT * FROM notif_prefs WHERE user_id = ?", user.id)!;
  return {
    user: { id: user.id, name: user.name, phone: maskPhone(user.phone), color: user.color, initials: initials(user.name), threshold: user.threshold, hideItems: Boolean(user.hide_items), receiptVisibility: user.receipt_visibility, onboarded: Boolean(user.onboarded) },
    prefs: {
      whatsappEnabled: Boolean(prefs.whatsapp_enabled),
      whatsappVerified: Boolean(prefs.whatsapp_verified),
      breakdown: Boolean(prefs.t_breakdown),
      request: Boolean(prefs.t_request),
      reminder: Boolean(prefs.t_reminder),
      wusoolMaaf: Boolean(prefs.t_wusool_maaf),
      consentAt: prefs.consent_at,
    },
    capabilities: capabilities(),
  };
}

const maskPhone = (p: string) => p.slice(0, 4) + " ••• ••" + p.slice(-3);

export const CONSENT_TEXT =
  "Wusool may send you WhatsApp messages about outings you’re in: your breakdowns, payment requests, reminders and Wusool/Maaf updates, only for the types you choose. Messages come from Wusool, never more than one reminder per balance every 48 hours. Turn this off any time in Settings; it applies to future messages.";

export function updatePrefs(
  user: User,
  input: { threshold?: number; hideItems?: boolean; receiptVisibility?: "members" | "payer_organizer"; whatsappEnabled?: boolean; consent?: boolean; verified?: boolean; types?: Partial<Record<"breakdown" | "request" | "reminder" | "wusoolMaaf", boolean>>; name?: string; onboarded?: boolean },
) {
  if (input.threshold !== undefined) {
    if (!Number.isInteger(input.threshold) || input.threshold < 0 || input.threshold > 500000) throw new Error("THRESHOLD_RANGE");
    run("UPDATE users SET threshold = ? WHERE id = ?", input.threshold, user.id);
  }
  if (input.hideItems !== undefined) run("UPDATE users SET hide_items = ? WHERE id = ?", input.hideItems ? 1 : 0, user.id);
  if (input.receiptVisibility) run("UPDATE users SET receipt_visibility = ? WHERE id = ?", input.receiptVisibility, user.id);
  if (input.name !== undefined && input.name.trim()) run("UPDATE users SET name = ? WHERE id = ?", input.name.trim().slice(0, 40), user.id);
  if (input.onboarded) run("UPDATE users SET onboarded = 1 WHERE id = ?", user.id);
  if (input.whatsappEnabled === false) run("UPDATE notif_prefs SET whatsapp_enabled = 0 WHERE user_id = ?", user.id);
  if (input.whatsappEnabled === true) {
    // Turning ON is deliberate: it requires explicit consent to the shown text (H1).
    if (!input.consent) throw new Error("CONSENT_REQUIRED");
    run("UPDATE notif_prefs SET whatsapp_enabled = 1, whatsapp_verified = 1, consent_at = ?, consent_text = ? WHERE user_id = ?", now(), CONSENT_TEXT, user.id);
  }
  if (input.types) {
    const map = { breakdown: "t_breakdown", request: "t_request", reminder: "t_reminder", wusoolMaaf: "t_wusool_maaf" } as const;
    for (const [k, v] of Object.entries(input.types)) if (v !== undefined) run(`UPDATE notif_prefs SET ${map[k as keyof typeof map]} = ? WHERE user_id = ?`, v ? 1 : 0, user.id);
  }
}

export function inboxView(user: User) {
  const items = all<{ id: string; outing_id: string | null; type: string; title: string; body: string; link: string | null; read: number; created_at: string }>(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    user.id,
  );
  const names = new Map<string, string>();
  for (const i of items) if (i.outing_id && !names.has(i.outing_id)) names.set(i.outing_id, get<{ name: string }>("SELECT name FROM outings WHERE id = ?", i.outing_id)?.name ?? "");
  return items.map((i) => ({ ...i, read: Boolean(i.read), outingName: i.outing_id ? names.get(i.outing_id) : null }));
}

export function markRead(user: User, ids?: string[]) {
  if (ids?.length) for (const id of ids) run("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", id, user.id);
  else run("UPDATE notifications SET read = 1 WHERE user_id = ?", user.id);
}

export function whatsappSimView(user: User) {
  return all<{ id: string; outing_id: string | null; balance_id: string | null; type: string; text: string; buttons: string | null; status: string; response: string | null; created_at: string }>(
    "SELECT * FROM wa_messages WHERE to_user_id = ? ORDER BY created_at",
    user.id,
  ).map((m) => ({ ...m, buttons: m.buttons ? (JSON.parse(m.buttons) as string[]) : [] }));
}

export function membershipState(outingId: string, user: User) {
  const m = memberForUser(outingId, user.id);
  return m ? m.status : null;
}

/** J2: delete account. Blocked with open balances; ledger entries are anonymised, never removed. */
export function deleteAccount(user: User): { ok: true } | { blocked: number } {
  const open = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM balances b JOIN members m ON m.outing_id = b.outing_id AND m.user_id = ?
     WHERE b.superseded = 0 AND b.status NOT IN ('confirmed','maaf') AND (b.debtor_member_id = m.id OR b.creditor_member_id = m.id)`,
    user.id,
  )!.n;
  if (open > 0) return { blocked: open };
  tx(() => {
    run("UPDATE members SET name = 'Deleted user', status = CASE WHEN status = 'active' THEN 'left' ELSE status END WHERE user_id = ?", user.id);
    run("UPDATE users SET name = 'Deleted user', phone = ? WHERE id = ?", `deleted:${user.id}`, user.id);
    run("DELETE FROM sessions WHERE user_id = ?", user.id);
    run("DELETE FROM notifications WHERE user_id = ?", user.id);
    run("DELETE FROM wa_messages WHERE to_user_id = ?", user.id);
    run("UPDATE notif_prefs SET whatsapp_enabled = 0, consent_at = NULL, consent_text = NULL WHERE user_id = ?", user.id);
  });
  return { ok: true };
}
