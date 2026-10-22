import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ctx = {
  narratorId: "k",
  members: [
    { id: "k", name: "Kashaf" },
    { id: "a", name: "Ayesha" },
  ],
  expenses: [{ id: "cb", title: "Coffee Bean", kind: "receipt" as const, total: 100000, items: [{ id: "latte", name: "Latte" }] }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

describe("Gemini provider (mocked network)", () => {
  it("sends audio inline with name hints and returns the transcript", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const calls = mockFetch({ candidates: [{ content: { parts: [{ text: "Ayesha paid 1000 for the inDrive." }] } }] });
    const { transcribeWithGemini } = await import("./gemini");
    const text = await transcribeWithGemini(Buffer.from("fake-audio"), "audio/webm;codecs=opus", { names: ["Ayesha", "Kashaf"], terms: ["Coffee Bean"] });
    expect(text).toBe("Ayesha paid 1000 for the inDrive.");
    expect(calls[0].url).toMatch(/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "audio/webm", data: Buffer.from("fake-audio").toString("base64") });
    expect(body.contents[0].parts[1].text).toContain("Ayesha, Kashaf, Coffee Bean");
  });

  it("turns structured story output into validated facts and drops unknown ids", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const story = {
      facts: [
        { type: "item", sentence: "Ayesha had the latte", confidence: "high", expenseId: "cb", itemId: "latte", memberIds: ["a"], uncertainMemberIds: [], payerIds: [] },
        { type: "item", sentence: "ghost", confidence: "high", expenseId: "nope", itemId: "x", memberIds: ["a"], uncertainMemberIds: [], payerIds: [] },
        { type: "newExpense", sentence: "inDrive 1000 split equally", confidence: "high", title: "inDrive ride", rideOrOther: "ride", amountPKR: "1000", memberIds: ["k", "a", "zz"], uncertainMemberIds: [], payerIds: [], splitMode: "equal" },
      ],
      uncertainWords: [],
    };
    mockFetch({ candidates: [{ content: { parts: [{ text: JSON.stringify(story) }] } }] });
    const { interpretWithGemini } = await import("./gemini");
    const r = await interpretWithGemini("…", ctx);
    expect(r.interpreter).toBe("gemini");
    expect(r.facts[0]).toMatchObject({ type: "item", itemId: "latte", memberIds: ["a"] });
    expect(r.facts[1]).toMatchObject({ type: "unparsed" });
    expect(r.facts[2]).toMatchObject({ type: "newExpense", amount: 100000, payerIds: [], participantIds: ["k", "a"], split: "equal", kind: "ride" });
  });

  it("surfaces API errors clearly", async () => {
    vi.stubEnv("GEMINI_API_KEY", "bad");
    mockFetch({ error: { message: "API key not valid" } }, 400);
    const { transcribeWithGemini } = await import("./gemini");
    await expect(transcribeWithGemini(Buffer.from("a"), "audio/webm", { names: [], terms: [] })).rejects.toThrow(/Gemini 400: API key not valid/);
  });
});

describe("speech-to-text provider selection", () => {
  it("prefers Gemini, then OpenAI, else the browser", async () => {
    const { sttEngine } = await import("./transcribe");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(sttEngine()).toBe("browser");
    vi.stubEnv("OPENAI_API_KEY", "x");
    expect(sttEngine()).toBe("openai");
    vi.stubEnv("GEMINI_API_KEY", "y");
    expect(sttEngine()).toBe("gemini");
  });

  it("posts audio to OpenAI gpt-4o-transcribe with a names prompt", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const calls = mockFetch({ text: "Talha paid for parking." });
    const { transcribe } = await import("./transcribe");
    const r = await transcribe(Buffer.from("audio"), "audio/webm", { names: ["Talha"], terms: [] });
    expect(r).toEqual({ text: "Talha paid for parking.", engine: "openai" });
    expect(calls[0].url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const form = calls[0].init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-transcribe");
    expect(String(form.get("prompt"))).toContain("Talha");
  });
});
