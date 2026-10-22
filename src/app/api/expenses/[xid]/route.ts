import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { deleteExpense, ExpenseInput, setExpenseOptions, updateExpense } from "@/server/expenses";

type P = { params: Promise<{ xid: string }> };

export const PUT = route<P>(async (req, { params }) => {
  updateExpense((await params).xid, await requireUser(), await body(req, ExpenseInput));
});

export const DELETE = route<P>(async (_req, { params }) => deleteExpense((await params).xid, await requireUser()));

/** Per-expense options: split equally / itemised, and pay the payer directly when optimizing. */
export const PATCH = route<P>(async (req, { params }) => {
  const input = await body(req, z.object({ splitMode: z.enum(["itemised", "equal"]).optional(), direct: z.boolean().optional() }));
  setExpenseOptions((await params).xid, await requireUser(), input);
});
