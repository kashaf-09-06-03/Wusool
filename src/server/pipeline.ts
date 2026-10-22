import "server-only";
import fs from "node:fs";
import path from "node:path";
import { all, get, newId, now, run, tx, UPLOAD_DIR } from "./db";
import { bad, notFound } from "./http";
import { bumpDraft, membersOf, requireMember, addManualMember, type Member } from "./outings";
import { ledgerPeople, listEvidence, loadExpenses, loadPreTransfers, toLedgerExpense, type EvidenceRow, type ExpenseRecord } from "./expenses";
import { logActivity } from "./notify";
import { ocrImage } from "./ai/ocr";
import { claudeAvailable, extractReceiptWithClaude, interpretWithClaude } from "./ai/claude";
import { extractReceiptWithGemini, geminiAvailable, interpretWithGemini } from "./ai/gemini";
import { parseReceiptText, type ParsedReceipt } from "@/lib/interpret/receipt";
import { interpretNarrative, type Fact, type NarrativeContext, type NarrativeResult } from "@/lib/interpret/narrative";
import { computeLedger, splitByWeights } from "@/lib/ledger";
import { formatPKR, type Paisa } from "@/lib/money";
import type { User } from "./auth";

// ---------------------------------------------------------------------------
// Questions (≤ a handful, each with 2–3 answer chips; skipped ones stay flagged)
// ---------------------------------------------------------------------------

export type QuestionKind = "payer" | "confirm_share" | "line" | "mismatch" | "amount" | "name" | "change" | "shared_all" | "unreadable" | "unparsed" | "payer_conflict";
export interface QuestionOption {
  id: string;
  label: string;
  input?: "amount";
}
export interface QuestionRow {
  id: string;
  outing_id: string;
  expense_id: string | null;
  kind: QuestionKind;
  qkey: string;
  text: string;
  detail: string | null;
  options: string;
  payload: string | null;
  answer: string | null;
  status: "open" | "answered" | "skipped";
}

/** Kinds that don't block publishing (informational). */
export const NON_BLOCKING: QuestionKind[] = ["unparsed", "shared_all"];

function ask(outingId: string, q: { expenseId?: string | null; kind: QuestionKind; key: string; text: string; detail?: string; options: QuestionOption[]; payload?: unknown }) {
  const existing = get<QuestionRow>("SELECT * FROM questions WHERE outing_id = ? AND qkey = ?", outingId, q.key);
  if (existing) {
    if (existing.status !== "answered")
      run("UPDATE questions SET text = ?, detail = ?, options = ?, payload = ? WHERE id = ?", q.text, q.detail ?? null, JSON.stringify(q.options), q.payload ? JSON.stringify(q.payload) : null, existing.id);
    return existing.id;
  }
  const id = newId("q_");
  run(
    "INSERT INTO questions (id, outing_id, expense_id, kind, qkey, text, detail, options, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    outingId,
    q.expenseId ?? null,
    q.kind,
    q.key,
    q.text,
    q.detail ?? null,
    JSON.stringify(q.options),
    q.payload ? JSON.stringify(q.payload) : null,
    now(),
  );
  return id;
}

export function listQuestions(outingId: string) {
  return all<QuestionRow>("SELECT * FROM questions WHERE outing_id = ? ORDER BY created_at", outingId).map((q) => ({
    id: q.id,
    expenseId: q.expense_id,
    kind: q.kind,
    text: q.text,
    detail: q.detail,
    options: JSON.parse(q.options) as QuestionOption[],
    answer: q.answer ? JSON.parse(q.answer) : null,
    selected: q.status === "answered" ? (storedAnswer(q.answer)?.opt ?? null) : null,
    status: q.status,
    blocking: !NON_BLOCKING.includes(q.kind),
  }));
}

// ---------------------------------------------------------------------------
// Low-level expense mutations used by facts and answers
// ---------------------------------------------------------------------------

function expenseTotal(expenseId: string): Paisa {
  return get<{ t: number }>(
    "SELECT COALESCE((SELECT SUM(line_total) FROM items WHERE expense_id = ?), 0) + COALESCE((SELECT SUM(amount) FROM charges WHERE expense_id = ?), 0) AS t",
    expenseId,
    expenseId,
  )!.t;
}

function setPayers(expenseId: string, memberIds: string[], source: string) {
  const total = expenseTotal(expenseId);
  // Whole-rupee shares between several payers when the total is whole rupees.
  const parts = total % 100 === 0 ? splitByWeights(total / 100, memberIds.map(() => 1)).map((x) => x * 100) : splitByWeights(total, memberIds.map(() => 1));
  run("DELETE FROM expense_payers WHERE expense_id = ?", expenseId);
  memberIds.forEach((m, i) => run("INSERT INTO expense_payers (expense_id, member_id, amount) VALUES (?, ?, ?)", expenseId, m, parts[i]));
  run("UPDATE expenses SET payer_source = ?, updated_at = ? WHERE id = ?", source, now(), expenseId);
}

function setAllShares(expenseId: string, memberIds: string[], source: string) {
  for (const it of all<{ id: string }>("SELECT id FROM items WHERE expense_id = ?", expenseId)) setItemShares(it.id, memberIds);
  run("UPDATE expenses SET share_source = ?, updated_at = ? WHERE id = ?", source, now(), expenseId);
}

function setItemShares(itemId: string, memberIds: string[]) {
  run("DELETE FROM item_shares WHERE item_id = ?", itemId);
  for (const m of [...new Set(memberIds)]) run("INSERT INTO item_shares (item_id, member_id, weight) VALUES (?, ?, 1)", itemId, m);
}

function removeMemberFromExpense(expenseId: string, memberId: string) {
  run("DELETE FROM item_shares WHERE member_id = ? AND item_id IN (SELECT id FROM items WHERE expense_id = ?)", memberId, expenseId);
}
function addMemberToExpense(expenseId: string, memberId: string) {
  for (const it of all<{ id: string }>("SELECT id FROM items WHERE expense_id = ?", expenseId)) {
    if (!get("SELECT 1 FROM item_shares WHERE item_id = ? AND member_id = ?", it.id, memberId))
      run("INSERT INTO item_shares (item_id, member_id, weight) VALUES (?, ?, 1)", it.id, memberId);
  }
}

function insertExpense(outingId: string, e: { title: string; source: string; evidenceId?: string | null; declaredTotal: Paisa | null; payerSource: string | null; shareSource: string | null; createdBy: string }): string {
  const id = newId("e_");
  const pos = get<{ n: number }>("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM expenses WHERE outing_id = ?", outingId)!.n;
  run(
    "INSERT INTO expenses (id, outing_id, evidence_id, source, title, declared_total, payer_source, share_source, created_by_member_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    outingId,
    e.evidenceId ?? null,
    e.source,
    e.title,
    e.declaredTotal,
    e.payerSource,
    e.shareSource,
    e.createdBy,
    pos,
    now(),
    now(),
  );
  return id;
}

// ---------------------------------------------------------------------------
// Stage 2: extraction
// ---------------------------------------------------------------------------

function titleFor(ev: EvidenceRow, parsed: ParsedReceipt): string {
  if (parsed.kind === "ride") {
    const p = parsed.provider ? (parsed.provider === "indrive" ? "inDrive" : parsed.provider[0].toUpperCase() + parsed.provider.slice(1)) : "Ride";
    return `${p} ride`;
  }
  const v = parsed.vendor?.replace(/\s+/g, " ").trim();
  if (v && v.length <= 40) return v.split(" ").map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");
  return ev.kind === "ride" ? "Ride" : "Receipt";
}

async function extractOne(ev: EvidenceRow, members: Member[]): Promise<{ parsed: ParsedReceipt | null; engine: string; error?: string }> {
  const buf = fs.readFileSync(path.join(UPLOAD_DIR, ev.file_name));
  if (claudeAvailable()) {
    try {
      return { parsed: await extractReceiptWithClaude(buf, ev.mime, ev.kind), engine: "claude-vision" };
    } catch (e) {
      console.warn("[wusool] Claude extraction failed; trying the next reader", e);
    }
  }
  if (geminiAvailable()) {
    try {
      return { parsed: await extractReceiptWithGemini(buf, ev.mime, ev.kind), engine: "gemini-vision" };
    } catch (e) {
      console.warn("[wusool] Gemini extraction failed; using local OCR", e);
    }
  }
  try {
    const ocr = await ocrImage(buf);
    run("UPDATE evidence SET ocr_text = ?, ocr_confidence = ? WHERE id = ?", ocr.text, ocr.confidence, ev.id);
    return { parsed: parseReceiptText(ocr.lines, ev.kind === "other" ? undefined : ev.kind), engine: "tesseract" };
  } catch (e) {
    void members;
    return { parsed: null, engine: "tesseract", error: e instanceof Error ? e.message : String(e) };
  }
}

function upsertExpenseFromReceipt(outingId: string, ev: EvidenceRow, parsed: ParsedReceipt, createdBy: string) {
  const existing = get<{ id: string; confirmed: number }>("SELECT id, confirmed FROM expenses WHERE evidence_id = ?", ev.id);
  if (existing?.confirmed) return existing.id; // never overwrite a person's edits
  const itemsSum = parsed.items.reduce((a, i) => a + i.lineTotal, 0);
  const chargeSum = parsed.charges.reduce((a, c) => a + c.amount, 0);
  const declared = parsed.total ?? (itemsSum + chargeSum || null);
  const id = existing?.id ?? insertExpense(outingId, { title: titleFor(ev, parsed), source: parsed.kind === "ride" ? "ride" : "receipt", evidenceId: ev.id, declaredTotal: declared, payerSource: null, shareSource: null, createdBy });
  if (existing) {
    run("DELETE FROM items WHERE expense_id = ?", id);
    run("DELETE FROM charges WHERE expense_id = ?", id);
    run("UPDATE expenses SET title = ?, declared_total = ?, source = ? WHERE id = ?", titleFor(ev, parsed), declared, parsed.kind === "ride" ? "ride" : "receipt", id);
  }
  parsed.items.forEach((it, i) =>
    run("INSERT INTO items (id, expense_id, name, quantity, line_total, confidence, raw, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", newId("it_"), id, it.name.slice(0, 80), it.quantity, it.lineTotal, it.confidence, it.raw, i),
  );
  for (const c of parsed.charges) run("INSERT INTO charges (id, expense_id, kind, label, amount, basis) VALUES (?, ?, ?, ?, ?, 'prorata')", newId("ch_"), id, c.kind, c.label.slice(0, 60), c.amount);
  if (ev.payer_member_id) setPayers(id, [ev.payer_member_id], "upload");
  return id;
}

// ---------------------------------------------------------------------------
// Stage 3: interpretation → facts → draft changes
// ---------------------------------------------------------------------------

export function narrativeContext(outingId: string, narratorId: string | null): NarrativeContext {
  const members = membersOf(outingId);
  const evidence = listEvidence(outingId);
  return {
    narratorId,
    members: members.map((m) => ({ id: m.id, name: m.name })),
    expenses: loadExpenses(outingId).map((e) => {
      const ev = evidence.find((x) => x.id === e.evidenceId);
      const parsed = ev?.parsed ? (JSON.parse(ev.parsed) as ParsedReceipt) : null;
      return {
        id: e.id,
        title: e.title,
        kind: e.source === "ride" ? "ride" : e.source === "manual" ? "manual" : e.source === "story" ? "other" : "receipt",
        vendor: parsed?.vendor ?? parsed?.provider ?? null,
        total: e.items.reduce((a, i) => a + i.lineTotal, 0) + e.charges.reduce((a, c) => a + c.amount, 0),
        items: e.items.map((i) => ({ id: i.id, name: i.name })),
      };
    }),
  };
}

async function interpret(transcript: string, ctx: NarrativeContext): Promise<NarrativeResult> {
  if (claudeAvailable()) {
    try {
      return await interpretWithClaude(transcript, ctx);
    } catch (e) {
      console.warn("[wusool] Claude interpretation failed; trying the next interpreter", e);
    }
  }
  if (geminiAvailable()) {
    try {
      return await interpretWithGemini(transcript, ctx);
    } catch (e) {
      console.warn("[wusool] Gemini interpretation failed; using rule-based interpreter", e);
    }
  }
  return interpretNarrative(transcript, ctx);
}

const strongSources = new Set(["you", "manual", "upload", "sample"]);

/** Apply interpreter facts to the draft. `fromUser` = a conversational correction (overrides earlier sources). */
export function applyFacts(outingId: string, facts: Fact[], opts: { fromUser: boolean; actorMemberId: string }): string[] {
  const changes: string[] = [];
  const members = membersOf(outingId);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name.split(" ")[0] ?? "Someone";
  const names = (ids: string[]) => ids.map(nameOf).join(", ");
  const expenses = loadExpenses(outingId);
  const exp = (id: string) => expenses.find((e) => e.id === id);
  const src = opts.fromUser ? "you" : "story";

  // Payers and participants first, then item-level facts refine lines, then "whatever was left".
  const rank: Partial<Record<Fact["type"], number>> = { payer: 0, participants: 1, newExpense: 1, split: 2, item: 3, rest: 4 };
  const ordered = [...facts].sort((a, b) => (rank[a.type] ?? 2) - (rank[b.type] ?? 2));
  const assignedNow = new Set(facts.flatMap((f) => (f.type === "item" ? [f.itemId] : [])));
  for (const f of ordered) {
    if (f.type === "rest") {
      const e = exp(f.expenseId);
      if (!e) continue;
      // Items nobody claimed: not assigned in this story and not set by a person before.
      const left = e.items.filter((i) => !assignedNow.has(i.id) && (i.shares.length === 0 || !e.shareSource || e.shareSource === "assumed" || e.shareSource === "story"));
      for (const it of left) setItemShares(it.id, f.memberIds);
      if (left.length) {
        run("UPDATE expenses SET share_source = ? WHERE id = ?", src, e.id);
        changes.push(`${names(f.memberIds)} had the rest of ${e.title} (${left.length} item${left.length > 1 ? "s" : ""})`);
      }
      continue;
    }
    if (f.type === "split") {
      const e = exp(f.expenseId);
      if (!e) continue;
      run("UPDATE expenses SET split_mode = ? WHERE id = ?", f.mode, e.id);
      changes.push(`${e.title}: ${f.mode === "equal" ? "split equally" : "each pays for what they had"}`);
      continue;
    }
    if (f.type === "note") {
      changes.push(f.text);
      continue;
    }
    if (f.type === "payer") {
      const e = exp(f.expenseId);
      if (!e) continue;
      const current = e.payers.map((p) => p.memberId).sort().join(",");
      const proposed = [...f.memberIds].sort().join(",");
      if (!opts.fromUser && e.payerSource && strongSources.has(e.payerSource) && current && current !== proposed) {
        ask(outingId, {
          expenseId: e.id,
          kind: "payer_conflict",
          key: `payer_conflict:${e.id}`,
          text: `Who paid for ${e.title}?`,
          detail: `Your story says ${names(f.memberIds)}; the upload says ${names(e.payers.map((p) => p.memberId))}.`,
          options: [
            { id: `set:${f.memberIds.join("+")}`, label: names(f.memberIds) },
            { id: `set:${e.payers.map((p) => p.memberId).join("+")}`, label: names(e.payers.map((p) => p.memberId)) },
          ],
        });
        continue;
      }
      setPayers(e.id, f.memberIds, src);
      changes.push(`${names(f.memberIds)} paid for ${e.title}`);
      for (const uid of f.uncertainIds ?? [])
        ask(outingId, { expenseId: e.id, kind: "payer", key: `payer:${e.id}`, text: `Did ${nameOf(uid)} pay for ${e.title}?`, detail: `We weren’t sure about a name in: “${f.sentence}”.`, options: [...members.map((m) => ({ id: `set:${m.id}`, label: m.name.split(" ")[0] }))].slice(0, 6) });
    } else if (f.type === "participants") {
      const e = exp(f.expenseId);
      if (!e) continue;
      if (!opts.fromUser && e.shareSource && strongSources.has(e.shareSource)) {
        // A person already set who shared this; only add question if the story disagrees.
        const cur = new Set(e.items.flatMap((i) => i.shares.map((s) => s.memberId)));
        const missing = f.memberIds.filter((m) => !cur.has(m));
        for (const m of missing)
          ask(outingId, { expenseId: e.id, kind: "confirm_share", key: `share:${e.id}:${m}`, text: `Did ${nameOf(m)} share the ${e.title.toLowerCase()}?`, detail: "Your story says yes; the entry doesn’t include them.", options: yesNoUnsure(m) });
        continue;
      }
      setAllShares(e.id, f.memberIds, src);
      changes.push(`${e.title}: ${names(f.memberIds)}`);
      for (const uid of f.uncertainIds ?? [])
        ask(outingId, { expenseId: e.id, kind: "confirm_share", key: `share:${e.id}:${uid}`, text: `Did ${nameOf(uid)} share the ${e.title.toLowerCase()}?`, detail: "Your story says yes, but we weren’t sure about the name.", options: yesNoUnsure(uid) });
    } else if (f.type === "item") {
      const e = exp(f.expenseId);
      const item = e?.items.find((i) => i.id === f.itemId);
      if (!e || !item) continue;
      setItemShares(item.id, f.memberIds);
      run("UPDATE expenses SET share_source = COALESCE(share_source, ?) WHERE id = ?", src, e.id);
      changes.push(`${item.name}: ${names(f.memberIds)}`);
      for (const uid of f.uncertainIds ?? [])
        ask(outingId, { expenseId: e.id, kind: "confirm_share", key: `item:${item.id}:${uid}`, text: `Did ${nameOf(uid)} have the ${item.name.toLowerCase()}?`, detail: `From your story: “${f.sentence}”.`, options: yesNoUnsure(uid, item.id) });
    } else if (f.type === "newExpense") {
      const key = `new:${f.title.toLowerCase()}`;
      const already = expenses.find((e) => e.title.toLowerCase() === f.title.toLowerCase());
      if (already) continue;
      if (f.amount === null) {
        ask(outingId, {
          kind: "amount",
          key,
          text: `How much was ${f.title.toLowerCase()}?`,
          detail: `Your story mentions it (“${f.sentence}”) but there’s no receipt or amount.`,
          options: [
            { id: "amount", label: "Enter amount", input: "amount" },
            { id: "ignore", label: "Leave it out" },
          ],
          payload: f,
        });
        continue;
      }
      createStoryExpense(outingId, f, opts.actorMemberId);
      changes.push(`Added ${f.title} (${formatPKR(f.amount)}) from your story${f.split === "equal" ? ", split equally" : ""}`);
    } else if (f.type === "handoff") {
      applyHandoff(outingId, f, opts.actorMemberId);
      changes.push(`${nameOf(f.fromId)} gave ${nameOf(f.viaId)} ${formatPKR(f.given)} to pass to ${nameOf(f.toId)}`);
    } else if (f.type === "unknownName") {
      ask(outingId, {
        kind: "name",
        key: `name:${f.name.toLowerCase()}`,
        text: `Who is ${f.name}?`,
        detail: `Your story mentions ${f.name}, who isn’t in this outing.`,
        options: [
          ...f.suggestionIds.slice(0, 2).map((id) => ({ id: `member:${id}`, label: `It’s ${nameOf(id)}` })),
          { id: "add", label: `Add ${f.name} as a guest` },
          { id: "ignore", label: "Ignore" },
        ],
        payload: { name: f.name, sentence: f.sentence },
      });
    } else if (f.type === "unparsed" && !opts.fromUser) {
      ask(outingId, { kind: "unparsed", key: `unparsed:${f.sentence.toLowerCase().slice(0, 80)}`, text: "We couldn’t use one part of your story", detail: `“${f.sentence}”`, options: [{ id: "ok", label: "That’s fine" }] });
    }
  }
  return changes;
}

function yesNoUnsure(memberId: string, itemId?: string): QuestionOption[] {
  const t = itemId ? `${memberId}:${itemId}` : memberId;
  return [
    { id: `yes:${t}`, label: "Yes" },
    { id: `no:${t}`, label: "No" },
    { id: "unsure", label: "Not sure" },
  ];
}

function createStoryExpense(outingId: string, f: Extract<Fact, { type: "newExpense" }>, createdBy: string, amount = f.amount!) {
  const members = membersOf(outingId);
  const id = insertExpense(outingId, { title: f.title, source: "story", declaredTotal: amount, payerSource: f.payerIds.length ? "story" : null, shareSource: f.participantIds.length ? "story" : "assumed", createdBy });
  if (f.split) run("UPDATE expenses SET split_mode = ? WHERE id = ?", f.split, id);
  const itemId = newId("it_");
  run("INSERT INTO items (id, expense_id, name, quantity, line_total, confidence, position) VALUES (?, ?, ?, 1, ?, 'high', 0)", itemId, id, f.title, amount);
  setItemShares(itemId, f.participantIds.length ? f.participantIds : members.map((m) => m.id));
  // "It cost us 1000" doesn't say who paid: leave payers empty so validation asks once.
  if (f.payerIds.length) setPayers(id, f.payerIds, "story");
  if (!f.participantIds.length)
    ask(outingId, { expenseId: id, kind: "shared_all", key: `shared_all:${id}`, text: `Who shared ${f.title}?`, detail: "We assumed everyone. Tap Edit on the expense to change it.", options: [{ id: "ok", label: "Everyone is right" }] });
  return id;
}

function applyHandoff(outingId: string, f: Extract<Fact, { type: "handoff" }>, actor: string) {
  const key = `handoff:${f.fromId}:${f.viaId}:${f.toId}:${f.given}`;
  if (get("SELECT 1 FROM transfers WHERE outing_id = ? AND label = ?", outingId, key)) return;
  // The intermediary forwarded what `from` owed `to` (from the current draft ledger), unless stated.
  let forwarded = f.forwarded;
  if (forwarded === null) {
    const recs = loadExpenses(outingId);
    const tr = loadPreTransfers(outingId);
    const ledger = computeLedger({ members: ledgerPeople(outingId, recs, tr).members, expenses: recs.map(toLedgerExpense), transfers: tr, allocation: "actual", rounding: "rupee" });
    const owed = ledger.originalDebts.find((e) => e.from === f.fromId && e.to === f.toId)?.amount ?? null;
    forwarded = owed !== null && owed <= f.given ? owed : f.given;
  }
  run("INSERT INTO transfers (id, outing_id, from_member, to_member, amount, kind, label, source, created_at) VALUES (?, ?, ?, ?, ?, 'handoff', ?, 'story', ?)", newId("t_"), outingId, f.fromId, f.viaId, f.given, key, now());
  run(
    "INSERT INTO transfers (id, outing_id, from_member, to_member, amount, on_behalf_of, kind, label, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'handoff', ?, 'story', ?)",
    newId("t_"),
    outingId,
    f.viaId,
    f.toId,
    forwarded,
    f.fromId,
    key + ":fwd",
    now(),
  );
  const change = f.given - forwarded;
  if (change > 0) {
    const members = membersOf(outingId);
    const n = (id: string) => members.find((m) => m.id === id)?.name.split(" ")[0] ?? "?";
    if (f.changeReturned === "yes") recordChange(outingId, f.viaId, f.fromId, change, key);
    else if (f.changeReturned === "unknown")
      ask(outingId, {
        kind: "change",
        key: `change:${key}`,
        text: `Did ${n(f.viaId)} return ${formatPKR(change)} to ${n(f.fromId)}?`,
        detail: `${n(f.fromId)} → ${n(f.viaId)} ${formatPKR(f.given)} cash · ${n(f.viaId)} → ${n(f.toId)} ${formatPKR(forwarded)} for ${n(f.fromId)}.`,
        options: [
          { id: "yes", label: "Yes, returned" },
          { id: "no", label: "No" },
          { id: "unsure", label: "Not sure" },
        ],
        payload: { viaId: f.viaId, fromId: f.fromId, change, key },
      });
  }
  void actor;
}

function recordChange(outingId: string, from: string, to: string, amount: Paisa, key: string) {
  run("INSERT INTO transfers (id, outing_id, from_member, to_member, amount, kind, label, source, created_at) VALUES (?, ?, ?, ?, ?, 'change', ?, 'story', ?)", newId("t_"), outingId, from, to, amount, key + ":change", now());
}

// ---------------------------------------------------------------------------
// Stage 4: validation → questions
// ---------------------------------------------------------------------------

export function validateDraft(outingId: string) {
  const members = membersOf(outingId);
  const expenses = loadExpenses(outingId);
  for (const e of expenses) {
    // Items with nobody assigned: assume the whole group and say so.
    const unassigned = e.items.filter((i) => i.shares.length === 0);
    if (unassigned.length) {
      const ids = members.map((m) => m.id);
      for (const it of unassigned) setItemShares(it.id, ids);
      if (!e.shareSource) run("UPDATE expenses SET share_source = 'assumed' WHERE id = ?", e.id);
      ask(outingId, { expenseId: e.id, kind: "shared_all", key: `shared_all:${e.id}`, text: `Who shared ${e.title}?`, detail: "Nobody was named, so we assumed everyone. Tap Edit on the expense to change it.", options: [{ id: "ok", label: "Everyone is right" }] });
    }
    const total = expenseTotal(e.id);
    if (e.payers.length === 0) {
      ask(outingId, {
        expenseId: e.id,
        kind: "payer",
        key: `payer:${e.id}`,
        text: `Who paid for ${e.title}?`,
        detail: e.source === "story" ? "Your story says what it cost but not who paid." : "Neither the upload nor your story says.",
        options: [...members.slice(0, 6).map((m) => ({ id: `set:${m.id}`, label: m.name.split(" ")[0] })), { id: "self", label: "Each paid their own share" }],
      });
    } else if (e.payers.reduce((a, p) => a + p.amount, 0) !== total && e.payers.length === 1) {
      run("UPDATE expense_payers SET amount = ? WHERE expense_id = ?", total, e.id); // single payer covers the (possibly corrected) total
    }
    for (const it of e.items.filter((i) => i.confidence === "low"))
      ask(outingId, {
        expenseId: e.id,
        kind: "line",
        key: `line:${it.id}`,
        text: `${it.name}: ${formatPKR(it.lineTotal)}?`,
        detail: `One receipt line is hard to read${it.raw ? `: “${it.raw}”` : ""}. Skipping keeps it flagged.`,
        options: [
          { id: `keep:${it.id}`, label: formatPKR(it.lineTotal) },
          { id: `amount:${it.id}`, label: "Other amount", input: "amount" },
        ],
      });
    if (e.declaredTotal !== null && e.declaredTotal !== total) {
      const gap = e.declaredTotal - total;
      ask(outingId, {
        expenseId: e.id,
        kind: "mismatch",
        key: `mismatch:${e.id}`,
        text: `${e.title} doesn’t add up`,
        detail: `Items and charges come to ${formatPKR(total)} but the receipt total is ${formatPKR(e.declaredTotal)} (gap ${formatPKR(gap, { signed: true })}).`,
        options: [
          { id: "gap", label: gap > 0 ? `Add ${formatPKR(gap)} as unlisted charge` : `Add ${formatPKR(-gap)} discount` },
          { id: "items", label: `Use ${formatPKR(total)}` },
        ],
        payload: { gap },
      });
    } else {
      run("UPDATE questions SET status = 'answered', answer = '\"resolved\"' WHERE qkey = ? AND status != 'answered'", `mismatch:${e.id}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The pipeline (streamed to the Processing screen)
// ---------------------------------------------------------------------------

export type StageId = "upload" | "extract" | "interpret" | "validate";
export interface StageEvent {
  stage: StageId;
  state: "done" | "active" | "pending" | "attention";
  detail: string;
  notice?: string;
}

export async function processOuting(outingId: string, user: User, emit: (e: StageEvent) => void) {
  const { me } = requireMember(outingId, user);
  const members = membersOf(outingId);
  const evidence = listEvidence(outingId);

  emit({ stage: "upload", state: "done", detail: `${evidence.length} of ${evidence.length} uploaded` });

  // Extraction
  const todo = evidence.filter((e) => e.status === "uploaded" || e.status === "failed");
  emit({ stage: "extract", state: "active", detail: todo.length ? `Reading 1 of ${todo.length}…` : "Nothing new to read" });
  let receipts = 0;
  let items = 0;
  let chargesFound = false;
  const notices: string[] = [];
  for (let i = 0; i < todo.length; i++) {
    const ev = todo[i];
    emit({ stage: "extract", state: "active", detail: `Reading ${i + 1} of ${todo.length}…` });
    const r = await extractOne(ev, members);
    if (!r.parsed) {
      run("UPDATE evidence SET status = 'failed', engine = ?, error = ? WHERE id = ?", r.engine, r.error ?? "OCR failed", ev.id);
      notices.push(`${ev.original_name ?? "One image"} couldn’t be read. Retake it or enter it by hand.`);
      ask(outingId, { kind: "unreadable", key: `unreadable:${ev.id}`, text: "One image couldn’t be read", detail: r.error ?? undefined, options: [{ id: "ok", label: "I’ll add it by hand" }] });
      continue;
    }
    const parsed = r.parsed;
    if (parsed.items.length === 0) {
      run("UPDATE evidence SET status = 'unreadable', engine = ?, parsed = ? WHERE id = ?", r.engine, JSON.stringify(parsed), ev.id);
      notices.push(`${ev.original_name ?? "One image"}: no amounts found. Crop or retake it, or add it by hand.`);
      ask(outingId, { kind: "unreadable", key: `unreadable:${ev.id}`, text: "No amounts found on one image", detail: parsed.notes.join(" "), options: [{ id: "ok", label: "I’ll add it by hand" }] });
      continue;
    }
    tx(() => {
      run("UPDATE evidence SET status = 'processed', engine = ?, parsed = ?, kind = ? WHERE id = ?", r.engine, JSON.stringify(parsed), parsed.kind === "ride" ? "ride" : ev.kind === "other" ? "receipt" : ev.kind, ev.id);
      upsertExpenseFromReceipt(outingId, { ...ev, kind: parsed.kind === "ride" ? "ride" : ev.kind }, parsed, me.id);
    });
    receipts++;
    items += parsed.items.length;
    chargesFound ||= parsed.charges.length > 0;
    const low = parsed.items.filter((x) => x.confidence === "low").length;
    if (low) notices.push(`${titleFor(ev, parsed)}: ${low === 1 ? "one line is" : `${low} lines are`} hard to read. We’ll ask you instead of guessing.`);
  }
  const extractDetail = todo.length
    ? `${receipts} read · ${items} items${chargesFound ? " · tax/charges found" : ""}${receipts < todo.length ? ` · ${todo.length - receipts} need you` : ""}`
    : "Already read";
  emit({ stage: "extract", state: receipts < todo.length ? "attention" : "done", detail: extractDetail, notice: notices[0] });

  // Interpretation
  const narrative = get<{ id: string; transcript: string }>("SELECT * FROM narratives WHERE outing_id = ? ORDER BY created_at DESC", outingId);
  let interpreter = "none";
  if (narrative?.transcript.trim()) {
    emit({ stage: "interpret", state: "active", detail: "Matching people to items, rides and payers…" });
    const ctx = narrativeContext(outingId, me.id);
    const result = await interpret(narrative.transcript, ctx);
    interpreter = result.interpreter;
    run("UPDATE narratives SET interpreter = ? WHERE id = ?", interpreter, narrative.id);
    const changes = tx(() => applyFacts(outingId, result.facts, { fromUser: false, actorMemberId: me.id }));
    const unclear = result.facts.filter((f) => f.type === "unparsed" || f.type === "unknownName").length;
    emit({ stage: "interpret", state: unclear ? "attention" : "done", detail: `${changes.length} facts from your story${unclear ? ` · ${unclear} unclear` : ""} (${interpreter === "claude" ? "Claude" : interpreter === "gemini" ? "Gemini" : "rule-based"})` });
  } else {
    emit({ stage: "interpret", state: "done", detail: "No story. Receipts alone also work." });
  }

  // Validation
  emit({ stage: "validate", state: "active", detail: "Items must match receipt totals; balances must sum to zero" });
  tx(() => validateDraft(outingId));
  bumpDraft(outingId);
  const open = listQuestions(outingId).filter((q) => q.status !== "answered" && q.blocking).length;
  emit({ stage: "validate", state: open ? "attention" : "done", detail: open ? `${open} quick question${open > 1 ? "s" : ""} for you` : "Everything adds up" });
  logActivity(outingId, me.id, "processed", `${me.name} ran “Read my outing” (${interpreter === "claude" ? "Claude" : interpreter === "rules" ? "rule-based" : "no story"})`);
  return { open, notices };
}

// ---------------------------------------------------------------------------
// Answers and conversational corrections
// ---------------------------------------------------------------------------

type Stored = { opt: string; meta?: Record<string, unknown> };
function storedAnswer(raw: string | null): Stored | null {
  if (!raw) return null;
  const v = JSON.parse(raw) as unknown;
  if (v && typeof v === "object" && "opt" in (v as object)) return v as Stored;
  if (typeof v === "number") return { opt: "amount", meta: { amount: v } };
  return { opt: String(v) };
}

/** Undo what a previous answer changed, so an answer can be switched or cleared (never stuck). */
function undoAnswer(q: QuestionRow, prev: Stored) {
  const meta = prev.meta ?? {};
  switch (q.kind) {
    case "confirm_share": {
      const [verdict, memberId, itemId] = prev.opt.split(":");
      if (verdict !== "no") return;
      if (itemId) {
        if (!get("SELECT 1 FROM item_shares WHERE item_id = ? AND member_id = ?", itemId, memberId)) run("INSERT INTO item_shares (item_id, member_id, weight) VALUES (?, ?, 1)", itemId, memberId);
      } else addMemberToExpense(q.expense_id!, memberId);
      return;
    }
    case "line": {
      const itemId = String(meta.itemId ?? prev.opt.split(":")[1] ?? "");
      if (!itemId) return;
      if (typeof meta.previous === "number") run("UPDATE items SET line_total = ? WHERE id = ?", meta.previous, itemId);
      run("UPDATE items SET confidence = 'low' WHERE id = ?", itemId);
      return;
    }
    case "mismatch":
      if (meta.chargeId) run("DELETE FROM charges WHERE id = ?", String(meta.chargeId));
      if (prev.opt === "items" && typeof meta.prevDeclared === "number") run("UPDATE expenses SET declared_total = ? WHERE id = ?", meta.prevDeclared, q.expense_id);
      return;
    case "amount":
      if (meta.expenseId) {
        run("DELETE FROM questions WHERE expense_id = ?", String(meta.expenseId));
        run("DELETE FROM expenses WHERE id = ?", String(meta.expenseId));
      }
      return;
    case "name":
      if (prev.opt === "add" && meta.memberId) {
        const id = String(meta.memberId);
        const used = get<{ n: number }>("SELECT COUNT(*) AS n FROM item_shares WHERE member_id = ?", id)!.n + get<{ n: number }>("SELECT COUNT(*) AS n FROM expense_payers WHERE member_id = ?", id)!.n;
        if (used) throw bad("That guest is already on expenses. Remove them from Members first, or keep this answer.", "ANSWER_LOCKED");
        run("DELETE FROM members WHERE id = ?", id);
      }
      return;
    case "change":
      if (prev.opt === "yes") run("DELETE FROM transfers WHERE outing_id = ? AND label = ?", q.outing_id, `${String(meta.key ?? "")}:change`);
      return;
    default:
      return;
  }
}

/** Each person on the expense paid exactly their own share (so it creates no debts). */
function setSelfPaid(outingId: string, expenseId: string) {
  const recs = loadExpenses(outingId);
  const e = recs.find((x) => x.id === expenseId);
  if (!e) return;
  const people = ledgerPeople(outingId, recs);
  const l = computeLedger({ members: people.members, expenses: [toLedgerExpense({ ...e, payers: [] })], allocation: "actual", rounding: "rupee" });
  run("DELETE FROM expense_payers WHERE expense_id = ?", expenseId);
  for (const [m, amt] of Object.entries(l.consumed)) if (amt > 0) run("INSERT INTO expense_payers (expense_id, member_id, amount) VALUES (?, ?, ?)", expenseId, m, amt);
  run("UPDATE expenses SET payer_source = 'you', confirmed = 1 WHERE id = ?", expenseId);
}

export function answerQuestion(questionId: string, user: User, input: { optionId: string; amount?: number | null; skip?: boolean; reopen?: boolean }) {
  const q = get<QuestionRow>("SELECT * FROM questions WHERE id = ?", questionId);
  if (!q) throw notFound("Question not found.");
  const { me } = requireMember(q.outing_id, user);
  const prev = q.status === "answered" ? storedAnswer(q.answer) : null;
  if (input.skip || input.reopen) {
    tx(() => {
      if (prev) undoAnswer(q, prev);
      run("UPDATE questions SET status = ?, answer = NULL WHERE id = ?", input.skip ? "skipped" : "open", q.id);
    });
    bumpDraft(q.outing_id);
    return;
  }
  const opt = input.optionId;
  tx(() => {
    if (prev) undoAnswer(q, prev);
    const done = (meta?: Record<string, unknown>) => run("UPDATE questions SET status = 'answered', answer = ? WHERE id = ?", JSON.stringify({ opt, meta } satisfies Stored), q.id);
    if (opt === "unsure") {
      run("UPDATE questions SET status = 'skipped', answer = NULL WHERE id = ?", q.id);
      return;
    }
    switch (q.kind) {
      case "payer":
      case "payer_conflict": {
        if (opt === "self") setSelfPaid(q.outing_id, q.expense_id!);
        else {
          setPayers(q.expense_id!, opt.replace(/^set:/, "").split("+"), "you");
          run("UPDATE expenses SET confirmed = 1 WHERE id = ?", q.expense_id);
        }
        return done();
      }
      case "confirm_share": {
        const [verdict, memberId, itemId] = opt.split(":");
        if (itemId) {
          if (verdict === "no") run("DELETE FROM item_shares WHERE item_id = ? AND member_id = ?", itemId, memberId);
          else if (verdict === "yes" && !get("SELECT 1 FROM item_shares WHERE item_id = ? AND member_id = ?", itemId, memberId)) run("INSERT INTO item_shares (item_id, member_id, weight) VALUES (?, ?, 1)", itemId, memberId);
        } else if (verdict === "no") removeMemberFromExpense(q.expense_id!, memberId);
        else if (verdict === "yes") addMemberToExpense(q.expense_id!, memberId);
        return done();
      }
      case "line": {
        const [action, itemId] = opt.split(":");
        const previous = get<{ line_total: number }>("SELECT line_total FROM items WHERE id = ?", itemId)?.line_total;
        if (action === "amount") {
          if (!input.amount || input.amount <= 0) throw bad("Enter the amount printed on the receipt.");
          run("UPDATE items SET line_total = ?, confidence = 'high' WHERE id = ?", input.amount, itemId);
        } else run("UPDATE items SET confidence = 'high' WHERE id = ?", itemId);
        return done({ itemId, previous, amount: input.amount ?? null });
      }
      case "mismatch": {
        const payload = JSON.parse(q.payload ?? "{}") as { gap: number };
        const prevDeclared = get<{ d: number | null }>("SELECT declared_total AS d FROM expenses WHERE id = ?", q.expense_id)?.d ?? null;
        let chargeId: string | null = null;
        if (opt === "gap") {
          chargeId = newId("ch_");
          run("INSERT INTO charges (id, expense_id, kind, label, amount, basis) VALUES (?, ?, ?, ?, ?, 'prorata')", chargeId, q.expense_id, payload.gap > 0 ? "other" : "discount", payload.gap > 0 ? "Unlisted charge (added by you)" : "Unlisted discount (added by you)", payload.gap);
        } else run("UPDATE expenses SET declared_total = NULL WHERE id = ?", q.expense_id);
        return done({ chargeId, prevDeclared });
      }
      case "amount": {
        if (opt === "ignore") return done();
        if (!input.amount || input.amount <= 0) throw bad("Enter an amount above zero.");
        const f = JSON.parse(q.payload!) as Extract<Fact, { type: "newExpense" }>;
        const expenseId = createStoryExpense(q.outing_id, f, me.id, input.amount);
        return done({ expenseId, amount: input.amount });
      }
      case "name": {
        const payload = JSON.parse(q.payload ?? "{}") as { name: string };
        if (opt === "add") {
          const m = addManualMember(q.outing_id, user, { name: payload.name, force: true });
          return done({ memberId: m.id });
        }
        return done();
      }
      case "change": {
        const p = JSON.parse(q.payload!) as { viaId: string; fromId: string; change: number; key: string };
        if (opt === "yes") recordChange(q.outing_id, p.viaId, p.fromId, p.change, p.key);
        return done({ key: p.key });
      }
      default:
        return done();
    }
  });
  if (q.kind === "mismatch" || q.kind === "line" || q.kind === "amount") tx(() => validateDraft(q.outing_id));
  bumpDraft(q.outing_id);
}

export async function applyCorrection(outingId: string, user: User, text: string) {
  const { me } = requireMember(outingId, user);
  if (!text.trim()) throw bad("Say or type what to fix.");
  const ctx = narrativeContext(outingId, me.id);
  const before = snapshotConsumption(outingId);
  const result = await interpret(text, ctx);
  const changes = tx(() => applyFacts(outingId, result.facts, { fromUser: true, actorMemberId: me.id }));
  if (changes.length) {
    for (const f of result.facts) if ("expenseId" in f && f.expenseId) run("UPDATE expenses SET confirmed = 1 WHERE id = ?", f.expenseId);
    tx(() => validateDraft(outingId));
    bumpDraft(outingId);
    logActivity(outingId, me.id, "correction", `${me.name} corrected: “${text.slice(0, 120)}”`);
  }
  const after = snapshotConsumption(outingId);
  const diff = Object.keys(after)
    .map((id) => ({ memberId: id, before: before[id] ?? 0, after: after[id] }))
    .filter((d) => d.before !== d.after);
  return { changes, diff, understood: changes.length > 0, interpreter: result.interpreter, unparsed: result.facts.filter((f) => f.type === "unparsed").map((f) => f.sentence) };
}

function snapshotConsumption(outingId: string): Record<string, number> {
  const recs = loadExpenses(outingId);
  const tr = loadPreTransfers(outingId);
  const l = computeLedger({ members: ledgerPeople(outingId, recs, tr).members, expenses: recs.map(toLedgerExpense), transfers: tr, allocation: "actual", rounding: "rupee" });
  return l.consumed;
}

export function saveNarrative(outingId: string, user: User, input: { transcript: string; mode: "voice" | "text" }) {
  const { me } = requireMember(outingId, user);
  const transcript = input.transcript.trim().slice(0, 5000);
  if (!transcript) throw bad("Say or type what happened first.");
  run("INSERT INTO narratives (id, outing_id, member_id, mode, transcript, created_at) VALUES (?, ?, ?, ?, ?, ?)", newId("nr_"), outingId, me.id, input.mode, transcript, now());
}

export function latestNarrative(outingId: string) {
  return get<{ transcript: string; mode: string; interpreter: string | null; created_at: string }>("SELECT transcript, mode, interpreter, created_at FROM narratives WHERE outing_id = ? ORDER BY created_at DESC", outingId) ?? null;
}

export type { ExpenseRecord };
