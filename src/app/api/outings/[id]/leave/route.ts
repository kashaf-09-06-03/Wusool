import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { leaveOuting } from "@/server/outings";

type P = { params: Promise<{ id: string }> };

export const POST = route<P>(async (_req, { params }) => leaveOuting((await params).id, await requireUser()));
