import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { saveNarrative } from "@/server/pipeline";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ transcript: z.string(), mode: z.enum(["voice", "text"]) }));
  saveNarrative((await params).id, await requireUser(), input);
});
