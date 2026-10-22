import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { myBreakdown } from "@/server/settlement";

type P = { params: Promise<{ id: string }> };

export const GET = route<P>(async (_req, { params }) => myBreakdown((await params).id, await requireUser()));
