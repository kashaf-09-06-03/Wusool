import "server-only";
import { all, get, newId, now, run } from "./db";

/**
 * Notification send rules (Figma flow H2):
 *   1. Every event is ALWAYS delivered in-app.
 *   2. WhatsApp only if the recipient turned WhatsApp notifications ON (default OFF),
 *      the message type is allowed by them, and an official WhatsApp Business integration exists.
 *   3. No official integration is configured in this prototype, so opted-in messages are stored
 *      as SIMULATED messages (status "simulated", never "sent") and shown in the labelled in-app
 *      WhatsApp simulator. Nothing is sent to WhatsApp.
 */
export type NotifType = "breakdown" | "request" | "reminder" | "wusool_maaf" | "status" | "member" | "photo" | "system";

const TYPE_TO_PREF: Partial<Record<NotifType, string>> = {
  breakdown: "t_breakdown",
  request: "t_request",
  reminder: "t_reminder",
  wusool_maaf: "t_wusool_maaf",
};

/** Base URL used in message links (set WUSOOL_PUBLIC_URL to your LAN/public address so links open on phones). */
export const appUrl = (path: string) => (process.env.WUSOOL_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, "") + path;

export const WHATSAPP_INTEGRATION_CONFIGURED = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

export interface NotifyInput {
  userId: string | null | undefined;
  outingId?: string | null;
  type: NotifType;
  title: string;
  body: string;
  link?: string;
  whatsapp?: { text: string; balanceId?: string; buttons?: string[] };
}

export function notify(n: NotifyInput): { inApp: boolean; whatsapp: "off" | "type_off" | "simulated" } {
  if (!n.userId) return { inApp: false, whatsapp: "off" };
  // A muted outing still records every notice in-app (source of truth), but quietly: already read, no WhatsApp.
  const muted = n.outingId ? Boolean(get<{ muted: number }>("SELECT muted FROM members WHERE outing_id = ? AND user_id = ?", n.outingId, n.userId)?.muted) : false;
  run(
    "INSERT INTO notifications (id, user_id, outing_id, type, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    newId("n_"),
    n.userId,
    n.outingId ?? null,
    n.type,
    n.title,
    n.body,
    n.link ?? null,
    muted ? 1 : 0,
    now(),
  );
  if (!n.whatsapp || muted) return { inApp: true, whatsapp: "off" };
  const prefs = get<Record<string, number>>("SELECT * FROM notif_prefs WHERE user_id = ?", n.userId);
  if (!prefs?.whatsapp_enabled) return { inApp: true, whatsapp: "off" };
  const prefCol = TYPE_TO_PREF[n.type];
  if (prefCol && !prefs[prefCol]) return { inApp: true, whatsapp: "type_off" };
  run(
    "INSERT INTO wa_messages (id, to_user_id, outing_id, balance_id, type, text, buttons, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'simulated', ?)",
    newId("wa_"),
    n.userId,
    n.outingId ?? null,
    n.whatsapp.balanceId ?? null,
    n.type,
    n.whatsapp.text,
    n.whatsapp.buttons ? JSON.stringify(n.whatsapp.buttons) : null,
    now(),
  );
  return { inApp: true, whatsapp: "simulated" };
}

export function whatsappOptedInCount(userIds: string[]): number {
  if (userIds.length === 0) return 0;
  return all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM notif_prefs WHERE whatsapp_enabled = 1 AND user_id IN (${userIds.map(() => "?").join(",")})`,
    ...userIds,
  )[0].c;
}

export function logActivity(outingId: string, actorMemberId: string | null, type: string, text: string) {
  run("INSERT INTO activity (id, outing_id, actor_member_id, type, text, created_at) VALUES (?, ?, ?, ?, ?, ?)", newId("a_"), outingId, actorMemberId, type, text, now());
}
