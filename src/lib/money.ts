/**
 * Money is always an integer number of paisa (1 PKR = 100 paisa).
 * Never use floating-point arithmetic on these values; parse and format only at the edges.
 */
export type Paisa = number;

export const PAISA_PER_RUPEE = 100;

export function assertPaisa(value: number, label = "amount"): Paisa {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer number of paisa, got ${value}`);
  return value;
}

/** Parse user/OCR text like "1,955", "PKR 216.50", "Rs. 80" into paisa. Returns null when unparseable. */
export function parsePKR(input: string | number | null | undefined): Paisa | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * PAISA_PER_RUPEE);
  }
  const cleaned = input.replace(/(pkr|rs\.?|₨)/gi, "").replace(/[,\s]/g, "").trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const paisa = Number(whole) * PAISA_PER_RUPEE + Number((frac + "00").slice(0, 2));
  return negative ? -paisa : paisa;
}

const grouping = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Rupee amount without currency: "1,955", "216.67", "−545" (true minus sign for display). */
export function formatAmount(paisa: Paisa, opts: { signed?: boolean } = {}): string {
  const negative = paisa < 0;
  const abs = Math.abs(paisa);
  const whole = Math.floor(abs / PAISA_PER_RUPEE);
  const frac = abs % PAISA_PER_RUPEE;
  let body = grouping.format(whole);
  if (frac !== 0) body += "." + String(frac).padStart(2, "0");
  if (negative) return "−" + body;
  if (opts.signed && paisa > 0) return "+" + body;
  return body;
}

export function formatPKR(paisa: Paisa, opts: { signed?: boolean } = {}): string {
  const negative = paisa < 0;
  const body = formatAmount(Math.abs(paisa));
  if (negative) return "−PKR " + body;
  if (opts.signed && paisa > 0) return "+PKR " + body;
  return "PKR " + body;
}

export const rupees = (r: number): Paisa => Math.round(r * PAISA_PER_RUPEE);
