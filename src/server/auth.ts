import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { all, get, newId, now, run, tx } from "./db";
import { AppError, bad } from "./http";

export const SESSION_COOKIE = "wusool_session";
/** Sessions signed in on this browser, so one device can switch between test accounts. */
export const DEVICE_COOKIE = "wusool_device";
const cookieOpts = () => ({ httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" && process.env.WUSOOL_INSECURE_COOKIES !== "1", maxAge: 60 * 60 * 24 * 60 });

async function deviceTokens(): Promise<string[]> {
  const raw = (await cookies()).get(DEVICE_COOKIE)?.value;
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 30 * 1000;
const MAX_ATTEMPTS = 3;
const COLORS = ["blue", "pink", "lime", "ink", "lilac"] as const;

export interface User {
  id: string;
  name: string;
  phone: string;
  color: string;
  threshold: number;
  hide_items: number;
  receipt_visibility: "members" | "payer_organizer";
  no_bank_account: number;
  onboarded: number;
}

/** Pakistani mobile numbers: 03XXXXXXXXX or +923XXXXXXXXX → +923XXXXXXXXX. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  let d = digits.replace(/^\+/, "");
  if (d.startsWith("0092")) d = d.slice(2);
  if (d.startsWith("03")) d = "92" + d.slice(1);
  if (/^3\d{9}$/.test(d)) d = "92" + d;
  if (!/^923\d{9}$/.test(d) && !/^\d{10,15}$/.test(d)) throw bad("Enter a valid mobile number, e.g. 0300 1234567.", "BAD_PHONE");
  return "+" + d;
}

export function pickColor(seed: string): string {
  const h = crypto.createHash("sha1").update(seed).digest()[0];
  return COLORS[h % COLORS.length];
}

/**
 * Start phone verification. No SMS provider is configured in this prototype, so the code is
 * returned to the client and displayed with a clear "prototype" label (Figma C1/A1 mark OTP as MOCK).
 */
export function startOtp(rawPhone: string): { phone: string; devCode: string; resendInSec: number } {
  const phone = normalizePhone(rawPhone);
  const existing = get<{ sent_at: number }>("SELECT sent_at FROM otps WHERE phone = ?", phone);
  const t = Date.now();
  if (existing && t - existing.sent_at < RESEND_AFTER_MS) {
    throw new AppError(429, "OTP_TOO_SOON", `Wait ${Math.ceil((RESEND_AFTER_MS - (t - existing.sent_at)) / 1000)} s before asking for a new code.`);
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  run("INSERT OR REPLACE INTO otps (phone, code, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)", phone, code, t + OTP_TTL_MS, t);
  return { phone, devCode: code, resendInSec: RESEND_AFTER_MS / 1000 };
}

export async function verifyOtp(rawPhone: string, code: string, name: string): Promise<User> {
  const phone = normalizePhone(rawPhone);
  const user = tx(() => {
    const otp = get<{ code: string; expires_at: number; attempts: number }>("SELECT * FROM otps WHERE phone = ?", phone);
    if (!otp) throw bad("Ask for a code first.", "OTP_MISSING");
    if (otp.expires_at < Date.now()) throw bad("That code expired. Send a new one.", "OTP_EXPIRED");
    if (otp.attempts >= MAX_ATTEMPTS) throw new AppError(429, "OTP_LOCKED", "Too many tries. Send a new code in a moment.");
    if (otp.code !== code.trim()) {
      run("UPDATE otps SET attempts = attempts + 1 WHERE phone = ?", phone);
      const left = MAX_ATTEMPTS - otp.attempts - 1;
      throw bad(left > 0 ? `That code isn’t right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn’t right. Send a new code.", "OTP_WRONG");
    }
    run("DELETE FROM otps WHERE phone = ?", phone);
    let u = get<User>("SELECT * FROM users WHERE phone = ?", phone);
    if (!u) {
      const id = newId("u_");
      const clean = name.trim().slice(0, 40) || "Friend";
      run("INSERT INTO users (id, name, phone, color, created_at) VALUES (?, ?, ?, ?, ?)", id, clean, phone, pickColor(phone), now());
      run("INSERT INTO notif_prefs (user_id) VALUES (?)", id); // WhatsApp OFF by default
      u = get<User>("SELECT * FROM users WHERE id = ?", id)!;
    }
    return u;
  });
  const token = crypto.randomBytes(32).toString("base64url");
  run("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", token, user.id, now());
  const jar = await cookies();
  const device = (await deviceTokens()).filter((t) => t !== token);
  jar.set(SESSION_COOKIE, token, cookieOpts());
  jar.set(DEVICE_COOKIE, JSON.stringify([token, ...device].slice(0, 8)), cookieOpts());
  return user;
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return get<User>("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", token) ?? null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AppError(401, "UNAUTHENTICATED", "Please sign in first.");
  return u;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE token = ?", token);
  jar.delete(SESSION_COOKIE);
  const rest = (await deviceTokens()).filter((t) => t !== token);
  if (rest.length) jar.set(DEVICE_COOKIE, JSON.stringify(rest), cookieOpts());
  else jar.delete(DEVICE_COOKIE);
}

/** Accounts signed in on this browser (only ones whose session is still valid). */
export async function deviceAccounts() {
  const current = (await cookies()).get(SESSION_COOKIE)?.value;
  const out: { id: string; name: string; phone: string; color: string; current: boolean }[] = [];
  for (const t of await deviceTokens()) {
    const u = get<User>("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", t);
    if (u && !out.some((x) => x.id === u.id)) out.push({ id: u.id, name: u.name, phone: u.phone.slice(0, 4) + " ••• ••" + u.phone.slice(-3), color: u.color, current: t === current });
  }
  return out;
}

/** Switch to another account already signed in on this device (never to an arbitrary user). */
export async function switchAccount(userId: string) {
  for (const t of await deviceTokens()) {
    const s = get<{ user_id: string }>("SELECT user_id FROM sessions WHERE token = ?", t);
    if (s?.user_id === userId) {
      (await cookies()).set(SESSION_COOKIE, t, cookieOpts());
      return;
    }
  }
  throw new AppError(403, "NOT_ON_DEVICE", "That account isn’t signed in on this device.");
}

/** Development helper for usability sessions: list accounts on this device's database. */
export function listUsers() {
  return all<{ id: string; name: string; phone: string }>("SELECT id, name, phone FROM users ORDER BY created_at");
}
