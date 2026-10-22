import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { mergeMembers } from "@/server/outings";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ intoId: z.string(), fromId: z.string() }));
  mergeMembers((await params).id, await requireUser(), input.intoId, input.fromId);
});
