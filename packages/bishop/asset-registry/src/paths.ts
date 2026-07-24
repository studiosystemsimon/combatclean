// Pure POSIX path helper — no fs, no format knowledge, browser-safe. The shared home for resolving a
// file-relative uri against the manifest basePath; format packages call it from their extractors when a
// declaration points at a sibling file (an indirection format's referenced source).

/**
 * Resolve `relUri` (relative to `fromFile`) against `basePath`, normalizing `.`/`..`.
 * e.g. resolvePosixRelative("packs/ruins/", "meta/entry.def", "../images/wall.png")
 *      → "packs/ruins/images/wall.png"
 */
export function resolvePosixRelative(basePath: string, fromFile: string, relUri: string): string {
	const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/") + 1);
	const out: string[] = [];
	for (const seg of (basePath + fromDir + relUri).split("/")) {
		if (seg === "..") out.pop();
		else if (seg !== "." && seg !== "") out.push(seg);
	}
	return out.join("/");
}
