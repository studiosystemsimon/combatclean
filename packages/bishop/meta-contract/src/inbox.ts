// Inbox — async reward delivery for absent players (GM gifts / season rollover / compensation).
// Backend TDD ch.4/ch.11. Rewards are **resource grants only** (resolved 2026-07-09) — consuming an
// inbox message builds a Transaction of `grantResource` lines (additive, cap-clamped). Server OUTPUT
// types (like MutationResponse/GetMeResponse) — the client never posts these.

export interface InboxRewardLine {
	resourceConfigId: number;
	amount: number;
}
export type InboxReward = InboxRewardLine[];

// The client-facing view of a pending inbox message. Server-only fields (`playerId`, `consumedAt`) are
// stripped — the client only sees what it can act on.
export interface InboxMessage {
	inboxId: string;
	source: string; // "gm" | "season" | "compensation" | a feature id
	title: string;
	content: string;
	reward: InboxReward;
	createdAt: number; // ms epoch
	expiresAt?: number; // ms epoch; absent = never expires
}
