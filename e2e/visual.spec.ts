import { test, type Page } from "@playwright/test";
import path from "node:path";

/** Viewport screenshots of the main screens for design review (run with SHOTS_DIR set). */
const SHOTS = process.env.SHOTS_DIR;
test.skip(!SHOTS, "Set SHOTS_DIR to capture design screenshots");

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS!, `v-${name}.png`) });

test("design review screenshots", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const p = "03" + String(Math.floor(100000000 + Math.random() * 899999999));
  const start = await (await page.request.post("/api/auth/start", { data: { phone: p } })).json();
  await page.request.post("/api/auth/verify", { data: { phone: p, code: start.devCode, name: "Ayesha Khan" } });
  await page.request.patch("/api/me", { data: { onboarded: true } });
  const { id } = await (await page.request.post("/api/sample")).json();

  await page.goto("/");
  await page.waitForTimeout(1500);
  await shot(page, "home");
  await page.goto(`/o/${id}`);
  await page.waitForTimeout(1500);
  await shot(page, "outing");
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(900);
  await shot(page, "outing-scrolled");
  await page.goto(`/o/${id}/review`);
  await page.waitForTimeout(1800);
  await shot(page, "review");
  await page.getByRole("radio", { name: /Optimized/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("radio", { name: /Optimized/ }).scrollIntoViewIfNeeded();
  await shot(page, "review-optimized");
  await page.goto(`/o/${id}/narrate`);
  await page.waitForTimeout(1200);
  await shot(page, "narrate");
  await page.goto(`/o/${id}/invite`);
  await page.waitForTimeout(1500);
  await shot(page, "invite");
  await page.goto(`/welcome?add=1`);
  await page.waitForTimeout(800);
  await shot(page, "add-account");
  await ctx.close();
});
