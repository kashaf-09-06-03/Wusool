/**
 * Pakistani payment identifiers, shared by the server (validation) and the client (live feedback).
 *
 * - Raast ID: the mobile number registered with Raast (SBP's instant payment system). Any Raast-enabled bank
 *   or wallet app can send to it. Stored as 03XXXXXXXXX.
 * - IBAN: PK + 2 check digits + 4-letter bank code + 16-digit account = 24 characters, validated with the
 *   ISO 13616 mod-97 checksum so typos are caught before anyone sends money to the wrong account.
 */

export function normalizeRaast(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  const m = digits.match(/^(?:\+?92|0)?(3\d{9})$/);
  return m ? `0${m[1]}` : null;
}

export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function ibanProblem(input: string): string | null {
  const iban = normalizeIban(input);
  if (!iban) return null;
  if (!iban.startsWith("PK")) return "Pakistani IBANs start with PK.";
  if (iban.length !== 24) return `A Pakistani IBAN has 24 characters (this has ${iban.length}).`;
  if (!/^PK\d{2}[A-Z]{4}\d{16}$/.test(iban)) return "That doesn’t look like a Pakistani IBAN (PK00 ABCD 0000…).";
  // ISO 13616: move the first four characters to the end, letters → numbers (A=10…Z=35), remainder mod 97 must be 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1 ? null : "One of the digits looks wrong (the IBAN checksum doesn’t match).";
}

/** IBAN grouped in fours for reading aloud / checking: PK36 SCBL 0000 0011 2345 6702. */
export const formatIban = (iban: string) => normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();

/** Common banks and wallets for the picker; free text is allowed too. */
export const BANKS = ["Meezan Bank", "HBL", "UBL", "MCB", "Bank Alfalah", "Allied Bank", "Faysal Bank", "Bank Al Habib", "Askari Bank", "Standard Chartered", "JazzCash", "Easypaisa", "SadaPay", "NayaPay"] as const;

export interface PayDetails {
  raast: string | null;
  iban: string | null;
  title: string | null;
  bank: string | null;
}

export const hasPayDetails = (d: PayDetails | null | undefined) => Boolean(d && (d.raast || d.iban));
