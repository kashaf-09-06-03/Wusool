/**
 * Wusool ledger engine — deterministic, integer-paisa, no I/O, no AI.
 *
 * Two separate decisions (CLAUDE.md §5.6):
 *   1. Allocation  ("who pays for what")  → changes what each person owes.
 *   2. Routing     ("who pays whom")      → never changes anyone's net position.
 *
 * Original debts = for every expense, each consumer owes the payer(s) their share;
 * cash movements (handoffs, change, recorded payments) are applied; then reciprocal
 * pairs are netted. This reproduces the Figma sample exactly (9 original transfers).
 */
import type { Paisa } from "../money";
import { splitByWeights, splitEqually, splitMatrix } from "./split";

export { splitByWeights, splitEqually, splitMatrix };

export type AllocationMode = "actual" | "equal";
export type RoutingMode = "original" | "optimized";

export interface LedgerMember {
  id: string;
  name: string;
  noBankAccount?: boolean;
}
export interface ShareSpec {
  memberId: string;
  weight: number;
}
export interface LedgerItem {
  id: string;
  name: string;
  quantity?: number;
  lineTotal: Paisa;
  shares: ShareSpec[];
}
export type ChargeKind = "tax" | "service" | "fee" | "tip" | "discount" | "other";
export interface LedgerCharge {
  id: string;
  kind: ChargeKind;
  label: string;
  /** Signed: discounts are negative. */
  amount: Paisa;
  /** prorata: split by each person's item subtotal (default). equal: split equally among the expense's participants. */
  basis?: "prorata" | "equal";
}
export interface LedgerPayer {
  memberId: string;
  amount: Paisa;
}
export interface LedgerExpense {
  id: string;
  title: string;
  payers: LedgerPayer[];
  items: LedgerItem[];
  charges: LedgerCharge[];
  /** Total printed on the receipt / entered by the user; used to detect mismatches. */
  declaredTotal?: Paisa | null;
  /** Excluded from Equal split when false (e.g. one person's private purchase). Default true. */
  equalEligible?: boolean;
  /** Per-expense split: "itemised" (default — who had what) or "equal" among this expense's people. */
  split?: "itemised" | "equal";
  /** When optimizing, keep this expense's debts as direct payments to its payer(s). */
  direct?: boolean;
}
export interface LedgerTransfer {
  id: string;
  from: string;
  to: string;
  amount: Paisa;
  /** When `from` paid `to` on behalf of someone else (e.g. Mariam paid Ayesha for Talha). */
  onBehalfOf?: string | null;
  kind: "handoff" | "change" | "payment" | "waiver" | "adjustment";
  label?: string;
}
export interface Edge {
  from: string;
  to: string;
  amount: Paisa;
}

export type LineKind = "item" | "charge" | "equal" | "rounding";
export interface AllocationLine {
  memberId: string;
  expenseId: string;
  kind: LineKind;
  refId: string;
  label: string;
  amount: Paisa;
  /** For item lines: the member's weight and the total weight, for "why" explanations. */
  weight?: number;
  totalWeight?: number;
}

export interface LedgerIssue {
  code:
    | "TOTAL_MISMATCH"
    | "PAYER_MISMATCH"
    | "NO_PAYER"
    | "ITEM_UNASSIGNED"
    | "UNKNOWN_MEMBER"
    | "EMPTY_EXPENSE"
    | "INVALID_AMOUNT";
  message: string;
  expenseId?: string;
  refId?: string;
  /** Signed gap where relevant (declared − computed). */
  gap?: Paisa;
}

export interface ExpenseAllocation {
  expenseId: string;
  total: Paisa;
  itemSubtotal: Paisa;
  perMember: Record<string, Paisa>;
  lines: AllocationLine[];
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const add = (rec: Record<string, Paisa>, k: string, v: Paisa) => {
  rec[k] = (rec[k] ?? 0) + v;
};

export function expenseTotal(e: LedgerExpense): Paisa {
  return sum(e.items.map((i) => i.lineTotal)) + sum(e.charges.map((c) => c.amount));
}

/** Members who consume part of the expense (have a positive share in any item). */
export function expenseParticipants(e: LedgerExpense): string[] {
  const seen: string[] = [];
  for (const it of e.items) for (const s of it.shares) if (s.weight > 0 && !seen.includes(s.memberId)) seen.push(s.memberId);
  return seen;
}

/** Itemised ("actual / individual") allocation of one expense. */
export function allocateActual(e: LedgerExpense, memberOrder: readonly string[]): ExpenseAllocation {
  const perMember: Record<string, Paisa> = {};
  const lines: AllocationLine[] = [];
  const subtotals: Record<string, Paisa> = {};
  const order = (ids: string[]) => [...ids].sort((a, b) => memberOrder.indexOf(a) - memberOrder.indexOf(b));

  for (const it of e.items) {
    const shares = it.shares.filter((s) => s.weight > 0);
    if (shares.length === 0) continue; // reported as ITEM_UNASSIGNED by validate()
    const totalWeight = sum(shares.map((s) => s.weight));
    const parts = splitByWeights(it.lineTotal, shares.map((s) => s.weight));
    shares.forEach((s, i) => {
      add(subtotals, s.memberId, parts[i]);
      add(perMember, s.memberId, parts[i]);
      lines.push({
        memberId: s.memberId,
        expenseId: e.id,
        kind: "item",
        refId: it.id,
        label: it.name,
        amount: parts[i],
        weight: s.weight,
        totalWeight,
      });
    });
  }

  const participants = order(Object.keys(subtotals));
  // Charges are pooled by sign and basis so that every person's tax/fee share is computed
  // once against the pooled amount (minimising rounding), then itemised per charge for "why".
  const pools: { basis: "prorata" | "equal"; positive: boolean }[] = [
    { basis: "prorata", positive: true },
    { basis: "prorata", positive: false },
    { basis: "equal", positive: true },
    { basis: "equal", positive: false },
  ];
  for (const pool of pools) {
    const charges = e.charges.filter(
      (c) => (c.basis ?? "prorata") === pool.basis && (pool.positive ? c.amount > 0 : c.amount < 0),
    );
    if (charges.length === 0 || participants.length === 0) continue;
    const pooled = sum(charges.map((c) => c.amount));
    const weights =
      pool.basis === "prorata" ? participants.map((m) => Math.max(0, subtotals[m] ?? 0)) : participants.map(() => 1);
    const personShares = splitByWeights(pooled, weights);
    participants.forEach((m, pi) => {
      const perCharge = splitByWeights(personShares[pi], charges.map((c) => Math.abs(c.amount)));
      charges.forEach((c, ci) => {
        if (perCharge[ci] === 0) return;
        add(perMember, m, perCharge[ci]);
        lines.push({ memberId: m, expenseId: e.id, kind: "charge", refId: c.id, label: c.label, amount: perCharge[ci] });
      });
    });
  }

  return { expenseId: e.id, total: expenseTotal(e), itemSubtotal: sum(e.items.map((i) => i.lineTotal)), perMember, lines };
}

/** Equal allocation of one expense across the given members. */
export function allocateEqual(e: LedgerExpense, memberIds: readonly string[], precomputed?: Record<string, Paisa>): ExpenseAllocation {
  const total = expenseTotal(e);
  const parts = precomputed ? memberIds.map((m) => precomputed[m] ?? 0) : splitEqually(total, memberIds.length);
  const perMember: Record<string, Paisa> = {};
  const lines: AllocationLine[] = [];
  memberIds.forEach((m, i) => {
    perMember[m] = parts[i];
    lines.push({ memberId: m, expenseId: e.id, kind: "equal", refId: e.id, label: `${e.title} (equal share)`, amount: parts[i] });
  });
  return { expenseId: e.id, total, itemSubtotal: sum(e.items.map((i) => i.lineTotal)), perMember, lines };
}

export function validateExpenses(members: readonly LedgerMember[], expenses: readonly LedgerExpense[]): LedgerIssue[] {
  const ids = new Set(members.map((m) => m.id));
  const issues: LedgerIssue[] = [];
  for (const e of expenses) {
    const total = expenseTotal(e);
    if (e.items.length === 0) issues.push({ code: "EMPTY_EXPENSE", message: `${e.title} has no items or amount.`, expenseId: e.id });
    for (const it of e.items) {
      if (!Number.isSafeInteger(it.lineTotal)) issues.push({ code: "INVALID_AMOUNT", message: `${it.name}: invalid amount.`, expenseId: e.id, refId: it.id });
      if (!it.shares.some((s) => s.weight > 0))
        issues.push({ code: "ITEM_UNASSIGNED", message: `Nobody is assigned to “${it.name}”.`, expenseId: e.id, refId: it.id });
      for (const s of it.shares) if (!ids.has(s.memberId)) issues.push({ code: "UNKNOWN_MEMBER", message: `Unknown person on “${it.name}”.`, expenseId: e.id, refId: it.id });
    }
    if (e.payers.length === 0) issues.push({ code: "NO_PAYER", message: `Who paid for ${e.title}?`, expenseId: e.id });
    else {
      const paid = sum(e.payers.map((p) => p.amount));
      if (paid !== total)
        issues.push({ code: "PAYER_MISMATCH", message: `${e.title}: payers cover ${paid / 100} but the expense is ${total / 100}.`, expenseId: e.id, gap: total - paid });
      for (const p of e.payers) if (!ids.has(p.memberId)) issues.push({ code: "UNKNOWN_MEMBER", message: `Unknown payer on ${e.title}.`, expenseId: e.id });
    }
    if (e.declaredTotal != null && e.declaredTotal !== total)
      issues.push({
        code: "TOTAL_MISMATCH",
        message: `${e.title}: receipt total and items + charges differ.`,
        expenseId: e.id,
        gap: e.declaredTotal - total,
      });
  }
  return issues;
}

/** Pairwise-net a debt matrix into edges (debtor → creditor). Deterministic order. */
export function netPairs(D: Map<string, Map<string, Paisa>>, memberOrder: readonly string[]): Edge[] {
  const edges: Edge[] = [];
  const ids = [...memberOrder];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const x = (D.get(a)?.get(b) ?? 0) - (D.get(b)?.get(a) ?? 0);
      if (x > 0) edges.push({ from: a, to: b, amount: x });
      else if (x < 0) edges.push({ from: b, to: a, amount: -x });
    }
  return sortEdges(edges, memberOrder);
}

export function sortEdges(edges: Edge[], memberOrder: readonly string[]): Edge[] {
  return edges.sort(
    (x, y) => y.amount - x.amount || memberOrder.indexOf(x.from) - memberOrder.indexOf(y.from) || memberOrder.indexOf(x.to) - memberOrder.indexOf(y.to),
  );
}

export function netsFromEdges(edges: readonly Edge[], memberIds: readonly string[]): Record<string, Paisa> {
  const net: Record<string, Paisa> = Object.fromEntries(memberIds.map((m) => [m, 0]));
  for (const e of edges) {
    net[e.from] = (net[e.from] ?? 0) - e.amount;
    net[e.to] = (net[e.to] ?? 0) + e.amount;
  }
  return net;
}

export interface LedgerInput {
  members: readonly LedgerMember[];
  expenses: readonly LedgerExpense[];
  transfers?: readonly LedgerTransfer[];
  allocation: AllocationMode;
  /** Who an outing-wide Equal split is divided among (defaults to all members). */
  equalIds?: readonly string[];
  /**
   * "rupee": shares are rounded to whole rupees (people transfer whole rupees). Each expense still
   * sums exactly, every person stays within PKR 1 of their exact share overall, and the adjustment
   * appears as an explicit "rounding" line. Applied only when all expense totals are whole rupees.
   * "paisa" (default): exact to the paisa.
   */
  rounding?: "paisa" | "rupee";
}

export interface LedgerResult {
  allocation: AllocationMode;
  memberOrder: string[];
  allocations: ExpenseAllocation[];
  /** Cost of what each person consumed under the chosen allocation. */
  consumed: Record<string, Paisa>;
  /** What each person paid towards expenses. */
  paid: Record<string, Paisa>;
  /** Cash sent minus cash received through transfers. */
  transferred: Record<string, Paisa>;
  /** Positive = is owed money; negative = owes money. Sums to zero. */
  net: Record<string, Paisa>;
  originalDebts: Edge[];
  /** Raw consumer → payer debts per expense (before netting), used for per-expense direct routing. */
  expenseDebts: Record<string, Edge[]>;
  issues: LedgerIssue[];
  grandTotal: Paisa;
}

export function computeLedger(input: LedgerInput): LedgerResult {
  const memberOrder = input.members.map((m) => m.id);
  const issues = validateExpenses(input.members, input.expenses);
  const consumed: Record<string, Paisa> = Object.fromEntries(memberOrder.map((m) => [m, 0]));
  const paid: Record<string, Paisa> = Object.fromEntries(memberOrder.map((m) => [m, 0]));
  const transferred: Record<string, Paisa> = Object.fromEntries(memberOrder.map((m) => [m, 0]));
  const D = new Map<string, Map<string, Paisa>>();
  const owe = (debtor: string, creditor: string, amount: Paisa) => {
    if (debtor === creditor || amount === 0) return;
    if (!D.has(debtor)) D.set(debtor, new Map());
    const row = D.get(debtor)!;
    row.set(creditor, (row.get(creditor) ?? 0) + amount);
  };

  // Equal split divides the POOLED eligible total, so everyone's share is identical to the paisa.
  // Cumulative rounding keeps each expense's column exact as well: the share of expense k is the
  // difference between the equal split of the running total after k and after k−1 expenses.
  const equalShares = new Map<string, Record<string, Paisa>>();
  if (input.allocation === "equal") {
    let running = 0;
    const eq = input.equalIds?.length ? memberOrder.filter((m) => input.equalIds!.includes(m)) : memberOrder;
    let prev = splitEqually(0, eq.length);
    for (const e of input.expenses) {
      if (e.equalEligible === false) continue;
      running += expenseTotal(e);
      const cur = splitEqually(running, eq.length);
      equalShares.set(e.id, Object.fromEntries(eq.map((m, i) => [m, cur[i] - prev[i]])));
      prev = cur;
    }
  }

  const allocations: ExpenseAllocation[] = [];
  for (const e of input.expenses) {
    const shares = equalShares.get(e.id);
    if (shares) allocations.push(allocateEqual(e, Object.keys(shares), shares));
    else if (e.split === "equal") {
      // Per-expense Equal: the whole expense (items + charges) divided equally among its own people.
      const people = memberOrder.filter((m) => expenseParticipants(e).includes(m));
      allocations.push(people.length ? allocateEqual(e, people) : allocateActual(e, memberOrder));
    } else allocations.push(allocateActual(e, memberOrder));
  }

  // Whole-rupee rounding, only among each expense's own participants (nobody is charged for something
  // they didn't have). Leftover fractions carry forward per person, so each expense stays exact and each
  // person's total stays within one rupee of exact. The difference is shown as an explicit line.
  const rupee = input.rounding === "rupee" && input.expenses.every((e) => expenseTotal(e) % 100 === 0);
  if (rupee) {
    const carry: Record<string, number> = Object.fromEntries(memberOrder.map((m) => [m, 0]));
    for (const alloc of allocations) {
      const parts = memberOrder.filter((m) => (alloc.perMember[m] ?? 0) !== 0);
      if (!parts.length) continue;
      const exact = parts.map((m) => alloc.perMember[m]);
      const floors = exact.map((v) => Math.floor(v / 100) * 100);
      let units = Math.round((alloc.total - floors.reduce((a, b) => a + b, 0)) / 100);
      const order = parts.map((m, i) => ({ i, p: exact[i] - floors[i] + carry[m] })).sort((a, b) => b.p - a.p || a.i - b.i);
      const shares = [...floors];
      for (let k = 0; units > 0; k = (k + 1) % order.length, units--) shares[order[k].i] += 100;
      parts.forEach((m, i) => {
        carry[m] += exact[i] - shares[i];
        if (shares[i] !== exact[i]) {
          alloc.lines.push({ memberId: m, expenseId: alloc.expenseId, kind: "rounding", refId: alloc.expenseId, label: "Rounding to whole rupees", amount: shares[i] - exact[i] });
          alloc.perMember[m] = shares[i];
        }
      });
    }
  }

  const expenseDebts: Record<string, Edge[]> = {};
  for (const e of input.expenses) {
    const alloc = allocations.find((a) => a.expenseId === e.id)!;
    for (const p of e.payers) paid[p.memberId] = (paid[p.memberId] ?? 0) + p.amount;
    const consumers = Object.entries(alloc.perMember);
    for (const [m, share] of consumers) consumed[m] = (consumed[m] ?? 0) + share;
    if (e.payers.length === 0) continue;
    // Each consumer owes each payer a part of their share. The matrix is rounded so that every row
    // equals the consumer's share AND every column equals what that payer actually paid — otherwise
    // debts would drift from net positions by a paisa (or a rupee) with several payers.
    const rows = consumers.map(([, s]) => s);
    const cols = e.payers.map((p) => p.amount);
    const unit = rupee && rows.every((v) => v % 100 === 0) && cols.every((v) => v % 100 === 0) ? 100 : 1;
    const matrix = splitMatrix(rows, cols, unit);
    const raw: Edge[] = [];
    consumers.forEach(([m], i) =>
      e.payers.forEach((p, j) => {
        if (m === p.memberId || matrix[i][j] === 0) return;
        owe(m, p.memberId, matrix[i][j]);
        raw.push({ from: m, to: p.memberId, amount: matrix[i][j] });
      }),
    );
    expenseDebts[e.id] = raw;
  }

  for (const t of input.transfers ?? []) {
    transferred[t.from] = (transferred[t.from] ?? 0) + t.amount;
    transferred[t.to] = (transferred[t.to] ?? 0) - t.amount;
    if (t.onBehalfOf && t.onBehalfOf !== t.from) {
      owe(t.to, t.onBehalfOf, t.amount); // settles the beneficiary's debt to the recipient
      owe(t.onBehalfOf, t.from, t.amount); // the beneficiary now owes whoever fronted it
    } else {
      owe(t.to, t.from, t.amount);
    }
  }

  const net: Record<string, Paisa> = {};
  for (const m of memberOrder) net[m] = paid[m] - consumed[m] + transferred[m];

  return {
    allocation: input.allocation,
    memberOrder,
    allocations,
    consumed,
    paid,
    transferred,
    net,
    originalDebts: netPairs(D, memberOrder),
    expenseDebts,
    issues,
    grandTotal: sum(input.expenses.map(expenseTotal)),
  };
}

// ---------------------------------------------------------------------------
// Routing (settlement optimisation). Never changes net positions.
// ---------------------------------------------------------------------------

export interface RoutingRules {
  /** Only route money between people who shared an expense or a transfer ("people I know"). */
  onlyKnown?: boolean;
  /** Everyone pays this person, who then pays everyone owed. Off by default (CLAUDE.md: never silently reroute). */
  collectorId?: string | null;
  /** Members without a bank account keep their original transfers untouched (cash). */
  skipNoAccount?: boolean;
}

export function knownPairs(expenses: readonly LedgerExpense[], transfers: readonly LedgerTransfer[] = []): Set<string> {
  const known = new Set<string>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    known.add(`${a}|${b}`);
    known.add(`${b}|${a}`);
  };
  for (const e of expenses) {
    const people = [...new Set([...expenseParticipants(e), ...e.payers.map((p) => p.memberId)])];
    for (const a of people) for (const b of people) link(a, b);
  }
  for (const t of transfers) {
    link(t.from, t.to);
    if (t.onBehalfOf) {
      link(t.onBehalfOf, t.from);
      link(t.onBehalfOf, t.to);
    }
  }
  return known;
}

/** Greedy debtor–creditor matching on net balances. Practical, not guaranteed minimal. */
export function greedySettle(net: Record<string, Paisa>, memberOrder: readonly string[]): Edge[] {
  const idx = (m: string) => memberOrder.indexOf(m);
  const creditors = memberOrder.filter((m) => (net[m] ?? 0) > 0).map((m) => ({ m, v: net[m] }));
  const debtors = memberOrder.filter((m) => (net[m] ?? 0) < 0).map((m) => ({ m, v: -net[m] }));
  const byAmount = (a: { m: string; v: number }, b: { m: string; v: number }) => b.v - a.v || idx(a.m) - idx(b.m);
  const edges: Edge[] = [];
  while (creditors.length && debtors.length) {
    creditors.sort(byAmount);
    debtors.sort(byAmount);
    const c = creditors[0];
    const d = debtors[0];
    const x = Math.min(c.v, d.v);
    edges.push({ from: d.m, to: c.m, amount: x });
    c.v -= x;
    d.v -= x;
    if (c.v === 0) creditors.shift();
    if (d.v === 0) debtors.shift();
  }
  return sortEdges(edges, memberOrder);
}

/**
 * Path shortening restricted to allowed pairs: a→b and b→c become a→c when a may pay c.
 * Every step strictly reduces total edge weight, so it terminates; nets are preserved.
 */
export function shortenPaths(edges: readonly Edge[], allowed: (a: string, b: string) => boolean, memberOrder: readonly string[]): Edge[] {
  const W = new Map<string, number>();
  const key = (a: string, b: string) => `${a}|${b}`;
  const addW = (a: string, b: string, v: number) => {
    if (a === b || v === 0) return;
    const back = W.get(key(b, a)) ?? 0;
    if (back > 0) {
      const m = Math.min(back, v);
      W.set(key(b, a), back - m);
      v -= m;
    }
    if (v > 0) W.set(key(a, b), (W.get(key(a, b)) ?? 0) + v);
  };
  for (const e of edges) addW(e.from, e.to, e.amount);
  const list = () =>
    sortEdges(
      [...W.entries()].filter(([, v]) => v > 0).map(([k, v]) => {
        const [from, to] = k.split("|");
        return { from, to, amount: v };
      }),
      memberOrder,
    );
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 10_000) {
    changed = false;
    const es = list();
    outer: for (const ab of es)
      for (const bc of es) {
        if (ab.to !== bc.from || ab.from === bc.to) continue;
        if (!allowed(ab.from, bc.to)) continue;
        const m = Math.min(ab.amount, bc.amount);
        W.set(key(ab.from, ab.to), ab.amount - m);
        W.set(key(bc.from, bc.to), bc.amount - m);
        addW(ab.from, bc.to, m);
        changed = true;
        break outer;
      }
  }
  return list();
}

export interface RoutingResult {
  edges: Edge[];
  /** Edges kept as-is because of rules (e.g. members without a bank account). */
  pinned: Edge[];
  netsPreserved: boolean;
}

export function optimizeRouting(ledger: LedgerResult, expenses: readonly LedgerExpense[], transfers: readonly LedgerTransfer[], members: readonly LedgerMember[], rules: RoutingRules = {}): RoutingResult {
  const order = ledger.memberOrder;
  const noAccount = new Set(rules.skipNoAccount ? members.filter((m) => m.noBankAccount).map((m) => m.id) : []);
  // Expenses marked "pay directly" keep their own consumer → payer debts; the rest is optimized.
  const directIds = new Set(expenses.filter((e) => e.direct).map((e) => e.id));
  const direct: Edge[] = [];
  if (directIds.size) {
    const DM = new Map<string, Map<string, number>>();
    for (const id of directIds)
      for (const d of ledger.expenseDebts[id] ?? []) {
        if (!DM.has(d.from)) DM.set(d.from, new Map());
        DM.get(d.from)!.set(d.to, (DM.get(d.from)!.get(d.to) ?? 0) + d.amount);
      }
    direct.push(...netPairs(DM, order));
  }
  const remaining = ledger.originalDebts.length && direct.length ? subtractEdges(ledger.originalDebts, direct, order) : ledger.originalDebts;
  const pinned = [...direct, ...remaining.filter((e) => noAccount.has(e.from) || noAccount.has(e.to))];
  const free = remaining.filter((e) => !(noAccount.has(e.from) || noAccount.has(e.to)));
  const freeNet = netsFromEdges(free, order);

  let edges: Edge[];
  if (rules.collectorId && order.includes(rules.collectorId) && !noAccount.has(rules.collectorId)) {
    const c = rules.collectorId;
    edges = [];
    for (const m of order) {
      if (m === c) continue;
      if (freeNet[m] < 0) edges.push({ from: m, to: c, amount: -freeNet[m] });
      if (freeNet[m] > 0) edges.push({ from: c, to: m, amount: freeNet[m] });
    }
    edges = sortEdges(edges, order);
  } else if (rules.onlyKnown) {
    const known = knownPairs(expenses, transfers);
    edges = shortenPaths(free, (a, b) => known.has(`${a}|${b}`), order);
  } else {
    edges = greedySettle(freeNet, order);
  }
  // Merge same-direction duplicates (a direct debt and an optimized one between the same two people).
  const merged = new Map<string, Edge>();
  for (const e of [...pinned, ...edges]) {
    const k = `${e.from}|${e.to}`;
    merged.set(k, { from: e.from, to: e.to, amount: (merged.get(k)?.amount ?? 0) + e.amount });
  }
  const all = sortEdges([...merged.values()], order);
  const after = netsFromEdges(all, order);
  const before = netsFromEdges(ledger.originalDebts, order);
  const netsPreserved = order.every((m) => after[m] === before[m] && before[m] === ledger.net[m]);
  return { edges: all, pinned, netsPreserved };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

/** Per-person difference if Equal were chosen instead of Actual: positive = pays more. */
export function equalDeltas(input: Omit<LedgerInput, "allocation">): Record<string, Paisa> {
  // (rounding, when given, is applied to both sides so the comparison is like-for-like)
  const actual = computeLedger({ ...input, allocation: "actual" });
  const equal = computeLedger({ ...input, allocation: "equal" });
  return Object.fromEntries(actual.memberOrder.map((m) => [m, equal.consumed[m] - actual.consumed[m]]));
}

export interface Invariants {
  totalsMatch: boolean;
  netsSumToZero: boolean;
  edgesMatchNets: boolean;
}

export function checkInvariants(ledger: LedgerResult): Invariants {
  const allocated = sum(Object.values(ledger.consumed));
  const netSum = sum(Object.values(ledger.net));
  const fromEdges = netsFromEdges(ledger.originalDebts, ledger.memberOrder);
  return {
    totalsMatch: allocated === ledger.grandTotal,
    netsSumToZero: netSum === 0,
    edgesMatchNets: ledger.memberOrder.every((m) => fromEdges[m] === ledger.net[m]),
  };
}

/** a − b as pairwise-netted edges (used to set aside directly-paid expenses before optimizing). */
export function subtractEdges(a: readonly Edge[], b: readonly Edge[], memberOrder: readonly string[]): Edge[] {
  const D = new Map<string, Map<string, number>>();
  const add = (from: string, to: string, v: number) => {
    if (!D.has(from)) D.set(from, new Map());
    D.get(from)!.set(to, (D.get(from)!.get(to) ?? 0) + v);
  };
  for (const e of a) add(e.from, e.to, e.amount);
  for (const e of b) add(e.to, e.from, e.amount);
  return netPairs(D, memberOrder);
}
