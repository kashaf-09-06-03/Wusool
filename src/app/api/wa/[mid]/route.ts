import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { pressWhatsAppButton } from "@/server/balances";

type P = { params: Promise<{ mid: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { button } = await body(req, z.object({ button: z.enum(["Wusool", "Maaf"]) }));
  return pressWhatsAppButton((await params).mid, await requireUser(), button);
});
