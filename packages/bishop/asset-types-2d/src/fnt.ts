// Lightweight AngelCode BMFont (`.fnt`) parsing — pure, zero-dependency, no fs. Used by the
// bitmap-font extractor to resolve the font's page image(s) and expose its metadata.
//
// ponytail: parses the two shipped `.fnt` shapes only — the classic TEXT format
// (`page id=0 file="atlas.png"`) and the XML format (`<page id="0" file="atlas.png"/>`).
// The JSON `.fnt` variant that some tools emit is not handled; add a branch if one shows up.

export interface BitmapFontMeta {
	/** font-family named in the descriptor (`info face="…"`), if present. */
	face: string;
	/** True when the descriptor declares a distanceField section (MSDF/SDF). */
	distanceField: boolean;
	/** Page image sources as written in the `.fnt` (relative to the `.fnt`). */
	pageSources: string[];
	/** Page image paths relative to the assets root (resolved from the sources + basePath). */
	resolvedPagePaths: string[];
}

/** Every `file="…"` on a `page` entry (text or XML), in declaration order. */
function parsePageSources(text: string): string[] {
	const sources: string[] = [];
	// Matches `page ... file="x.png"` (text) and `<page ... file="x.png"` (XML) alike.
	const re = /(?:^|<)\s*page\b[^\n>]*?\bfile="([^"]+)"/gim;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) sources.push(m[1]);
	return sources;
}

/** Parse a `.fnt` string. Returns null if it has no `page` entry (not a BMFont descriptor). */
export function parseFntMeta(
	text: string,
): Omit<BitmapFontMeta, "resolvedPagePaths"> | null {
	const pageSources = parsePageSources(text);
	if (pageSources.length === 0) return null;

	const faceMatch = text.match(/\bface="([^"]+)"/i);
	return {
		face: faceMatch?.[1] ?? "",
		distanceField: /distanceField/i.test(text),
		pageSources,
	};
}
