import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { decideMember, removeMember, renameMember, setNoBankAccount } from "@/server/outings";

type P = { params: Promise<{ id: string; mid: string }> };

export const PATCH = route<P>(async (req, { params }) => {
  const { id, mid } = await params;
  const user = await requireUser();
  const input = await body(req, z.object({ name: z.string().optional(), decision: z.enum(["approve", "decline"]).optional(), noBankAccount: z.boolean().optional() }));
  if (input.decision) decideMember(id, user, mid, input.decision);
  if (input.name !== undefined) renameMember(id, user, mid, input.name);
  if (input.noBankAccount !== undefined) setNoBankAccount(id, user, mid, input.noBankAccount);
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { id, mid } = await params;
  removeMember(id, await requireUser(), mid);
});
