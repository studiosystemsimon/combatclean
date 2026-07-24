// Error contract shared by server (thrown) and client (branched on `code`, NOT the HTTP status).
// Three failure tiers (Backend TDD ch.5):
//   ① plausible reject  → 422 (own-state/eligibility; leaks nothing, client already holds its state)
//   ② impossible/tampered → 400 (+ abuse flag)
//   ③ internal fault    → 500 (+ traceId)
// Plus the transport/auth/version codes from the ch.5 status map.

export type ErrorTier = "plausible" | "impossible" | "internal" | "transport";

export const ErrorCode = {
	// ① business rejects (422)
	INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
	CAP_EXCEEDED: "CAP_EXCEEDED",
	ALREADY_CLAIMED: "ALREADY_CLAIMED",
	COOLDOWN: "COOLDOWN",
	INELIGIBLE: "INELIGIBLE",
	// ② impossible / tampered (400 + flag)
	BAD_REQUEST: "BAD_REQUEST",
	UNKNOWN_ID: "UNKNOWN_ID",
	SCHEMA_VIOLATION: "SCHEMA_VIOLATION",
	// auth / transport
	TOKEN_EXPIRED: "TOKEN_EXPIRED", // 401 — client renews via Fortis + retries
	TOKEN_INVALID: "TOKEN_INVALID", // 401 — never retry
	FORBIDDEN: "FORBIDDEN", // 403
	NOT_FOUND: "NOT_FOUND", // 404
	VERSION_CONFLICT: "VERSION_CONFLICT", // 409 — rarely surfaced (server retries)
	CONTENT_STALE: "CONTENT_STALE", // 409 — config hash mismatch (ch.10)
	CLIENT_TOO_NEW: "CLIENT_TOO_NEW", // 409 — client ahead of server (sticky "server catching up")
	UPDATE_REQUIRED: "UPDATE_REQUIRED", // 426 — client too old
	RATE_LIMITED: "RATE_LIMITED", // 429
	INTERNAL: "INTERNAL", // 500 (+ traceId)
	MAINTENANCE: "MAINTENANCE", // 503
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

interface ErrorSpec {
	status: number;
	tier: ErrorTier;
}

// code → { HTTP status, tier }. The one place the mapping lives.
export const ERROR_SPEC: Record<ErrorCode, ErrorSpec> = {
	INSUFFICIENT_FUNDS: { status: 422, tier: "plausible" },
	CAP_EXCEEDED: { status: 422, tier: "plausible" },
	ALREADY_CLAIMED: { status: 422, tier: "plausible" },
	COOLDOWN: { status: 422, tier: "plausible" },
	INELIGIBLE: { status: 422, tier: "plausible" },
	BAD_REQUEST: { status: 400, tier: "impossible" },
	UNKNOWN_ID: { status: 400, tier: "impossible" },
	SCHEMA_VIOLATION: { status: 400, tier: "impossible" },
	TOKEN_EXPIRED: { status: 401, tier: "transport" },
	TOKEN_INVALID: { status: 401, tier: "transport" },
	FORBIDDEN: { status: 403, tier: "transport" },
	NOT_FOUND: { status: 404, tier: "transport" },
	VERSION_CONFLICT: { status: 409, tier: "transport" },
	CONTENT_STALE: { status: 409, tier: "transport" },
	CLIENT_TOO_NEW: { status: 409, tier: "transport" },
	UPDATE_REQUIRED: { status: 426, tier: "transport" },
	RATE_LIMITED: { status: 429, tier: "transport" },
	INTERNAL: { status: 500, tier: "internal" },
	MAINTENANCE: { status: 503, tier: "transport" },
};

// Wire shape of an error response body.
export interface ErrorBody {
	code: ErrorCode;
	message?: string;
	traceId?: string;
}

export function httpStatusFor(code: ErrorCode): number {
	return ERROR_SPEC[code].status;
}

// ② impossible/tampered codes must be flagged to the abuse layer (ch.5).
export function shouldFlagAbuse(code: ErrorCode): boolean {
	return ERROR_SPEC[code].tier === "impossible";
}
