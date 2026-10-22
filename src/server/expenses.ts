import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import { all, get, newId, now, run, tx, UPLOAD_DIR } from "./db";
import { bad, forbidden, notFound } from "./http";
import { bumpDraft, getOuting, membersOf, requireMember, type Member } from "./outings";
import { logActivity } from "./notify";
import type { User } from "./auth";
import { splitByWeights, type LedgerExpense, type LedgerMember, type LedgerTransfer } from "@/lib/ledger";
import type { Paisa } from "@/lib/money";

export type Source = "receipt" | "ride" | "manual" | "story" | "sample";
export type FieldSource = "receipt" | "ride" | "story" | "you" | "upload" | "assumed" | "manual" | "sample";

export interface ExpenseRecord {
  id: string;
  outingId: string;
  evidenceId: string | null;
  source: Source;
  title: string;
  declaredTotal: Paisa | null;
  equalEligible: boolean;
  payerSource: FieldSource | null;
  shareSource: FieldSource | null;
  confirmed: boolean;
  /** "itemised" (who had what) or "equal" among this expense's people. */
  splitMode: "itemised" | "equal";
  /** Keep this expense as direct payments to its payer when the outing uses optimized routing. */
  direct: boolean;
  payers: { memberId: string; amount: Paisa }[];
  items: { id: string; name: string; quantity: number; lineTotal: Paisa; confidence: "high" | "low"; raw: string | null; shares: { memberId: string; weight: number }[] }[];
  charges: { id: string; kind: string; label: string; amount: Paisa; basis: "prorata" | "equal" }[];
  createdAt: string;
}

interface ExpenseRow {
  id: string;
  outing_id: string;
  evidence_id: string | null;
  source: Source;
  title: string;
  declared_total: number | null;
  equal_eligible: number;
  payer_source: FieldSource | null;
  share_source: FieldSource | null;
  confirmed: number;
  split_mode: "itemised" | "equal";
  direct: number;
  created_at: string;
}

export function loadExpenses(outingId: string): ExpenseRecord[] {
  const rows = all<ExpenseRow>("SELECT * FROM expenses WHERE outing_id = ? ORDER BY position, created_at", outingId);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const ph = ids.map(() => "?").join(",");
  const payers = all<{ expense_id: string; member_id: string; amount: number }>(`SELECT * FROM expense_payers WHERE expense_id IN (${ph})`, ...ids);
  const items = all<{ id: string; expense_id: string; name: string; quantity: number; line_total: number; confidence: "high" | "low"; raw: string | null }>(
    `SELECT * FROM items WHERE expense_id IN (${ph}) ORDER BY position`,
    ...ids,
  );
  const itemIds = items.map((i) => i.id);
  const shares = itemIds.length
    ? all<{ item_id: string; member_id: string; weight: number }>(`SELECT * FROM item_shares WHERE item_id IN (${itemIds.map(() => "?").join(",")})`, ...itemIds)
    : [];
  const charges = all<{ id: string; expense_id: string; kind: string; label: string; amount: number; basis: "prorata" | "equal" }>(`SELECT * FROM charges WHERE expense_id IN (${ph})`, ...ids);
  return rows.map((r) => ({
    id: r.id,
    outingId: r.outing_id,
    evidenceId: r.evidence_id,
    source: r.source,
    title: r.title,
    declaredTotal: r.declared_total,
    equalEligible: Boolean(r.equal_eligible),
    payerSource: r.payer_source,
    shareSource: r.share_source,
    confirmed: Boolean(r.confirmed),
    splitMode: r.split_mode === "equal" ? "equal" : "itemised",
    direct: Boolean(r.direct),
    payers: payers.filter((p) => p.expense_id === r.id).map((p) => ({ memberId: p.member_id, amount: p.amount })),
    items: items
      .filter((i) => i.expense_id === r.id)
      .map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        lineTotal: i.line_total,
        confidence: i.confidence,
        raw: i.raw,
        shares: shares.filter((s) => s.item_id === i.id).map((s) => ({ memberId: s.member_id, weight: s.weight })),
      })),
    charges: charges.filter((c) => c.expense_id === r.id).map((c) => ({ id: c.id, kind: c.kind, label: c.label, amount: c.amount, basis: c.basis })),
    createdAt: r.created_at,
  }));
}

export function toLedgerExpense(e: ExpenseRecord): LedgerExpense {
  // Payers always cover exactly the current total (a line fix or added charge can change the total
  // after payers were recorded). Proportional to what each payer was recorded as paying.
  const total = e.items.reduce((a, i) => a + i.lineTotal, 0) + e.charges.reduce((a, c) => a + c.amount, 0);
  const recorded = e.payers.reduce((a, p) => a + p.amount, 0);
  let payers = e.payers;
  if (payers.length && recorded !== total && total >= 0) {
    const whole = total % 100 === 0;
    const w = payers.map((p) => Math.max(1, p.amount));
    const parts = whole ? splitByWeights(total / 100, w).map((x) => x * 100) : splitByWeights(total, w);
    payers = payers.map((p, i) => ({ memberId: p.memberId, amount: parts[i] }));
  }
  return {
    id: e.id,
    title: e.title,
    split: e.splitMode,
    direct: e.direct,
    payers,
    items: e.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, lineTotal: i.lineTotal, shares: i.shares })),
    charges: e.charges.map((c) => ({ id: c.id, kind: c.kind as LedgerExpense["charges"][number]["kind"], label: c.label, amount: c.amount, basis: c.basis })),
    declaredTotal: e.declaredTotal,
    equalEligible: e.equalEligible,
  };
}

export function toLedgerMembers(members: Member[]): LedgerMember[] {
  return members.map((m) => ({ id: m.id, name: m.name, noBankAccount: Boolean(m.no_bank_account) }));
}

/**
 * Everyone the ledger must account for: active members plus anyone who left or was removed but still
 * appears on an item, a payment or a transfer (otherwise their share would vanish and nets wouldn't
 * sum to zero). An outing-wide Equal split is divided among active members only.
 */
export function ledgerPeople(outingId: string, expenses: ExpenseRecord[], transfers: LedgerTransfer[] = []) {
  const all = membersOf(outingId, true).filter((m) => m.status !== "pending" && m.status !== "declined");
  const referenced = new Set<string>();
  for (const e of expenses) {
    for (const p of e.payers) referenced.add(p.memberId);
    for (const i of e.items) for (const s of i.shares) referenced.add(s.memberId);
  }
  for (const t of transfers) [t.from, t.to, t.onBehalfOf].forEach((x) => x && referenced.add(x));
  const people = all.filter((m) => m.status === "active" || referenced.has(m.id));
  return { members: toLedgerMembers(people), activeIds: people.filter((m) => m.status === "active").map((m) => m.id) };
}

export function setExpenseOptions(expenseId: string, user: User, input: { splitMode?: "itemised" | "equal"; direct?: boolean }) {
  const e = get<ExpenseRow>("SELECT * FROM expenses WHERE id = ?", expenseId);
  if (!e) throw notFound("Expense not found.");
  const { me } = requireMember(e.outing_id, user);
  run(
    "UPDATE expenses SET split_mode = ?, direct = ?, updated_at = ? WHERE id = ?",
    input.splitMode ?? e.split_mode ?? "itemised",
    input.direct === undefined ? e.direct ?? 0 : input.direct ? 1 : 0,
    now(),
    expenseId,
  );
  bumpDraft(e.outing_id);
  if (input.splitMode) logActivity(e.outing_id, me.id, "split_mode", `${me.name} set ${e.title} to ${input.splitMode === "equal" ? "split equally" : "itemised (who had what)"}`);
  if (input.direct !== undefined) logActivity(e.outing_id, me.id, "direct", `${me.name} set ${e.title} to ${input.direct ? "pay the payer directly" : "include in optimized transfers"}`);
}

/** Cash movements recorded before publishing (handoffs, returned change). */
export function loadPreTransfers(outingId: string): LedgerTransfer[] {
  return all<{ id: string; from_member: string; to_member: string; amount: number; on_behalf_of: string | null; kind: LedgerTransfer["kind"]; label: string | null }>(
    "SELECT * FROM transfers WHERE outing_id = ? AND balance_id IS NULL ORDER BY created_at",
    outingId,
  ).map((t) => ({ id: t.id, from: t.from_member, to: t.to_member, amount: t.amount, onBehalfOf: t.on_behalf_of, kind: t.kind, label: t.label ?? undefined }));
}

// ---------------------------------------------------------------------------
// Writing expenses
// ---------------------------------------------------------------------------

const ShareSchema = z.object({ memberId: z.string(), weight: z.number().min(0) });
export const ExpenseInput = z.object({
  title: z.string().trim().min(1, "Give the expense a name.").max(60),
  payers: z.array(z.object({ memberId: z.string(), amount: z.number().int() })).min(1, "Who paid?"),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(80),
        quantity: z.number().positive().default(1),
        lineTotal: z.number().int(),
        confidence: z.enum(["high", "low"]).default("high"),
        shares: z.array(ShareSchema),
      }),
    )
    .min(1, "Add at least one item or amount."),
  charges: z
    .array(
      z.object({
        id: z.string().optional(),
        kind: z.enum(["tax", "service", "fee", "tip", "discount", "other"]),
        label: z.string().trim().min(1).max(60),
        amount: z.number().int(),
        basis: z.enum(["prorata", "equal"]).default("prorata"),
      }),
    )
    .default([]),
  declaredTotal: z.number().int().nullable().optional(),
  equalEligible: z.boolean().default(true),
  splitMode: z.enum(["itemised", "equal"]).optional(),
  direct: z.boolean().optional(),
});
export type ExpenseInputT = z.infer<typeof ExpenseInput>;

function writeExpenseBody(expenseId: string, input: ExpenseInputT) {
  run("DELETE FROM expense_payers WHERE expense_id = ?", expenseId);
  run("DELETE FROM items WHERE expense_id = ?", expenseId);
  run("DELETE FROM charges WHERE expense_id = ?", expenseId);
  for (const p of input.payers) run("INSERT INTO expense_payers (expense_id, member_id, amount) VALUES (?, ?, ?)", expenseId, p.memberId, p.amount);
  input.items.forEach((it, idx) => {
    const itemId = it.id && !it.id.startsWith("new") ? it.id : newId("it_");
    run(
      "INSERT INTO items (id, expense_id, name, quantity, line_total, confidence, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
      itemId,
      expenseId,
      it.name,
      it.quantity,
      it.lineTotal,
      it.confidence,
      idx,
    );
    for (const s of it.shares) if (s.weight > 0) run("INSERT INTO item_shares (item_id, member_id, weight) VALUES (?, ?, ?)", itemId, s.memberId, s.weight);
  });
  for (const c of input.charges)
    run("INSERT INTO charges (id, expense_id, kind, label, amount, basis) VALUES (?, ?, ?, ?, ?, ?)", newId("ch_"), expenseId, c.kind, c.label, c.kind === "discount" ? -Math.abs(c.amount) : c.amount, c.basis);
}

function assertMembers(outingId: string, input: ExpenseInputT) {
  const ids = new Set(membersOf(outingId).map((m) => m.id));
  for (const p of input.payers) if (!ids.has(p.memberId)) throw bad("A payer isn’t in this outing.");
  for (const it of input.items) for (const s of it.shares) if (!ids.has(s.memberId)) throw bad(`Someone on “${it.name}” isn’t in this outing.`);
}

export function createExpense(outingId: string, user: User, input: ExpenseInputT, opts: { source: Source; evidenceId?: string | null; payerSource?: FieldSource; shareSource?: FieldSource; confirmed?: boolean } = { source: "manual" }) {
  const { me } = requireMember(outingId, user);
  assertMembers(outingId, input);
  return tx(() => {
    const id = newId("e_");
    const pos = get<{ n: number }>("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM expenses WHERE outing_id = ?", outingId)!.n;
    run(
      "INSERT INTO expenses (id, outing_id, evidence_id, source, title, declared_total, equal_eligible, payer_source, share_source, confirmed, created_by_member_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      outingId,
      opts.evidenceId ?? null,
      opts.source,
      input.title,
      input.declaredTotal ?? null,
      input.equalEligible ? 1 : 0,
      opts.payerSource ?? "you",
      opts.shareSource ?? "you",
      opts.confirmed ? 1 : 0,
      me.id,
      pos,
      now(),
      now(),
    );
    writeExpenseBody(id, input);
    bumpDraft(outingId);
    logActivity(outingId, me.id, "expense_added", `${me.name} added ${input.title}`);
    return id;
  });
}

export function updateExpense(expenseId: string, user: User, input: ExpenseInputT) {
  const e = get<ExpenseRow>("SELECT * FROM expenses WHERE id = ?", expenseId);
  if (!e) throw notFound("Expense not found.");
  const { me } = requireMember(e.outing_id, user);
  assertMembers(e.outing_id, input);
  tx(() => {
    run(
      "UPDATE expenses SET title = ?, declared_total = ?, equal_eligible = ?, split_mode = ?, direct = ?, payer_source = 'you', share_source = 'you', confirmed = 1, updated_at = ? WHERE id = ?",
      input.title,
      input.declaredTotal ?? e.declared_total,
      input.equalEligible ? 1 : 0,
      input.splitMode ?? e.split_mode ?? "itemised",
      input.direct === undefined ? e.direct ?? 0 : input.direct ? 1 : 0,
      now(),
      expenseId,
    );
    writeExpenseBody(expenseId, input);
    // Edits by a person resolve questions about this expense's lines that no longer apply.
    run("UPDATE questions SET status = 'answered', answer = '\"edited\"' WHERE expense_id = ? AND status != 'answered' AND kind IN ('line','mismatch','payer','amount')", expenseId);
    bumpDraft(e.outing_id);
    logActivity(e.outing_id, me.id, "expense_edited", `${me.name} edited ${input.title}`);
  });
}

export function deleteExpense(expenseId: string, user: User) {
  const e = get<ExpenseRow>("SELECT * FROM expenses WHERE id = ?", expenseId);
  if (!e) throw notFound();
  const { me } = requireMember(e.outing_id, user);
  tx(() => {
    run("DELETE FROM questions WHERE expense_id = ?", expenseId);
    run("DELETE FROM expenses WHERE id = ?", expenseId);
    bumpDraft(e.outing_id);
    logActivity(e.outing_id, me.id, "expense_deleted", `${me.name} removed ${e.title}`);
  });
}

/** E2 split modes → item share weights, validated to the paisa on the server. */
export const ManualExpenseInput = z.object({
  title: z.string().trim().min(1, "What was it?").max(60),
  total: z.number().int().positive("Enter an amount above zero."),
  payers: z.array(z.object({ memberId: z.string(), amount: z.number().int().nonnegative() })).min(1, "Who paid?"),
  mode: z.enum(["equal", "exact", "percent", "weights"]),
  participants: z.array(z.object({ memberId: z.string(), value: z.number().nonnegative() })).min(1, "Pick who shared it."),
  date: z.string().optional(),
});

export function createManualExpense(outingId: string, user: User, raw: unknown) {
  const input = ManualExpenseInput.parse(raw);
  const paid = input.payers.reduce((a, p) => a + p.amount, 0);
  if (paid !== input.total) throw bad(`Payers add up to PKR ${paid / 100}; the total is PKR ${input.total / 100}.`, "PAYER_MISMATCH", { remaining: input.total - paid });
  let shares: { memberId: string; weight: number }[];
  if (input.mode === "equal") shares = input.participants.map((p) => ({ memberId: p.memberId, weight: 1 }));
  else if (input.mode === "exact") {
    const assigned = input.participants.reduce((a, p) => a + Math.round(p.value), 0);
    if (assigned !== input.total) throw bad(`PKR ${(input.total - assigned) / 100} left to assign.`, "SPLIT_MISMATCH", { remaining: input.total - assigned });
    shares = input.participants.map((p) => ({ memberId: p.memberId, weight: Math.round(p.value) }));
  } else if (input.mode === "percent") {
    const pct = input.participants.reduce((a, p) => a + p.value, 0);
    if (Math.abs(pct - 100) > 0.001) throw bad(`Percentages add up to ${Math.round(pct * 100) / 100}%, not 100%.`, "SPLIT_MISMATCH", { remainingPercent: 100 - pct });
    shares = input.participants.map((p) => ({ memberId: p.memberId, weight: p.value }));
  } else {
    if (!input.participants.some((p) => p.value > 0)) throw bad("Give at least one person a weight above zero.", "SPLIT_MISMATCH");
    shares = input.participants.map((p) => ({ memberId: p.memberId, weight: p.value }));
  }
  return createExpense(
    outingId,
    user,
    {
      title: input.title,
      payers: input.payers.filter((p) => p.amount > 0),
      items: [{ name: input.title, quantity: 1, lineTotal: input.total, confidence: "high", shares }],
      charges: [],
      declaredTotal: input.total,
      equalEligible: true,
    },
    { source: "manual", payerSource: "manual", shareSource: "manual", confirmed: true },
  );
}

// ---------------------------------------------------------------------------
// Evidence (E1)
// ---------------------------------------------------------------------------

export interface EvidenceRow {
  id: string;
  outing_id: string;
  kind: "receipt" | "ride" | "other";
  file_name: string;
  original_name: string | null;
  mime: string;
  size: number;
  sha256: string;
  uploader_member_id: string;
  payer_member_id: string | null;
  status: "uploaded" | "processed" | "unreadable" | "failed";
  ocr_text: string | null;
  ocr_confidence: number | null;
  parsed: string | null;
  engine: string | null;
  error: string | null;
  created_at: string;
}

const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/bmp", ".bmp"],
]);
const MAX_BYTES = 12 * 1024 * 1024;

export async function saveEvidence(outingId: string, user: User, file: File, kind: string, payerMemberId: string | null) {
  const { me } = requireMember(outingId, user);
  if (!ALLOWED.has(file.type)) throw bad(`“${file.name}” isn’t a supported image. Use JPG, PNG or WebP (HEIC: export as JPG).`, "UNSUPPORTED_FILE");
  if (file.size > MAX_BYTES) throw bad(`“${file.name}” is over 12 MB.`, "FILE_TOO_LARGE");
  if (!["receipt", "ride", "other"].includes(kind)) kind = "receipt";
  if (payerMemberId && !membersOf(outingId).some((m) => m.id === payerMemberId)) payerMemberId = null;
  const buf = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const dup = get<{ id: string }>("SELECT id FROM evidence WHERE outing_id = ? AND sha256 = ?", outingId, sha);
  const id = newId("ev_");
  const fileName = id + ALLOWED.get(file.type);
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buf);
  run(
    "INSERT INTO evidence (id, outing_id, kind, file_name, original_name, mime, size, sha256, uploader_member_id, payer_member_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    outingId,
    kind,
    fileName,
    file.name.slice(0, 120),
    file.type,
    file.size,
    sha,
    me.id,
    payerMemberId,
    now(),
  );
  logActivity(outingId, me.id, "evidence", `${me.name} added a ${kind === "ride" ? "ride screenshot" : kind === "receipt" ? "receipt" : "photo of evidence"}`);
  return { id, duplicateOf: dup?.id ?? null };
}

export function listEvidence(outingId: string): EvidenceRow[] {
  return all<EvidenceRow>("SELECT * FROM evidence WHERE outing_id = ? ORDER BY created_at", outingId);
}

export function updateEvidence(evidenceId: string, user: User, input: { kind?: string; payerMemberId?: string | null }) {
  const ev = get<EvidenceRow>("SELECT * FROM evidence WHERE id = ?", evidenceId);
  if (!ev) throw notFound();
  requireMember(ev.outing_id, user);
  if (input.payerMemberId && !membersOf(ev.outing_id).some((m) => m.id === input.payerMemberId)) throw bad("That person isn’t in this outing.");
  run(
    "UPDATE evidence SET kind = ?, payer_member_id = ? WHERE id = ?",
    input.kind && ["receipt", "ride", "other"].includes(input.kind) ? input.kind : ev.kind,
    input.payerMemberId === undefined ? ev.payer_member_id : input.payerMemberId,
    evidenceId,
  );
  // Keep a linked expense's payer in sync with an explicit upload choice.
  if (input.payerMemberId) {
    const exp = get<{ id: string }>("SELECT id FROM expenses WHERE evidence_id = ?", evidenceId);
    if (exp) {
      const total = get<{ t: number }>("SELECT COALESCE(SUM(line_total),0) + (SELECT COALESCE(SUM(amount),0) FROM charges WHERE expense_id = ?) AS t FROM items WHERE expense_id = ?", exp.id, exp.id)!.t;
      run("DELETE FROM expense_payers WHERE expense_id = ?", exp.id);
      run("INSERT INTO expense_payers (expense_id, member_id, amount) VALUES (?, ?, ?)", exp.id, input.payerMemberId, total);
      run("UPDATE expenses SET payer_source = 'upload' WHERE id = ?", exp.id);
      run("UPDATE questions SET status = 'answered', answer = '\"upload\"' WHERE expense_id = ? AND kind = 'payer' AND status != 'answered'", exp.id);
    }
  }
  bumpDraft(ev.outing_id);
}

export function deleteEvidence(evidenceId: string, user: User) {
  const ev = get<EvidenceRow>("SELECT * FROM evidence WHERE id = ?", evidenceId);
  if (!ev) throw notFound();
  const { me } = requireMember(ev.outing_id, user);
  tx(() => {
    const exp = get<{ id: string }>("SELECT id FROM expenses WHERE evidence_id = ?", evidenceId);
    if (exp) {
      run("DELETE FROM questions WHERE expense_id = ?", exp.id);
      run("DELETE FROM expenses WHERE id = ?", exp.id);
    }
    run("DELETE FROM evidence WHERE id = ?", evidenceId);
    bumpDraft(ev.outing_id);
    logActivity(ev.outing_id, me.id, "evidence_removed", `${me.name} removed a source`);
  });
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, ev.file_name));
  } catch {
    /* already gone */
  }
}

/** Receipt privacy (J2): uploader’s choice of “all members” or “payer + organizer only”. */
export function readEvidenceFile(evidenceId: string, user: User): { data: Buffer; mime: string } {
  const ev = get<EvidenceRow>("SELECT * FROM evidence WHERE id = ?", evidenceId);
  if (!ev) throw notFound();
  const { me } = requireMember(ev.outing_id, user);
  const uploader = get<Member>("SELECT * FROM members WHERE id = ?", ev.uploader_member_id);
  const pref = uploader?.user_id ? get<{ receipt_visibility: string }>("SELECT receipt_visibility FROM users WHERE id = ?", uploader.user_id)?.receipt_visibility : "members";
  const allowed = pref !== "payer_organizer" || me.role === "organizer" || me.id === ev.uploader_member_id || me.id === ev.payer_member_id;
  if (!allowed) throw forbidden("The uploader shares this receipt only with the payer and organizer.");
  return { data: fs.readFileSync(path.join(UPLOAD_DIR, ev.file_name)), mime: ev.mime };
}

export function outingIdOfExpense(expenseId: string) {
  const e = get<{ outing_id: string }>("SELECT outing_id FROM expenses WHERE id = ?", expenseId);
  if (!e) throw notFound();
  return getOuting(e.outing_id).id;
}
