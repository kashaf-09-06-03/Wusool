import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  computeLedger,
  equalDeltas,
  greedySettle,
  netsFromEdges,
  optimizeRouting,
  splitByWeights,
  type LedgerExpense,
  type LedgerMember,
  type LedgerTransfer,
} from "./index";
import { SAMPLE_EXPENSES, SAMPLE_MEMBERS } from "../sample";
import { formatPKR, parsePKR, rupees } from "../money";

const R = rupees;
const byName = (rec: Record<string, number>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v / 100]));

describe("splitByWeights", () => {
  it("sums exactly and breaks ties by order", () => {
    expect(splitByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitByWeights(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(splitByWeights(1000, [33.33, 33.33, 33.34]).reduce((a, b) => a + b)).toBe(1000);
  });
  it("handles huge values without precision loss", () => {
    const parts = splitByWeights(9_007_199_254_740, [999_999_937, 3]);
    expect(parts[0] + parts[1]).toBe(9_007_199_254_740);
  });
  it("falls back to equal when all weights are zero", () => {
    expect(splitByWeights(10, [0, 0])).toEqual([5, 5]);
  });
});

describe("money", () => {
  it("parses and formats PKR", () => {
    expect(parsePKR("1,955")).toBe(195500);
    expect(parsePKR("PKR 216.5")).toBe(21650);
    expect(parsePKR("Rs. 80")).toBe(8000);
    expect(parsePKR("abc")).toBeNull();
    expect(formatPKR(R(12060))).toBe("PKR 12,060");
    expect(formatPKR(21667)).toBe("PKR 216.67");
    expect(formatPKR(-R(545))).toBe("−PKR 545");
  });
});

describe("golden sample: Do Darya Night (matches Figma screens 06, 10a, 10b, 11, 12)", () => {
  const ledger = computeLedger({ members: SAMPLE_MEMBERS, expenses: SAMPLE_EXPENSES, allocation: "actual" });

  it("has no validation issues and a PKR 12,060 total", () => {
    expect(ledger.issues).toEqual([]);
    expect(ledger.grandTotal).toBe(R(12060));
  });

  it("allocates the Kolachi dinner pro-rata to exactly the per-person shares", () => {
    const k = ledger.allocations.find((a) => a.expenseId === "kolachi")!;
    expect(byName(k.perMember)).toEqual({ ayesha: 1780, hamza: 1690, mariam: 1520, talha: 1610, sara: 1250, bilal: 1570 });
  });

  it("produces the Figma nets", () => {
    expect(byName(ledger.net)).toEqual({ ayesha: 7215, mariam: -545, talha: -1835, hamza: -930, sara: -1955, bilal: -1950 });
    expect(checkInvariants(ledger)).toEqual({ totalsMatch: true, netsSumToZero: true, edgesMatchNets: true });
  });

  it("has 9 original transfers including Sara → Hamza 380", () => {
    expect(ledger.originalDebts).toHaveLength(9);
    expect(ledger.originalDebts).toContainEqual({ from: "sara", to: "hamza", amount: R(380) });
  });

  it("optimizes to 5 transfers into Ayesha, with nets preserved (greedy and people-I-know)", () => {
    for (const rules of [{}, { onlyKnown: true }]) {
      const r = optimizeRouting(ledger, SAMPLE_EXPENSES, [], SAMPLE_MEMBERS, rules);
      expect(r.netsPreserved).toBe(true);
      expect(r.edges.map((e) => [e.from, e.to, e.amount / 100])).toEqual([
        ["sara", "ayesha", 1955],
        ["bilal", "ayesha", 1950],
        ["talha", "ayesha", 1835],
        ["hamza", "ayesha", 930],
        ["mariam", "ayesha", 545],
      ]);
    }
  });

  it("computes the Equal-split consequence line from screen 10a", () => {
    const d = equalDeltas({ members: SAMPLE_MEMBERS, expenses: SAMPLE_EXPENSES });
    expect(byName(d)).toEqual({ mariam: 165, bilal: 60, sara: 55, ayesha: -195, hamza: -60, talha: -25 });
    const eq = computeLedger({ members: SAMPLE_MEMBERS, expenses: SAMPLE_EXPENSES, allocation: "equal" });
    expect(Object.values(eq.consumed).every((v) => v === R(2010))).toBe(true);
    expect(checkInvariants(eq).netsSumToZero).toBe(true);
  });
});

describe("allocation rules", () => {
  const members: LedgerMember[] = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];

  it("splits tax pro-rata and discounts negatively, preserving the total", () => {
    const e: LedgerExpense = {
      id: "e",
      title: "Lunch",
      payers: [{ memberId: "a", amount: 1000_00 - 50_00 + 160_00 }],
      items: [
        { id: "1", name: "Big", lineTotal: 700_00, shares: [{ memberId: "a", weight: 1 }] },
        { id: "2", name: "Small", lineTotal: 300_00, shares: [{ memberId: "b", weight: 1 }] },
      ],
      charges: [
        { id: "t", kind: "tax", label: "GST", amount: 160_00 },
        { id: "d", kind: "discount", label: "Discount", amount: -50_00 },
      ],
    };
    const l = computeLedger({ members, expenses: [e], allocation: "actual" });
    expect(l.consumed.a).toBe(700_00 + 112_00 - 35_00);
    expect(l.consumed.b).toBe(300_00 + 48_00 - 15_00);
    expect(l.consumed.c).toBe(0);
    expect(checkInvariants(l)).toEqual({ totalsMatch: true, netsSumToZero: true, edgesMatchNets: true });
  });

  it("rounds odd splits to the paisa and still sums exactly", () => {
    const e: LedgerExpense = {
      id: "e",
      title: "Chai",
      payers: [{ memberId: "a", amount: 100_00 }],
      items: [{ id: "1", name: "Chai", lineTotal: 100_00, shares: members.map((m) => ({ memberId: m.id, weight: 1 })) }],
      charges: [],
    };
    const l = computeLedger({ members, expenses: [e], allocation: "actual" });
    expect([l.consumed.a, l.consumed.b, l.consumed.c]).toEqual([33_34, 33_33, 33_33]);
    expect(checkInvariants(l).totalsMatch).toBe(true);
  });

  it("supports weighted and exact-amount shares", () => {
    const e: LedgerExpense = {
      id: "e",
      title: "Pizza",
      payers: [{ memberId: "c", amount: 900_00 }],
      items: [
        {
          id: "1",
          name: "Pizza",
          lineTotal: 900_00,
          shares: [
            { memberId: "a", weight: 2 },
            { memberId: "b", weight: 1 },
          ],
        },
      ],
      charges: [],
    };
    const l = computeLedger({ members, expenses: [e], allocation: "actual" });
    expect(l.consumed.a).toBe(600_00);
    expect(l.consumed.b).toBe(300_00);
    expect(l.originalDebts).toEqual([
      { from: "a", to: "c", amount: 600_00 },
      { from: "b", to: "c", amount: 300_00 },
    ]);
  });

  it("splits debts across multiple payers proportionally", () => {
    const e: LedgerExpense = {
      id: "e",
      title: "Dinner",
      payers: [
        { memberId: "a", amount: 600_00 },
        { memberId: "b", amount: 300_00 },
      ],
      items: [{ id: "1", name: "Food", lineTotal: 900_00, shares: members.map((m) => ({ memberId: m.id, weight: 1 })) }],
      charges: [],
    };
    const l = computeLedger({ members, expenses: [e], allocation: "actual" });
    expect(byName(l.net)).toEqual({ a: 300, b: 0, c: -300 });
    expect(checkInvariants(l).edgesMatchNets).toBe(true);
  });

  it("flags mismatched totals, missing payers and unassigned items", () => {
    const e: LedgerExpense = {
      id: "e",
      title: "Broken",
      payers: [],
      items: [{ id: "1", name: "Mystery", lineTotal: 100_00, shares: [] }],
      charges: [],
      declaredTotal: 120_00,
    };
    const codes = computeLedger({ members, expenses: [e], allocation: "actual" }).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["NO_PAYER", "ITEM_UNASSIGNED", "TOTAL_MISMATCH"]));
  });
});

describe("whole-rupee rounding", () => {
  const members: LedgerMember[] = ["a", "b", "c"].map((id) => ({ id, name: id }));
  const chai: LedgerExpense = { id: "e", title: "Chai", payers: [{ memberId: "a", amount: 100_00 }], items: [{ id: "1", name: "Chai", lineTotal: 100_00, shares: members.map((m) => ({ memberId: m.id, weight: 1 })) }], charges: [] };
  const snacks: LedgerExpense = { id: "f", title: "Snacks", payers: [{ memberId: "b", amount: 200_00 }], items: [{ id: "2", name: "Snacks", lineTotal: 200_00, shares: members.map((m) => ({ memberId: m.id, weight: 1 })) }], charges: [] };

  it("rounds shares to whole rupees, keeps every invariant, and records the adjustment", () => {
    const l = computeLedger({ members, expenses: [chai, snacks], allocation: "actual", rounding: "rupee" });
    expect(Object.values(l.consumed).every((v) => v % 100 === 0)).toBe(true);
    expect(Object.values(l.net).every((v) => v % 100 === 0)).toBe(true);
    expect(l.originalDebts.every((e) => e.amount % 100 === 0)).toBe(true);
    expect(checkInvariants(l)).toEqual({ totalsMatch: true, netsSumToZero: true, edgesMatchNets: true });
    expect([l.consumed.a, l.consumed.b, l.consumed.c]).toEqual([100_00, 100_00, 100_00]);
    expect(l.allocations[0].lines.some((x) => x.kind === "rounding")).toBe(true);
  });

  it("stays within PKR 1 of exact for every person on random outings", () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
    for (let t = 0; t < 100; t++) {
      const ms: LedgerMember[] = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, i) => ({ id: "m" + i, name: "m" + i }));
      const exps: LedgerExpense[] = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, k) => {
        const total = (50 + Math.floor(rnd() * 5000)) * 100;
        const who = ms.filter(() => rnd() > 0.3);
        const sharers = who.length ? who : ms;
        return { id: "e" + k, title: "x", payers: [{ memberId: ms[Math.floor(rnd() * ms.length)].id, amount: total }], items: [{ id: "i" + k, name: "x", lineTotal: total, shares: sharers.map((m) => ({ memberId: m.id, weight: 1 + Math.floor(rnd() * 3) })) }], charges: [] };
      });
      const exact = computeLedger({ members: ms, expenses: exps, allocation: "actual" });
      const r = computeLedger({ members: ms, expenses: exps, allocation: "actual", rounding: "rupee" });
      expect(checkInvariants(r)).toEqual({ totalsMatch: true, netsSumToZero: true, edgesMatchNets: true });
      for (const m of ms) expect(Math.abs(r.consumed[m.id] - exact.consumed[m.id])).toBeLessThan(100);
      // Nobody is ever charged (even a rupee) on an expense they didn't share.
      for (const a of r.allocations) for (const [m, v] of Object.entries(a.perMember)) if ((exact.allocations.find((x) => x.expenseId === a.expenseId)!.perMember[m] ?? 0) === 0) expect(v).toBe(0);
    }
  });

  it("leaves the golden sample unchanged", () => {
    const l = computeLedger({ members: SAMPLE_MEMBERS, expenses: SAMPLE_EXPENSES, allocation: "actual", rounding: "rupee" });
    expect(byName(l.net)).toEqual({ ayesha: 7215, mariam: -545, talha: -1835, hamza: -930, sara: -1955, bilal: -1950 });
    expect(l.allocations.flatMap((a) => a.lines).some((x) => x.kind === "rounding")).toBe(false);
  });
});

describe("several payers on one expense", () => {
  it("debts match exactly what each payer paid (property check)", () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
    for (let t = 0; t < 150; t++) {
      const ms: LedgerMember[] = Array.from({ length: 2 + Math.floor(rnd() * 5) }, (_, i) => ({ id: "m" + i, name: "m" + i }));
      const total = (100 + Math.floor(rnd() * 9000)) * 100;
      const np = 1 + Math.floor(rnd() * ms.length);
      const paidParts = splitByWeights(total, Array.from({ length: np }, () => 1 + Math.floor(rnd() * 5)));
      const e: LedgerExpense = { id: "e", title: "x", payers: ms.slice(0, np).map((m, i) => ({ memberId: m.id, amount: paidParts[i] })), items: [{ id: "i", name: "x", lineTotal: total, shares: ms.map((m) => ({ memberId: m.id, weight: 1 + Math.floor(rnd() * 4) })) }], charges: [] };
      for (const rounding of ["paisa", "rupee"] as const) {
        const l = computeLedger({ members: ms, expenses: [e], allocation: "actual", rounding });
        expect(checkInvariants(l)).toEqual({ totalsMatch: true, netsSumToZero: true, edgesMatchNets: true });
        expect(optimizeRouting(l, [e], [], ms, { onlyKnown: true }).netsPreserved).toBe(true);
      }
    }
  });

  it("the CBTL case: three payers of 333.34 / 333.33 / 333.33 stays exact with rupee rounding", () => {
    const ms: LedgerMember[] = ["k", "a", "t"].map((id) => ({ id, name: id }));
    const ride: LedgerExpense = { id: "r", title: "Indrive", payers: [{ memberId: "k", amount: 33334 }, { memberId: "a", amount: 33333 }, { memberId: "t", amount: 33333 }], items: [{ id: "i", name: "Ride", lineTotal: 100000, shares: ms.map((m) => ({ memberId: m.id, weight: 1 })) }], charges: [] };
    const cafe: LedgerExpense = { id: "c", title: "Cafe", payers: [{ memberId: "a", amount: 696000 }], items: [{ id: "j", name: "Food", lineTotal: 696000, shares: [{ memberId: "a", weight: 2 }, { memberId: "k", weight: 1 }, { memberId: "t", weight: 1 }] }], charges: [] };
    for (const allocation of ["actual", "equal"] as const) {
      const l = computeLedger({ members: ms, expenses: [cafe, ride], allocation, rounding: "rupee" });
      expect(checkInvariants(l)).toEqual({ totalsMatch: true, netsSumToZero: true, edgesMatchNets: true });
      expect(optimizeRouting(l, [cafe, ride], [], ms, { onlyKnown: true }).netsPreserved).toBe(true);
    }
  });
});

describe("per-expense split and direct payment", () => {
  const ms: LedgerMember[] = ["a", "b", "c"].map((id) => ({ id, name: id }));
  const dinner: LedgerExpense = { id: "d", title: "Dinner", payers: [{ memberId: "a", amount: 90000 }], items: [{ id: "1", name: "Big", lineTotal: 60000, shares: [{ memberId: "b", weight: 1 }] }, { id: "2", name: "Small", lineTotal: 30000, shares: [{ memberId: "a", weight: 1 }, { memberId: "c", weight: 1 }] }], charges: [] };
  const ride: LedgerExpense = { id: "r", title: "Ride", payers: [{ memberId: "c", amount: 30000 }], items: [{ id: "3", name: "Ride", lineTotal: 30000, shares: ms.map((m) => ({ memberId: m.id, weight: 1 })) }], charges: [] };

  it("splits one expense equally while another stays itemised", () => {
    const l = computeLedger({ members: ms, expenses: [{ ...dinner, split: "equal" }, ride], allocation: "actual" });
    expect(l.allocations[0].perMember).toEqual({ a: 30000, b: 30000, c: 30000 });
    expect(l.allocations[1].perMember).toEqual({ a: 10000, b: 10000, c: 10000 });
    const itemised = computeLedger({ members: ms, expenses: [dinner, ride], allocation: "actual" });
    expect(itemised.allocations[0].perMember).toEqual({ b: 60000, a: 15000, c: 15000 });
  });

  it("keeps a direct-pay expense as its own transfers while optimizing the rest", () => {
    const exps = [dinner, { ...ride, direct: true }];
    const l = computeLedger({ members: ms, expenses: exps, allocation: "actual" });
    const r = optimizeRouting(l, exps, [], ms, {});
    expect(r.netsPreserved).toBe(true);
    // Everyone who rode pays c (the ride payer) directly.
    expect(r.edges.some((e) => e.to === "c" && e.from === "b")).toBe(true);
  });
});

describe("intermediary handoff (Talha / Mariam / Ayesha, CLAUDE.md §7)", () => {
  const members: LedgerMember[] = [
    { id: "ayesha", name: "Ayesha" },
    { id: "mariam", name: "Mariam" },
    { id: "talha", name: "Talha" },
  ];
  // Ayesha paid the birthday bill; Talha's share is 1,100.
  const bill: LedgerExpense = {
    id: "bday",
    title: "Birthday",
    payers: [{ memberId: "ayesha", amount: 3300_00 }],
    items: [{ id: "1", name: "Bill", lineTotal: 3300_00, shares: members.map((m) => ({ memberId: m.id, weight: 1 })) }],
    charges: [],
  };
  const handoff: LedgerTransfer[] = [
    { id: "t1", from: "talha", to: "mariam", amount: 1500_00, kind: "handoff", label: "Cash to pass on" },
    { id: "t2", from: "mariam", to: "ayesha", amount: 1100_00, onBehalfOf: "talha", kind: "handoff" },
  ];

  it("leaves Mariam owing Talha the PKR 400 change when it was not returned", () => {
    const l = computeLedger({ members, expenses: [bill], transfers: handoff, allocation: "actual" });
    expect(l.originalDebts).toContainEqual({ from: "mariam", to: "talha", amount: 400_00 });
    expect(l.originalDebts.find((e) => e.from === "talha" && e.to === "ayesha")).toBeUndefined();
    expect(checkInvariants(l)).toEqual({ totalsMatch: true, netsSumToZero: true, edgesMatchNets: true });
  });

  it("clears the secondary debt once the change is returned", () => {
    const l = computeLedger({
      members,
      expenses: [bill],
      transfers: [...handoff, { id: "t3", from: "mariam", to: "talha", amount: 400_00, kind: "change" }],
      allocation: "actual",
    });
    expect(l.originalDebts).toEqual([{ from: "mariam", to: "ayesha", amount: 1100_00 }]);
  });
});

describe("routing rules", () => {
  it("collector routes everything through one person and preserves nets", () => {
    const members: LedgerMember[] = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
    const exps: LedgerExpense[] = [
      { id: "1", title: "x", payers: [{ memberId: "a", amount: 400_00 }], items: [{ id: "i", name: "x", lineTotal: 400_00, shares: members.map((m) => ({ memberId: m.id, weight: 1 })) }], charges: [] },
      { id: "2", title: "y", payers: [{ memberId: "b", amount: 200_00 }], items: [{ id: "j", name: "y", lineTotal: 200_00, shares: members.map((m) => ({ memberId: m.id, weight: 1 })) }], charges: [] },
    ];
    const l = computeLedger({ members, expenses: exps, allocation: "actual" });
    const r = optimizeRouting(l, exps, [], members, { collectorId: "a" });
    expect(r.netsPreserved).toBe(true);
    expect(r.edges.every((e) => e.from === "a" || e.to === "a")).toBe(true);
  });

  it("people-I-know never creates transfers between strangers", () => {
    const members: LedgerMember[] = ["a", "b", "c"].map((id) => ({ id, name: id }));
    // a and c never shared anything: b bridges them.
    const exps: LedgerExpense[] = [
      { id: "1", title: "ab", payers: [{ memberId: "b", amount: 100_00 }], items: [{ id: "i", name: "x", lineTotal: 100_00, shares: [{ memberId: "a", weight: 1 }] }], charges: [] },
      { id: "2", title: "bc", payers: [{ memberId: "c", amount: 100_00 }], items: [{ id: "j", name: "y", lineTotal: 100_00, shares: [{ memberId: "b", weight: 1 }] }], charges: [] },
    ];
    const l = computeLedger({ members, expenses: exps, allocation: "actual" });
    const free = optimizeRouting(l, exps, [], members, {});
    expect(free.edges).toEqual([{ from: "a", to: "c", amount: 100_00 }]);
    const known = optimizeRouting(l, exps, [], members, { onlyKnown: true });
    expect(known.edges).toHaveLength(2);
    expect(known.netsPreserved).toBe(true);
  });

  it("people without a bank account keep their original transfers", () => {
    const members: LedgerMember[] = [
      { id: "a", name: "a" },
      { id: "b", name: "b", noBankAccount: true },
      { id: "c", name: "c" },
    ];
    const exps: LedgerExpense[] = [
      { id: "1", title: "x", payers: [{ memberId: "a", amount: 300_00 }], items: [{ id: "i", name: "x", lineTotal: 300_00, shares: members.map((m) => ({ memberId: m.id, weight: 1 })) }], charges: [] },
    ];
    const l = computeLedger({ members, expenses: exps, allocation: "actual" });
    const r = optimizeRouting(l, exps, [], members, { skipNoAccount: true });
    expect(r.pinned).toEqual([{ from: "b", to: "a", amount: 100_00 }]);
    expect(r.netsPreserved).toBe(true);
  });

  it("greedy settle preserves arbitrary nets (property check)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(rnd() * 7);
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      const net: Record<string, number> = {};
      let running = 0;
      ids.slice(0, -1).forEach((id) => {
        net[id] = Math.floor((rnd() - 0.5) * 1_000_000);
        running += net[id];
      });
      net[ids[n - 1]] = -running;
      const edges = greedySettle(net, ids);
      const after = netsFromEdges(edges, ids);
      expect(ids.every((id) => after[id] === net[id])).toBe(true);
      expect(edges.length).toBeLessThanOrEqual(n - 1);
    }
  });
});
