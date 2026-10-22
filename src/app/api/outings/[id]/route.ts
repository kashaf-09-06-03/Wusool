import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { archiveOuting, renameOuting, setMuted, updateHeader } from "@/server/outings";
import { outingView } from "@/server/views";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => outingView((await params).id, await requireUser()));

export const PATCH = route<P>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const input = await body(
    req,
    z.object({
      name: z.string().optional(),
      banner: z.string().max(80).optional(),
      logoType: z.string().max(20).optional(),
      logoValue: z.string().max(80).nullable().optional(),
      date: z.string().max(40).nullable().optional(),
      place: z.string().max(60).nullable().optional(),
      archived: z.boolean().optional(),
      muted: z.boolean().optional(),
    }),
  );
  if (input.name !== undefined) renameOuting(id, user, input.name);
  if (input.banner || input.logoType || input.logoValue !== undefined || input.date !== undefined || input.place !== undefined) updateHeader(id, user, input);
  if (input.archived !== undefined) archiveOuting(id, user, input.archived);
  if (input.muted !== undefined) setMuted(id, user, input.muted);
  return outingView(id, user);
});
