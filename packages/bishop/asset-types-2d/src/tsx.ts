// Lightweight Tiled `.tsx` (tileset) parsing — pure, zero-dependency, no fs. Used by
// the tileset extractor to resolve the tileset's image + expose its metadata.

export interface TilesetMeta {
	tileWidth: number;
	tileHeight: number;
	columns: number;
	tileCount: number;
	imageSource: string;
	/** Image path relative to the assets root (resolved from the TSX `<image source>` + basePath). */
	resolvedImagePath: string;
}

/** Parse a `.tsx` XML string. Returns null if it has no `<tileset>` tag. */
export function parseTsxMeta(xml: string): Omit<TilesetMeta, "resolvedImagePath"> | null {
	const tag = xml.match(/<tileset[^>]*>/);
	if (!tag) return null;

	const attr = (name: string): string => {
		const m = tag[0].match(new RegExp(`${name}="([^"]+)"`));
		return m ? m[1] : "";
	};

	const imgMatch = xml.match(/<image[^>]+source="([^"]+)"/);

	return {
		tileWidth: Number(attr("tilewidth")) || 32,
		tileHeight: Number(attr("tileheight")) || 32,
		columns: Number(attr("columns")) || 1,
		tileCount: Number(attr("tilecount")) || 0,
		imageSource: imgMatch?.[1] ?? "",
	};
}
