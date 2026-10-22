import { route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { requireMember } from "@/server/outings";
import { processOuting } from "@/server/pipeline";

type P = { params: Promise<{ id: string }> };
export const maxDuration = 300;

/** Streams newline-delimited JSON stage events so the Processing screen shows real progress. */
export const POST = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  requireMember(id, user);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        const result = await processOuting(id, user, (e) => send({ type: "stage", ...e }));
        send({ type: "done", ...result });
      } catch (e) {
        console.error("[wusool] processing failed", e);
        send({ type: "error", message: e instanceof Error ? e.message : "Processing failed. Your uploads are kept; try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
});
