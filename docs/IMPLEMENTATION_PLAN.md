# Wusool — Design Audit & Implementation Plan

> **Update (2026-10-22): implemented.** See `README.md` for how to run it and what is real or simulated. Decisions that changed during the build:
> - **Storage:** SQLite (`node:sqlite`) and local files instead of Supabase, so the prototype runs with no accounts.
> - **Undesigned screens** (onboarding, Balances, Inbox, Profile, Members, Memories, sheets) were built from the existing Figma components and need a design review.
> - **Copy link:** kept the Figma flow (Create → one tap → Invite), not "immediately on create" as CLAUDE.md §5.1 says.
> - **Terminology:** kept "Marked Wusooled" as in Figma.
> - **Collector routing rule:** OFF by default. Figma 11 shows it checked, but CLAUDE.md forbids silently routing money through someone.
> - **Rounding:** shares are rounded to whole rupees, within PKR 1 per person and shown in breakdowns, as the Figma confirm screen states. Nobody is charged on an expense they didn't share.
>
> The original plan follows.

Status (at planning time): planning only, no application code yet.
Sources: `CLAUDE.md` (product behaviour, the source of truth) and the Figma file "Application Screens (Copy)", `87ZI6CNQFCmyy8e9r2vdDg` (visual design, the source of truth).
Audited: 2026-10-22.

Labels used below: **MVP** = must work in the prototype. **MOCK** = simulated with labelled sample data. **FUTURE** = not in the prototype. Every flow step in Figma carries one of these tags, and this plan keeps them.

---

## 1. What is in the Figma file

The file has two pages.

| Page | Contents |
|---|---|
| **User Flows** (`0:1`) | 40 flows in 10 areas (A–J), with about 107 screen nodes, 87 system states, 56 edge cases, 90 decisions and 91 terminals. Each flow names its actor and tags every step MVP / MOCK / FUTURE, and each has an HCI annotation card. |
| **Screens** (`4:2`) | A style tile (11 sections), 12 high-fidelity mobile screens at 390 × 844 with an HCI annotation card each, a component library, and a set of sample images (AI-generated). |

### 1.1 Designed screens (12)

| # | Screen | Node | Flow(s) | Notes |
|---|---|---|---|---|
| 02 | Home | `28:2985` | A2 | Large "Add Outing" hero, a "Have an invite link? Paste to join" link, My Outings cards (banner, logo, members, your money position), and a glass tab bar (Home / Balances / Inbox / Profile). |
| 03 | Create outing | `28:3141` | B1, B3 | Auto-named "Outing 003" with an inline pencil, a live header preview, 5 banner presets, 5 logo types, "Continue to invite", and "Skip, use the auto look". |
| 04 | Invite | `29:3173` | B4 | Copy invite link (primary, solid blue), Share to WhatsApp (glass), Add manually (outline backup), expiry, Settings, a live roster, and a "Copied" toast. |
| 05 | Join via link (browser) | `29:3300` | C1 | Outing preview (header, organizer, member count, no expenses), a name field, Join, an OTP note (mock), and "Not you, or wrong outing?". |
| 06 | Outing page | `29:3409` | A2, E | LinkedIn-style header with tabs (Expenses / Settle / Members / Memories), a total summary with "2 to review", and an expense list with payer and source. |
| 07 | Add evidence | `33:3469` | E1 | Camera / Gallery / Screenshot / Manual. The source list shows type, payer and a "Who paid? · Needs you" flag. Glass footer: "Next: tell the story". |
| 08 | Narrate | `33:3647` | E3 | Voice/Text toggle, an EN · URDU · BOTH pill, a recorder (waveform, timer, stop), and an editable transcript (MOCK) with low-confidence words underlined. |
| 09 | Processing | `33:3772` | E4 | Four named stages (upload, extract, interpret, validate) with Done / Active / Pending / Attention states, an "unreadable line" notice, a "separate calculator" trust statement, a MOCK label, and Cancel. |
| 10a | What Wusool understood (Original selected) | `35:3608` | E5, F1, F2 | Provenance pills (FROM RECEIPT / FROM YOUR STORY / UNSURE / CONFIRMED BY YOU / MANUAL), up to 2 quick questions, expense cards with Fix, "Say or type a fix…", then two numbered decisions: allocation (with the Equal-split consequence line) and routing. |
| 10b | Same, Optimized selected | `35:3932` | F2 | Routing expands to "9 → 5 transfers" with before/after mini graphs, the transfer list, and "Net amounts unchanged for everyone". |
| 11 | Optimized debt graph (sheet) | `38:3931` | F2 | Modal sheet with an Original/Optimized toggle, a node-link graph, proposed transfers, a net table (original vs optimized, total 0), an explanation, and a collapsed "Routing rules (optional)". |
| 12 | Confirm & publish | `38:4385` | F3 | Restates both decisions (each with Change), lists who pays whom, a "Checked" panel (totals, zero-sum, questions, rounding), a disclosure of who receives what, "Publish to 6 members", and "Not yet". |

### 1.2 Design tokens (Figma local styles; the file has **no Figma variables**)

- **Colour (16 paint styles):** Paper `#FFFFFF`, Paper Warm `#F6F6F3`, Ink `#111114`, Ink Secondary `#5A5A66`, Line `#E3E3E8`, Line Strong `#85858F`, Blue `#1F3BFF`, Blue Tint `#EEF1FF`, Pink `#FF2E93`, Pink Text `#C8006A`, Pink Tint `#FFE8F3`, Lime `#C6F432`, Lime Tint `#F3FCD6`, Lilac `#C9B8FF`, Chrome (iridescent gradient, decorative only), and Glass fill (white at 58%). The style tile documents usage rules and WCAG ratios, e.g. "Lime: never text on white" and "Pink only for large text or UI; use Pink Text for body".
- **Type (23 text styles, 7 Google Fonts families):**
  - Newsreader for Display and Headline styles
  - Gelasio for Body
  - Libre Franklin for UI and Amount styles (tabular figures)
  - Bagel Fat One for stickers
  - Caveat for handwritten accents
  - Instrument Serif for elegant accents
  - Libre Baskerville for print accents
- **Effects:** Glass/Float (GLASS effect plus a 24-px drop shadow), Glass/Reduced transparency, Shadow/Card, and Gloss/Primary.
- **Radius:** 8 · 16 · 24 · pill. **Spacing:** a 4-pt grid (4 · 8 · 12 · 16 · 24 · 32 · 48).
- **Rules from the style tile, which the implementation must follow:**
  - *Clarity rule:* money surfaces stay calm, white and aligned, and stickers, tape and 3D never overlap an amount or a form field.
  - Glass is only for floating controls, and text on glass over a photo gets at least an 85% white backing.
  - One solid-blue primary action per screen.
  - Touch targets are at least 44 × 44 pt.
  - Status is never shown by colour alone.
  - Accessibility fallbacks for Reduce Transparency, Reduce Motion and Increase Contrast.

### 1.3 Component library (Screens › "Library · Components")

| Component set | Variants / properties |
|---|---|
| Button | Style: Primary / Glass / Outline / Text / Maaf. Size: L / M. Label, optional icon (instance swap). |
| Chip | Default / Selected |
| Status chip | Requested / Marked Wusooled / Confirmed received / Partial / Disputed / Maaf. Each has a distinct icon and shape. |
| Avatar | Initials. Colour: Blue / Pink / Lime / Ink / Lilac. |
| Sticker | Label. Colour: Lime / Pink / Blue / Chrome. |
| Torn paper | Lime / Pink / Blue / Kraft |
| Status bar | Dark / Light (device chrome, mock only) |
| Tab bar | Active: Home / Balances / Inbox / Profile |
| Outing tabs | Active: Expenses / Settle / Members / Memories |
| Icon button | Icon swap. Surface: Glass / Solid. |
| Text field | Label, Value, Helper. State: Default / Focused. |
| Logo | Chai 3D / Star 3D / Initial / Sticker / Upload |
| Option card | Title, Description, Tag. State: Default / Selected. Used by the allocation and routing pickers. |
| Progress step | Done / Active / Pending / Attention |
| Single components | 32 icons (home, wallet, bell, user, plus, copy, share, link, pencil, back, chevron, more, check, checks, clock, hourglass, alert, heart, partial, camera, close, lock, receipt, phone, mic, image, users, sparkle, calendar, pin, upload, shield), Tape, 7 doodles, Home indicator, Top bar, Outing header, Outing card |

Also present as screen-level (non-library) patterns, which should become code components:
- Link card, Roster, Privacy note, Summary (calm money surface), Expense list
- Sources / Evidence list, Floating footer (glass), Recorder, Editable transcript
- Stepper, Heads-up, Clarifying-question card, Provenance pill
- Mini debt graph, Debt graph, Net table, Sheet, Toast, Browser context chip, Safari bottom bar (mock chrome)

### 1.4 Interactions

- **The file has no Figma prototype connections.** All navigation comes from the User Flows page, and the arrow labels are the user actions.
- Interaction details stated in the designs:
  - The Copy toast reads "Copied. Paste it in your group."
  - The roster on the Invite screen updates live.
  - Recording, then an editable transcript, then Interpret.
  - Progressive disclosure of the Optimized section.
  - The sheet has a grabber and a dimmed backdrop.
  - Change links on Confirm & publish.
  - A glass sticky footer on long screens.
- Motion is described only in prose (parallax, sticker wobble, confetti), all switched off under Reduce Motion.

### 1.5 Verified sample ledger ("Do Darya Night", PKR 12,060)

The numbers used across screens 06 and 10–12 are internally consistent. I checked them arithmetically.

- **Consumption per person:** Ayesha 2,205 · Hamza 2,070 · Mariam 1,845 · Talha 2,035 · Sara 1,955 · Bilal 1,950. Total 12,060.
- **Implied Kolachi dinner shares:** 1,780 / 1,690 / 1,520 / 1,610 / 1,250 / 1,570. These sum to 9,420.
- **Nets:** Ayesha +7,215, with the other five summing to −7,215.
- **Equal-split deltas** (equal share 2,010) match the screen: Mariam +165 · Bilal +60 · Sara +55 · Ayesha −195 · Hamza −60 · Talha −25.
- **Original debts:** one debtor → payer edge per expense, then reciprocal pairs netted, gives exactly **9 transfers**. That includes Sara → Hamza 380, which screen 11 mentions. The optimized plan has **5 transfers** (everyone → Ayesha).

This fixes the engine's definition of "original debts": **pairwise-netted direct obligations to each expense's payer.** It becomes the first golden test.

The 14 Kolachi line items, the GST rate and the service charge are **not** in Figma. The sample receipt must be authored so its pro-rata tax allocation reproduces the dinner shares above, using sample rates only and labelled as such.

---

## 2. Gaps, conflicts and open questions (not resolved silently)

1. **Most flow screens are undesigned.** Only 12 of about 107 flow screen nodes have high-fidelity designs. See §3 for the list.
2. **Tab bar destinations with no screen:** Balances, Inbox and Profile. Settings (WhatsApp toggle, threshold, privacy) is reached from flows as "Settings › …", but no Profile → Settings path is designed.
3. **Settle, Members and Memories tabs** on the Outing page have no designs. Only Expenses is shown.
4. **"Marked Wusooled" terminology.** The design uses "Wusooled" for the *debtor's* "I paid" claim, while CLAUDE.md defines **Wusool** as the *creditor's* collect/request action and calls the debtor state "payer marked paid". The two meanings may confuse users. This is an HCI team decision, so I will build exactly what Figma says unless you choose otherwise.
5. **Copy link on the create screen.** CLAUDE.md §5.1 says to show Copy invite link *immediately* on creating an outing. Figma puts it one tap later ("Continue to invite" → screen 04), with zero typing required. I will keep the Figma flow and flag it as a possible deviation for your write-up.
6. **Review screen merges E5 + F1 + F2.** The flows treat them as separate steps, but screen 10 puts both pickers below the review. I will follow the screen. The flow-only screens (Equal warning, constraints editor) become inline states or the sheet.
7. **Sample numbers in flows differ from screens** (F2 says "7 → 3 transfers", the screens say "9 → 5"). This is illustrative only, and I will use the screen ledger.
8. **Desktop/tablet layout is not designed.** Everything is 390-wide mobile. Proposal: a centred mobile column (max width about 480 px) on larger viewports, with no invented desktop layouts until designed.
9. **Liquid glass.** Figma's GLASS effect (refraction, depth) cannot be reproduced exactly on the web. I will approximate it with `backdrop-filter: blur() saturate()`, the 58% white fill, a 1-pt rim and the shadow, and implement the documented Reduce Transparency fallback via `prefers-reduced-transparency` plus a manual setting.
10. **Seven font families** is heavy for mobile. I will keep them all (design is the source of truth), subset and self-host via `next/font`, and load accent faces only where used.
11. **3D objects, collage banners and photos** are AI-generated samples in Figma. They will be exported as static assets and labelled as sample.
12. **Small-debt threshold** has a sample default of PKR 100 and a range of 0–5,000 (J1). Confirm the default.

---

## 3. Missing screens to design (or derive from the component library)

Grouped by flow. Bold items are needed for the CLAUDE.md §14 MVP.

| Area | Screens / states with no hi-fi design |
|---|---|
| A1 First launch | **Welcome**, **Name + phone**, **Verify code (OTP, MOCK)**, Profile setup (optional), **Notifications intro (WhatsApp OFF)**, Home empty state |
| A2 Home | **Home empty state**, card ⋯ menu (Rename · Archive · Leave) |
| B2/B3 | Inline rename states, upload/crop banner, logo picker detail, legibility scrim |
| B4/B5 | **Add participant manually** (with duplicate prompt), **Link settings** (expiry · approval · revoke), pending requests, revoke confirm dialog |
| C1/C2/C3 | Revoked/expired link, duplicate name, already joined, waiting for approval, declined, joined (browser), claim-a-guest prompt, personal breakdown link + verify |
| D1/D2 | **Members tab** (list, correct name, merge preview, remove confirm), leave outing (blocked / confirm) |
| E1/E2 | Receipt privacy note (first upload), label source / who paid picker, blurry or duplicate states, **Manual expense form** (what · amount · payers · sharers · split details) |
| E3/E4/E5 | Mic denied, text-mode narrate, upload/extract failure states, manual item edit sheet, re-validate diff, mismatch state |
| E6 | Cash handoff, shown as two steps plus "Did Mariam return PKR 400?" |
| E7 | Propose edit, impact preview, re-confirm old vs new |
| F1/F2/F3 | Equal-split warning state, routing constraints editor, publish-blocked state, final confirm dialog |
| F4 | **My breakdown**, **Why do I owe this?** (items, tax pro-rata, payer, receipt crop) |
| G1/G2 | **Balances tab**, **Mark Wusooled** (full / partial + note), **creditor confirm received**, **Quick-choice Wusool / Maaf card**, **Maaf confirmation**, stale-balance message, **audit history** |
| G3–G6 | Dispute reason picker + shared thread, reminder tone/preview/disclosure, wrong-recipient correction, all-settled celebration, archive warning |
| H1–H5 | **Settings › Notifications** (WhatsApp toggle OFF, consent sheet, per-type choices), **message preview / manual share sheet**, **Inbox** |
| I1–I4 | Memories empty state, masonry grid, add photos, viewer, removal flows, set as banner |
| J1/J2 | **Small-debt threshold**, privacy (receipt visibility, hide my items), delete account |

**Recommendation:** have the design team produce the bold MVP screens in Figma before Phase 2 starts. Alternatively, with your approval, I can compose them from the existing library components, mark them "derived, pending design review", and push them back to Figma for sign-off.

---

## 4. Navigation map (derived from the flows)

```
Launch ─┬─ invite link? ──► C1 Join (browser) ──► Outing page
        └─ A1 Welcome → Name+phone → OTP(mock) → Profile → Notifications intro → Home

Home (tab) ── Add Outing ─► Create (03) ─► Invite (04) ─► Outing page (06)
   │           └─ Paste invite link ─► C1
   ├─ outing card ─► Outing page ── tabs: Expenses | Settle | Members | Memories
   ├─ card ⋯ ─► Rename · Archive · Leave
   └─ bell ─► Inbox
Tab bar: Home | Balances | Inbox | Profile(→ Settings: Notifications, Threshold, Privacy)

Expenses: Add evidence (07) ─► Narrate (08) ─► Processing (09) ─► Review (10a/10b)
          └─ Manual expense (E2)                    Review ─► Debt graph sheet (11)
                                                     Review ─► Confirm & publish (12) ─► Balances
Settle:   My breakdown ─► Why do I owe this? ─► Mark Wusooled / Dispute
          Creditor: Confirm received · Remind · Wusool/Maaf quick card · history
```

---

## 5. Recommended stack (mobile-first responsive web app)

| Concern | Choice | Why |
|---|---|---|
| App framework | **Next.js (App Router) + TypeScript** | One codebase for the app and the no-install join/breakdown pages, server actions and route handlers for the API, good mobile performance, and easy Vercel deploys for usability sessions. |
| Styling | **Tailwind CSS with design tokens as CSS custom properties** generated from the Figma styles | Fast to match Figma exactly, keeps tokens in one place, and supports the reduced-transparency, motion and contrast variants. |
| UI primitives | **Radix UI** (dialog, sheet, toggle, toast) styled to the Figma components | Accessible behaviour (focus, ARIA) without imposing a visual style. |
| Fonts | `next/font/google`, self-hosted and subset | All 7 families are on Google Fonts. |
| Database / auth / storage / realtime | **Supabase (Postgres, Row-Level Security, Storage, Realtime)** | RLS enforces "members only" for receipts and private items; Realtime gives the live roster and approval updates; Storage handles receipts and photos. Phone OTP is **mocked** in the prototype as the designs specify, and real SMS can be switched on later. |
| ORM / validation | **Drizzle ORM + Zod** | Typed schema and migrations; Zod validates every LLM or OCR output before it touches the ledger. |
| Money & ledger engine | **A pure TypeScript package (`packages/ledger`)** using integer paisa (`bigint`), with no floats and no I/O | Deterministic, auditable and unit-testable (CLAUDE.md §6, §13). |
| Settlement | Pairwise-netted original debts + greedy debtor–creditor matching with constraints | This matches the verified Figma sample. Do not claim it is minimal in every case. |
| AI (interpretation, OCR) | Behind an `Interpreter` / `Extractor` interface: **MockProvider by default** (labelled MOCK); later a Claude model with vision and structured tool output | The designs label OCR and interpretation as MOCK. The LLM proposes facts with provenance and confidence, and the ledger engine calculates. |
| Speech | `MediaRecorder` capture now with a **mock transcript** (labelled); a server STT provider later | Browser speech APIs are unreliable on iOS Safari, and text is always available as a fallback. |
| WhatsApp | `wa.me` / Web Share API prefilled text + in-app preview, always labelled "Preview: not sent automatically" | An honest fallback (H3). The WhatsApp Business Platform is FUTURE (H4). |
| Testing | **Vitest** (ledger, property tests via fast-check), **Playwright** (mobile viewport e2e), **axe** accessibility checks | The invariants and HCI accessibility claims become testable. |
| Study instrumentation | A lightweight event log (screen timings, taps, corrections) stored per session, opt-in | Needed for the RQ3 measures (§12). |

Alternative if the team prefers fewer services: Next.js + Prisma + plain Postgres (e.g. Neon) + S3-compatible storage + polling instead of Realtime. That is more code to write for auth, RLS and realtime.

---

## 6. Backend requirements

### 6.1 Data model (append-only where money is involved)

- **User**: id, display name, avatar, phone hash (never shown to others), smallDebtThreshold (paisa, default 10,000 paisa = PKR 100, range 0–5,000 PKR), privacy prefs.
- **NotificationPreference**: userId, whatsappEnabled (**default false**), per type (breakdown, request, reminder, wusoolMaafUpdate), whatsappVerifiedAt. **ConsentRecord**: who consented, when, and what text they saw.
- **Outing**: name (auto "Outing NNN"), banner, logo, date, place, organizerId, status (active / archived), rename history.
- **Membership**: outingId, userId or a manual guest, kind (joined / manualGuest), addedBy, status (pending / active / left / removed), claimedFromGuestId.
- **InviteLink**: token, expiresAt (24 h / 7 days / until settled), requireApproval, revokedAt, regeneratedFrom. **JoinRequest**: pending / approved / declined.
- **Evidence**: type (restaurant receipt / ride screenshot / other), storagePath, uploaderId, declaredPayerId, quality flags, visibility (all members, or payer + organizer). Never shared with Memories.
- **Narrative**: transcript versions (raw → user-edited), language, mode (voice / text).
- **Interpretation**: proposed facts, each with `source` (receipt / story / manual / confirmedByUser), `confidence` or `unknown`, and an evidence reference. **ClarifyingQuestion**: at most 3 per run, with answer chips and answered / skipped state. Skipped questions block publishing.
- **Expense**: outingId, title, source, evidenceId, currency (PKR), payers[] (amounts), lineItems[] (qty, unit price, participants + weights), charges[] (tax / service / discount / fee, as printed, with an allocation rule), total.
- **Handoff** (E6): from → intermediary → to, amount given, amount forwarded, change returned (yes / no / unsure).
- **SettlementPlan** (versioned): allocationMode (actual / equal), routingMode (original / optimized), constraints, computed shares, transfers, invariant results, publishedAt, publishedBy.
- **Balance**: debtor, creditor, amount, planVersion, status (requested / markedWusooled / confirmedReceived / partial / disputed / maaf).
- **BalanceEvent** (append-only audit): type, actor, amount, note, idempotencyKey, createdAt.
- **Adjustment / EditProposal** (E7): original kept, difference entries, approval.
- **Dispute + DisputeMessage**, **Reminder** (rate limit 48 h, tone, channel disclosure), **Notification** (in-app inbox, always), **OutboundMessage** (WhatsApp preview / fallback status).
- **Photo**, **PhotoReaction**, **RemovalRequest** (Memories), and a general **AuditLog**.

### 6.2 Services / endpoints

- Outings: create (auto-name), rename (organizer only, ≤ 40 characters, audit), banner/logo, archive (with an open-balance warning).
- Invites: create, copy, revoke and regenerate links; preview by token (public, no expenses); join (name + mock OTP, duplicate-name and already-member checks); approve or decline; claim a guest.
- Members: correct a name, merge (with preview), remove (blocked while items or balances exist), leave (blocked while balances are open).
- Evidence upload (signed URLs, per-file progress and retry), quality check (mock), extraction (mock → real).
- Narrative save and interpret (mock → LLM), returning schema-validated proposals and questions.
- Ledger compute (pure function, run on the server and mirrored on the client for previews), re-validate with a diff.
- Settlement preview (allocation × routing), publish (blocked unless totals reconcile, nets equal 0 and no flags are unconfirmed).
- Balance actions: mark Wusooled (full / partial), confirm received, dispute, remind, **Wusool / Maaf**. All are validated server-side against the live ledger, use idempotency keys, and return a "stale balance" error when the balance has changed.
- Notification dispatcher implementing the H2 rules: always in-app; WhatsApp only if the recipient opted in, the type is allowed and an official API exists. Otherwise it creates a preview / manual-share record.
- Privacy: per-member breakdown endpoint returning only that member's items (and others' items only if they allowed it); receipt-visibility checks; account deletion anonymises ledger entries and never deletes them.

### 6.3 Ledger invariants (enforced by tests)

- Allocated total equals the expense total, to the paisa, with largest-remainder rounding that is documented and shown ("within PKR 1 per person").
- The sum of nets equals 0.
- Optimized routing preserves every net exactly.
- A handoff is never treated as a direct payment, and unreturned change becomes an explicit balance.
- No silent edits: changes after publishing create adjustment entries.

---

## 7. Phased implementation plan

Each phase ends with something demonstrable and tested.

### Phase 0 — Foundations (no screens yet)

1. Repo scaffold: Next.js + TypeScript, Tailwind, lint/format, Vitest, Playwright, CI.
2. **Design tokens:** colours, type ramp, radius, spacing, shadows and glass from the Figma styles into CSS variables and the Tailwind theme, plus the reduced-transparency, motion and contrast variants.
3. **Component library** matching the 14 Figma component sets and 32 icons, with a Storybook-style gallery page for visual comparison against Figma.
4. **`packages/ledger`:**
   - integer-paisa money type
   - allocation (actual / itemised with pro-rata charges; equal; exact; %; weights)
   - pairwise-netted original debts
   - greedy optimized routing with constraints
   - handoffs
   - invariant checks and explanation data
5. **Golden test:** the "Do Darya Night" ledger must reproduce every number on screens 06, 10a, 10b, 11 and 12. Also tests for tax rounding, multiple payers, duplicate receipts, intermediary change, partial payments, waivers and disconnected groups.
6. A Supabase project, schema, RLS policies and a seed script with the labelled sample outing.

### Phase 1 — The designed happy path (screens 02–12)

Build pixel-faithful to Figma at 390 px, then make it responsive (centred column):
- Home
- Create outing
- Invite, with a live roster via Realtime
- Join via link (browser, mock OTP)
- Outing page (Expenses tab)
- Add evidence (real uploads, mock extraction)
- Narrate (record + text, mock transcript, editable)
- Processing (staged, with failure states)
- Review with provenance pills, questions, Fix and conversational fix (MOCK)
- Allocation and routing pickers
- Debt graph sheet
- Confirm & publish

The **Exit** check is an end-to-end Playwright run of the full outing using sample data, with every MOCK clearly labelled on screen.

### Phase 2 — Post-publish MVP (needs the missing designs from §3 first)

- A1 onboarding
- My breakdown + "Why do I owe this?"
- Balances tab and Settle tab
- Balance lifecycle chips and actions
- Small-debt threshold + **Wusool / Maaf** quick card with Maaf confirmation, stale-ledger handling and audit history
- Settings › Notifications (WhatsApp **OFF** by default, consent sheet, per-type choices)
- In-app Inbox
- WhatsApp message preview / manual share (H3)
- Manual add participant (B4 backup)

This completes CLAUDE.md §14 MVP.

### Phase 3 — Robustness & edge cases

- Manual expense form (E2)
- Link controls (B5)
- Claim guest (C2)
- Members management (D1) and leave (D2)
- Cash handoff (E6)
- Edit after publishing (E7)
- Disputes (G3), reminders (G4), wrong recipient (G5)
- All settled and archive (G6)
- Privacy settings and account deletion (J2)
- Rename and banner from all entry points (B2, B3)

### Phase 4 — Memories (I1–I4)

Photo upload, grid, viewer, reactions, removal requests and set-as-banner, all kept separate from evidence.

### Phase 5 — Real intelligence + study readiness

- Swap the mock providers for real OCR/vision, STT and LLM narrative parsing behind the same interfaces, with Zod validation and confidence carried through. Labels change from MOCK only where something is actually real.
- Usability-study instrumentation (time on task, taps, corrections, errors) and a comparable manual-workflow baseline task set (§12).

### Phase 6 — FUTURE / integration milestone

WhatsApp Business Platform templates, interactive Wusool/Maaf buttons with webhooks and idempotency (H4), personal breakdown links for non-members (C3), install prompt / PWA, duplicate-receipt detection, and real SMS OTP.

---

## 8. Decisions needed from you

1. Design the §3 MVP screens in Figma, or let me derive them from the library for your review?
2. Keep "Marked Wusooled" as the debtor's paid-claim label, or rename it (see §2.4)?
3. Is the centred mobile column acceptable on desktop for now?
4. For the usability study, should interpretation stay MOCK (scripted scenarios) or be a live LLM?
5. Stack: Supabase-based (recommended) or plain Postgres + Prisma?
