// Types inferred from the server read-models (type-only imports are erased at build time).
import type { homeView, outingView, profileView, inboxView, whatsappSimView } from "@/server/views";
import type { computePreview, myBreakdown } from "@/server/settlement";
import type { balanceDetail, myBalances } from "@/server/balances";
import type { listPhotos } from "@/server/photos";
import type { invitePreview } from "@/server/outings";

export type HomeData = ReturnType<typeof homeView>;
export type OutingData = ReturnType<typeof outingView>;
export type MemberData = OutingData["members"][number];
export type ExpenseData = OutingData["expenses"][number];
export type QuestionData = OutingData["questions"][number];
export type EvidenceData = OutingData["evidence"][number];
export type PreviewData = ReturnType<typeof computePreview>;
export type BreakdownData = ReturnType<typeof myBreakdown>;
export type BalanceData = ReturnType<typeof myBalances>[number];
export type BalanceDetailData = ReturnType<typeof balanceDetail>;
export type ProfileData = ReturnType<typeof profileView> & { consentText: string };
export type InboxItem = ReturnType<typeof inboxView>[number];
export type WaMessage = ReturnType<typeof whatsappSimView>[number];
export type PhotoData = ReturnType<typeof listPhotos>[number];
export type InvitePreview = ReturnType<typeof invitePreview> & { viewer: { name: string; membership: string | null } | null };
