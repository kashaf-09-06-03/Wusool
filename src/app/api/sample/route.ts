import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createSampleOuting } from "@/server/sample";

export const POST = route(async () => ({ id: createSampleOuting(await requireUser()) }));
