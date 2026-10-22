/**
 * Deterministic parser for OCR text from restaurant receipts and ride screenshots.
 * It never invents values: anything it cannot read confidently is returned with
 * `confidence: "low"` so the UI asks the user instead of guessing.
 */
import { parsePKR, type Paisa } from "../money";

export type EvidenceKind = "receipt" | "ride" | "other";

export interface OcrLine {
  text: string;
  /** 0–100 from the OCR engine, when available. */
  confidence?: number;
}

export interface ParsedItem {
  name: string;
  quantity: number;
  lineTotal: Paisa;
  confidence: "high" | "low";
  raw: string;
}
export interface ParsedCharge {
  kind: "tax" | "service" | "fee" | "tip" | "discount" | "other";
  label: string;
  amount: Paisa;
  raw: string;
  confidence: "high" | "low";
}
export interface ParsedReceipt {
  kind: EvidenceKind;
  vendor: string | null;
  provider: string | null;
  items: ParsedItem[];
  charges: ParsedCharge[];
  subtotal: Paisa | null;
  total: Paisa | null;
  /** Human-readable notes about unreadable or inconsistent parts. */
  notes: string[];
}

const RIDE_PROVIDERS = ["careem", "uber", "indrive", "bykea", "yango", "airlift", "swvl"];
const LOW_CONFIDENCE = 70;

// Amount at the end of a line: "1,800", "1800.00", "Rs 1,800", "PKR 520".
const TRAILING_AMOUNT = /(?:(?:pkr|rs\.?|₨)\s*)?(-?\(?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\)?|-?\(?\d+(?:\.\d{1,2})?\)?)\s*(?:pkr|rs)?\s*$/i;

function chargeKind(label: string): ParsedCharge["kind"] | "subtotal" | "total" | "skip" | null {
  const l = label.toLowerCase();
  if (/\b(sub\s*-?\s*total|subtotal|sub tot|exclusive|excl\.?|before tax|gross amount)\b/.test(l)) return "subtotal";
  if (/\b(grand\s*total|net\s*total|net\s*bill|total\s*(payable|due|amount)?|amount\s*(due|payable)|bill\s*total|net\s*amount|net\s*payable|payable|you\s*paid|total\s*fare)\b/.test(l)) return "total";
  // Metadata and payment lines are never items (token/table numbers, NTN, cashier, card payment…).
  if (
    /\b(cash|change|card|credit|debit|visa|master\s*card|mastercard|jazz\s*cash|easypaisa|balance|tender(ed)?|paid\s*by|payment|ntn|strn|reg(istration)?\.?\s*(no|#)|pos|fbr|invoice|tnvoice|receipt\s*(no|#)|bill\s*(no|#)|table|rable|cover|waiter|walter|server|cashier|order\s*(no|#|date)|print\s*date|token|person|persons|pax|guests?|date|time|tine|tel|phone|mob(ile)?|whatsapp|www|http|thank)\b/.test(l) ||
    /^(th|ph|ntn)\s*[:#]/.test(l) ||
    // OCR often glues a stray letter on ("fToken No 251"), so match these anywhere.
    /(token|invoice|cashier|waiter|persons?\b|table\s*#|no\.?\s*of\s*person)/.test(l)
  )
    return "skip";
  if (/\b(gst|sst|pst|sales\s*tax|tax|vat|fed|ict)\b/.test(l)) return "tax";
  if (/\b(service|s\.?\s*c\.?|svc)\b/.test(l)) return "service";
  if (/\b(discount|disc\.?|off|promo|voucher|deal)\b/.test(l)) return "discount";
  if (/\b(tip|gratuity)\b/.test(l)) return "tip";
  if (/\b(delivery|platform|packaging|booking|convenience|fee|toll|waiting|surcharge)\b/.test(l)) return "fee";
  if (/\d\s*%/.test(l)) return "tax"; // e.g. a garbled "SST 18%" line
  return null;
}

function cleanName(s: string): string {
  return s
    .replace(/[|_*~=•·]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.:\-–]+|[\s.:\-–]+$/g, "")
    .trim();
}

function parseAmountToken(token: string): Paisa | null {
  const negative = /^-|^\(.*\)$/.test(token);
  const v = parsePKR(token.replace(/[()]/g, "").replace(/^-/, ""));
  if (v === null) return null;
  return negative ? -v : v;
}

export function detectKind(text: string): { kind: EvidenceKind; provider: string | null } {
  const l = text.toLowerCase();
  const provider = RIDE_PROVIDERS.find((p) => l.includes(p)) ?? null;
  if (provider || /\b(trip|ride|fare|pickup|drop[- ]?off|captain|driver)\b/.test(l)) return { kind: "ride", provider };
  return { kind: "receipt", provider: null };
}

export function parseReceiptText(input: string | OcrLine[], hint?: EvidenceKind): ParsedReceipt {
  const lines: OcrLine[] = typeof input === "string" ? input.split(/\r?\n/).map((text) => ({ text })) : input;
  const fullText = lines.map((l) => l.text).join("\n");
  const detected = detectKind(fullText);
  const kind = hint && hint !== "other" ? hint : detected.kind;
  const result: ParsedReceipt = { kind, vendor: null, provider: detected.provider, items: [], charges: [], subtotal: null, total: null, notes: [] };

  // Vendor: "Operated by FOOCHA HOLDINGS" → Foocha; otherwise the first line that reads like a name.
  const operated = fullText.match(/operated\s+by\s+([a-z][a-z&' ]{2,30}?)(?:\s+(holdings|pvt|private|ltd|limited|group|foods?)\b|\n|$)/i);
  if (operated) result.vendor = titleCase(operated[1].trim());
  else
    for (const l of lines) {
      const t = cleanName(l.text);
      if (t.length >= 3 && !/\d{3,}/.test(t) && (t.match(/[a-z]/gi)?.length ?? 0) >= 4 && !/\b(receipt|invoice|dine|take ?away)\b/i.test(t)) {
        result.vendor = t.replace(/\b(restaurant|pvt|ltd|\(pvt\))\b\.?/gi, "").trim() || t;
        break;
      }
    }

  if (kind === "ride") {
    // Prefer an explicit total/fare line; otherwise the largest PKR amount on the screenshot.
    let best: { amount: Paisa; score: number; raw: string; low: boolean } | null = null;
    for (const l of lines) {
      const m = l.text.match(/(?:pkr|rs\.?|₨)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:pkr|rs)/i);
      const fareLine = /\b(total|fare|you paid|amount|trip)\b/i.test(l.text);
      const token = m?.[1] ?? m?.[2] ?? (fareLine ? l.text.match(TRAILING_AMOUNT)?.[1] : undefined);
      if (!token) continue;
      const amount = parseAmountToken(token);
      if (amount === null || amount <= 0) continue;
      const score = (fareLine ? 1e12 : 0) + amount;
      if (!best || score > best.score) best = { amount, score, raw: l.text.trim(), low: (l.confidence ?? 100) < LOW_CONFIDENCE };
    }
    if (best) {
      result.total = best.amount;
      result.items.push({ name: result.provider ? `${cap(result.provider)} ride` : "Ride fare", quantity: 1, lineTotal: best.amount, confidence: best.low ? "low" : "high", raw: best.raw });
      if (best.low) result.notes.push(`The fare “${best.raw}” is hard to read.`);
    } else {
      result.notes.push("Couldn’t find a fare on this screenshot.");
    }
    return result;
  }

  let lastItem: ParsedItem | null = null;
  for (const l of lines) {
    const text = l.text.trim().replace(/[~—–]+/g, " ");
    if (!text) continue;
    const m = text.match(TRAILING_AMOUNT);
    if (!m) {
      // Continuation of the previous item's name ("SPICY SCHEZWAN" / "CHICKEN SMALL").
      if (lastItem && /^[A-Za-z][A-Za-z &()'-]{1,24}$/.test(text) && !chargeKind(text)) lastItem.name = `${lastItem.name} ${cleanName(text)}`;
      else lastItem = null;
      continue;
    }
    const amount = parseAmountToken(m[1]);
    if (amount === null) continue;
    // Long digit runs without separators are IDs or phone numbers, not money.
    if (/\d{7,}/.test(text.replace(/[,.]/g, "").replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, "")) && !/[,.]\d{2}\b/.test(m[1])) {
      lastItem = null;
      continue;
    }
    let label = cleanName(text.slice(0, m.index));
    lastItem = null;
    const low = (l.confidence ?? 100) < LOW_CONFIDENCE;
    const k = chargeKind(label);
    if (k === "skip") continue;
    if (k === "subtotal") {
      result.subtotal = Math.abs(amount);
      continue;
    }
    if (k === "total") {
      result.total = Math.abs(amount);
      continue;
    }
    if (!label || !/[a-z]/i.test(label)) continue;
    // Percent labels like "GST 16%" keep their text; we never compute tax from the rate.
    if (k) {
      const signed = k === "discount" ? -Math.abs(amount) : amount;
      result.charges.push({ kind: k, label, amount: signed, raw: text, confidence: low ? "low" : "high" });
      continue;
    }
    if (amount <= 0) continue; // negative/zero "items" are OCR noise; discounts are handled above
    // Drop a unit-price column before the line total: "1.00 SOFT DRINK 190 570.00" → label "1.00 SOFT DRINK".
    label = label.replace(/\s+[\d,]+(?:\.\d{1,2})?$/, "");
    // Quantity forms: "2 x Naan 160", "Naan x2 160", "2 Naan 160", "1.00 Naan 160", "Naan 2 @ 80 160".
    let quantity = 1;
    const q0 = label.match(/^(\d{1,2})\.0{1,2}\s+(.+)$/);
    if (q0) label = `${q0[1]} ${q0[2]}`;
    const q1 = label.match(/^(\d{1,2})\s*[x×*]?\s+(.+)$/i);
    const q2 = label.match(/^(.+?)\s*[x×]\s*(\d{1,2})$/i);
    const q3 = label.match(/^(.+?)\s+(\d{1,2})\s*@\s*[\d,.]+$/);
    if (q3) {
      label = q3[1];
      quantity = Number(q3[2]);
    } else if (q1 && !/^\d+\s*(ml|l|kg|g|pcs?)\b/i.test(label)) {
      quantity = Number(q1[1]);
      label = q1[2];
    } else if (q2) {
      label = q2[1];
      quantity = Number(q2[2]);
    }
    label = cleanName(label);
    // A real item name has a few letters; a large amount on a near-letterless line is noise.
    if ((label.match(/[a-z]/gi)?.length ?? 0) < 3) continue;
    const item: ParsedItem = { name: label, quantity, lineTotal: amount, confidence: low ? "low" : "high", raw: text };
    result.items.push(item);
    lastItem = item;
  }

  const itemSum = result.items.reduce((a, i) => a + i.lineTotal, 0);
  const chargeSum = result.charges.reduce((a, c) => a + c.amount, 0);
  if (result.subtotal !== null && result.subtotal !== itemSum) {
    result.notes.push(`Items add up to ${itemSum / 100} but the receipt subtotal says ${result.subtotal / 100}.`);
  }
  if (result.total !== null && result.total !== itemSum + chargeSum) {
    result.notes.push(`Items and charges add up to ${(itemSum + chargeSum) / 100} but the receipt total says ${result.total / 100}.`);
  }
  if (result.items.length === 0) result.notes.push("Couldn’t read any line items.");
  for (const it of result.items) if (it.confidence === "low") result.notes.push(`One line is hard to read: “${it.raw}”.`);
  return result;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const cap = (s: string) => (s === "indrive" ? "inDrive" : s.charAt(0).toUpperCase() + s.slice(1));
