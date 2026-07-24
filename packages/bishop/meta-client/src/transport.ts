import type { ErrorCode } from "@bishop/meta-contract";

// The HTTP boundary as a port — the host supplies fetch/XHR; tests supply a fake. A REJECTED promise
// means a network fault (lost ack → safe to retry the same guid); a resolved WireResponse with a 4xx
// is a server verdict (not retried).
export interface WireResponse {
	status: number;
	body: unknown;
}

export interface WireRequest {
	method: "GET" | "POST";
	path: string;
	token: string;
	body?: unknown;
}

export type Transport = (req: WireRequest) => Promise<WireResponse>;

// Thrown for any 4xx/5xx server verdict; the client branches on `code`, not the status number.
export class ClientError extends Error {
	constructor(
		readonly code: ErrorCode | string,
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "ClientError";
	}
}
