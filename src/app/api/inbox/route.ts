import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { inboxView, markRead } from "@/server/views";

export const GET = route(async () => ({ items: inboxView(await requireUser()) }));

export const POST = route(async (req) => {
  const { ids } = await body(req, z.object({ ids: z.array(z.string()).optional() }));
  markRead(await requireUser(), ids);
});
