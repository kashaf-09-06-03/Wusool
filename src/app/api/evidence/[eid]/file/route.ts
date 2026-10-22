import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { readEvidenceFile } from "@/server/expenses";

type P = { params: Promise<{ eid: string }> };

export const GET = route<P>(async (_req, { params }) => {
  const f = readEvidenceFile((await params).eid, await requireUser());
  return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=300" } });
});
