# Wusool — Project Context and Instructions for Claude

## 1. Project identity

Project name: **Wusool** (use this spelling consistently; never rename it Musool).
Project type: Human-Computer Interaction (HCI) university project, with a potential working software prototype.
Primary audience: University students in Pakistan, initially students at IBA Karachi, who regularly split expenses during social outings.

Wusool is a conversational, multimodal group-expense reconstruction and settlement system. Its core promise is: **Tell Wusool what happened, instead of manually teaching a bill-splitting app how to represent it.**

This is NOT merely a calculator, a Splitwise clone, or a receipt OCR demo. Design decisions must be defensible using HCI principles and measurable through usability testing.

## 2. Problem and motivation

Student outings involve overlapping but nonidentical groups: some friends share a ride, some arrive separately, some share dishes, others order alone, different people pay different bills, and receipts contain GST, service fees, discounts, or other charges. The group currently reconstructs these events from memory, word of mouth, calculator calculations, Notes, banking apps, and fragmented WhatsApp chats. Complex reciprocal debts lead to avoidable transactions. Asking friends to pay can be socially uncomfortable.

Current commercial apps, including Splitwise, can split expenses and simplify debts. However, they generally still require substantial manual specification of payers, participants, items, and split rules. Wusool's proposed differentiator is **reconstructing a whole multi-expense outing from several receipts/screenshots plus a short natural-language voice or text account**, then verifying the reconstruction and offering optional settlement optimization. Outings are link-first. WhatsApp settlement notifications are optional, explicitly opt-in, and OFF by default; sharing an outing invite link is separate from enabling notifications.

Do not claim that OCR, uneven splitting, debt graphs, or debt simplification are individually novel. They are established capabilities. The proposed contribution is the end-to-end interaction design, with an emphasis on low effort, explainability, correction, and socially comfortable settlement.

## 3. Initial field investigation: baseline evidence

Preliminary student responses (informal, limited sample; do not fabricate sample size or percentages beyond what was actually reported):

- Group expense splitting happens about once or twice weekly, often on every group outing.
- If everyone spends similar amounts, students often split equally; otherwise one group member manually calculates individual shares and explains them on WhatsApp.
- Current tools: calculators, Notes, WhatsApp, memory, and banking applications.
- Tracking who paid what is often handled through memory and word of mouth.
- Major difficulties: calculations; multiple expense types beyond food; identifying payers; GST, taxes, and platform fees.
- Shared dishes are often split in stages: calculate the main group bill, then perform additional pairwise or subgroup calculations.
- Extra fees and taxes are currently handled inconsistently ('winging it').
- Multiple payers create complicated calculations and messy group/personal chats.
- Participants reported instances where debts could have been offset rather than requiring extra payments.
- Nearly all respondents reported extreme discomfort reminding friends to repay (mostly 0/10); one reported 2/10 if the amount is large and one outlier reported 10/10. Treat '99%' as an informal characterization, not a verified statistical estimate.
- Respondents reported that friendship closeness did not materially change this discomfort.

Concrete anecdote: At a birthday gathering in the third semester, each participant owed Ayesha PKR 1,100. Talha lacked online payment or exact change, gave Mariam PKR 1,500, and asked her to pay on their behalf. Mariam sent the combined payment but forgot to return the PKR 400 difference. The anecdote demonstrates that payment intermediaries and change can create secondary debts even after the primary group bill is paid. Students also reported wrong-account transfers and awkward recovery attempts.

These findings are preliminary qualitative evidence, not a representative survey. Future research should record sample size, interview method, participant characteristics, and exact response distributions.

## 4. Target users

Primary: Students approximately 18–25 years old, familiar with smartphones, WhatsApp, ride-hailing, and mobile banking, but not necessarily experienced with specialized expense-splitting software.

Goals: accurately and fairly settle an entire outing with minimal effort; know who paid, who consumed, and who owes whom; avoid repeated awkward reminders; verify charges before paying.

Abilities and accessibility: do not assume perfect English, Urdu, speech recognition, vision, or hearing. Support voice AND text, readable receipt correction, clear controls, and mixed-language names and phrases where feasible.

Secondary: Friends who do not have Wusool installed and receive a shareable breakdown or WhatsApp settlement message.

## 5. Primary user journey (canonical; link-first)

1. Create an outing (name optional). Immediately show a prominent **Copy invite link** action, with **Share to WhatsApp** alongside it. This is the PRIMARY onboarding path. The host pastes the link into their existing WhatsApp group; friends tap to join the outing themselves. Do NOT make the host manually add every participant. Provide **Add participant manually** as a secondary backup for guests, people without access, or exceptions.
2. Invitees open the link on mobile, see the outing name and organizer, and join with minimal friction. Support a lightweight browser join without requiring installation when feasible. Identify people reliably to prevent duplicate names, accidental joins, or impersonation; support organizer controls to remove or correct entries, expire/revoke links, and protect private expense information.
3. Upload one or more restaurant receipts, ride screenshots, or other evidence; allow manual expenses.
4. Speak or type a short narrative of the entire outing. Interpret receipt items, payer(s), participants, shared dishes, taxes, fees, rides, and intermediary payments.
5. Show an editable **What Wusool understood** review with clear uncertainties and conversational/manual corrections.
6. Calculate accurate individual shares. **Offer settlement mode selection** rather than automatically imposing debt optimization: (a) **Equal split** of eligible expenses, with a visible warning if that overrides unequal consumption; (b) **Actual/individual split** based on items, participants, and original payer relationships; (c) **Optimized settlement**, netting balances and proposing fewer practical transfers while preserving each person's net position. Equal splitting is an expense-allocation policy; optimization is a payment-routing policy, so the UI must explain these as distinct decisions even if shown in one friendly wizard. Do not change a user's economic share merely by optimizing transfers.
7. Preview the original debt graph and, only if selected, the optimized settlement graph. Explain who pays whom, how much, and why. Confirm before publishing.
8. Each member can view their own breakdown in-app or via a secure web link. WhatsApp is an **optional communication channel, OFF by default**. Members always receive their breakdown in-app; send individualized WhatsApp breakdowns, requests, reminders, or status changes only after the relevant recipient explicitly enables WhatsApp notifications and the integration permits it.
9. For eligible outstanding balances below a **user-configurable small-debt threshold** (PKR), show **Wusool** (collect/request) and **Maaf** (forgive) actions. Make these actions available in the app and, when supported, as interactive WhatsApp reply buttons. The person owed the money makes this choice; notify the debtor in-app; use WhatsApp only if the debtor has explicitly opted in to WhatsApp notifications. Amounts above the threshold remain collectible normally; the threshold determines when the quick forgive/collect choice is emphasized, not whether larger debts exist.
10. Track pending/requested, marked paid, confirmed received, partial, disputed, and forgiven balances. Never treat a WhatsApp button press as proof of money transfer. Confirm waivers, avoid double processing, and keep an auditable history.

## 6. Essential functionality

### Link-first outing membership (P0)
- The main create-outing screen must foreground **Copy link** and **Share to WhatsApp**. Copy link is not buried behind manual participant management.
- Link is outing-specific, mobile-friendly, and joinable with minimal steps; joining should update the participant roster without the host manually adding people.
- Provide manual add as a visible but SECONDARY fallback.
- Support invite permissions, organizer approval or safeguards where appropriate, duplicate prevention, link expiration/revocation, and privacy-conscious access to expense details.
- A WhatsApp group invite link to Wusool does not automatically grant access to the WhatsApp group or expose its membership; users must tap and join Wusool individually. Do not assume WhatsApp group membership can be read.

### Multimodal ingestion
- Multiple receipts and screenshots per outing, with clear source attribution.
- Speech-to-text plus typed narration; user can edit transcription before parsing.
- OCR and extraction of item prices, quantities, tax, service fees, discounts, and totals.
- Natural-language interpretation of shared items, individual items, multiple payers, ride participants, cash advances, and intermediary payments.
- No-receipt/manual fallback and graceful handling of illegible or incomplete inputs.

### Calculation engine
- Represent each expense separately, with payer(s), participants, weights/shares, currency, tax/fee rules, and supporting evidence.
- Default item-level tax allocation proportional to applicable taxable spending when supported by the receipt and applicable tax structure. Do not invent tax rates or assume all charges are taxed identically.
- Support equal split, exact amount, percentages, weighted shares, and item-specific participants.
- Preserve accounting invariants: total allocated cost equals actual expense total (subject to documented rounding), and net balances sum to zero.
- Use deterministic decimal or integer minor-unit arithmetic, not floating-point currency math.
- Distinguish original consumption obligations from subsequent transfers, reimbursements, partial payments, and waived debts.

### Settlement mode selection (required; optimization is opt-in)
- Show clear, user-controlled choices for **Equal split**, **Actual/individual split**, and **Optimized settlement**. Make actual/individual split the safe starting point for mixed meals/rides, subject to confirmation; do not preselect optimization.
- Keep expense allocation separate from settlement routing in the data model: equal vs itemized decides each person's cost; original vs optimized debts decides who transfers to whom.
- Explain how choosing equal allocation can change what each person owes, whereas choosing optimized routing cannot change anyone's net obligation.
- Preview before/after transfers and allow returning to original debts. Never silently reroute payments through someone else.

### Debt graph and settlement optimization
- Model people as vertices and obligations as directed weighted edges.
- Net each person's total paid versus total owed, cancelling reciprocal/interconnected balances.
- Produce a small, practical set of transfers that preserves net balances; do not promise a mathematically minimum number in all cases unless an exact optimization algorithm and constraints are implemented and verified. A simple greedy debtor-creditor matching approach can be a first version.
- Practical constraints may include: avoiding transfers to unfamiliar participants, honoring a chosen collector, excluding a payer without a payment account, minimum transfer amounts, and preserving certain direct-payment relationships.
- Provide both an original-debts view and a simplified settlement view, plus an explanation of why the suggested transfers are equivalent financially.

### Optional WhatsApp communication and interactive decisions (OFF by default)
- Provide a clearly labeled **WhatsApp notifications** toggle in notification settings, initially **OFF** for every user. Users must deliberately turn it ON; never infer consent from joining an outing, copying/sharing a join link, or entering a phone number.
- Keep **Copy invite link / Share to WhatsApp** available regardless of notification preferences: manually sharing an invite is NOT the same as enabling automated WhatsApp notifications.
- Allow users to turn notifications OFF at any time, with changes taking effect for future sends. Respect recipient-level preferences, and provide separate controls for breakdowns, payment requests, reminders, and Wusool/Maaf updates if feasible. Never auto-enable notifications for an entire group.
- After confirmation, each opted-in participant may receive (where integration and consent allow) an individualized WhatsApp message with outing, amount, payer/payee, readable breakdown, and secure view link. Also offer an in-app breakdown.
- Send respectful reminders only on user request or agreed schedule; allow opt-out, avoid spam, and disclose who will be messaged.
- For a creditor's outstanding amount **below their configurable threshold**, WhatsApp should be able to present: **“Ali owes you PKR 80. Wusool or Maaf?”** with interactive **Wusool** and **Maaf** buttons where supported.
- A Wusool button records a request-to-collect and sends Ali an in-app payment request and, only if Ali opted in, a WhatsApp notification. A Maaf button requests confirmation, records forgiveness, and sends Ali an in-app notice plus an optional WhatsApp notice only if he opted in. Both actions update the app ledger and message status idempotently.
- WhatsApp interactive buttons and proactive messaging require an official, authorized WhatsApp Business Platform integration, approved templates when applicable, opt-in and policy compliance. Personal WhatsApp share links can prefill text but **cannot themselves implement interactive buttons, automated sends, or callbacks**. If credentials/API approval are absent, implement a clearly labeled in-app interaction plus WhatsApp message preview/share fallback; never pretend buttons work in WhatsApp.
- Handle late button presses, stale balances, double taps, edited expenses, and cases where the creditor has already been paid; validate the current ledger server-side before applying any action.

### Settlement and social UX
- Individualized amount and item/tax breakdown.
- WhatsApp-ready message with payer, payee, amount, purpose, and view-breakdown link; automated sending requires the recipient’s explicit opt-in (default OFF), applicable platform consent, and authorization. Manual copy/share remains available.
- Maaf: forgive a selected balance with confirmation and audit history; do not silently delete ledger entries.
- Wusool: explicitly request/collect an outstanding amount, with a friendly and non-coercive tone.
- Do not assume a message proves payment. Separate 'request sent', 'payer marked paid', and 'recipient confirmed received'.
- Handle mistaken recipients, corrections after sending, and disputes without silent retroactive changes.

## 7. Example scenario and expected behavior

Five friends take different rides, share some dishes, order some individual items, and have three different people paying different receipts. A user uploads all three proofs and narrates the trip once. Wusool extracts item-level splits and ride participants, identifies missing payer details, asks a small number of clarifying questions, and calculates the group ledger. It offers equal or itemized expense allocation and, separately, an optional optimized settlement route; it does not force optimization. Everyone can inspect exactly why they owe an amount and who will receive it. The payer can request settlement (Wusool) or forgive a small outstanding amount (Maaf).

A key edge case is the Talha/Mariam/Ayesha example: a cash handoff to an intermediary is NOT equivalent to a direct transfer to the original bill payer; the remaining change or reimbursement must be represented explicitly.

## 8. HCI research framing

### Research gap
Traditional expense-splitting tools can automate calculations and debt simplification but still place much of the burden of translating a real-world event into structured data on the user. The research gap is the design and evaluation of a receipt-plus-conversation interface that reconstructs complex outings with less manual interaction while remaining interpretable, correctable, and trusted.

### Research questions
RQ1 — Problem: What difficulties and social friction do university students experience tracking, calculating, and settling complex shared expenses involving multiple payers, shared items, taxes, and interconnected debts?

RQ2 — Design: How can receipt/screenshot scanning plus natural-language narration minimize manual entry while letting students verify and correct the system's interpretation?

RQ3 — Evaluation: Compared with a conventional manual expense-splitting workflow, does the conversational approach reduce completion time, interaction effort, and calculation errors while maintaining user comprehension, trust, and perceived control?

### Research objectives
- Understand baseline student expense-splitting behavior and social friction.
- Design and prototype the end-to-end multimodal interaction.
- Build a consistent expense ledger and debt graph with practical settlement reduction.
- Make all inferred allocations inspectable, editable, and explainable.
- Evaluate efficiency, accuracy, usability, comprehension, trust, and payment-request comfort.

## 9. HCI theories and principles to apply

1. **Cognitive load:** minimize working-memory demands and unnecessary form filling; avoid creating new cognitive overload through verbose AI output.
2. **External cognition:** maintain an explicit, persistent representation of participants, expenses, assumptions, balances, and evidence instead of relying on memory/WhatsApp threads.
3. **Recognition rather than recall:** show scanned items, candidate participants, and editable inferred relationships so users recognize/correct information rather than recreate it from scratch.
4. **Multimodal interaction:** use receipts for amounts/items and speech or text for social context. Permit modality switching and graceful fallback.
5. **Visibility of system status:** show upload, extraction, interpretation, validation, calculation, and settlement states. Clearly distinguish suggestions from confirmed facts.
6. **User control and error recovery:** support edit, undo, correction, confirmation, and recovery from mistaken shares or messages.
7. **Explainable automation and calibrated trust:** offer 'Why do I owe this?' drill-downs, tax allocation logic, original versus optimized graph, and explicit uncertainty. Never mask guessed facts as certain.
8. **Social computing:** reduce the embarrassment of requesting money, without shaming debtors or making unilateral decisions about forgiveness.
9. **Error prevention and consistency:** confirm high-impact actions, validate totals and participants, use consistent currency formatting, and make ambiguous payer references obvious.
10. **Privacy and consent:** avoid unnecessary exposure of personal purchases, bank account details, phone numbers, or entire group receipts. Limit what each recipient sees where possible.

## 10. Academic literature review — relevant papers

These are HCI research anchors, not claims that these papers studied Wusool or expense splitting. Verify publication metadata and consult the original papers before citing them formally.

### Sharon Oviatt (1999), 'Ten Myths of Multimodal Interaction'
Proceedings of CHI 1999. DOI: 10.1145/319382.319398.
Discusses misconceptions about combining speech and other input modalities, and why multimodal design must account for users, tasks, and error conditions. Relevant to combining receipts/screenshots with voice or typed descriptions. The design should not assume speech is always faster or preferable: multimodal input must be tested against real tasks and users.

### Brian Y. Lim, Anind K. Dey, and Daniel Avrahami (2009), 'Why and Why Not Explanations Improve the Intelligibility of Context-Aware Intelligent Systems'
Proceedings of CHI 2009. DOI: 10.1145/1518701.1519023.
Investigates how explanations help people understand inferences made by intelligent/context-aware systems. Wusool should explain its assignment of food, rides, fees, and taxes, and support 'Why this amount?' and potentially 'Why not a different split?' interactions. Use the paper as motivation for evaluating explanation usefulness, not as proof that every explanation always increases trust.

### Brian Y. Lim and Anind K. Dey (2010), 'Improving Trust in Context-Aware Applications with Intelligibility'
Examines relationships between intelligibility/explanations and trust in context-aware systems. Relevant to showing assumptions and evidence before a financial settlement is accepted. Design for appropriately calibrated trust rather than uncritical acceptance of AI output. Verify venue and bibliographic details before final report submission.

### Brian Y. Lim and Anind K. Dey (2011), 'Investigating Intelligibility for Uncertain Context-Aware Applications'
Studies intelligibility where inferred contextual information is uncertain. Relevant to unclear receipt text, noisy speech, ambiguous names, and uncertain group membership. Wusool should flag uncertainty and request clarification instead of silently deciding who owes money. Verify venue and bibliographic details before final report submission.

### Sharon Oviatt, Rachel Coulston, and Rebecca Lunsford (2004), 'When Do We Interact Multimodally? Cognitive Load and Multimodal Communication Patterns'
Proceedings of ICMI 2004 (verify full citation before submission).
Examines multimodal behavior in relation to cognitive load and task demands. Supports investigating whether a natural narration plus receipt workflow is less effortful than manually entering many structured expenses. It does not by itself establish that voice input is always superior.

### Related foundational HCI concepts to cite appropriately
- Nielsen's usability heuristics: visibility, user control, error prevention, recognition rather than recall.
- External cognition/distributed cognition: interfaces as external representations supporting reasoning.
- Cognitive load: minimize unnecessary mental work; distinguish this general principle from experimentally proven effects in Wusool.
- Human-AI interaction: transparency, appropriate reliance, feedback, and graceful recovery.

## 11. Commercial solution analysis

**Splitwise:** established group expense tracking, equal/unequal splits, receipt itemization in paid features, and debt simplification. Acknowledge these existing features. The difference Wusool seeks to test is narrating a multi-receipt outing once rather than manually mapping all items and participants through repeated forms.

**Tricount:** collaborative group expense recording, unequal splits, and balance settlement. Acknowledge that it already addresses shared-expense tracking. Compare actual interaction steps rather than claiming it lacks features without verification.

Potential comparison dimensions: number of entry steps; whether multi-receipt natural narration is supported; manual participant assignment; correction workflow; tax allocation; debt simplification; settlement communication; explanation and trust; accessibility; no-install recipient flow.

Avoid unsupported competitor claims. Check current versions before finalizing a comparison table.

## 12. Usability evaluation plan

Use realistic, equivalent student-outing scenarios with multiple receipts, mixed shared/individual items, rides, several payers, GST/fees, and at least one reciprocal debt. Compare Wusool against a conventional manual workflow (e.g., calculator/WhatsApp or a commercial splitter, depending on the study design). Counterbalance task order if possible and keep complexity comparable.

Measures:
- Time to complete a correct settlement.
- Number of taps, manual fields, and correction steps.
- Allocation mistakes, missing expenses, tax errors, and net-balance discrepancies.
- Number of final payments proposed and actual feasibility.
- User understanding of why an amount is owed.
- Subjective task effort, perceived usability (e.g., SUS if suitable), trust, and sense of control.
- Comfort with settlement requests and Maaf/Wusool choices.

Qualitative observation: watch users work, record hesitation, misunderstandings, unnecessary backtracking, and questions about amounts. Interview them afterward. Do not fabricate results or claim the prototype outperformed competitors without a study.

## 13. Engineering guidance and constraints

Architecture is open; do not assume a framework until the team chooses one. Prefer a modular design separating:
1. UI and interaction state.
2. Receipt/screenshot extraction.
3. Speech transcription and narrative parsing.
4. Validated, typed expense data model.
5. Deterministic calculation and tax allocation.
6. Debt graph / settlement planning.
7. Explanation and provenance generation.
8. Messaging/sharing and settlement tracking.

LLMs may interpret the narrative, but should NOT be the authoritative calculator. Use schema validation, deterministic arithmetic, explicit confidence/unknown fields, and tests. Keep receipt-derived evidence and narration-derived assumptions traceable. Include sample datasets and unit tests for unequal splits, tax rounding, multiple payers, duplicate receipts, intermediary payments, partial payments, waivers, and disconnected groups.

Security/privacy: consent before processing or sharing personal receipts; avoid exposing full receipts to everyone; minimize storage and redact sensitive data where appropriate. Do not represent a payment request as a completed transfer. For a course prototype, mocked WhatsApp messages and synthetic receipts are acceptable if clearly labeled; don't claim integrations work when they are only simulated.

## 14. Suggested implementation priorities

**MVP (must demonstrate):** create outing with prominent copy-invite-link and WhatsApp share; self-join via link; secondary manual participant entry; upload receipts; type or speak narrative; editable interpretation; accurate item-level split and fees; selectable equal/itemized allocation and opt-in debt optimization; original and optimized debt graph previews; configurable small-debt threshold; in-app Wusool/Maaf with history; per-person breakdown, a WhatsApp notifications toggle defaulting OFF, and optional WhatsApp message previews.

**Next:** conversational corrections, multiple receipts and ride screenshots, partial payment tracking, ambiguity prompts, no-install recipient page, robust invitation access controls, WhatsApp callback/webhook handling if authorized.

**Integration milestone (important product goal, dependent on approvals):** official WhatsApp Business interactive messages for Wusool/Maaf, individualized breakdowns, consent-based reminders, debtor notifications, and secure callbacks. **Later/optional:** multilingual speech improvements, payment-service integration, duplicate receipt detection, group history.

Prioritize a reliable end-to-end prototype over flashy AI that invents amounts or makes irreversible mistakes.

## 15. Instructions for Claude working on this repository

- Treat this document as the source of truth for product intent and research constraints, but adapt technical decisions to the actual repository.
- Spell the product **Wusool**. The two user actions are **Maaf** (forgive) and **Wusool** (collect/request payment).
- Keep the Pakistani university/student context and PKR examples; do not assume US-only payment rails or tax structures.
- Whenever proposing a feature, explain the user problem and relevant HCI principle.
- **Copy invite link is the primary way to populate outings; manual adding is backup only.**
- **Debt optimization is an explicit option, never the default.** Distinguish expense allocation from debt routing.
- **WhatsApp notifications are opt-in and OFF by default**, with interactive Wusool/Maaf as a target integration. Manual WhatsApp invite-link sharing remains prominent and independent of notification preferences. Do not claim unsupported capabilities.
- **Wusool = collect; Maaf = forgive.** Make small-debt threshold user-configurable and keep full audit trails.
- Preserve human verification before sending payment requests, waiving debts, or finalizing settlements.
- Never invent OCR output, AI confidence, completed transactions, research findings, or third-party integration capabilities.
- Clearly distinguish a tested capability from a prototype/mock and a future feature.
- Keep calculations auditable, with deterministic tests and explainable rounding.
- For research writing, distinguish preliminary student anecdotes from published literature and verified product capabilities.
- When asked to implement, first inspect the existing repository, propose a concise plan, and build incrementally with tests.

## 16. One-paragraph concept statement

University students frequently struggle to settle expenses after group outings because different friends pay for different rides, shared meals, individual items, taxes, and additional charges, creating a complicated network of debts. Wusool is a conversational, multimodal expense-splitting system in which users upload receipts and screenshots and briefly describe what happened through voice or text. The outing organizer primarily invites friends by copying a join link into a WhatsApp group; friends join themselves, with manual adding as backup. The system reconstructs expenses and participation, calculates shares, and offers equal or itemized allocation and optional debt-graph settlement optimization rather than forcing optimization. Users can inspect and correct breakdowns and optionally receive them through WhatsApp after explicitly enabling notifications (OFF by default). A configurable small-balance threshold highlights Wusool (collect) or Maaf (forgive), including interactive WhatsApp actions where officially supported, with optional, opt-in WhatsApp notifications and audit history. The HCI research evaluates whether this approach reduces interaction effort, errors, and social friction compared with conventional expense-splitting workflows while maintaining transparency, trust, and user control.
