import "server-only";
import { get, run } from "./db";
import { bad } from "./http";
import { getOuting, membersOf } from "./outings";
import { assertBalanceAccess } from "./settlement";
import { outstanding } from "./balances";
import { appUrl } from "./notify";
import { ibanProblem, normalizeIban, normalizeRaast, type PayDetails } from "@/lib/payments";
import type { User } from "./auth";

/**
 * "Get paid" details (Raast ID / IBAN / account title / bank) live on the user, not the outing, so you enter
 * them once. Privacy: they are only revealed on a pay page, to someone who currently owes you on a balance
 * (or to you). They never appear in breakdowns, Memories or messages.
 */
export function getPayDetails(userId: string): PayDetails {
  const r = get<{ pay_raast: string | null; pay_iban: string | null; pay_title: string | null; pay_bank: string | null }>(
    "SELECT pay_raast, pay_iban, pay_title, pay_bank FROM users WHERE id = ?",
    userId,
  );
  return { raast: r?.pay_raast ?? null, iban: r?.pay_iban ?? null, title: r?.pay_title ?? null, bank: r?.pay_bank ?? null };
}

export function setPayDetails(user: User, input: { raast?: string | null; iban?: string | null; title?: string | null; bank?: string | null }) {
  const cur = getPayDetails(user.id);
  let raast = cur.raast;
  if (input.raast !== undefined) {
    if (input.raast && !normalizeRaast(input.raast)) throw bad("A Raast ID is a Pakistani mobile number, like 0300 1234567.", "RAAST_INVALID");
    raast = input.raast ? normalizeRaast(input.raast) : null;
  }
  let iban = cur.iban;
  if (input.iban !== undefined) {
    const problem = input.iban ? ibanProblem(input.iban) : null;
    if (problem) throw bad(problem, "IBAN_INVALID");
    iban = input.iban ? normalizeIban(input.iban) : null;
  }
  const title = input.title !== undefined ? input.title?.trim().slice(0, 60) || null : cur.title;
  const bank = input.bank !== undefined ? input.bank?.trim().slice(0, 40) || null : cur.bank;
  run("UPDATE users SET pay_raast = ?, pay_iban = ?, pay_title = ?, pay_bank = ? WHERE id = ?", raast, iban, title, bank, user.id);
  return getPayDetails(user.id);
}

/** Everything the pay page needs for one balance. Only the two people on the balance (or the organizer) get it. */
export function payInfo(balanceId: string, user: User) {
  const { b, role } = assertBalanceAccess(balanceId, user);
  const members = membersOf(b.outing_id, true);
  const creditor = members.find((m) => m.id === b.creditor_member_id);
  const debtor = members.find((m) => m.id === b.debtor_member_id);
  const left = outstanding(b);
  const due = Math.max(0, left - b.claimed);
  // The payee's account details are shown to the person who owes them, and to the payee themselves.
  const showDetails = role === "debtor" || role === "creditor";
  const details = showDetails && creditor?.user_id ? getPayDetails(creditor.user_id) : null;
  const outing = getOuting(b.outing_id);
  return {
    balanceId: b.id,
    version: b.version,
    role,
    outing: { id: outing.id, name: outing.name },
    payee: { name: creditor?.name ?? "Former member", color: creditor?.color ?? "ink", isUser: Boolean(creditor?.user_id) },
    payer: { name: debtor?.name ?? "Former member" },
    amount: b.amount,
    outstanding: left,
    due,
    claimed: b.claimed,
    status: b.status,
    superseded: Boolean(b.superseded),
    details,
    link: appUrl(`/pay/${b.id}`),
  };
}
