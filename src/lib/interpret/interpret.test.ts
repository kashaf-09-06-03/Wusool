import { describe, expect, it } from "vitest";
import { interpretNarrative, type NarrativeContext } from "./narrative";
import { parseReceiptText } from "./receipt";

const ctx: NarrativeContext = {
  narratorId: "ayesha",
  members: [
    { id: "ayesha", name: "Ayesha Khan" },
    { id: "mariam", name: "Mariam Siddiqui" },
    { id: "talha", name: "Talha Hussain" },
    { id: "hamza", name: "Hamza" },
    { id: "sara", name: "Sara" },
    { id: "bilal", name: "Bilal" },
  ],
  expenses: [
    { id: "kolachi", title: "Kolachi dinner", kind: "receipt", vendor: "Kolachi", items: [{ id: "k8", name: "Mint margarita" }, { id: "k4", name: "Fish tikka" }] },
    { id: "careem", title: "Careem to Sea View", kind: "ride", items: [{ id: "c1", name: "Ride fare" }] },
    { id: "chai", title: "Chai & paratha", kind: "receipt", items: [{ id: "ch1", name: "Doodh patti chai" }] },
  ],
};

describe("narrative interpreter (rules)", () => {
  it("reconstructs the Figma sample story", () => {
    const story =
      "Ayesha paid for dinner at Kolachi. Hamza booked the Careem for himself, Sara and Bilal. Mariam got chai and paratha for her, Ayesha, Talha and Sara. Talha paid the parking for him and Ayesha.";
    const { facts } = interpretNarrative(story, ctx);
    expect(facts).toContainEqual(expect.objectContaining({ type: "payer", expenseId: "kolachi", memberIds: ["ayesha"] }));
    expect(facts).toContainEqual(expect.objectContaining({ type: "payer", expenseId: "careem", memberIds: ["hamza"] }));
    expect(facts).toContainEqual(expect.objectContaining({ type: "participants", expenseId: "careem", memberIds: ["sara", "bilal", "hamza"] }));
    expect(facts).toContainEqual(expect.objectContaining({ type: "payer", expenseId: "chai", memberIds: ["mariam"] }));
    const chai = facts.find((f) => f.type === "participants" && f.expenseId === "chai");
    expect(chai && "memberIds" in chai ? [...chai.memberIds].sort() : null).toEqual(["ayesha", "mariam", "sara", "talha"]);
    const parking = facts.find((f) => f.type === "newExpense");
    expect(parking).toMatchObject({ type: "newExpense", title: "Parking", payerIds: ["talha"], amount: null });
    expect(parking && "participantIds" in parking ? [...parking.participantIds].sort() : null).toEqual(["ayesha", "talha"]);
  });

  it("assigns items and flags fuzzy names as uncertain", () => {
    const r = interpretNarrative("Bilaal had the mint margarita. Sara and Ayesha shared the fish tikka.", ctx);
    expect(r.facts).toContainEqual(expect.objectContaining({ type: "item", itemId: "k8", memberIds: ["bilal"], confidence: "low" }));
    expect(r.facts).toContainEqual(expect.objectContaining({ type: "item", itemId: "k4", memberIds: ["sara", "ayesha"] }));
    expect(r.uncertainWords).toContain("Bilaal");
  });

  it("detects the intermediary cash handoff and unreturned change", () => {
    const r = interpretNarrative("Talha gave Mariam 1,500 to pay Ayesha. Mariam forgot to return the change.", ctx);
    expect(r.facts[0]).toMatchObject({ type: "handoff", fromId: "talha", viaId: "mariam", toId: "ayesha", given: 150000, changeReturned: "no" });
  });

  it("handles Roman Urdu and new expenses with amounts", () => {
    const r = interpretNarrative("Hamza ne sab ke liye 600 ki ice cream li aur pay kiya.", ctx);
    const f = r.facts.find((x) => x.type === "newExpense");
    expect(f).toMatchObject({ type: "newExpense", amount: 60000, payerIds: ["hamza"] });
    expect(f && "participantIds" in f ? f.participantIds.length : 0).toBe(6);
  });

  it("titles a story-only expense from the thing paid for", () => {
    const r = interpretNarrative("Talha paid 200 for parking for him and Ayesha.", ctx);
    expect(r.facts[0]).toMatchObject({ type: "newExpense", title: "Parking", amount: 20000, payerIds: ["talha"] });
  });

  it("reports unknown names instead of guessing", () => {
    const r = interpretNarrative("Hamza booked the Careem for Zainab and Sara.", ctx);
    expect(r.facts).toContainEqual(expect.objectContaining({ type: "unknownName", name: "Zainab" }));
  });
});

describe("real stories from testing", () => {
  const cbtl: NarrativeContext = {
    narratorId: "kashaf",
    members: [
      { id: "kashaf", name: "Kashaf Saleem" },
      { id: "ayesha", name: "Ayesha" },
      { id: "talha", name: "Talha" },
    ],
    expenses: [
      {
        id: "cb",
        title: "The Coffee Bean",
        kind: "receipt",
        total: 696000,
        items: [
          { id: "pasta", name: "Chicken Alfredo Pasta" },
          { id: "latte", name: "Cafe Latte (Regular)" },
          { id: "amer", name: "Iced Americano (Regular)" },
          { id: "coke", name: "Soft Drink (Coke)" },
        ],
      },
    ],
  };
  const story =
    "So Ayesha had the Alfredo pasta and they Americano . I, kashaf,  have the soft drink and talha had the latte. We dont want to split the taxes and another charges equally we wanted to be according to what we got. We also got an indrive ride to the CBTL together it cost us a thousand rupees which we want to split equally.";

  it("assigns several items per person, across clauses, including lower-case names", () => {
    const { facts } = interpretNarrative(story, cbtl);
    const item = (id: string) => facts.find((f) => f.type === "item" && f.itemId === id);
    expect(item("pasta")).toMatchObject({ memberIds: ["ayesha"] });
    expect(item("amer")).toMatchObject({ memberIds: ["ayesha"] });
    expect(item("coke")).toMatchObject({ memberIds: ["kashaf"] });
    expect(item("latte")).toMatchObject({ memberIds: ["talha"] });
  });

  it("understands the spoken ride amount, equal split and unknown payer (no amount question)", () => {
    const { facts } = interpretNarrative(story, cbtl);
    const ride = facts.find((f) => f.type === "newExpense");
    expect(ride).toMatchObject({ type: "newExpense", kind: "ride", title: "inDrive ride", amount: 100000, payerIds: [], split: "equal" });
    expect(ride && "participantIds" in ride ? ride.participantIds.length : 0).toBe(3);
    expect(facts.some((f) => f.type === "note")).toBe(true); // taxes pro-rata instruction understood
    expect(facts.filter((f) => f.type === "unparsed")).toHaveLength(0);
  });

  it("recognises a ride already added separately instead of asking again", () => {
    const withRide: NarrativeContext = { ...cbtl, expenses: [...cbtl.expenses, { id: "ride", title: "inDrive", kind: "manual", total: 100000, items: [{ id: "r1", name: "inDrive" }] }] };
    const { facts } = interpretNarrative("We also got an indrive ride to the CBTL together it cost us a thousand rupees which we want to split equally.", withRide);
    expect(facts.find((f) => f.type === "newExpense")).toBeUndefined();
    expect(facts).toContainEqual(expect.objectContaining({ type: "participants", expenseId: "ride" }));
    expect(facts).toContainEqual(expect.objectContaining({ type: "split", expenseId: "ride", mode: "equal" }));
  });

  it("handles an unpunctuated voice run-on with 'whatever was left'", () => {
    const ctx2: NarrativeContext = {
      narratorId: "kashaf",
      members: [
        { id: "kashaf", name: "Kashaf" },
        { id: "ayesha", name: "Ayesha" },
        { id: "talha", name: "Talha" },
      ],
      expenses: [
        {
          id: "f",
          title: "Foocha",
          kind: "receipt",
          items: [
            { id: "sz", name: "SPICY SCHEZWAN" },
            { id: "egg", name: "EGG FRIED RICE" },
            { id: "chop", name: "AMERICAN CHOPSUEY" },
          ],
        },
      ],
    };
    const { facts } = interpretNarrative("So Ayesha have the spicy chicken schezwan small I had the egg fried rice and then Talha had whatever was left", ctx2);
    expect(facts).toContainEqual(expect.objectContaining({ type: "item", itemId: "sz", memberIds: ["ayesha"] }));
    expect(facts).toContainEqual(expect.objectContaining({ type: "item", itemId: "egg", memberIds: ["kashaf"] }));
    expect(facts).toContainEqual(expect.objectContaining({ type: "rest", expenseId: "f", memberIds: ["talha"] }));
  });

  it("converts spoken numbers", async () => {
    const { normalizeAmounts } = await import("./numbers");
    expect(normalizeAmounts("it cost us a thousand rupees")).toBe("it cost us 1000 rupees");
    expect(normalizeAmounts("fifteen hundred for petrol")).toBe("1500 for petrol");
    expect(normalizeAmounts("two thousand five hundred total")).toBe("2500 total");
    expect(normalizeAmounts("1.5k ka khana")).toBe("1500 ka khana");
    expect(normalizeAmounts("do hazar diye")).toBe("2000 diye");
    expect(normalizeAmounts("So Ayesha had two naans")).toBe("So Ayesha had two naans");
  });
});

describe("receipt text parser", () => {
  it("parses items, quantities, charges and totals without inventing values", () => {
    const text = `KOLACHI RESTAURANT
Do Darya, Karachi
2 x Chicken Karahi        2,400
Naan x6                     480
Mint Margarita              520
Sub Total                 3,400
Sales Tax (sample)          272
Service Charge              128
Discount                    -50
Grand Total               3,750
Cash                      4,000`;
    const r = parseReceiptText(text);
    expect(r.kind).toBe("receipt");
    expect(r.vendor).toMatch(/KOLACHI/);
    expect(r.items).toEqual([
      expect.objectContaining({ name: "Chicken Karahi", quantity: 2, lineTotal: 240000 }),
      expect.objectContaining({ name: "Naan", quantity: 6, lineTotal: 48000 }),
      expect.objectContaining({ name: "Mint Margarita", quantity: 1, lineTotal: 52000 }),
    ]);
    expect(r.charges.map((c) => [c.kind, c.amount])).toEqual([
      ["tax", 27200],
      ["service", 12800],
      ["discount", -5000],
    ]);
    expect(r.subtotal).toBe(340000);
    expect(r.total).toBe(375000);
    expect(r.notes).toEqual([]);
  });

  it("flags low-confidence lines and total mismatches", () => {
    const r = parseReceiptText([
      { text: "Chai 400", confidence: 95 },
      { text: "Paratha 8O0", confidence: 40 },
      { text: "Paratha 800", confidence: 40 },
      { text: "Total 1,300", confidence: 90 },
    ]);
    expect(r.items.find((i) => i.name === "Paratha")?.confidence).toBe("low");
    expect(r.notes.join(" ")).toMatch(/hard to read/);
  });

  it("reads a real Foocha receipt (OCR text) without metadata noise", () => {
    const text = `Own & Operated By FOOCHA HOLDINGS
FL6/3 Block A Gulshan e Iqbal Karachi
PRE RECEIPT
[Invoice #       152809
[Print Date       25-Jun-2025       8:53:36PM
OrderDate ~~ 25.un2025 8:23PM
DINE IN
fToken No            251
(rable #       1
No Of Person 3
walter       GULZAIB
lat Description         Rate Amount
1.00 SPICY SCHEZWAN     1195 1195.00
CHICKEN SMALL
1.00 AMERICAN CHOPSUEY ~~ 1585 1585.00
1.00 EGG FRIED RICE -         1495 1495.00
LARGE
3.00 SOFT DRINK         190 570.00
Amnaunt (Exclusive SST)            4,845.00
SS1'8%                       — 387.60
CARD NET BILL                   5,232.60
Thanks for your Order`;
    const r = parseReceiptText(text);
    expect(r.vendor).toBe("Foocha");
    expect(r.items.map((i) => [i.name, i.quantity, i.lineTotal / 100])).toEqual([
      ["SPICY SCHEZWAN CHICKEN SMALL", 1, 1195],
      ["AMERICAN CHOPSUEY", 1, 1585],
      ["EGG FRIED RICE LARGE", 1, 1495],
      ["SOFT DRINK", 3, 570],
    ]);
    expect(r.charges.map((c) => [c.kind, c.amount / 100])).toEqual([["tax", 387.6]]);
    expect(r.subtotal).toBe(484500);
    expect(r.total).toBe(523260);
    expect(r.notes).toEqual([]);
  });

  it("reads a real Coffee Bean receipt (OCR text) and ignores NTN, table and card lines", () => {
    const text = `THE COFFEE BEAN
& TEA LEAF
Meals. Coffee. Community.
Shop No. 6-28, Ground Floor
Lahore, Pakistan
TH: 3277876-1
Sales Tax Reg. No: 03-07-2716-007-73
Tnvoice i CTL-PK-042391         Dine In
Date: 12 Nov 2024                Tine: 03:27 PM
Table: 12                Cashier: Ayesha
aty Item                    Price Amount
1 Chicken Alfredo Pasta      1,850.00 1,450.00
1 Cafe Latte (Regular)        550.00 550.00
1 Iced Americano (Regular)     500.00 500.00
1 Soft Drink (Coke)          300.00 300.00
subtotal                               2,800.00
Sales Tax (16%)                      504.00
Service Charge (5%)                      140.00
Total Amount                      3,444.00
payment Method:
Credit/Debit Card                      3,444.00
Thank you for choosing`;
    const r = parseReceiptText(text);
    expect(r.vendor).toBe("THE COFFEE BEAN");
    expect(r.items.map((i) => [i.name, i.lineTotal / 100])).toEqual([
      ["Chicken Alfredo Pasta", 1450],
      ["Cafe Latte (Regular)", 550],
      ["Iced Americano (Regular)", 500],
      ["Soft Drink (Coke)", 300],
    ]);
    expect(r.charges.map((c) => [c.kind, c.amount / 100])).toEqual([
      ["tax", 504],
      ["service", 140],
    ]);
    expect(r.total).toBe(344400);
    expect(r.notes).toEqual([]);
  });

  it("reads ride screenshots", () => {
    const r = parseReceiptText("Careem\nTrip to Sea View\nDistance 12.4 km\nTotal fare\nPKR 1,140\nPaid by cash");
    expect(r.kind).toBe("ride");
    expect(r.provider).toBe("careem");
    expect(r.total).toBe(114000);
  });
});
