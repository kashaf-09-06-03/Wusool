import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { requestNewLink } from "@/server/outings";

type P = { params: Promise<{ token: string }> };

export const POST = route<P>(async (_req, { params }) => requestNewLink((await params).token, await requireUser()));
