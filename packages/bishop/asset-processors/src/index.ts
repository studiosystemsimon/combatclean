// ─────────────────────────────────────────────────────────────────────────────
// @bishop/asset-processors — basic build-time MAP processors for @bishop/asset-registry.
//
// Importing this module REGISTERS the processors (side-effect), mirroring how a format
// package registers its extractors/schemas. A game references them by id in its build
// profile: { use: "image-convert", … } / { use: "audio-convert", … }.
//
// Node-only (shells out to ffmpeg). A game defines its OWN processors the same way —
// e.g. a `frames-pack` FOLD processor driving TexturePacker. These two are just the
// common cases the engine ships.
// ─────────────────────────────────────────────────────────────────────────────

import { registerAssetProcessor } from "@bishop/asset-registry/node";
import { z } from "zod";
import { ffmpegVersion, runFfmpeg } from "./ffmpeg.js";

// ─── image-convert — PNG/JPG/TGA → WebP/PNG/JPG, optional longest-edge resize ───

const IMAGE_EXT: Record<string, string> = { webp: ".webp", png: ".png", jpg: ".jpg" };

registerAssetProcessor({
	id: "image-convert",
	kind: "map",
	version: 1,
	accepts: { extensions: ["png", "jpg", "jpeg", "tga", "webp"] },
	toolVersion: ffmpegVersion,
	optionsSchema: z.object({
		format: z.enum(["webp", "png", "jpg"]).default("webp"),
		quality: z.number().min(1).max(100).default(80),
		/** Longest-edge clamp (box fit, never enlarges). */
		maxDim: z.number().int().positive().optional(),
	}),
	async process({ artifacts, options, emit }) {
		const outExt = IMAGE_EXT[options.format];
		const out = artifacts.map((a) => {
			const inExt = a.relPath.slice(a.relPath.lastIndexOf("."));
			const args: string[] = [];
			if (options.maxDim) {
				args.push(
					"-vf",
					`scale='min(iw,${options.maxDim})':'min(ih,${options.maxDim})':force_original_aspect_ratio=decrease`,
				);
			}
			if (options.format === "webp") args.push("-quality", String(options.quality));
			else if (options.format === "jpg")
				args.push("-q:v", String(Math.max(2, Math.round(31 - (options.quality / 100) * 29))));
			const bytes = runFfmpeg(a.bytes, inExt, outExt, args);
			return { relPath: emit(a.relPath.replace(/\.[^.]+$/, outExt), bytes), bytes };
		});
		return { artifacts: out };
	},
});

// ─── audio-convert — WAV/etc → MP3/OGG ───

const AUDIO_EXT: Record<string, string> = { mp3: ".mp3", ogg: ".ogg" };

registerAssetProcessor({
	id: "audio-convert",
	kind: "map",
	version: 2,
	accepts: { extensions: ["wav", "aiff", "flac", "m4a", "mp3", "ogg"] },
	toolVersion: ffmpegVersion,
	optionsSchema: z.object({
		format: z.enum(["mp3", "ogg"]).default("mp3"),
		bitrate: z.string().default("128k"),
		/** Channel count (1 = mono downmix). Omit to preserve the source. */
		channels: z.number().int().positive().optional(),
		/** Output sample rate in Hz (e.g. 22050). Omit to preserve the source. */
		sampleRate: z.number().int().positive().optional(),
		/** Drop cover art + metadata (audio track only) to shrink the file. */
		stripMetadata: z.boolean().default(false),
	}),
	async process({ artifacts, options, emit }) {
		const outExt = AUDIO_EXT[options.format];
		const args = ["-b:a", options.bitrate];
		if (options.channels) args.push("-ac", String(options.channels));
		if (options.sampleRate) args.push("-ar", String(options.sampleRate));
		if (options.stripMetadata) args.push("-map", "0:a", "-map_metadata", "-1");
		const out = artifacts.map((a) => {
			const inExt = a.relPath.slice(a.relPath.lastIndexOf("."));
			const bytes = runFfmpeg(a.bytes, inExt, outExt, args);
			return { relPath: emit(a.relPath.replace(/\.[^.]+$/, outExt), bytes), bytes };
		});
		return { artifacts: out };
	},
});
