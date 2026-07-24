// Shared by every mount<Surface> export (core + features) — installed once, idempotent.

/** Stop keystrokes typed into a Marksman overlay's OWN inputs from reaching the host game's global key
 *  handlers. Many games bind a window/document keydown that preventDefault()s Space + arrows (and use
 *  Space as an action key) with NO "is the user typing?" guard — which would swallow spaces/arrows typed
 *  into a Marksman comment/text field (and can poke the game underneath). Such handlers run in the bubble
 *  phase and every Marksman overlay mounts on document.body, so we stop keydown/keyup at document.body
 *  (bubble) — AFTER the input's own handlers, BEFORE the game's window/document listeners. Scoped to
 *  Marksman-owned editables only (host inputs are untouched). Installed once; idempotent. */
let _inputKeyGuardInstalled = false;
export function installOverlayInputKeyGuard(): void {
	if (_inputKeyGuardInstalled || typeof document === "undefined" || !document.body) return;
	_inputKeyGuardInstalled = true;
	const isOverlayEditable = (el: unknown): boolean => {
		const node = el as HTMLElement | null;
		if (!node || (node.tagName !== "INPUT" && node.tagName !== "TEXTAREA" && !node.isContentEditable)) return false;
		for (let n: HTMLElement | null = node; n && n !== document.body; n = n.parentElement) {
			const c = n.getAttribute && n.getAttribute("class");
			if (c && /(^|\s)mk-/.test(c)) return true; // inside a Marksman overlay container
		}
		return false;
	};
	for (const type of ["keydown", "keyup"] as const) {
		document.body.addEventListener(type, (e) => { if (isOverlayEditable(e.target)) e.stopPropagation(); }, false);
	}
}
