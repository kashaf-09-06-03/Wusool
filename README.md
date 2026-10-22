# Wusool

**Tell Wusool what happened.** A conversational, multimodal group-expense app for student outings: upload receipts and ride screenshots, tell the story once (voice or text), check what Wusool understood, choose how to split, and settle with Wusool (collect) or Maaf (forgive).

HCI research prototype. Product intent: [`CLAUDE.md`](CLAUDE.md). Visual design and user flows: the Figma file "Application Screens (Copy)". Audit and plan: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Run it

Requires Node.js 22.13+ (tested on 24.20). No accounts or API keys needed.

```bash
npm install
npm run build
npm start            # http://localhost:3000
```

For development with hot reload: `npm run dev`.

**First visit:** sign up with any name and Pakistani mobile number. No SMS provider is connected, so the one-time code is shown on screen; tap it to fill it in. To see a finished example, tap **Load the sample outing** on the empty Home screen. It loads the labelled SAMPLE "Do Darya Night" outing from the Figma designs (PKR 12,060, 9 → 5 transfers).

**Try a second person:** copy the invite link and open it in a private window or another browser, then join with a different number. To use a phone on the same Wi-Fi, run `npm start` and open `http://<your-laptop-IP>:3000`. Set `WUSOOL_PUBLIC_URL` so message links use that address. Microphone and clipboard need a secure context, so on a phone over plain `http` use typing instead, or put an https tunnel in front.

**Better voice, receipts and story understanding:** copy `.env.example` to `.env.local`, add a free `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey), then rebuild and restart.

**Testing invites and Wusool/Maaf on one device (no WhatsApp needed):** on the Invite screen tap **Test the link as a friend on this device** (or Profile → **Add another person**). Sign in as a second person with any other number, join through the link, then switch between people in **Profile → Accounts on this device**. Wusool/Maaf live on each balance in the **Balances** tab; turn on WhatsApp notifications in Profile to see the simulated messages in **Profile → WhatsApp simulator**, whose buttons run the real actions.

**Test receipts:** `samples/` contains synthetic receipt and ride images (all marked SAMPLE). Regenerate them with `npm run samples` (needs Python and Pillow).

**Reset local data:** `npm run reset-db`. This deletes `.data/wusool.db` and uploads.

## Tests

```bash
npm test             # 33 unit tests: ledger engine, rounding, routing, receipt parser, narrative interpreter
npx playwright install chromium
npm run e2e          # 4 end-to-end suites against http://localhost:3000 (starts `npm run dev` if nothing is running)
```

The unit suite includes a **golden test** that reproduces every number on Figma screens 06, 10a, 10b, 11 and 12: the PKR 12,060 total, the nets, the Equal-split deltas, Sara → Hamza PKR 380, and 9 → 5 transfers.

## What's real and what's simulated

| Area | Status |
|---|---|
| Outings, invite links, joining via link, approval, claiming a manual guest, roster, members, leaving | **Real.** SQLite, server-side permissions. |
| Expense ledger, item-level split, pro-rata tax/fees, Equal split, whole-rupee rounding, debt graph, optimized routing | **Real.** A deterministic integer-paisa engine with unit and property tests. AI never does the maths. |
| Receipt and screenshot OCR | **Real**, using Tesseract on the server. The English model is downloaded once from the tesseract.js CDN and cached. With `ANTHROPIC_API_KEY` set, Claude vision is used instead and the result is validated. Unreadable lines become questions and are never guessed. |
| Voice | **Real.** Audio is recorded and transcribed by **Gemini** (`GEMINI_API_KEY`, recommended: handles Urdu–English mixing) or **OpenAI gpt-4o-transcribe** (`OPENAI_API_KEY`), with the outing's names as spelling hints. Without a key, the browser's built-in recognition is used and labelled "basic". Typing is always available. |
| Story interpretation and conversational fixes | **Real** deterministic rule-based interpreter (English plus common Roman Urdu). With `ANTHROPIC_API_KEY`, Claude (`claude-opus-5-5`, structured output) is used and its facts are validated against the outing. |
| Wusool / Maaf, mark paid, partial, confirm, dispute threads, reminders (48 h limit), wrong-recipient correction, edit after publishing, audit history | **Real.** Validated server-side against the live ledger; idempotent. |
| In-app inbox | **Real.** Always delivered. |
| WhatsApp invite and message sharing | **Real `wa.me` links.** They open WhatsApp with prefilled text, and you send it yourself. |
| WhatsApp notifications and interactive Wusool/Maaf buttons | **Simulated.** No WhatsApp Business credentials are configured. Messages are created only for people who opted in (OFF by default, consent required) and shown in **Profile → WhatsApp simulator**, labelled SIMULATED. Nothing is sent to WhatsApp. The buttons run the real, validated actions; Maaf always needs confirmation in the app. |
| SMS one-time codes | **Simulated.** The code is shown on screen. |
| Payments | **Not handled.** Wusool records claims and confirmations; it never moves money. |

## Stack

- Next.js 15 (App Router), React 19, TypeScript
- Tailwind CSS 4, with tokens transcribed from the Figma style tile
- Motion for animation; shared-element page transitions use the View Transitions API
- SQLite through Node's built-in `node:sqlite`; files stored in `.data/`
- tesseract.js for OCR; the Anthropic SDK is optional
- Zod for validation; Vitest and Playwright for tests

## Project layout

```
src/lib/ledger/       deterministic money engine (allocation, rounding, debts, routing) + tests
src/lib/interpret/    receipt-text parser and narrative interpreter (pure) + tests
src/server/           database, auth, outings, expenses, pipeline, settlement, balances, notifications
src/app/api/          route handlers (thin wrappers over src/server)
src/app/              screens: welcome, home, o/new, o/[id] (+ invite, evidence, narrate, processing,
                      review, confirm, me, expense), j/[token], balances, inbox, profile, wa
src/components/       UI kit mirroring the Figma components, collage, debt graph, balance sheets
e2e/                  Playwright journeys
samples/              synthetic SAMPLE receipts for OCR tests
```
