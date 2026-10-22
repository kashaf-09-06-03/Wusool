import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { currentUser, requireUser } from "@/server/auth";
import { invitePreview, joinViaLink, resolveInvite } from "@/server/outings";
import { membershipState } from "@/server/views";

type P = { params: Promise<{ token: string }> };

/** Public: outing preview only (never expenses). */
export const GET = route<P>(async (_req, { params }) => {
  const { token } = await params;
  const preview = invitePreview(token);
  const user = await currentUser();
  const r = resolveInvite(token);
  return { ...preview, viewer: user ? { name: user.name, membership: r.outing ? membershipState(r.outing.id, user) : null } : null };
});

export const POST = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ name: z.string(), claimGuestId: z.string().nullable().optional(), notMe: z.boolean().optional() }));
  return joinViaLink((await params).token, await requireUser(), input);
});
