import { bad, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createManualExpense } from "@/server/expenses";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const json = await req.json().catch(() => {
    throw bad("Expected a JSON body.");
  });
  return { id: createManualExpense((await params).id, await requireUser(), json) };
});
