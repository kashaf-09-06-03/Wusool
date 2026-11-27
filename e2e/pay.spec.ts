import { expect, test, type Browser } from "@playwright/test";
import path from "node:path";

/**
 * Payment details + pay links, end to end against the running server:
 * validation, the optional "how should friends pay you?" step after joining by link, privacy of the
 * details (only people on the balance), the pay page, and "I've paid" recording a claim (not a transfer).
 */
const SHOTS = process.env.SHOTS_DIR;
const newPhone = () => "03" + String(Math.floor(100000000 + Math.random() * 899999999));

async function user(browser: Browser, name: string) {
  const ctx = await browser.newContext();
  const req = ctx.request;
  const phone = newPhone();
  const start = await (await req.post("/api/auth/start", { data: { phone } })).json();
  expect((await req.post("/api/auth/verify", { data: { phone, code: start.devCode, name } })).ok()).toBeTruthy();
  await req.patch("/api/me", { data: { onboarded: true } });
  return { ctx, req, name, phone };
}
const j = async (r: Promise<import("@playwright/test").APIResponse>) => {
  const res = await r;
  return { status: res.status(), body: await res.json().catch(() => null) };
};

test("pay details, join prompt, privacy, pay page and I've paid", async ({ browser }) => {
  test.setTimeout(240_000);
  const ayesha = await user(browser, "Ayesha Khan");

  // Validation: a mistyped IBAN (checksum) and a landline are rejected; the official example IBAN is accepted.
  expect((await j(ayesha.req.put("/api/me/payment", { data: { iban: "PK36SCBL0000001123456703" } }))).status).toBe(400);
  expect((await j(ayesha.req.put("/api/me/payment", { data: { raast: "021 1234567" } }))).status).toBe(400);
  const saved = await j(ayesha.req.put("/api/me/payment", { data: { raast: "@me", iban: "pk36 scbl 0000 0011 2345 6702", title: "Ayesha Khan", bank: "Meezan Bank" } }));
  expect(saved.status).toBe(200);
  expect(saved.body.details).toEqual({ raast: ayesha.phone, iban: "PK36SCBL0000001123456702", title: "Ayesha Khan", bank: "Meezan Bank" });

  const o = (await j(ayesha.req.post("/api/outings", { data: { name: "Chai run" } }))).body;
  const token = (await j(ayesha.req.get(`/api/outings/${o.id}`))).body.invite.token as string;

  // Mariam joins through the invite link in the browser and is asked (optionally) how friends should pay her.
  const mariam = await user(browser, "Mariam Siddiqui");
  const page = await mariam.ctx.newPage();
  await page.goto(`/j/${token}`);
  await page.getByLabel("Your name").fill("Mariam Siddiqui");
  await page.getByRole("button", { name: "Join outing" }).click();
  await expect(page.getByText("How should friends pay you back?")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "pay-01-join-step.png") });
  await page.getByRole("button", { name: /Use my number as Raast ID/ }).click();
  await page.getByRole("button", { name: "Save and open the outing" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${o.id}`));
  expect((await j(mariam.req.get("/api/me/payment"))).body.details.raast).toBe(mariam.phone);

  // Talha joins too (skips the step) but won't be on Mariam's balance.
  const talha = await user(browser, "Talha Hussain");
  expect((await j(talha.req.post(`/api/invite/${token}`, { data: { name: talha.name } }))).body.state).toBe("joined");

  const members = (await j(ayesha.req.get(`/api/outings/${o.id}`))).body.members as { id: string; name: string }[];
  const id = (n: string) => members.find((m) => m.name.startsWith(n))!.id;
  const [A, M, T] = [id("Ayesha"), id("Mariam"), id("Talha")];
  await ayesha.req.post(`/api/outings/${o.id}/expenses/manual`, { data: { title: "Chai", total: 300000, payers: [{ memberId: A, amount: 300000 }], mode: "equal", participants: [A, M, T].map((m) => ({ memberId: m, value: 1 })) } });
  const plan = (await j(ayesha.req.get(`/api/outings/${o.id}/settlement?routing=original`))).body;
  expect((await j(ayesha.req.post(`/api/outings/${o.id}/publish`, { data: { allocation: "actual", routing: "original", rules: {}, expectedRev: plan.draftRev, confirm: true } }))).status).toBe(200);
  const balances = (await j(ayesha.req.get(`/api/outings/${o.id}/balances`))).body.balances as { id: string; debtor: { id: string } }[];
  const mToA = balances.find((b) => b.debtor.id === M)!;

  // Privacy: Talha isn't on Mariam's balance → no access; Mariam (debtor) sees Ayesha's details.
  expect((await j(talha.req.get(`/api/pay/${mToA.id}`))).status).toBe(403);
  const info = (await j(mariam.req.get(`/api/pay/${mToA.id}`))).body;
  expect(info.role).toBe("debtor");
  expect(info.due).toBe(100000);
  expect(info.details.raast).toBe(ayesha.phone);

  // Pay page UI: details visible and copyable; "I've paid" records a claim for Ayesha to confirm.
  await page.goto(`/pay/${mToA.id}`);
  await expect(page.getByRole("button", { name: "Copy Raast ID" })).toBeVisible();
  await expect(page.getByText("PK36 SCBL 0000 0011 2345 6702")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "pay-02-pay-page.png"), fullPage: true });
  await page.getByRole("button", { name: /I’ve paid PKR 1,000/ }).click();
  await expect(page.getByText(/marked paid · waiting for Ayesha to confirm/)).toBeVisible();
  const after = (await j(ayesha.req.get(`/api/pay/${mToA.id}`))).body;
  expect(after.claimed).toBe(100000);
  expect(after.status).toBe("marked"); // a claim, not a completed transfer
  expect(after.role).toBe("creditor");

  // Ayesha's own view of the link: the QR sheet opens.
  const ap = await ayesha.ctx.newPage();
  await ap.goto(`/pay/${mToA.id}`);
  await ap.getByRole("button", { name: "QR code" }).click();
  await expect(ap.getByRole("img", { name: "QR code of this pay link" })).toBeVisible();
  if (SHOTS) await ap.screenshot({ path: path.join(SHOTS, "pay-03-qr.png") });
});
