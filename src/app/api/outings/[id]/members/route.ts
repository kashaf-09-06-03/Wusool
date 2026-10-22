import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { addManualMember } from "@/server/outings";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ name: z.string(), force: z.boolean().optional() }));
  return addManualMember((await params).id, await requireUser(), input);
});
