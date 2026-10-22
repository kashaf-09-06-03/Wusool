import "server-only";
import { all, get, newId, now, run, tx } from "./db";
import { conflict, forbidden, notFound } from "./http";
import { getOuting, membersOf, requireMember, requireOrganizer, type Member } from "./outings";
import { ledgerPeople, listEvidence, loadExpenses, loadPreTransfers, toLedgerExpense } from "./expenses";
import { listQuestions } from "./pipeline";
import { appUrl, logActivity, notify, whatsappOptedInCount } from "./notify";
import {
  checkInvariants,
  computeLedger,
  equalDeltas,
  netsFromEdges,
  optimizeRouting,
  type AllocationMode,
  type Edge,
  type LedgerTransfer,
  type RoutingMode,
  type RoutingRules,
} from "@/lib/ledger";
import { formatPKR, type Paisa } from "@/lib/money";
import type { User } from "./auth";

/** People transfer whole rupees; the ledger rounds shares to rupees (within PKR 1 each, shown in breakdowns). */
export const ROUNDING = "rupee" as const;

export interface BalanceRow {
  id: string;
  outing_id: string;
  plan_id: string;
  debtor_member_id: string;
  creditor_member_id: string;
  amount: number;
  claimed: number;
  confirmed: number;
  forgiven: number;
  status: BalanceStatus;
  prev_status: BalanceStatus | null;
  version: number;
  superseded: number;
  last_reminder_at: string | null;
  created_at: string;
  updated_at: string;
}
export type BalanceStatus = "requested" | "marked" | "confirmed" | "partial" | "disputed" | "maaf";

/** Settled amounts from the current (not yet superseded) balances, as ledger transfers. */
function liveSettlementTransfers(outingId: string): LedgerTransfer[] {
  const stored = all<{ id: string; from_member: string; to_member: string; amount: number; kind: LedgerTransfer["kind"] }>(
    "SELECT * FROM transfers WHERE outing_id = ? AND balance_id IS NOT NULL",
    outingId,
  ).map((t) => ({ id: t.id, from: t.from_member, to: t.to_member, amount: t.amount, kind: t.kind }));
  const live = all<BalanceRow>("SELECT * FROM balances WHERE outing_id = ? AND superseded = 0", outingId).flatMap((b) => {
    const out: LedgerTransfer[] = [];
    if (b.confirmed > 0) out.push({ id: `live-pay-${b.id}`, from: b.debtor_member_id, to: b.creditor_member_id, amount: b.confirmed, kind: "payment" });
    if (b.forgiven > 0) out.push({ id: `live-maaf-${b.id}`, from: b.debtor_member_id, to: b.creditor_member_id, amount: b.forgiven, kind: "waiver" });
    return out;
  });
  return [...stored, ...live];
}

export function latestPlan(outingId: string) {
  return get<{ id: string; version: number; allocation: AllocationMode; routing: RoutingMode; rules: string; snapshot: string; published_at: string; published_by_member_id: string }>(
    "SELECT * FROM plans WHERE outing_id = ? ORDER BY version DESC",
    outingId,
  );
}

export function parseRules(raw: string | null | undefined): RoutingRules {
  try {
    return raw ? (JSON.parse(raw) as RoutingRules) : {};
  } catch {
    return {};
  }
}

export interface PreviewInput {
  allocation: AllocationMode;
  routing: RoutingMode;
  rules: RoutingRules;
}

export function computePreview(outingId: string, input: PreviewInput) {
  const outing = getOuting(outingId);
  const members = membersOf(outingId);
  const records = loadExpenses(outingId);
  const expenses = records.map(toLedgerExpense);
  const pre = loadPreTransfers(outingId);
  const settled = liveSettlementTransfers(outingId);
  const transfers = [...pre, ...settled];
  const people = ledgerPeople(outingId, records, transfers);
  const ledgerMembers = people.members;
  const ledger = computeLedger({ members: ledgerMembers, expenses, transfers, allocation: input.allocation, rounding: ROUNDING, equalIds: people.activeIds });
  const optimized = optimizeRouting(ledger, expenses, pre, ledgerMembers, input.rules);
  const deltas = expenses.length ? equalDeltas({ members: ledgerMembers, expenses, transfers, rounding: ROUNDING, equalIds: people.activeIds }) : {};
  const invariants = checkInvariants(ledger);
  const questions = listQuestions(outingId);
  const openQuestions = questions.filter((q) => q.status !== "answered" && q.blocking);
  const eligibleTotal = records.filter((r) => r.equalEligible).reduce((a, r) => a + toLedgerExpense(r).items.reduce((s, i) => s + i.lineTotal, 0) + r.charges.reduce((s, c) => s + c.amount, 0), 0);
  const chosen: Edge[] = input.routing === "optimized" ? optimized.edges : ledger.originalDebts;
  const plan = latestPlan(outingId);
  const pendingClaims = get<{ n: number }>("SELECT COUNT(*) AS n FROM balances WHERE outing_id = ? AND superseded = 0 AND (claimed > 0 OR status = 'disputed')", outingId)!.n;

  const blockers: string[] = [];
  if (records.length === 0) blockers.push("Add at least one expense.");
  if (openQuestions.length) blockers.push(`${openQuestions.length} question${openQuestions.length > 1 ? "s" : ""} still need an answer.`);
  if (ledger.issues.length) blockers.push(...ledger.issues.map((i) => i.message));
  if (!invariants.totalsMatch || !invariants.netsSumToZero || !invariants.edgesMatchNets) blockers.push("Calculation check failed. Publishing is disabled.");
  if (input.routing === "optimized" && !optimized.netsPreserved) blockers.push("Optimized routing would change someone’s total.");
  if (plan && pendingClaims) blockers.push("Some payments are waiting for confirmation or are disputed. Resolve them before re-publishing.");

  const evidence = listEvidence(outingId);
  // E7 re-confirm: compare each person's cost (allocation) before and after the edit.
  const prevNets: Record<string, Paisa> | null = plan ? (JSON.parse(plan.snapshot) as { consumed: Record<string, Paisa> }).consumed : null;

  return {
    outingId,
    draftRev: outing.draft_rev,
    allocation: input.allocation,
    routing: input.routing,
    rules: input.rules,
    grandTotal: ledger.grandTotal,
    memberCount: members.length,
    sourceCounts: {
      receipts: evidence.filter((e) => e.kind === "receipt").length,
      rides: evidence.filter((e) => e.kind === "ride").length,
      manual: records.filter((r) => r.source === "manual").length,
      story: records.filter((r) => r.source === "story").length,
    },
    consumed: ledger.consumed,
    paid: ledger.paid,
    net: ledger.net,
    originalDebts: ledger.originalDebts,
    optimizedEdges: optimized.edges,
    pinnedEdges: optimized.pinned,
    chosenEdges: chosen,
    optimizedNets: netsFromEdges(optimized.edges, ledger.memberOrder),
    netsPreserved: optimized.netsPreserved,
    equalDeltas: deltas,
    equalShare: members.length ? Math.floor(eligibleTotal / members.length) : 0,
    invariants,
    issues: ledger.issues,
    blockers,
    questionsTotal: questions.filter((q) => q.blocking).length,
    questionsAnswered: questions.filter((q) => q.blocking && q.status === "answered").length,
    published: plan ? { version: plan.version, at: plan.published_at, allocation: plan.allocation, routing: plan.routing, prevNets } : null,
    hasUnpublishedChanges: plan ? (JSON.parse(plan.snapshot) as { draftRev: number }).draftRev !== outing.draft_rev : true,
    rounding: ROUNDING,
    roundingApplied: ledger.allocations.some((a) => a.lines.some((l) => l.kind === "rounding")),
    whatsappOptIns: whatsappOptedInCount(members.flatMap((m) => (m.user_id ? [m.user_id] : []))),
  };
}

export function previewFor(outingId: string, user: User, input: Partial<PreviewInput>) {
  requireMember(outingId, user);
  const outing = getOuting(outingId);
  return computePreview(outingId, {
    allocation: input.allocation ?? outing.allocation,
    routing: input.routing ?? outing.routing,
    rules: input.rules ?? parseRules(outing.rules),
  });
}

/** Persist the organizer's in-progress choices so every member sees the same pickers. */
export function saveChoices(outingId: string, user: User, input: Partial<PreviewInput>) {
  requireOrganizer(outingId, user);
  const o = getOuting(outingId);
  run("UPDATE outings SET allocation = ?, routing = ?, rules = ? WHERE id = ?", input.allocation ?? o.allocation, input.routing ?? o.routing, JSON.stringify(input.rules ?? parseRules(o.rules)), outingId);
}

export function publish(outingId: string, user: User, input: PreviewInput & { expectedRev: number }) {
  const { me, outing } = requireOrganizer(outingId, user);
  if (input.expectedRev !== outing.draft_rev) throw conflict("Something changed while you were reviewing. Check the latest version before publishing.", "STALE_DRAFT");
  const preview = computePreview(outingId, input);
  if (preview.blockers.length) throw conflict(preview.blockers[0], "PUBLISH_BLOCKED", { blockers: preview.blockers });
  const members = membersOf(outingId);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";
  const first = (id: string) => name(id).split(" ")[0];

  const result = tx(() => {
    const prev = latestPlan(outingId);
    // Re-publishing: keep what was already settled as explicit entries; never rewrite history silently.
    if (prev) {
      for (const b of all<BalanceRow>("SELECT * FROM balances WHERE outing_id = ? AND superseded = 0", outingId)) {
        if (b.confirmed > 0)
          run("INSERT INTO transfers (id, outing_id, from_member, to_member, amount, kind, label, source, balance_id, created_at) VALUES (?, ?, ?, ?, ?, 'payment', ?, 'settlement', ?, ?)", newId("t_"), outingId, b.debtor_member_id, b.creditor_member_id, b.confirmed, `Confirmed in v${prev.version}`, b.id, now());
        if (b.forgiven > 0)
          run("INSERT INTO transfers (id, outing_id, from_member, to_member, amount, kind, label, source, balance_id, created_at) VALUES (?, ?, ?, ?, ?, 'waiver', ?, 'settlement', ?, ?)", newId("t_"), outingId, b.debtor_member_id, b.creditor_member_id, b.forgiven, `Maaf in v${prev.version}`, b.id, now());
        run("UPDATE balances SET superseded = 1, updated_at = ? WHERE id = ?", now(), b.id);
        run("INSERT INTO balance_events (id, balance_id, type, actor_member_id, note, created_at) VALUES (?, ?, 'superseded', ?, ?, ?)", newId("be_"), b.id, me.id, `Replaced by version ${prev.version + 1}`, now());
      }
    }
    const version = (prev?.version ?? 0) + 1;
    const planId = newId("p_");
    const ledgerSnapshot = buildSnapshot(outingId, input, outing.draft_rev);
    run(
      "INSERT INTO plans (id, outing_id, version, allocation, routing, rules, snapshot, published_by_member_id, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      planId,
      outingId,
      version,
      input.allocation,
      input.routing,
      JSON.stringify(input.rules),
      JSON.stringify(ledgerSnapshot),
      me.id,
      now(),
    );
    for (const e of ledgerSnapshot.edges) {
      const id = newId("b_");
      run(
        "INSERT INTO balances (id, outing_id, plan_id, debtor_member_id, creditor_member_id, amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?)",
        id,
        outingId,
        planId,
        e.from,
        e.to,
        e.amount,
        now(),
        now(),
      );
      run("INSERT INTO balance_events (id, balance_id, type, actor_member_id, amount, created_at) VALUES (?, ?, 'created', ?, ?, ?)", newId("be_"), id, me.id, e.amount, now());
    }
    run("UPDATE outings SET allocation = ?, routing = ?, rules = ? WHERE id = ?", input.allocation, input.routing, JSON.stringify(input.rules), outingId);
    logActivity(outingId, me.id, "published", `${me.name} published version ${version}: ${input.allocation === "equal" ? "Equal split" : "Actual / individual"}, ${input.routing === "optimized" ? "optimized" : "original"} transfers (${ledgerSnapshot.edges.length})`);
    return { planId, version, edges: ledgerSnapshot.edges, net: ledgerSnapshot.net };
  });

  // In-app breakdown to everyone; WhatsApp only for those who opted in (simulated).
  for (const m of members) {
    if (!m.user_id) continue;
    const owe = result.edges.filter((e) => e.from === m.id);
    const owed = result.edges.filter((e) => e.to === m.id);
    const lines = [
      ...owe.map((e) => `Pay ${first(e.to)} ${formatPKR(e.amount)}`),
      ...owed.map((e) => `${first(e.from)} pays you ${formatPKR(e.amount)}`),
    ];
    const body = lines.length ? lines.join(" · ") : "You’re all square on this outing.";
    notify({
      userId: m.user_id,
      outingId,
      type: "breakdown",
      title: `${outing.name}: your breakdown is ready${result.version > 1 ? ` (v${result.version})` : ""}`,
      body,
      link: `/o/${outingId}/me`,
      whatsapp: { text: `Wusool · ${outing.name}\n${body}\nSee why: ${appUrl(`/o/${outingId}/me`)}` },
    });
  }
  // Small-debt quick choice for opted-in creditors (target integration H4; simulated here).
  for (const e of result.edges) {
    const creditor = members.find((m) => m.id === e.to);
    if (!creditor?.user_id) continue;
    const threshold = get<{ threshold: number }>("SELECT threshold FROM users WHERE id = ?", creditor.user_id)?.threshold ?? 10000;
    if (e.amount >= threshold) continue;
    const bal = get<{ id: string }>("SELECT id FROM balances WHERE plan_id = ? AND debtor_member_id = ? AND creditor_member_id = ?", result.planId, e.from, e.to);
    notify({
      userId: creditor.user_id,
      outingId,
      type: "wusool_maaf",
      title: `${first(e.from)} owes you ${formatPKR(e.amount)}`,
      body: "It’s below your small-debt threshold. Wusool or Maaf?",
      link: `/balances?focus=${bal?.id}`,
      whatsapp: { text: `${first(e.from)} owes you ${formatPKR(e.amount)}. Wusool or Maaf?`, balanceId: bal?.id, buttons: ["Wusool", "Maaf"] },
    });
  }
  return { planId: result.planId, version: result.version };
}

interface Snapshot {
  draftRev: number;
  allocation: AllocationMode;
  routing: RoutingMode;
  grandTotal: Paisa;
  net: Record<string, Paisa>;
  consumed: Record<string, Paisa>;
  paid: Record<string, Paisa>;
  originalDebts: Edge[];
  edges: Edge[];
  lines: { memberId: string; expenseId: string; kind: string; refId: string; label: string; amount: Paisa; weight?: number; totalWeight?: number }[];
  expenses: { id: string; title: string; source: string; total: Paisa; itemSubtotal: Paisa; payers: { memberId: string; amount: Paisa }[]; evidenceId: string | null; charges: { label: string; amount: Paisa }[]; itemSharers: Record<string, string[]> }[];
  members: { id: string; name: string }[];
}

function buildSnapshot(outingId: string, input: PreviewInput, draftRev: number): Snapshot {
  const members = membersOf(outingId);
  const records = loadExpenses(outingId);
  const expenses = records.map(toLedgerExpense);
  const pre = loadPreTransfers(outingId);
  const settled = all<{ id: string; from_member: string; to_member: string; amount: number; kind: LedgerTransfer["kind"] }>("SELECT * FROM transfers WHERE outing_id = ? AND balance_id IS NOT NULL", outingId).map((t) => ({
    id: t.id,
    from: t.from_member,
    to: t.to_member,
    amount: t.amount,
    kind: t.kind,
  }));
  const people = ledgerPeople(outingId, records, [...pre, ...settled]);
  const lm = people.members;
  const ledger = computeLedger({ members: lm, expenses, transfers: [...pre, ...settled], allocation: input.allocation, rounding: ROUNDING, equalIds: people.activeIds });
  const routed = optimizeRouting(ledger, expenses, pre, lm, input.rules);
  return {
    draftRev,
    allocation: input.allocation,
    routing: input.routing,
    grandTotal: ledger.grandTotal,
    net: ledger.net,
    consumed: ledger.consumed,
    paid: ledger.paid,
    originalDebts: ledger.originalDebts,
    edges: input.routing === "optimized" ? routed.edges : ledger.originalDebts,
    lines: ledger.allocations.flatMap((a) => a.lines),
    expenses: records.map((r) => {
      const a = ledger.allocations.find((x) => x.expenseId === r.id)!;
      return {
        id: r.id,
        title: r.title,
        source: r.source,
        total: a.total,
        itemSubtotal: a.itemSubtotal,
        payers: r.payers,
        evidenceId: r.evidenceId,
        charges: r.charges.map((c) => ({ label: c.label, amount: c.amount })),
        itemSharers: Object.fromEntries(r.items.map((i) => [i.id, i.shares.map((s) => s.memberId)])),
      };
    }),
    members: members.map((m) => ({ id: m.id, name: m.name })),
  };
}

/** F4: my breakdown only. Other people’s individual items are never returned. */
export function myBreakdown(outingId: string, user: User) {
  const { me, outing } = requireMember(outingId, user);
  const plan = latestPlan(outingId);
  if (!plan) return { published: false as const, outing: { id: outing.id, name: outing.name } };
  const snap = JSON.parse(plan.snapshot) as Snapshot;
  const nameOf = (id: string) => snap.members.find((m) => m.id === id)?.name ?? membersOf(outingId, true).find((m) => m.id === id)?.name ?? "Former member";
  const mine = snap.lines.filter((l) => l.memberId === me.id);
  const byExpense = snap.expenses
    .map((e) => {
      const lines = mine.filter((l) => l.expenseId === e.id);
      if (!lines.length) return null;
      const itemLines = lines.filter((l) => l.kind === "item" || l.kind === "equal");
      const myItemSubtotal = itemLines.filter((l) => l.kind === "item").reduce((a, l) => a + l.amount, 0);
      return {
        expenseId: e.id,
        title: e.title,
        source: e.source,
        total: e.total,
        evidenceId: e.evidenceId,
        payers: e.payers.map((p) => ({ name: nameOf(p.memberId), amount: p.amount, isMe: p.memberId === me.id })),
        myTotal: lines.reduce((a, l) => a + l.amount, 0),
        items: itemLines.map((l) => ({
          label: l.label,
          amount: l.amount,
          kind: l.kind,
          sharedWith: l.kind === "item" ? (e.itemSharers[l.refId] ?? []).filter((id) => id !== me.id).map((id) => nameOf(id).split(" ")[0]) : [],
          weight: l.weight,
          totalWeight: l.totalWeight,
        })),
        charges: lines.filter((l) => l.kind === "charge").map((l) => ({ label: l.label, amount: l.amount })),
        rounding: lines.filter((l) => l.kind === "rounding").reduce((a, l) => a + l.amount, 0),
        chargeBasis: { myItemSubtotal, itemSubtotal: e.itemSubtotal },
      };
    })
    .filter(Boolean);
  const balances = all<BalanceRow>("SELECT * FROM balances WHERE plan_id = ? AND (debtor_member_id = ? OR creditor_member_id = ?)", plan.id, me.id, me.id);
  const original = snap.originalDebts.filter((e) => e.from === me.id || e.to === me.id);
  return {
    published: true as const,
    outing: { id: outing.id, name: outing.name },
    me: { id: me.id, name: me.name },
    version: plan.version,
    allocation: plan.allocation,
    routing: plan.routing,
    consumed: snap.consumed[me.id] ?? 0,
    paid: snap.paid[me.id] ?? 0,
    net: snap.net[me.id] ?? 0,
    expenses: byExpense,
    original: original.map((e) => ({ from: nameOf(e.from), to: nameOf(e.to), amount: e.amount, iOwe: e.from === me.id })),
    transfers: balances.map((b) => ({
      balanceId: b.id,
      iOwe: b.debtor_member_id === me.id,
      other: nameOf(b.debtor_member_id === me.id ? b.creditor_member_id : b.debtor_member_id),
      amount: b.amount,
      status: b.superseded ? "superseded" : b.status,
    })),
  };
}

export function outingSummaryForMember(outingId: string, memberId: string): { owed: Paisa; owe: Paisa; settled: boolean; published: boolean } {
  const rows = all<BalanceRow>("SELECT * FROM balances WHERE outing_id = ? AND superseded = 0", outingId);
  if (!rows.length) return { owed: 0, owe: 0, settled: false, published: Boolean(latestPlan(outingId)) };
  let owed = 0;
  let owe = 0;
  for (const b of rows) {
    const outstanding = b.amount - b.confirmed - b.forgiven;
    if (outstanding <= 0) continue;
    if (b.creditor_member_id === memberId) owed += outstanding;
    if (b.debtor_member_id === memberId) owe += outstanding;
  }
  const settled = rows.every((b) => b.status === "confirmed" || b.status === "maaf");
  return { owed, owe, settled, published: true };
}

export function assertBalanceAccess(balanceId: string, user: User): { b: BalanceRow; me: Member; role: "debtor" | "creditor" | "organizer" } {
  const b = get<BalanceRow>("SELECT * FROM balances WHERE id = ?", balanceId);
  if (!b) throw notFound("This balance doesn’t exist.");
  const { me } = requireMember(b.outing_id, user);
  const role = me.id === b.debtor_member_id ? "debtor" : me.id === b.creditor_member_id ? "creditor" : me.role === "organizer" ? "organizer" : null;
  if (!role) throw forbidden("Only the two people involved (or the organizer) can see this balance.");
  return { b, me, role };
}
