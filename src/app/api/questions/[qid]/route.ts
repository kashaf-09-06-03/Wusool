import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { answerQuestion } from "@/server/pipeline";

type P = { params: Promise<{ qid: string }> };

export const POST = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ optionId: z.string().default(""), amount: z.number().int().nullable().optional(), skip: z.boolean().optional(), reopen: z.boolean().optional() }));
  answerQuestion((await params).qid, await requireUser(), input);
});
