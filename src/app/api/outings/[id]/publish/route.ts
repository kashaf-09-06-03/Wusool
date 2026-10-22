import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { publish } from "@/server/settlement";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const input = await body(
    req,
    z.object({
      allocation: z.enum(["actual", "equal"]),
      routing: z.enum(["original", "optimized"]),
      rules: z.object({ onlyKnown: z.boolean().optional(), collectorId: z.string().nullable().optional(), skipNoAccount: z.boolean().optional() }),
      expectedRev: z.number().int(),
      confirm: z.literal(true, { error: "Please confirm before publishing." }),
    }),
  );
  return publish((await params).id, await requireUser(), input);
});
