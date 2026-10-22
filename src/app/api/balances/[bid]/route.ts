import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { BalanceAction, balanceDetail, performAction } from "@/server/balances";

type P = { params: Promise<{ bid: string }> };

export const GET = route<P>(async (_req, { params }) => balanceDetail((await params).bid, await requireUser()));

export const POST = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ action: BalanceAction, expectedVersion: z.number().int().optional(), idempotencyKey: z.string().max(80).optional() }));
  const { bid } = await params;
  const user = await requireUser();
  const result = performAction(bid, user, input.action, { expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey });
  return { ...result, detail: balanceDetail(bid, user) };
});
