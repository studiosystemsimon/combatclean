// ffmpeg helper — the transforms shell out to ffmpeg (a soft-dep of this repo).
// ponytail: reuse ffmpeg for both image + audio to avoid a new `sharp` dep; swap to
// sharp for images later if quality/speed needs it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cachedVersion: string | null | undefined;

/** ffmpeg version string (folded into the cache key), or undefined if ffmpeg is unavailable. */
export function ffmpegVersion(): string | undefined {
	if (cachedVersion !== undefined) return cachedVersion ?? undefined;
	try {
		const out = execFileSync("ffmpeg", ["-version"], { encoding: "utf-8" });
		cachedVersion = out.split("\n")[0]?.trim() ?? "ffmpeg";
	} catch {
		cachedVersion = null;
	}
	return cachedVersion ?? undefined;
}

/** Run ffmpeg over `input` bytes → output bytes, via temp files. `args` sits between input and output. */
export function runFfmpeg(
	input: Uint8Array,
	inExt: string,
	outExt: string,
	args: string[],
): Uint8Array {
	const dir = mkdtempSync(join(tmpdir(), "asset-proc-"));
	const inPath = join(dir, `in${inExt}`);
	const outPath = join(dir, `out${outExt}`);
	try {
		writeFileSync(inPath, input);
		try {
			execFileSync("ffmpeg", ["-y", "-i", inPath, ...args, outPath], { stdio: "pipe" });
		} catch (e) {
			const err = e as NodeJS.ErrnoException & { stderr?: Buffer };
			if (err.code === "ENOENT") {
				throw new Error(
					"[asset-processors] ffmpeg not found — install ffmpeg or remove the image/audio processors from the profile",
				);
			}
			throw new Error(`[asset-processors] ffmpeg failed: ${err.stderr?.toString() ?? err.message}`);
		}
		return readFileSync(outPath);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
