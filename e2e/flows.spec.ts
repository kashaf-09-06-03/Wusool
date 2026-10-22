import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * Secondary flows, exercised end-to-end against the running server with separate signed-in users.
 * Every assertion checks real server state (no mocks).
 */
const SHOTS = process.env.SHOTS_DIR;
const phone = () => "03" + String(Math.floor(100000000 + Math.random() * 899999999));

async function user(browser: Browser, name: string) {
  const ctx = await browser.newContext();
  const req = ctx.request;
  const p = phone();
  const start = await (await req.post("/api/auth/start", { data: { phone: p } })).json();
  const v = await req.post("/api/auth/verify", { data: { phone: p, code: start.devCode, name } });
  expect(v.ok()).toBeTruthy();
  return { ctx, req, name };
}
const j = async (r: Promise<import("@playwright/test").APIResponse>) => {
  const res = await r;
  const body = await res.json().catch(() => null);
  return { status: res.status(), body };
};
async function memberId(req: APIRequestContext, outingId: string, name: string) {
  const o = (await j(req.get(`/api/outings/${outingId}`))).body;
  return o.members.find((m: { name: string }) => m.name.startsWith(name)).id as string;
}

test.describe.configure({ mode: "serial" });

test("C1/C2/B5: approval, claiming a manual guest, duplicate names, revoked links", async ({ browser }) => {
  const org = await user(browser, "Ayesha Khan");
  const o = (await j(org.req.post("/api/outings", { data: {} }))).body;
  expect(o.name).toMatch(/^Outing \d{3}$/); // zero typing: auto-named

  // B4 backup: manual guest, then duplicate detection
  await org.req.post(`/api/outings/${o.id}/members`, { data: { name: "Talha Hussain" } });
  const dup = await j(org.req.post(`/api/outings/${o.id}/members`, { data: { name: "Talha" } }));
  expect(dup.status).toBe(409);
  expect(dup.body.error.code).toBe("POSSIBLE_DUPLICATE");

  let view = (await j(org.req.get(`/api/outings/${o.id}`))).body;
  const token = view.invite.token;

  // C2: Talha joins via link with a similar name → asked to claim the manual entry
  const talha = await user(browser, "Talha Hussain");
  const preview = (await j(talha.req.get(`/api/invite/${token}`))).body;
  expect(preview.outing.memberCount).toBe(2);
  expect(preview.outing).not.toHaveProperty("expenses"); // privacy: no expenses before joining
  const ask = (await j(talha.req.post(`/api/invite/${token}`, { data: { name: "Talha Hussain" } }))).body;
  expect(ask.state).toBe("claim");
  const claimed = (await j(talha.req.post(`/api/invite/${token}`, { data: { name: "Talha Hussain", claimGuestId: ask.guest.id } }))).body;
  expect(claimed.state).toBe("pending");
  view = (await j(org.req.get(`/api/outings/${o.id}`))).body;
  const pending = view.pending.find((p: { name: string }) => p.name === "Talha Hussain");
  await org.req.patch(`/api/outings/${o.id}/members/${pending.id}`, { data: { decision: "approve" } });
  view = (await j(org.req.get(`/api/outings/${o.id}`))).body;
  expect(view.members.filter((m: { name: string }) => m.name.startsWith("Talha"))).toHaveLength(1); // merged, no duplicate
  expect(view.members.find((m: { name: string }) => m.name.startsWith("Talha")).kind).toBe("joined");

  // B5: require approval, then a new joiner waits; decline shows nothing
  await org.req.patch(`/api/outings/${o.id}/invite`, { data: { requireApproval: true } });
  const sara = await user(browser, "Sara Raza");
  expect((await j(sara.req.post(`/api/invite/${token}`, { data: { name: "Sara Raza" } }))).body.state).toBe("pending");
  expect((await j(sara.req.get(`/api/outings/${o.id}`))).status).toBe(403);
  view = (await j(org.req.get(`/api/outings/${o.id}`))).body;
  await org.req.patch(`/api/outings/${o.id}/members/${view.pending[0].id}`, { data: { decision: "decline" } });
  expect((await j(sara.req.get(`/api/outings/${o.id}`))).status).toBe(403);

  // B5: revoke & regenerate → old link dead for everyone
  const fresh = (await j(org.req.post(`/api/outings/${o.id}/invite`))).body;
  expect(fresh.token).not.toBe(token);
  expect((await j(sara.req.get(`/api/invite/${token}`))).body.status).toBe("revoked");
  expect((await j(sara.req.post(`/api/invite/${token}`, { data: { name: "Sara" } }))).status).toBe(410);

  // Non-organizer can't rename (B2) or revoke
  expect((await j(talha.req.patch(`/api/outings/${o.id}`, { data: { name: "Hacked" } }))).status).toBe(403);
  expect((await j(talha.req.post(`/api/outings/${o.id}/invite`))).status).toBe(403);
  // Rename limits
  expect((await j(org.req.patch(`/api/outings/${o.id}`, { data: { name: "x".repeat(41) } }))).status).toBe(400);
  expect((await j(org.req.patch(`/api/outings/${o.id}`, { data: { name: "" } }))).body.outing.name).toMatch(/^Outing \d{3}$/);
});

test("E6 + G1–G5 + E7 + H1–H4: handoff, lifecycle, disputes, reminders, WhatsApp opt-in, re-publish", async ({ browser }) => {
  const ayesha = await user(browser, "Ayesha Khan");
  const o = (await j(ayesha.req.post("/api/outings", { data: { name: "Birthday" } }))).body;
  const token = (await j(ayesha.req.get(`/api/outings/${o.id}`))).body.invite.token;
  const mariam = await user(browser, "Mariam Siddiqui");
  const talha = await user(browser, "Talha Hussain");
  for (const u of [mariam, talha]) expect((await j(u.req.post(`/api/invite/${token}`, { data: { name: u.name } }))).body.state).toBe("joined");
  const [A, M, T] = [await memberId(ayesha.req, o.id, "Ayesha"), await memberId(ayesha.req, o.id, "Mariam"), await memberId(ayesha.req, o.id, "Talha")];

  // H1: Mariam opts in to WhatsApp (consent required); Talha stays OFF (default)
  expect((await j(mariam.req.patch("/api/me", { data: { whatsappEnabled: true } }))).status).toBe(400);
  expect((await j(mariam.req.patch("/api/me", { data: { whatsappEnabled: true, consent: true } }))).body.prefs.whatsappEnabled).toBe(true);
  expect((await j(talha.req.get("/api/me"))).body.prefs.whatsappEnabled).toBe(false);
  // Ayesha opts in so the small-debt Wusool/Maaf quick choice can be simulated for her
  await ayesha.req.patch("/api/me", { data: { whatsappEnabled: true, consent: true, threshold: 50000 } });

  // Manual expense: Ayesha paid 3,300 for all three (1,100 each)
  expect((await j(ayesha.req.post(`/api/outings/${o.id}/expenses/manual`, { data: { title: "Birthday dinner", total: 330000, payers: [{ memberId: A, amount: 330000 }], mode: "equal", participants: [A, M, T].map((m) => ({ memberId: m, value: 1 })) } }))).status).toBe(200);
  // Split validation: exact amounts must add up
  const bad = await j(ayesha.req.post(`/api/outings/${o.id}/expenses/manual`, { data: { title: "Cake", total: 100000, payers: [{ memberId: A, amount: 100000 }], mode: "exact", participants: [{ memberId: A, value: 50000 }, { memberId: M, value: 40000 }] } }));
  expect(bad.status).toBe(400);
  expect(bad.body.error.details.remaining).toBe(10000);

  // E6: Talha gave Mariam 1,500 to pay Ayesha; Mariam forgot to return the change.
  await ayesha.req.post(`/api/outings/${o.id}/narrative`, { data: { mode: "text", transcript: "Talha gave Mariam 1500 to pay Ayesha. Mariam forgot to return the change." } });
  const stream = await (await ayesha.req.post(`/api/outings/${o.id}/process`)).text();
  expect(stream).toContain('"type":"done"');
  let p = (await j(ayesha.req.get(`/api/outings/${o.id}/settlement?routing=original`))).body;
  expect(p.originalDebts).toContainEqual({ from: M, to: T, amount: 40000 }); // the PKR 400 change is explicit
  expect(p.originalDebts).toContainEqual({ from: M, to: A, amount: 110000 }); // Mariam still owes her own 1,100
  expect(p.originalDebts.find((e: { from: string; to: string }) => e.from === T && e.to === A)).toBeUndefined(); // Talha settled via Mariam
  expect(p.blockers).toEqual([]);

  // F3: publish (original debts)
  const pub = await j(ayesha.req.post(`/api/outings/${o.id}/publish`, { data: { allocation: "actual", routing: "original", rules: {}, expectedRev: p.draftRev, confirm: true } }));
  expect(pub.status).toBe(200);
  const bal = (await j(ayesha.req.get(`/api/outings/${o.id}/balances`))).body.balances as { id: string; debtor: { id: string }; creditor: { id: string }; amount: number; version: number }[];
  const mToA = bal.find((b) => b.debtor.id === M && b.creditor.id === A)!;
  const mToT = bal.find((b) => b.debtor.id === M && b.creditor.id === T)!;

  // H2: only Mariam (opted in) got a simulated WhatsApp breakdown; Talha nothing
  expect((await j(mariam.req.get("/api/wa"))).body.messages.some((m: { type: string }) => m.type === "breakdown")).toBe(true);
  expect((await j(talha.req.get("/api/wa"))).body.messages).toHaveLength(0);
  expect((await j(talha.req.get("/api/inbox"))).body.items.some((i: { type: string }) => i.type === "breakdown")).toBe(true);

  // G1: partial payment → Partial; creditor confirms; non-debtor can't mark
  expect((await j(talha.req.post(`/api/balances/${mToA.id}`, { data: { action: { type: "mark_paid", amount: 1000 } } }))).status).toBe(403);
  await mariam.req.post(`/api/balances/${mToA.id}`, { data: { action: { type: "mark_paid", amount: 100000, note: "JazzCash" } } });
  let d = (await j(ayesha.req.get(`/api/balances/${mToA.id}`))).body;
  expect(d.status).toBe("partial");
  await ayesha.req.post(`/api/balances/${mToA.id}`, { data: { action: { type: "confirm" } } });
  d = (await j(ayesha.req.get(`/api/balances/${mToA.id}`))).body;
  expect(d.confirmed).toBe(100000);
  expect(d.status).toBe("partial");

  // G4: reminder respects the 48 h limit and pauses while disputed
  expect((await j(ayesha.req.post(`/api/balances/${mToA.id}`, { data: { action: { type: "remind", tone: "friendly" } } }))).status).toBe(200);
  const again = await j(ayesha.req.post(`/api/balances/${mToA.id}`, { data: { action: { type: "remind", tone: "friendly" } } }));
  expect(again.status).toBe(429);
  expect((await j(mariam.req.get("/api/wa"))).body.messages.some((m: { type: string }) => m.type === "reminder")).toBe(true);

  // G3: Mariam disputes the 400 she owes Talha; thread; Talha withdraws? (only opener/organizer) → organizer resolves "paid"
  await mariam.req.post(`/api/balances/${mToT.id}`, { data: { action: { type: "dispute", reason: "already_paid", note: "I gave it back in cash" } } });
  expect((await j(talha.req.get(`/api/balances/${mToT.id}`))).body.status).toBe("disputed");
  expect((await j(talha.req.post(`/api/balances/${mToT.id}`, { data: { action: { type: "remind", tone: "neutral" } } }))).status).toBe(400);
  await talha.req.post(`/api/balances/${mToT.id}`, { data: { action: { type: "message", text: "Oh right, you did!" } } });
  await talha.req.post(`/api/balances/${mToT.id}`, { data: { action: { type: "resolve", resolution: "paid" } } });
  d = (await j(talha.req.get(`/api/balances/${mToT.id}`))).body;
  expect(d.status).toBe("confirmed");
  expect(d.dispute.messages.length).toBe(2);

  // E7: edit after publishing → re-publish keeps confirmed payments; new balance is only the difference
  const view = (await j(ayesha.req.get(`/api/outings/${o.id}`))).body;
  const dinner = view.expenses.find((e: { title: string }) => e.title === "Birthday dinner");
  await ayesha.req.put(`/api/expenses/${dinner.id}`, {
    data: { title: "Birthday dinner", payers: [{ memberId: A, amount: 360000 }], items: [{ name: "Birthday dinner", quantity: 1, lineTotal: 360000, confidence: "high", shares: [A, M, T].map((m) => ({ memberId: m, weight: 1 })) }], charges: [], declaredTotal: 360000, equalEligible: true },
  });
  p = (await j(ayesha.req.get(`/api/outings/${o.id}/settlement?routing=original`))).body;
  expect(p.hasUnpublishedChanges).toBe(true);
  const re = await j(ayesha.req.post(`/api/outings/${o.id}/publish`, { data: { allocation: "actual", routing: "original", rules: {}, expectedRev: p.draftRev, confirm: true } }));
  expect(re.body.version).toBe(2);
  const v2 = (await j(ayesha.req.get(`/api/outings/${o.id}/balances`))).body.balances as { debtor: { id: string }; creditor: { id: string }; amount: number }[];
  // Shares rose to 1,200 each. Mariam already paid 1,000 → she owes exactly 200 more; Talha owes the extra 100.
  expect(v2.find((b) => b.debtor.id === M && b.creditor.id === A)!.amount).toBe(20000);
  expect(v2.find((b) => b.debtor.id === T && b.creditor.id === A)!.amount).toBe(10000);
  const superseded = (await j(ayesha.req.get(`/api/balances/${mToA.id}`))).body;
  expect(superseded.superseded).toBe(true);

  // G2/H4: Talha's balance to Ayesha is below her PKR 500 threshold → quick choice; simulated WhatsApp buttons
  const mine = (await j(ayesha.req.get("/api/balances"))).body.balances as { id: string; quickChoice: boolean; debtor: { id: string } }[];
  const quick = mine.find((b) => b.quickChoice);
  expect(quick).toBeTruthy();
  if (quick) {
    const wa = (await j(ayesha.req.get("/api/wa"))).body.messages.find((m: { balance_id: string; buttons: string[] }) => m.balance_id === quick.id && m.buttons.length);
    expect(wa).toBeTruthy();
    const maaf = (await j(ayesha.req.post(`/api/wa/${wa.id}`, { data: { button: "Maaf" } }))).body;
    expect(maaf.confirmLink).toContain("maaf=1"); // Maaf always needs confirmation in the app
    const again2 = (await j(ayesha.req.post(`/api/wa/${wa.id}`, { data: { button: "Wusool" } }))).body;
    expect(again2.alreadyHandled).toBe(true); // second tap changes nothing
  }

  // G5: wrong recipient — Talha sent his share to Mariam by mistake; Mariam confirms → correction entries
  const tToA = (await j(talha.req.get("/api/balances"))).body.balances.find((b: { direction: string; creditor: { id: string } }) => b.direction === "owe" && b.creditor.id === A);
  expect(tToA).toBeTruthy();
  if (tToA) {
    await talha.req.post(`/api/balances/${tToA.id}`, { data: { action: { type: "third_party", memberId: M, amount: tToA.outstanding } } });
    const conf = await j(mariam.req.post(`/api/balances/${tToA.id}/third-party`, { data: { confirm: true } }));
    expect(conf.status).toBe(200);
    const after = (await j(talha.req.get(`/api/balances/${tToA.id}`))).body;
    expect(after.status).toBe("confirmed");
    const newOwe = (await j(mariam.req.get("/api/balances"))).body.balances.find((b: { direction: string; amount: number }) => b.direction === "owe" && b.amount === tToA.outstanding);
    expect(newOwe).toBeTruthy();
  }

  // D2: can't leave with open balances
  expect((await j(mariam.req.post(`/api/outings/${o.id}/leave`))).status).toBe(409);
  // J2: delete account blocked with open balances
  expect((await j(mariam.req.delete("/api/me"))).status).toBe(409);

  // UI: WhatsApp simulator renders Mariam's simulated messages, clearly labelled
  const page = await mariam.ctx.newPage();
  await page.goto("/wa");
  await expect(page.getByText(/PROTOTYPE SIMULATION/)).toBeVisible();
  await expect(page.getByText("SIMULATED").first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "16-whatsapp-sim.png") });
  await page.close();
});

test("I1–I3 Memories and D1 roster safety", async ({ browser }) => {
  const org = await user(browser, "Ayesha Khan");
  const o = (await j(org.req.post("/api/outings", { data: {} }))).body;
  const token = (await j(org.req.get(`/api/outings/${o.id}`))).body.invite.token;
  const sara = await user(browser, "Sara Raza");
  await sara.req.post(`/api/invite/${token}`, { data: { name: "Sara Raza" } });
  const outsider = await user(browser, "Stranger");

  // I1: upload a photo; visible to members only
  const up = await j(sara.req.post(`/api/outings/${o.id}/photos`, { multipart: { file: { name: "sea.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(__dirname, "..", "public", "assets", "sea.png")) } } }));
  const photoId = up.body.results[0].id;
  expect((await org.req.get(`/api/photos/${photoId}`)).status()).toBe(200);
  expect((await outsider.req.get(`/api/photos/${photoId}`)).status()).toBe(403);
  // I3: organizer (not uploader) asks removal? Organizer can remove directly; requester flow for pictured member
  await org.req.post(`/api/photos/${photoId}`, { data: { requestRemoval: "I blinked" } });
  await sara.req.post(`/api/photos/${photoId}`, { data: { decide: "decline" } });
  expect((await org.req.get(`/api/photos/${photoId}`)).status()).toBe(200);
  // I4: organizer sets it as banner
  await org.req.patch(`/api/outings/${o.id}`, { data: { banner: `photo:${photoId}` } });
  expect((await j(org.req.get(`/api/outings/${o.id}`))).body.outing.banner).toBe(`photo:${photoId}`);

  // D1: remove is blocked when the member has items
  const S = await memberId(org.req, o.id, "Sara");
  const A = await memberId(org.req, o.id, "Ayesha");
  await org.req.post(`/api/outings/${o.id}/expenses/manual`, { data: { title: "Ice cream", total: 60000, payers: [{ memberId: A, amount: 60000 }], mode: "equal", participants: [A, S].map((m) => ({ memberId: m, value: 1 })) } });
  const rm = await j(org.req.delete(`/api/outings/${o.id}/members/${S}`));
  expect(rm.status).toBe(409);
  expect(rm.body.error.code).toBe("HAS_ENTRIES");
});
