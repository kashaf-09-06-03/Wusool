import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { outingBalances } from "@/server/balances";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => ({ balances: outingBalances((await params).id, await requireUser()) }));
