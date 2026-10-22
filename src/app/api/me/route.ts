import { z } from "zod/v4";
import { bad, body, conflict, route } from "@/server/http";
import { currentUser, requireUser } from "@/server/auth";
import { CONSENT_TEXT, deleteAccount, profileView, updatePrefs } from "@/server/views";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";

export const GET = route(async () => {
  const u = await currentUser();
  if (!u) return { user: null, consentText: CONSENT_TEXT };
  return { ...profileView(u), consentText: CONSENT_TEXT };
});

export const PATCH = route(async (req) => {
  const user = await requireUser();
  const input = await body(
    req,
    z.object({
      name: z.string().max(40).optional(),
      threshold: z.number().int().optional(),
      hideItems: z.boolean().optional(),
      receiptVisibility: z.enum(["members", "payer_organizer"]).optional(),
      whatsappEnabled: z.boolean().optional(),
      consent: z.boolean().optional(),
      types: z.object({ breakdown: z.boolean().optional(), request: z.boolean().optional(), reminder: z.boolean().optional(), wusoolMaaf: z.boolean().optional() }).optional(),
      onboarded: z.boolean().optional(),
    }),
  );
  try {
    updatePrefs(user, input);
  } catch (e) {
    if (e instanceof Error && e.message === "THRESHOLD_RANGE") throw bad("Choose an amount between PKR 0 and PKR 5,000.", "THRESHOLD_RANGE");
    if (e instanceof Error && e.message === "CONSENT_REQUIRED") throw bad("Please read and agree to what we will send first.", "CONSENT_REQUIRED");
    throw e;
  }
  return { ...profileView((await currentUser())!), consentText: CONSENT_TEXT };
});

export const DELETE = route(async () => {
  const r = deleteAccount(await requireUser());
  if ("blocked" in r) throw conflict(`You have ${r.blocked} open balance${r.blocked > 1 ? "s" : ""}. Settle or get Maaf first.`, "OPEN_BALANCES");
  (await cookies()).delete(SESSION_COOKIE);
  return { ok: true };
});
