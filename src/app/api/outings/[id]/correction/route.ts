import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { applyCorrection } from "@/server/pipeline";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { text } = await body(req, z.object({ text: z.string().max(1000) }));
  return applyCorrection((await params).id, await requireUser(), text);
});
