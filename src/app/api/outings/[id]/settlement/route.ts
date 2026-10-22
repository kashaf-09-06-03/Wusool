import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { previewFor, saveChoices } from "@/server/settlement";

type P = { params: Promise<{ id: string }> };

const Rules = z.object({ onlyKnown: z.boolean().optional(), collectorId: z.string().nullable().optional(), skipNoAccount: z.boolean().optional() });

export const GET = route<P>(async (req, { params }) => {
  const url = new URL(req.url);
  const a = url.searchParams.get("allocation");
  const r = url.searchParams.get("routing");
  const rules = url.searchParams.get("rules");
  return previewFor((await params).id, await requireUser(), {
    allocation: a === "equal" || a === "actual" ? a : undefined,
    routing: r === "optimized" || r === "original" ? r : undefined,
    rules: rules ? Rules.parse(JSON.parse(rules)) : undefined,
  });
});

export const PATCH = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ allocation: z.enum(["actual", "equal"]).optional(), routing: z.enum(["original", "optimized"]).optional(), rules: Rules.optional() }));
  saveChoices((await params).id, await requireUser(), input);
});
