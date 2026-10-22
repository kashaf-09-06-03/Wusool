import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createOuting } from "@/server/outings";

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await body(
    req,
    z.object({
      name: z.string().max(40).optional(),
      banner: z.string().max(80).optional(),
      logoType: z.string().max(20).optional(),
      logoValue: z.string().max(80).nullable().optional(),
      date: z.string().max(40).nullable().optional(),
      place: z.string().max(60).nullable().optional(),
    }),
  );
  return createOuting(user, input);
});
