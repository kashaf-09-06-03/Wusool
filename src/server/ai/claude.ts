import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import type { ParsedReceipt } from "@/lib/interpret/receipt";
import type { NarrativeContext, NarrativeResult } from "@/lib/interpret/narrative";
import { factsFromFlat, STORY_SYSTEM, storyPrompt } from "./gemini";
import { parsePKR } from "@/lib/money";

/**
 * Optional Claude integration (used only when ANTHROPIC_API_KEY is set).
 * Claude *interprets* receipts and stories into validated facts; the deterministic ledger
 * engine still does all arithmetic. Any failure falls back to the local engines.
 */
export const claudeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const ReceiptSchema = z.object({
  kind: z.enum(["receipt", "ride", "other"]),
  vendor: z.string().nullable(),
  provider: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      lineTotalPKR: z.string().describe("Exact amount as printed for the whole line, digits only, e.g. 2400 or 216.50"),
      legible: z.boolean().describe("false if any digit of this amount is hard to read"),
    }),
  ),
  charges: z.array(
    z.object({
      kind: z.enum(["tax", "service", "fee", "tip", "discount", "other"]),
      label: z.string(),
      amountPKR: z.string().describe("As printed; discounts as positive numbers"),
    }),
  ),
  subtotalPKR: z.string().nullable(),
  totalPKR: z.string().nullable(),
  notes: z.array(z.string()).describe("Anything unreadable or inconsistent; never guess missing digits"),
});

export async function extractReceiptWithClaude(image: Buffer, mime: string, hint: string): Promise<ParsedReceipt> {
  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system:
      "You transcribe Pakistani restaurant receipts and ride-hailing screenshots (Careem, Uber, inDrive, Bykea) for an expense-splitting app. Copy amounts exactly as printed in PKR. Never compute, infer or invent a value: if a digit is unclear, mark the line not legible and say so in notes. Do not apply tax rates yourself; only list tax/service/fee lines that are printed.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/png", data: image.toString("base64") } },
          { type: "text", text: `The uploader labelled this as: ${hint}. Extract every line item, every printed charge, the subtotal and the total.` },
        ],
      },
    ],
    output_config: { format: betaZodOutputFormat(ReceiptSchema) },
  } as Parameters<Anthropic["beta"]["messages"]["parse"]>[0]);
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this image.");
  const out = response.parsed_output as z.infer<typeof ReceiptSchema> | null;
  if (!out) throw new Error("Claude returned no structured output.");
  const p = (s: string | null) => (s == null ? null : parsePKR(s));
  return {
    kind: out.kind,
    vendor: out.vendor,
    provider: out.provider?.toLowerCase() ?? null,
    items: out.items.flatMap((i) => {
      const v = p(i.lineTotalPKR);
      return v === null ? [] : [{ name: i.name, quantity: i.quantity || 1, lineTotal: v, confidence: i.legible ? ("high" as const) : ("low" as const), raw: `${i.name} ${i.lineTotalPKR}` }];
    }),
    charges: out.charges.flatMap((c) => {
      const v = p(c.amountPKR);
      return v === null ? [] : [{ kind: c.kind, label: c.label, amount: c.kind === "discount" ? -Math.abs(v) : v, raw: `${c.label} ${c.amountPKR}`, confidence: "high" as const }];
    }),
    subtotal: p(out.subtotalPKR),
    total: p(out.totalPKR),
    notes: out.notes,
  };
}

/** Same story schema as the Gemini path (all fields present; null when not applicable). */
const ClaudeFact = z.object({
  type: z.enum(["payer", "participants", "item", "rest", "split", "newExpense", "handoff", "unknownName", "note", "unparsed"]),
  sentence: z.string(),
  confidence: z.enum(["high", "low"]),
  expenseId: z.string().nullable(),
  itemId: z.string().nullable(),
  memberIds: z.array(z.string()),
  uncertainMemberIds: z.array(z.string()),
  payerIds: z.array(z.string()),
  splitMode: z.enum(["equal", "itemised"]).nullable(),
  title: z.string().nullable(),
  rideOrOther: z.enum(["ride", "other"]).nullable(),
  amountPKR: z.string().nullable(),
  fromId: z.string().nullable(),
  viaId: z.string().nullable(),
  toId: z.string().nullable(),
  changeReturned: z.enum(["yes", "no", "unknown"]).nullable(),
  name: z.string().nullable(),
  note: z.string().nullable(),
});
const ClaudeStory = z.object({ facts: z.array(ClaudeFact), uncertainWords: z.array(z.string()) });

export async function interpretWithClaude(transcript: string, ctx: NarrativeContext): Promise<NarrativeResult> {
  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: STORY_SYSTEM,
    messages: [{ role: "user", content: storyPrompt(transcript, ctx) }],
    output_config: { format: betaZodOutputFormat(ClaudeStory) },
  } as Parameters<Anthropic["beta"]["messages"]["parse"]>[0]);
  if (response.stop_reason === "refusal") throw new Error("Claude declined to interpret this story.");
  const out = response.parsed_output as z.infer<typeof ClaudeStory> | null;
  if (!out) throw new Error("Claude returned no structured output.");
  return { facts: factsFromFlat(out.facts, ctx), uncertainWords: out.uncertainWords, interpreter: "claude" };
}
