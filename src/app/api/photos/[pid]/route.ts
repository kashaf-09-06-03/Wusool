import { z } from "zod/v4";
import { body, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { decideRemoval, deletePhoto, react, readPhoto, requestRemoval, suggestBanner } from "@/server/photos";

type P = { params: Promise<{ pid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const f = readPhoto((await params).pid, await requireUser());
  return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=3600" } });
});

export const POST = route<P>(async (req, { params }) => {
  const { pid } = await params;
  const user = await requireUser();
  const input = await body(req, z.object({ react: z.string().optional(), requestRemoval: z.string().optional(), decide: z.enum(["approve", "decline"]).optional(), suggestBanner: z.boolean().optional() }));
  if (input.react) react(pid, user, input.react);
  if (input.requestRemoval !== undefined) requestRemoval(pid, user, input.requestRemoval);
  if (input.decide) decideRemoval(pid, user, input.decide === "approve");
  if (input.suggestBanner) suggestBanner(pid, user);
});

export const DELETE = route<P>(async (_req, { params }) => deletePhoto((await params).pid, await requireUser()));
