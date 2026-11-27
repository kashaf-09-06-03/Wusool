import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { getPayDetails, setPayDetails } from "@/server/payments";

/** Your own "get paid" details. */
export const GET = route(async () => ({ details: getPayDetails((await requireUser()).id) }));

export const PUT = route(async (req) => {
  const user = await requireUser();
  const input = await body(
    req,
    z.object({
      raast: z.string().max(20).nullable().optional(),
      iban: z.string().max(40).nullable().optional(),
      title: z.string().max(60).nullable().optional(),
      bank: z.string().max(40).nullable().optional(),
    }),
  );
  // "@me" = use the phone number this account verified (one tap during join).
  return { details: setPayDetails(user, { ...input, raast: input.raast === "@me" ? user.phone : input.raast }) };
});
