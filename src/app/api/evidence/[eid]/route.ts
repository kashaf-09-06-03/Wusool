import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { deleteEvidence, updateEvidence } from "@/server/expenses";

type P = { params: Promise<{ eid: string }> };

export const PATCH = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ kind: z.enum(["receipt", "ride", "other"]).optional(), payerMemberId: z.string().nullable().optional() }));
  updateEvidence((await params).eid, await requireUser(), input);
});

export const DELETE = route<P>(async (_req, { params }) => deleteEvidence((await params).eid, await requireUser()));
