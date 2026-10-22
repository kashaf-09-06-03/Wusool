import "server-only";
import { geminiAvailable, transcribeWithGemini } from "./gemini";

/**
 * Speech-to-text providers, best first for Urdu/English code-switching:
 *  1. Gemini (GEMINI_API_KEY): handles mixed English/Roman-Urdu speech well and takes name hints.
 *  2. OpenAI gpt-4o-transcribe (OPENAI_API_KEY): strong general accuracy; names passed as a prompt.
 * With neither key, the client keeps the browser's own live speech recognition (lower quality) and
 * says so on screen.
 */
export type SttEngine = "gemini" | "openai" | "browser";

export function sttEngine(): SttEngine {
  if (geminiAvailable()) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "browser";
}

async function transcribeWithOpenAI(audio: Buffer, mime: string, hints: { names: string[]; terms: string[] }): Promise<string> {
  const form = new FormData();
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `story.${ext}`);
  form.append("model", process.env.OPENAI_STT_MODEL ?? "gpt-4o-transcribe");
  form.append("response_format", "json");
  form.append(
    "prompt",
    `A student in Pakistan describes a group outing, mixing English and Roman Urdu. Write Urdu in Roman Urdu, amounts as digits. Names: ${[...hints.names, ...hints.terms].slice(0, 40).join(", ")}.`,
  );
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const json = (await res.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json?.error?.message ?? "transcription failed"}`);
  return (json?.text ?? "").trim();
}

export async function transcribe(audio: Buffer, mime: string, hints: { names: string[]; terms: string[] }): Promise<{ text: string; engine: SttEngine }> {
  const engine = sttEngine();
  if (engine === "gemini") return { text: await transcribeWithGemini(audio, mime, hints), engine };
  if (engine === "openai") return { text: await transcribeWithOpenAI(audio, mime, hints), engine };
  throw Object.assign(new Error("No speech-to-text service is configured."), { code: "NO_STT" });
}
