import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { inviteSettings, regenerateInvite } from "@/server/outings";

type P = { params: Promise<{ id: string }> };

export const PATCH = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ expiry: z.enum(["24h", "7d", "settled"]).optional(), requireApproval: z.boolean().optional() }));
  return inviteSettings((await params).id, await requireUser(), input);
});

/** Revoke the current link and issue a new one (the UI confirms first). */
export const POST = route<P>(async (_req, { params }) => regenerateInvite((await params).id, await requireUser()));
