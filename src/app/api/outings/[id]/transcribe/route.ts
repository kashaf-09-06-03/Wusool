import { AppError, bad, route } from "@/server/http";
import { requireUser } from "@/server/auth";
import { requireMember } from "@/server/outings";
import { narrativeContext } from "@/server/pipeline";
import { transcribe } from "@/server/ai/transcribe";

type P = { params: Promise<{ id: string }> };
export const maxDuration = 120;

/** Audio (webm/ogg/mp4) → transcript, with the outing's names and items as spelling hints. */
export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser();
  const { me } = requireMember(id, user);
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File) || file.size === 0) throw bad("No audio received. Record again.");
  if (file.size > 18 * 1024 * 1024) throw bad("That recording is too long. Keep it under about 10 minutes.");
  const ctx = narrativeContext(id, me.id);
  const hints = {
    names: ctx.members.map((m) => m.name),
    terms: [...new Set(ctx.expenses.flatMap((e) => [e.title, e.vendor ?? "", ...e.items.map((i) => i.name)]).filter(Boolean))].slice(0, 40),
  };
  try {
    return await transcribe(Buffer.from(await file.arrayBuffer()), file.type || "audio/webm", hints);
  } catch (e) {
    if ((e as { code?: string }).code === "NO_STT") throw new AppError(501, "NO_STT", "High-accuracy transcription isn’t set up (no GEMINI_API_KEY or OPENAI_API_KEY). Using your browser’s transcript.");
    console.error("[wusool] transcription failed", e);
    throw new AppError(502, "STT_FAILED", "Transcription failed. Your browser’s transcript is kept; you can edit it or try again.");
  }
});
