import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createExpense, ExpenseInput } from "@/server/expenses";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (req, { params }) => {
  const input = await body(req, ExpenseInput);
  return { id: createExpense((await params).id, await requireUser(), input, { source: "manual", confirmed: true }) };
});
