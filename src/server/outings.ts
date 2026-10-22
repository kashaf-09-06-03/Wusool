import "server-only";
import crypto from "node:crypto";
import { all, get, newId, now, run, tx } from "./db";
import { bad, conflict, forbidden, notFound, AppError } from "./http";
import { logActivity, notify } from "./notify";
import { pickColor, type User } from "./auth";

export interface Member {
  id: string;
  outing_id: string;
  user_id: string | null;
  name: string;
  kind: "joined" | "manual";
  status: "active" | "pending" | "left" | "removed" | "declined";
  role: "organizer" | "member";
  added_by_member_id: string | null;
  claim_user_id: string | null;
  color: string;
  no_bank_account: number;
  muted: number;
  created_at: string;
}
export interface Outing {
  id: string;
  seq: number;
  name: string;
  organizer_user_id: string;
  banner: string;
  logo_type: string;
  logo_value: string | null;
  date: string | null;
  place: string | null;
  status: "active" | "archived";
  allocation: "actual" | "equal";
  routing: "original" | "optimized";
  rules: string;
  draft_rev: number;
  is_sample: number;
  created_at: string;
}
export interface Invite {
  id: string;
  outing_id: string;
  token: string;
  expires_at: string | null;
  require_approval: number;
  revoked_at: string | null;
}

export const BANNERS = ["sea", "chai", "bowl", "pink"] as const;
export const LOGOS = ["cup3d", "star3d", "initial", "sticker", "upload"] as const;

const MAX_NAME = 40;
const TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function makeToken(): string {
  const bytes = crypto.randomBytes(7);
  const chars = [...bytes].map((b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join("");
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

export function getOuting(id: string): Outing {
  const o = get<Outing>("SELECT * FROM outings WHERE id = ?", id);
  if (!o) throw notFound("This outing doesn’t exist.");
  return o;
}

export function membersOf(outingId: string, includeInactive = false): Member[] {
  return all<Member>(
    `SELECT * FROM members WHERE outing_id = ? ${includeInactive ? "" : "AND status = 'active'"} ORDER BY CASE role WHEN 'organizer' THEN 0 ELSE 1 END, created_at`,
    outingId,
  );
}

export function memberForUser(outingId: string, userId: string): Member | undefined {
  return get<Member>("SELECT * FROM members WHERE outing_id = ? AND user_id = ? ORDER BY created_at DESC", outingId, userId);
}

export function requireMember(outingId: string, user: User): { outing: Outing; me: Member } {
  const outing = getOuting(outingId);
  const me = memberForUser(outingId, user.id);
  if (!me || me.status !== "active") throw forbidden("You’re not a member of this outing.");
  return { outing, me };
}

export function requireOrganizer(outingId: string, user: User) {
  const r = requireMember(outingId, user);
  if (r.me.role !== "organizer") throw forbidden("Only the organizer can do this.");
  return r;
}

export function activeInvite(outingId: string): Invite | undefined {
  return get<Invite>("SELECT * FROM invites WHERE outing_id = ? AND revoked_at IS NULL ORDER BY created_at DESC", outingId);
}

/** B1: create with an automatic name ("Outing 003") so the organizer never has to type. */
export function createOuting(user: User, input: { name?: string; banner?: string; logoType?: string; logoValue?: string | null; date?: string | null; place?: string | null; isSample?: boolean }) {
  return tx(() => {
    const seq = (get<{ n: number }>("SELECT COUNT(*) AS n FROM outings WHERE organizer_user_id = ?", user.id)?.n ?? 0) + 1;
    const autoName = `Outing ${String(seq).padStart(3, "0")}`;
    const name = (input.name ?? "").trim().slice(0, MAX_NAME) || autoName;
    const id = newId("o_");
    run(
      "INSERT INTO outings (id, seq, name, organizer_user_id, banner, logo_type, logo_value, date, place, is_sample, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      seq,
      name,
      user.id,
      input.banner ?? "sea",
      input.logoType ?? "cup3d",
      input.logoValue ?? null,
      input.date ?? null,
      input.place ?? null,
      input.isSample ? 1 : 0,
      now(),
    );
    const memberId = newId("m_");
    run(
      "INSERT INTO members (id, outing_id, user_id, name, kind, status, role, color, created_at) VALUES (?, ?, ?, ?, 'joined', 'active', 'organizer', ?, ?)",
      memberId,
      id,
      user.id,
      user.name,
      user.color,
      now(),
    );
    const expires = new Date(Date.now() + 7 * 864e5).toISOString();
    run("INSERT INTO invites (id, outing_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", newId("i_"), id, makeToken(), expires, now());
    logActivity(id, memberId, "created", `${user.name} created ${name}`);
    return { id, seq, autoName, name };
  });
}

/** B2: rename (organizer only, 1–40 characters, audited). Empty restores the auto name. */
export function renameOuting(outingId: string, user: User, rawName: string) {
  const { outing, me } = requireOrganizer(outingId, user);
  const auto = `Outing ${String(outing.seq).padStart(3, "0")}`;
  const name = rawName.trim();
  if (name.length > MAX_NAME) throw bad(`Keep it under ${MAX_NAME} characters.`, "NAME_TOO_LONG");
  const finalName = name || auto;
  if (finalName === outing.name) return { name: finalName };
  run("UPDATE outings SET name = ? WHERE id = ?", finalName, outingId);
  logActivity(outingId, me.id, "renamed", `${me.name} renamed ${outing.name} → ${finalName}`);
  return { name: finalName };
}

export function updateHeader(outingId: string, user: User, input: { banner?: string; logoType?: string; logoValue?: string | null; date?: string | null; place?: string | null }) {
  const { me } = requireOrganizer(outingId, user);
  if (input.banner && !BANNERS.includes(input.banner as (typeof BANNERS)[number]) && !input.banner.startsWith("photo:") && !input.banner.startsWith("upload:"))
    throw bad("Unknown banner.");
  if (input.logoType && !LOGOS.includes(input.logoType as (typeof LOGOS)[number])) throw bad("Unknown logo.");
  const o = getOuting(outingId);
  run(
    "UPDATE outings SET banner = ?, logo_type = ?, logo_value = ?, date = ?, place = ? WHERE id = ?",
    input.banner ?? o.banner,
    input.logoType ?? o.logo_type,
    input.logoValue !== undefined ? input.logoValue : o.logo_value,
    input.date !== undefined ? input.date : o.date,
    input.place !== undefined ? input.place : o.place,
    outingId,
  );
  logActivity(outingId, me.id, "header", `${me.name} updated the outing header`);
}

// ---------------------------------------------------------------------------
// Invite links (B4, B5)
// ---------------------------------------------------------------------------

export function inviteSettings(outingId: string, user: User, input: { expiry?: "24h" | "7d" | "settled"; requireApproval?: boolean }) {
  requireOrganizer(outingId, user);
  const inv = activeInvite(outingId);
  if (!inv) throw notFound("No active link.");
  let expires = inv.expires_at;
  if (input.expiry === "24h") expires = new Date(Date.now() + 864e5).toISOString();
  if (input.expiry === "7d") expires = new Date(Date.now() + 7 * 864e5).toISOString();
  if (input.expiry === "settled") expires = null;
  run(
    "UPDATE invites SET expires_at = ?, require_approval = ? WHERE id = ?",
    expires,
    input.requireApproval === undefined ? inv.require_approval : input.requireApproval ? 1 : 0,
    inv.id,
  );
  return activeInvite(outingId);
}

export function regenerateInvite(outingId: string, user: User) {
  const { me } = requireOrganizer(outingId, user);
  return tx(() => {
    const old = activeInvite(outingId);
    run("UPDATE invites SET revoked_at = ? WHERE outing_id = ? AND revoked_at IS NULL", now(), outingId);
    run(
      "INSERT INTO invites (id, outing_id, token, expires_at, require_approval, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      newId("i_"),
      outingId,
      makeToken(),
      old?.expires_at === null ? null : new Date(Date.now() + 7 * 864e5).toISOString(),
      old?.require_approval ?? 0,
      now(),
    );
    logActivity(outingId, me.id, "link_revoked", `${me.name} revoked the old invite link`);
    return activeInvite(outingId)!;
  });
}

export type LinkStatus = "valid" | "revoked" | "expired" | "missing";

export function resolveInvite(token: string): { status: LinkStatus; invite?: Invite; outing?: Outing } {
  const inv = get<Invite>("SELECT * FROM invites WHERE token = ?", token);
  if (!inv) return { status: "missing" };
  const outing = getOuting(inv.outing_id);
  if (inv.revoked_at) return { status: "revoked", invite: inv, outing };
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return { status: "expired", invite: inv, outing };
  return { status: "valid", invite: inv, outing };
}

/** Public preview (C1): header, organizer, member count. Never expenses. */
export function invitePreview(token: string) {
  const r = resolveInvite(token);
  if (!r.outing) return { status: r.status };
  const o = r.outing;
  const members = membersOf(o.id);
  const organizer = members.find((m) => m.role === "organizer");
  return {
    status: r.status,
    outing: {
      id: o.id,
      seq: o.seq,
      name: o.name,
      banner: o.banner,
      logoType: o.logo_type,
      logoValue: o.logo_value,
      date: o.date,
      place: o.place,
      organizerName: organizer?.name ?? "the organizer",
      memberCount: members.length,
      memberInitials: members.slice(0, 3).map((m) => ({ initials: initials(m.name), color: m.color })),
      requireApproval: Boolean(r.invite?.require_approval),
    },
  };
}

export function requestNewLink(token: string, user: User) {
  const r = resolveInvite(token);
  if (!r.outing) throw notFound();
  const org = membersOf(r.outing.id).find((m) => m.role === "organizer");
  notify({ userId: org?.user_id, outingId: r.outing.id, type: "member", title: "Someone needs a new invite link", body: `${user.name} tried an expired link to ${r.outing.name}.`, link: `/o/${r.outing.id}/invite` });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function normName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function similar(a: string, b: string) {
  const x = normName(a);
  const y = normName(b);
  return x === y || x.split(" ")[0] === y.split(" ")[0];
}

export type JoinResult =
  | { state: "joined"; outingId: string }
  | { state: "already"; outingId: string }
  | { state: "pending"; outingId: string }
  | { state: "claim"; outingId: string; guest: { id: string; name: string; addedBy: string } }
  | { state: "name_taken"; suggestion: string };

/** C1/C2: join via link. Phone verification has already happened (session exists). */
export function joinViaLink(token: string, user: User, input: { name: string; claimGuestId?: string | null; notMe?: boolean }): JoinResult {
  const r = resolveInvite(token);
  if (r.status === "revoked") throw new AppError(410, "LINK_REVOKED", "This link was turned off. Ask the organizer for a new link.");
  if (r.status === "expired") throw new AppError(410, "LINK_EXPIRED", "This link has expired.");
  if (r.status !== "valid" || !r.outing || !r.invite) throw notFound("This invite link doesn’t exist.");
  const outing = r.outing;
  const invite = r.invite;
  const name = input.name.trim().slice(0, MAX_NAME);
  if (!name) throw bad("Tell your friends who you are: add your name.", "NAME_REQUIRED");

  return tx(() => {
    const existing = memberForUser(outing.id, user.id);
    if (existing?.status === "active") return { state: "already", outingId: outing.id } as const;
    if (existing?.status === "pending") return { state: "pending", outingId: outing.id } as const;
    if (existing?.status === "removed") throw forbidden("The organizer removed you from this outing.");

    const members = membersOf(outing.id);
    // C2: someone added by hand with a similar name may be this person.
    const guest = members.find((m) => m.kind === "manual" && !m.user_id && similar(m.name, name));
    if (guest && !input.notMe && input.claimGuestId !== guest.id) {
      const adder = members.find((m) => m.id === guest.added_by_member_id);
      return { state: "claim", outingId: outing.id, guest: { id: guest.id, name: guest.name, addedBy: adder?.name ?? "the organizer" } } as const;
    }
    if (input.claimGuestId && guest && input.claimGuestId === guest.id) {
      run("UPDATE members SET claim_user_id = ? WHERE id = ?", user.id, guest.id);
      const org = members.find((m) => m.role === "organizer");
      notify({
        userId: org?.user_id,
        outingId: outing.id,
        type: "member",
        title: "Claim request",
        body: `${name} says they are “${guest.name}” (added by hand). Confirm to merge.`,
        link: `/o/${outing.id}?tab=members`,
      });
    }
    // Duplicate display names among joined members: suggest an initial.
    if (members.some((m) => m.kind === "joined" && normName(m.name) === normName(name)) && !input.claimGuestId) {
      const parts = user.name.trim().split(/\s+/);
      const suggestion = `${name.split(" ")[0]} ${(parts[1]?.[0] ?? user.phone.slice(-1)).toUpperCase()}.`;
      return { state: "name_taken", suggestion } as const;
    }

    const status = invite.require_approval || input.claimGuestId ? "pending" : "active";
    const id = newId("m_");
    run(
      "INSERT INTO members (id, outing_id, user_id, name, kind, status, role, color, created_at) VALUES (?, ?, ?, ?, 'joined', ?, 'member', ?, ?)",
      id,
      outing.id,
      user.id,
      name,
      status,
      user.color,
      now(),
    );
    const org = members.find((m) => m.role === "organizer");
    if (status === "active") {
      logActivity(outing.id, id, "joined", `${name} joined via link`);
      notify({ userId: org?.user_id, outingId: outing.id, type: "member", title: `${name} joined ${outing.name}`, body: "Joined via your invite link.", link: `/o/${outing.id}?tab=members` });
      return { state: "joined", outingId: outing.id } as const;
    }
    if (!input.claimGuestId)
      notify({ userId: org?.user_id, outingId: outing.id, type: "member", title: "Join request", body: `${name} wants to join ${outing.name}.`, link: `/o/${outing.id}?tab=members` });
    return { state: "pending", outingId: outing.id } as const;
  });
}

// ---------------------------------------------------------------------------
// Members (B4 manual add, D1 manage, D2 leave)
// ---------------------------------------------------------------------------

export function addManualMember(outingId: string, user: User, input: { name: string; force?: boolean }) {
  const { me } = requireMember(outingId, user);
  const name = input.name.trim().slice(0, MAX_NAME);
  if (!name) throw bad("Add a name.", "NAME_REQUIRED");
  const dup = membersOf(outingId).find((m) => similar(m.name, name));
  if (dup && !input.force) throw conflict(`${dup.name} is already in this outing. Same person?`, "POSSIBLE_DUPLICATE", { memberId: dup.id, name: dup.name });
  const id = newId("m_");
  run(
    "INSERT INTO members (id, outing_id, name, kind, status, role, added_by_member_id, color, created_at) VALUES (?, ?, ?, 'manual', 'active', 'member', ?, ?, ?)",
    id,
    outingId,
    name,
    me.id,
    pickColor(id),
    now(),
  );
  bumpDraft(outingId);
  logActivity(outingId, me.id, "manual_add", `${me.name} added ${name} by hand`);
  return { id, name };
}

export function decideMember(outingId: string, user: User, memberId: string, decision: "approve" | "decline") {
  const { me } = requireOrganizer(outingId, user);
  const m = get<Member>("SELECT * FROM members WHERE id = ? AND outing_id = ?", memberId, outingId);
  if (!m || m.status !== "pending") throw notFound("No pending request.");
  return tx(() => {
    // A claim (C2): merge the joiner into the manual guest entry so items and balances carry over.
    const guest = get<Member>("SELECT * FROM members WHERE outing_id = ? AND claim_user_id = ? AND kind = 'manual'", outingId, m.user_id);
    if (decision === "approve" && guest) {
      run("UPDATE members SET user_id = ?, kind = 'joined', name = ?, claim_user_id = NULL, color = ? WHERE id = ?", m.user_id, m.name, m.color, guest.id);
      run("DELETE FROM members WHERE id = ?", m.id);
      logActivity(outingId, me.id, "claim_merged", `${me.name} confirmed ${m.name} is ${guest.name}; their items moved over`);
      notify({ userId: m.user_id, outingId, type: "member", title: "You’re in", body: `You were matched to “${guest.name}”.`, link: `/o/${outingId}` });
      return;
    }
    if (decision === "decline" && guest) run("UPDATE members SET claim_user_id = NULL WHERE id = ?", guest.id);
    run("UPDATE members SET status = ? WHERE id = ?", decision === "approve" ? "active" : "declined", m.id);
    logActivity(outingId, me.id, decision === "approve" ? "approved" : "declined", `${me.name} ${decision === "approve" ? "approved" : "declined"} ${m.name}`);
    notify({
      userId: m.user_id,
      outingId,
      type: "member",
      title: decision === "approve" ? "You’re in" : "Request declined",
      body: decision === "approve" ? `You joined the outing.` : "The organizer declined this request. No outing details are shared.",
      link: decision === "approve" ? `/o/${outingId}` : undefined,
    });
  });
}

export function renameMember(outingId: string, user: User, memberId: string, name: string) {
  const { me, outing } = requireMember(outingId, user);
  const m = get<Member>("SELECT * FROM members WHERE id = ? AND outing_id = ?", memberId, outingId);
  if (!m) throw notFound();
  if (me.role !== "organizer" && m.id !== me.id) throw forbidden("Only the organizer can rename other people.");
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) throw bad("Add a name.");
  run("UPDATE members SET name = ? WHERE id = ?", clean, memberId);
  logActivity(outing.id, me.id, "member_renamed", `${me.name} renamed ${m.name} → ${clean}`);
}

export function setNoBankAccount(outingId: string, user: User, memberId: string, value: boolean) {
  const { me } = requireMember(outingId, user);
  if (me.role !== "organizer" && me.id !== memberId) throw forbidden();
  run("UPDATE members SET no_bank_account = ? WHERE id = ? AND outing_id = ?", value ? 1 : 0, memberId, outingId);
  bumpDraft(outingId);
}

/** Members with expense items, payments or open balances can't be silently removed (D1). */
export function memberHasLedgerEntries(outingId: string, memberId: string): boolean {
  const q = (sql: string) => (get<{ n: number }>(sql, memberId, outingId)?.n ?? 0) > 0;
  return (
    q("SELECT COUNT(*) AS n FROM item_shares s JOIN items i ON i.id = s.item_id JOIN expenses e ON e.id = i.expense_id WHERE s.member_id = ? AND e.outing_id = ?") ||
    q("SELECT COUNT(*) AS n FROM expense_payers p JOIN expenses e ON e.id = p.expense_id WHERE p.member_id = ? AND e.outing_id = ?") ||
    openBalanceCount(outingId, memberId) > 0
  );
}

export function openBalanceCount(outingId: string, memberId: string): number {
  return (
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM balances WHERE outing_id = ? AND superseded = 0 AND status NOT IN ('confirmed','maaf') AND (debtor_member_id = ? OR creditor_member_id = ?)",
      outingId,
      memberId,
      memberId,
    )?.n ?? 0
  );
}

export function removeMember(outingId: string, user: User, memberId: string) {
  const { me } = requireOrganizer(outingId, user);
  const m = get<Member>("SELECT * FROM members WHERE id = ? AND outing_id = ?", memberId, outingId);
  if (!m) throw notFound();
  if (m.role === "organizer") throw bad("The organizer can’t be removed.");
  if (memberHasLedgerEntries(outingId, memberId))
    throw conflict(`${m.name} has items or balances. Reassign their items, or settle / Maaf first.`, "HAS_ENTRIES");
  run("UPDATE members SET status = 'removed' WHERE id = ?", memberId);
  logActivity(outingId, me.id, "removed", `${me.name} removed ${m.name}`);
  notify({ userId: m.user_id, outingId, type: "member", title: "Removed from an outing", body: "You no longer have access to this outing." });
}

/** D1 merge: move everything from `fromId` into `intoId`, keep one entry, audited. */
export function mergeMembers(outingId: string, user: User, intoId: string, fromId: string) {
  const { me } = requireOrganizer(outingId, user);
  if (intoId === fromId) throw bad("Pick two different people.");
  const into = get<Member>("SELECT * FROM members WHERE id = ? AND outing_id = ?", intoId, outingId);
  const from = get<Member>("SELECT * FROM members WHERE id = ? AND outing_id = ?", fromId, outingId);
  if (!into || !from) throw notFound();
  if (into.user_id && from.user_id) throw bad("Both entries belong to signed-in people; they can’t be merged.");
  if (get<{ n: number }>("SELECT COUNT(*) AS n FROM balances WHERE outing_id = ? AND superseded = 0 AND (debtor_member_id IN (?, ?) OR creditor_member_id IN (?, ?))", outingId, intoId, fromId, intoId, fromId)!.n > 0)
    throw conflict("Merge before publishing: these people already have published balances.", "HAS_BALANCES");
  tx(() => {
    run("UPDATE item_shares SET member_id = ? WHERE member_id = ?", intoId, fromId);
    run("UPDATE expense_payers SET member_id = ? WHERE member_id = ?", intoId, fromId);
    run("UPDATE transfers SET from_member = ? WHERE from_member = ? AND outing_id = ?", intoId, fromId, outingId);
    run("UPDATE transfers SET to_member = ? WHERE to_member = ? AND outing_id = ?", intoId, fromId, outingId);
    run("UPDATE transfers SET on_behalf_of = ? WHERE on_behalf_of = ? AND outing_id = ?", intoId, fromId, outingId);
    if (from.user_id && !into.user_id) run("UPDATE members SET user_id = ?, kind = 'joined' WHERE id = ?", from.user_id, intoId);
    run("DELETE FROM members WHERE id = ?", fromId);
    // Collapse duplicate shares on the same item into one weight.
    const dups = all<{ item_id: string; w: number; n: number }>(
      "SELECT item_id, SUM(weight) AS w, COUNT(*) AS n FROM item_shares WHERE member_id = ? GROUP BY item_id HAVING n > 1",
      intoId,
    );
    for (const d of dups) {
      run("DELETE FROM item_shares WHERE item_id = ? AND member_id = ?", d.item_id, intoId);
      run("INSERT INTO item_shares (item_id, member_id, weight) VALUES (?, ?, ?)", d.item_id, intoId, d.w);
    }
    bumpDraft(outingId);
    logActivity(outingId, me.id, "merged", `${me.name} merged ${from.name} into ${into.name}`);
  });
}

export function leaveOuting(outingId: string, user: User) {
  const { me, outing } = requireMember(outingId, user);
  if (me.role === "organizer") throw bad("The organizer can’t leave. Archive the outing instead.", "ORGANIZER_LEAVE");
  const open = openBalanceCount(outingId, me.id);
  if (open > 0) throw conflict(`You have ${open} open balance${open > 1 ? "s" : ""}. Settle, ask for Maaf, or mute the outing instead.`, "OPEN_BALANCES");
  run("UPDATE members SET status = 'left' WHERE id = ?", me.id);
  logActivity(outingId, me.id, "left", `${me.name} left the outing; their history stays in the ledger`);
  const org = membersOf(outingId).find((m) => m.role === "organizer");
  notify({ userId: org?.user_id, outingId, type: "member", title: `${me.name} left ${outing.name}`, body: "Their entries are kept in the ledger." });
}

export function setMuted(outingId: string, user: User, muted: boolean) {
  const { me } = requireMember(outingId, user);
  run("UPDATE members SET muted = ? WHERE id = ?", muted ? 1 : 0, me.id);
}

export function archiveOuting(outingId: string, user: User, archive: boolean) {
  const { me } = requireOrganizer(outingId, user);
  run("UPDATE outings SET status = ? WHERE id = ?", archive ? "archived" : "active", outingId);
  logActivity(outingId, me.id, archive ? "archived" : "unarchived", `${me.name} ${archive ? "archived" : "reopened"} the outing. Open balances stay collectible.`);
}

/** Expenses changed after publishing → the organizer must re-confirm (E7). */
export function bumpDraft(outingId: string) {
  run("UPDATE outings SET draft_rev = draft_rev + 1 WHERE id = ?", outingId);
}
