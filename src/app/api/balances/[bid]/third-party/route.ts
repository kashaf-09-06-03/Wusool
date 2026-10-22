import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { thirdPartyConfirm } from "@/server/balances";

type P = { params: Promise<{ bid: string }> };

export const POST = route<P>(async (req, { params }) => {
  const { confirm } = await body(req, z.object({ confirm: z.boolean() }));
  return thirdPartyConfirm((await params).bid, await requireUser(), confirm);
});
