/**
 * SAMPLE data: the "Do Darya Night" outing used throughout the Figma screens.
 * Names, places, items and PKR amounts are synthetic. Tax and service lines are
 * "as printed on a sample receipt", not real Sindh tax rates.
 *
 * It is internally consistent: total PKR 12,060; nets Ayesha +7,215, Mariam −545,
 * Talha −1,835, Hamza −930, Sara −1,955, Bilal −1,950; 9 original → 5 optimized transfers.
 */
import type { LedgerExpense, LedgerMember } from "./ledger";
import { rupees } from "./money";

export const SAMPLE_MEMBERS: LedgerMember[] = [
  { id: "ayesha", name: "Ayesha" },
  { id: "mariam", name: "Mariam" },
  { id: "talha", name: "Talha" },
  { id: "hamza", name: "Hamza" },
  { id: "sara", name: "Sara" },
  { id: "bilal", name: "Bilal" },
];

const all = SAMPLE_MEMBERS.map((m) => ({ memberId: m.id, weight: 1 }));
const only = (...ids: string[]) => ids.map((memberId) => ({ memberId, weight: 1 }));

/** Kolachi receipt lines (14). Shared karahi/naan/raita; subgroup fish & drink; the rest individual. */
export const KOLACHI_ITEMS: { name: string; qty: number; price: number; who: string[] }[] = [
  { name: "Chicken karahi (full)", qty: 1, price: 2400, who: SAMPLE_MEMBERS.map((m) => m.id) },
  { name: "Naan", qty: 6, price: 480, who: SAMPLE_MEMBERS.map((m) => m.id) },
  { name: "Raita", qty: 1, price: 180, who: SAMPLE_MEMBERS.map((m) => m.id) },
  { name: "Fish tikka", qty: 1, price: 900, who: ["ayesha", "sara"] },
  { name: "Soft drink 1.5L", qty: 1, price: 300, who: ["hamza", "talha"] },
  { name: "Fresh lime", qty: 1, price: 165, who: ["sara"] },
  { name: "Malai boti", qty: 1, price: 642, who: ["ayesha"] },
  { name: "Mint margarita", qty: 1, price: 520, who: ["bilal"] },
  { name: "Seekh kabab", qty: 1, price: 383, who: ["bilal"] },
  { name: "Prawn tempura", qty: 1, price: 698, who: ["mariam"] },
  { name: "Kulfi", qty: 1, price: 160, who: ["mariam"] },
  { name: "Mutton chops", qty: 1, price: 701, who: ["hamza"] },
  { name: "Kulfi", qty: 1, price: 160, who: ["hamza"] },
  { name: "Beef bihari boti", qty: 1, price: 789, who: ["talha"] },
];

export const SAMPLE_EXPENSES: LedgerExpense[] = [
  {
    id: "kolachi",
    title: "Kolachi dinner",
    payers: [{ memberId: "ayesha", amount: rupees(9420) }],
    items: KOLACHI_ITEMS.map((it, i) => ({
      id: `k${i + 1}`,
      name: it.name,
      quantity: it.qty,
      lineTotal: rupees(it.price),
      shares: only(...it.who),
    })),
    charges: [
      { id: "k-tax", kind: "tax", label: "Sales tax (as printed, sample)", amount: rupees(678) },
      { id: "k-svc", kind: "service", label: "Service charge (as printed, sample)", amount: rupees(264) },
    ],
    declaredTotal: rupees(9420),
  },
  {
    id: "careem",
    title: "Careem to Sea View",
    payers: [{ memberId: "hamza", amount: rupees(1140) }],
    items: [{ id: "c1", name: "Ride fare", lineTotal: rupees(1140), shares: only("hamza", "sara", "bilal") }],
    charges: [],
    declaredTotal: rupees(1140),
  },
  {
    id: "chai",
    title: "Chai & paratha",
    payers: [{ memberId: "mariam", amount: rupees(1300) }],
    items: [
      { id: "ch1", name: "Doodh patti chai", quantity: 4, lineTotal: rupees(400), shares: only("ayesha", "mariam", "talha", "sara") },
      { id: "ch2", name: "Aloo paratha", quantity: 4, lineTotal: rupees(800), shares: only("ayesha", "mariam", "talha", "sara") },
    ],
    charges: [{ id: "ch-tax", kind: "tax", label: "Tax (as printed, sample)", amount: rupees(100) }],
    declaredTotal: rupees(1300),
  },
  {
    id: "parking",
    title: "Parking",
    payers: [{ memberId: "talha", amount: rupees(200) }],
    items: [{ id: "p1", name: "Parking", lineTotal: rupees(200), shares: only("talha", "ayesha") }],
    charges: [],
    declaredTotal: rupees(200),
  },
];

void all;
