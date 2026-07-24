// Version handshake (Backend TDD ch.10). Independent axes the client presents at login:
//   apiVersion          — the ENGINE/base wire contract (THIS package's version);
//   gameApiVersion      — the GAME endpoint/DTO contract (@recipe-raiders/meta-contract), OPTIONAL —
//                         only present for a game that adds feature endpoints. The agnostic contract
//                         defines the slot; the game supplies the number. Engine + game version move
//                         independently, both gated the same way.
//   configSchemaVersion — the game's Zod config SHAPE;
//   contentHash         — the config VALUES bundle hash.
// The client sends these as headers; the server compares to its baked versions and returns a verdict.

// The @bishop/meta-contract wire-contract version — the (base) apiVersion axis. Bump on a breaking
// change to the ENGINE DTOs. The game contract carries its OWN version (the gameApiVersion axis).
export const API_VERSION = 1;

export interface ClientVersions {
	apiVersion: number;
	gameApiVersion?: number; // omitted by a client that predates any game endpoints
	configSchemaVersion: number;
	contentHash: string;
}

export const VERSION_HEADERS = {
	api: "x-api-version",
	gameApi: "x-game-api-version",
	schema: "x-config-schema-version",
	content: "x-content-hash",
} as const;
