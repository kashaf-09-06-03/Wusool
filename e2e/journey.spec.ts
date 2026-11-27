import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * End-to-end journey through the real UI (no mocks):
 * organizer signs up → creates an outing → copies the invite link → a friend joins via the link
 * in a separate browser → receipts are uploaded and read with real OCR → story → review →
 * optimized routing → publish → the friend marks paid → organizer confirms → Maaf on a balance.
 */
const SAMPLES = path.join(__dirname, "..", "samples");
const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};
const phone = () => "03" + String(Math.floor(100000000 + Math.random() * 899999999));

async function signUp(page: Page, name: string) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Mobile number").fill(phone());
  await page.getByRole("button", { name: "Send code" }).click();
  // Prototype: the code is shown on screen (no SMS provider); tap it to fill.
  const code = page.locator("text=Your code is").locator("button");
  await code.click();
}

test("organizer and friend complete a full outing", async ({ browser }) => {
  test.setTimeout(600_000);
  const org = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await org.newPage();

  // A1 · onboarding
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome/);
  await shot(page, "01-welcome");
  await page.getByRole("button", { name: "Get started" }).click();
  await signUp(page, "Ayesha Khan");
  await expect(page.getByText("WhatsApp notifications: OFF")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // 02 · Home
  await expect(page.getByRole("heading", { name: /Salaam, Ayesha/ })).toBeVisible();
  await shot(page, "02-home-empty");
  await page.getByRole("button", { name: /Add Outing/ }).click();

  // 03 · Create outing (zero typing)
  await expect(page.getByRole("button", { name: "Continue to invite" })).toBeVisible();
  await shot(page, "03-create");
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Outing name").fill("Do Darya Night");
  await page.getByLabel("Outing name").press("Enter");
  await page.getByRole("button", { name: "Continue to invite" }).click();

  // 04 · Invite (link-first)
  await expect(page.getByText("Get everyone in.")).toBeVisible();
  await page.getByRole("button", { name: "Copy invite link" }).click();
  await expect(page.getByText("Copied. Paste it in your group.")).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/j\/[A-Za-z0-9]{3}-[A-Za-z0-9]{4}$/);
  await shot(page, "04-invite");

  // Manual add (backup) for friends without the link
  for (const n of ["Mariam Siddiqui", "Hamza Ali", "Sara Raza", "Bilal Ahmed"]) {
    await page.getByRole("button", { name: "Add manually" }).click();
    await page.getByLabel("Name").fill(n);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(n).first()).toBeVisible();
  }

  // C1 · Talha joins via the link in a separate browser (no install)
  const friendCtx = await browser.newContext();
  const friend = await friendCtx.newPage();
  await friend.goto(link);
  await expect(friend.getByText("invited you to split this outing")).toBeVisible();
  await expect(friend.getByText("You’ll see expenses only after you join.")).toBeVisible();
  await shot(friend, "05-join");
  await friend.getByLabel("Your name").fill("Talha Hussain");
  await friend.getByRole("button", { name: "Join outing" }).click();
  await friend.getByLabel("Mobile number").fill(phone());
  await friend.getByRole("button", { name: "Send code" }).click();
  await friend.locator("text=Your code is").locator("button").click();
  // New members are asked (optionally) how friends should pay them back; this friend skips it.
  await expect(friend.getByText("How should friends pay you back?")).toBeVisible({ timeout: 30_000 });
  await friend.getByRole("button", { name: "Skip for now" }).click();
  await expect(friend).toHaveURL(/\/o\/o_/, { timeout: 30_000 });

  // Live roster on the organizer's invite screen
  await expect(page.getByText("Talha Hussain")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Go to outing/ }).click();

  // 07 · Add evidence (real uploads)
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("What do you have?")).toBeVisible();
  const gallery = page.locator('input[type=file][multiple]').first();
  await page.getByRole("button", { name: /Gallery/ }).click();
  await page.getByRole("button", { name: "I agree" }).click();
  await gallery.setInputFiles([path.join(SAMPLES, "kolachi-receipt-SAMPLE.jpg"), path.join(SAMPLES, "chai-paratha-receipt-SAMPLE.jpg")]);
  await expect(page.getByText("Added · 2", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type=file][multiple]').nth(1).setInputFiles(path.join(SAMPLES, "careem-ride-SAMPLE.png"));
  await expect(page.getByText("Added · 3", { exact: true })).toBeVisible({ timeout: 30_000 });
  // Pick a payer explicitly for one source
  await page.getByRole("button", { name: /Who paid\?/ }).first().click();
  await page.getByRole("button", { name: /Ayesha/ }).last().click();
  await shot(page, "07-evidence");

  // E2 · manual expense
  await page.getByRole("button", { name: "Add without a receipt" }).click();
  await page.getByLabel("What was it?").fill("Parking");
  await page.getByLabel("Amount").fill("200");
  await page.getByRole("button", { name: /Clear/ }).click();
  await page.getByRole("button", { name: /Talha/ }).first().click(); // payer toggled below
  await page.getByRole("button", { name: "Save expense" }).isVisible();
  // who shared: Ayesha + Talha
  const shared = page.locator("section").filter({ hasText: "Who shared it?" });
  await shared.getByRole("button", { name: /Ayesha/ }).click();
  await shared.getByRole("button", { name: /Talha/ }).click();
  const paid = page.locator("section").filter({ hasText: "Who paid?" });
  await paid.getByRole("button", { name: /Ayesha/ }).click(); // remove Ayesha, Talha stays
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText(/Parking · PKR 200/)).toBeVisible();

  // 08 · Narrate (typed: the same pipeline as voice)
  await page.getByRole("button", { name: "Next: tell the story" }).click();
  await page.getByRole("radio", { name: /Text/ }).click();
  await page.getByLabel("Story transcript").fill("Ayesha paid for dinner at Kolachi. Hamza booked the Careem for himself, Sara and Bilal. Mariam got chai and paratha for her, Ayesha, Talha and Sara. Bilal had the mint margarita.");
  await shot(page, "08-narrate");
  await page.getByRole("button", { name: "Read my outing" }).click();

  // 09 · Processing (real OCR) → 10 · Review
  await expect(page.getByText("Reading your outing…")).toBeVisible();
  await shot(page, "09-processing");
  await expect(page.getByRole("heading", { name: "What Wusool understood" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("PKR 9,420").first()).toBeVisible();
  await expect(page.getByText("PKR 1,140").first()).toBeVisible();
  await shot(page, "10a-review");

  // Conversational correction
  await page.getByLabel("Say or type a fix").fill("Actually Hamza paid for the Careem.");
  await page.getByRole("button", { name: "Apply fix" }).click();
  await expect(page.getByText("Fixed. Re-validated.")).toBeVisible();

  // Equal split shows its consequence; then back to Actual. Routing: opt into Optimized.
  await page.getByRole("radio", { name: /Equal split/ }).click();
  await expect(page.getByText(/Equal ignores what people actually had/)).toBeVisible();
  await page.getByRole("radio", { name: /Actual \/ individual/ }).click();
  await page.getByRole("radio", { name: /Optimized/ }).click();
  await expect(page.getByText("Optimized settlement")).toBeVisible();
  await shot(page, "10b-review-optimized");
  await page.getByRole("button", { name: "See full graph" }).click();
  await expect(page.getByText("Net amounts unchanged for everyone").first()).toBeVisible();
  await shot(page, "11-graph");
  await page.getByRole("button", { name: /Use optimized/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 12 · Confirm & publish
  await expect(page.getByRole("button", { name: "Review & confirm" })).toBeEnabled();
  await page.getByRole("button", { name: "Review & confirm" }).click();
  await expect(page).toHaveURL(/\/confirm/, { timeout: 60_000 });
  await expect(page.getByText("Every balance sums to zero")).toBeVisible({ timeout: 60_000 });
  await shot(page, "12-confirm");
  await page.getByRole("button", { name: /Publish to 6 members/ }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page).toHaveURL(/tab=settle/, { timeout: 90_000 });
  await shot(page, "13-settle");

  // F4 · Talha sees only his breakdown, then marks paid
  await friend.goto(friend.url().split("?")[0] + "/me");
  await expect(friend.getByText("Why do I owe this?")).toBeVisible();
  await shot(friend, "14-breakdown");
  await friend.getByRole("button", { name: /Pay Ayesha/ }).click();
  await friend.getByRole("button", { name: /Already paid/ }).click();
  await friend.getByRole("button", { name: "Mark as paid" }).click();
  await expect(friend.getByText(/Marked Wusooled/).first()).toBeVisible();

  // Organizer confirms received from Balances; then Maaf on another balance
  await page.goto("/balances");
  await page.getByRole("button", { name: /Talha pays you/ }).click();
  await page.getByRole("button", { name: "Received" }).click();
  await expect(page.getByText("Confirmed received").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Bilal pays you/ }).click();
  await page.getByRole("button", { name: /^Maaf/ }).first().click();
  await page.getByRole("button", { name: "Maaf ♥" }).click();
  await expect(page.getByText("Maaf recorded ♥")).toBeVisible();
  await shot(page, "15-balances");

  await org.close();
  await friendCtx.close();
});
