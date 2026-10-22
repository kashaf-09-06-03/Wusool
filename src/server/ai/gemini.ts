import "server-only";
import { z } from "zod/v4";
import type { ParsedReceipt } from "@/lib/interpret/receipt";
import type { Fact, NarrativeContext, NarrativeResult } from "@/lib/interpret/narrative";
import { parsePKR } from "@/lib/money";

/**
 * Google Gemini (optional; used when GEMINI_API_KEY is set). One key covers:
 *  - speech-to-text that copes with English/Urdu code-switching (research: Gemini-2.5-Pro reached ~3% WER on
 *    code-switched Urdu speech where Whisper-large-v3 was ~53%; arXiv 2605.17846),
 *  - reading receipts from photos,
 *  - turning the story into validated facts.
 * Gemini never does the maths: the deterministic ledger does.
 */
export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY);
const MODEL = () => process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function generate(parts: Part[], opts: { schema?: object; system?: string; temperature?: number } = {}): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      ...(opts.system ? { system_instruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: "user", parts }],
      generation_config: {
        temperature: opts.temperature ?? 0,
        ...(opts.schema ? { response_mime_type: "application/json", response_schema: opts.schema } : {}),
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const json = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json?.error?.message ?? "request failed"}`);
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Gemini returned an empty response.");
  return text;
}

// ---------------------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------------------
export async function transcribeWithGemini(audio: Buffer, mime: string, hints: { names: string[]; terms: string[] }): Promise<string> {
  const prompt = `Transcribe this voice note exactly as spoken. The speaker is a university student in Pakistan describing a group outing (who paid, who had what, rides, amounts).
- The speech may mix English and Urdu. Write English words in English and Urdu words in Roman Urdu (Latin letters). Never translate.
- Write money amounts as digits (e.g. "a thousand rupees" → "1000 rupees").
- Spell these names and words exactly like this if you hear them: ${[...hints.names, ...hints.terms].slice(0, 60).join(", ") || "(none)"}.
- Add normal punctuation. Output only the transcript text, nothing else.`;
  const text = await generate([{ inline_data: { mime_type: mime.split(";")[0] || "audio/webm", data: audio.toString("base64") } }, { text: prompt }]);
  return text.trim().replace(/^["“]|["”]$/g, "");
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------
const nullableString = { type: "STRING", nullable: true };
const RECEIPT_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["receipt", "ride", "other"] },
    vendor: nullableString,
    provider: nullableString,
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: { type: "STRING" }, quantity: { type: "NUMBER" }, lineTotalPKR: { type: "STRING" }, legible: { type: "BOOLEAN" } },
        required: ["name", "quantity", "lineTotalPKR", "legible"],
      },
    },
    charges: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { kind: { type: "STRING", enum: ["tax", "service", "fee", "tip", "discount", "other"] }, label: { type: "STRING" }, amountPKR: { type: "STRING" } },
        required: ["kind", "label", "amountPKR"],
      },
    },
    subtotalPKR: nullableString,
    totalPKR: nullableString,
    notes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["kind", "items", "charges", "notes"],
};
const Receipt = z.object({
  kind: z.enum(["receipt", "ride", "other"]),
  vendor: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  items: z.array(z.object({ name: z.string(), quantity: z.number(), lineTotalPKR: z.string(), legible: z.boolean() })),
  charges: z.array(z.object({ kind: z.enum(["tax", "service", "fee", "tip", "discount", "other"]), label: z.string(), amountPKR: z.string() })),
  subtotalPKR: z.string().nullable().optional(),
  totalPKR: z.string().nullable().optional(),
  notes: z.array(z.string()),
});

export async function extractReceiptWithGemini(image: Buffer, mime: string, hint: string): Promise<ParsedReceipt> {
  const text = await generate(
    [
      { inline_data: { mime_type: mime, data: image.toString("base64") } },
      { text: `Labelled by the uploader as: ${hint}. Extract every purchased line item (not token/table/invoice/NTN/cashier/payment-method lines), every printed tax/service/fee/discount line, the subtotal and the total. Copy amounts exactly as printed; never compute or guess digits — mark unclear lines legible=false and explain in notes.` },
    ],
    { schema: RECEIPT_SCHEMA, system: "You transcribe Pakistani restaurant receipts and ride-hailing screenshots (Careem, Uber, inDrive, Bykea, Yango) into structured data. Amounts are in PKR." },
  );
  const out = Receipt.parse(JSON.parse(text));
  const p = (s: string | null | undefined) => (s == null ? null : parsePKR(s));
  return {
    kind: out.kind,
    vendor: out.vendor ?? null,
    provider: out.provider?.toLowerCase() ?? null,
    items: out.items.flatMap((i) => {
      const v = p(i.lineTotalPKR);
      return v === null || v <= 0 ? [] : [{ name: i.name, quantity: i.quantity || 1, lineTotal: v, confidence: i.legible ? ("high" as const) : ("low" as const), raw: `${i.name} ${i.lineTotalPKR}` }];
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

// ---------------------------------------------------------------------------
// Story → facts
// ---------------------------------------------------------------------------
const ids = { type: "ARRAY", items: { type: "STRING" } };
const FACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    facts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["payer", "participants", "item", "rest", "split", "newExpense", "handoff", "unknownName", "note", "unparsed"] },
          sentence: { type: "STRING" },
          confidence: { type: "STRING", enum: ["high", "low"] },
          expenseId: nullableString,
          itemId: nullableString,
          memberIds: ids,
          uncertainMemberIds: ids,
          payerIds: ids,
          splitMode: { type: "STRING", enum: ["equal", "itemised"], nullable: true },
          title: nullableString,
          rideOrOther: { type: "STRING", enum: ["ride", "other"], nullable: true },
          amountPKR: nullableString,
          fromId: nullableString,
          viaId: nullableString,
          toId: nullableString,
          changeReturned: { type: "STRING", enum: ["yes", "no", "unknown"], nullable: true },
          name: nullableString,
          note: nullableString,
        },
        required: ["type", "sentence", "confidence", "memberIds", "uncertainMemberIds", "payerIds"],
      },
    },
    uncertainWords: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["facts", "uncertainWords"],
};
const FlatFact = z.object({
  type: z.enum(["payer", "participants", "item", "rest", "split", "newExpense", "handoff", "unknownName", "note", "unparsed"]),
  sentence: z.string(),
  confidence: z.enum(["high", "low"]),
  expenseId: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  memberIds: z.array(z.string()),
  uncertainMemberIds: z.array(z.string()),
  payerIds: z.array(z.string()),
  splitMode: z.enum(["equal", "itemised"]).nullable().optional(),
  title: z.string().nullable().optional(),
  rideOrOther: z.enum(["ride", "other"]).nullable().optional(),
  amountPKR: z.string().nullable().optional(),
  fromId: z.string().nullable().optional(),
  viaId: z.string().nullable().optional(),
  toId: z.string().nullable().optional(),
  changeReturned: z.enum(["yes", "no", "unknown"]).nullable().optional(),
  name: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
export const Story = z.object({ facts: z.array(FlatFact), uncertainWords: z.array(z.string()) });
export type FlatFactT = z.infer<typeof FlatFact>;

export const STORY_SYSTEM = `You turn a student's description of a group outing in Pakistan (English, Urdu or Roman Urdu, often from speech-to-text with mistakes and no punctuation) into structured facts for an expense-splitting app.
Use only the member ids, expense ids and item ids provided. Fact types:
- "item": a person had a specific line item (itemId). One fact per item; a sentence like "Ayesha had the pasta and the Americano" gives two.
- "rest": someone had "whatever was left" of an expense.
- "payer": who paid an existing expense. "participants": who shared a whole expense.
- "split": splitMode "equal" when they say an expense should be split equally/evenly; "itemised" when they want it by what each person had (including "taxes according to what we got").
- "newExpense": an expense the story mentions that has no matching expense (e.g. a ride with an amount). If the story mentions an expense that already exists (same kind or amount), refer to that expense instead of creating a new one. payerIds must be empty when the payer isn't stated (e.g. "it cost us 1000"). memberIds = who shared it ("together"/"all of us" = everyone).
- "handoff": cash given to an intermediary to pay someone else; changeReturned only if stated.
- "unknownName": a person mentioned who isn't a member. "note": an understood instruction with nothing to change. "unparsed": anything you can't use.
"I/me" is the narrator. Convert spoken numbers to digits in amountPKR. Never calculate shares. Mark confidence "low" and list uncertainMemberIds when unsure.`;

export function storyPrompt(transcript: string, ctx: NarrativeContext) {
  return `Members: ${JSON.stringify(ctx.members)}
Narrator member id: ${ctx.narratorId ?? "unknown"}
Expenses (with current totals in paisa and item ids): ${JSON.stringify(ctx.expenses)}

Story:
"""${transcript}"""`;
}

/** Convert flat model output to validated facts that only reference real ids. */
export function factsFromFlat(flat: FlatFactT[], ctx: NarrativeContext): Fact[] {
  const memberIds = new Set(ctx.members.map((m) => m.id));
  const expById = new Map(ctx.expenses.map((e) => [e.id, e]));
  const keep = (xs: string[]) => xs.filter((x) => memberIds.has(x));
  const out: Fact[] = [];
  for (const f of flat) {
    const base = { sentence: f.sentence, confidence: f.confidence };
    const e = f.expenseId ? expById.get(f.expenseId) : undefined;
    if ((f.type === "payer" || f.type === "participants") && e && keep(f.memberIds).length) out.push({ type: f.type, expenseId: e.id, memberIds: keep(f.memberIds), uncertainIds: keep(f.uncertainMemberIds), ...base });
    else if (f.type === "item" && e && f.itemId && e.items.some((i) => i.id === f.itemId) && keep(f.memberIds).length)
      out.push({ type: "item", expenseId: e.id, itemId: f.itemId, memberIds: keep(f.memberIds), uncertainIds: keep(f.uncertainMemberIds), ...base });
    else if (f.type === "rest" && e && keep(f.memberIds).length) out.push({ type: "rest", expenseId: e.id, memberIds: keep(f.memberIds), sentence: f.sentence });
    else if (f.type === "split" && e && f.splitMode) out.push({ type: "split", expenseId: e.id, mode: f.splitMode, sentence: f.sentence });
    else if (f.type === "newExpense")
      out.push({
        type: "newExpense",
        title: f.title?.trim() || "Expense from your story",
        kind: f.rideOrOther ?? "other",
        amount: f.amountPKR ? parsePKR(f.amountPKR) : null,
        payerIds: keep(f.payerIds),
        participantIds: keep(f.memberIds),
        split: f.splitMode ?? undefined,
        ...base,
      });
    else if (f.type === "handoff" && f.fromId && f.viaId && f.toId && memberIds.has(f.fromId) && memberIds.has(f.viaId) && memberIds.has(f.toId) && f.amountPKR) {
      const given = parsePKR(f.amountPKR);
      if (given) out.push({ type: "handoff", fromId: f.fromId, viaId: f.viaId, toId: f.toId, given, forwarded: null, changeReturned: f.changeReturned ?? "unknown", sentence: f.sentence });
    } else if (f.type === "unknownName" && f.name) out.push({ type: "unknownName", name: f.name, sentence: f.sentence, suggestionIds: [] });
    else if (f.type === "note") out.push({ type: "note", text: f.note ?? "Understood.", sentence: f.sentence });
    else out.push({ type: "unparsed", sentence: f.sentence });
  }
  return out;
}

export async function interpretWithGemini(transcript: string, ctx: NarrativeContext): Promise<NarrativeResult> {
  const text = await generate([{ text: storyPrompt(transcript, ctx) }], { schema: FACT_SCHEMA, system: STORY_SYSTEM });
  const out = Story.parse(JSON.parse(text));
  return { facts: factsFromFlat(out.facts, ctx), uncertainWords: out.uncertainWords, interpreter: "gemini" };
}
