// Auth is a PORT — the agnostic client proxy stays framework-free. The host wires a Fortis-backed
// implementation over `@fortis/sdk-client` (a React/Next SDK; kept out of this lib). Token refresh is
// entirely client-SDK-side (Backend TDD ch.7): the server only ever returns TOKEN_EXPIRED.
export interface IAuthProvider {
	getToken(): Promise<string>; // current access token, attached per call
	refresh(): Promise<string>; // swap the refresh token for a fresh access token
	relogin(): Promise<void>; // hard relogin when the refresh token itself is expired
}
