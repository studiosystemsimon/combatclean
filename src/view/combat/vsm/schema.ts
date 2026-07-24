// === Visual State Machine (VSM) — the visual registry schema (SSOT of the visual-config shape) ===
//
// The SECOND leg of the id-contract: per-entity VISUAL identity keyed by the SAME id as the logical
// entry, holding ONLY what the renderer draws (states → layers → keyframes). NO gameplay data, NO
// UI text. The build (compose → virtual:game-config `visual`), the visual scaffold registry, and the
// edit hook all validate against this one schema — "fails in one → fails in all".
//
// combatclean note: this is a THIN, OPT-IN layer. The shipped visuals are the ASSET REGISTRY
// (MergeCombat-style key→art, resolved by id); the VSM is the contract for animated combat visuals
// when they are added. An entity with no visual entry simply falls back to its asset.
//
// `.strict()` everywhere (unknown keys rejected). Colours are linear [r,g,b(,a)] tuples (renderer-
// native), never hex. Assets referenced by *AssetId (the asset-registry id), never a path.
import { z } from 'zod';

export const zVsmState = z.enum(['idle', 'move', 'attack', 'death']).describe('The visual states the state-machine selects between; idle is mandatory.');

export const zRGBA = z.tuple([z.number(), z.number(), z.number(), z.number()]).describe('Linear colour [r,g,b,a], 0..1 (renderer-native, HDR-capable).');

// A normalized keyframe track: t 0..1 (not seconds), one property animated with an easing.
export const zKeyframe = z.object({
  t: z.number().min(0).max(1).describe('Normalized time 0..1 within the state loop.'),
  value: z.number().describe('Property value at t.'),
}).strict();

export const zTrack = z.object({
  property: z.enum(['alpha', 'scale', 'offsetX', 'offsetY', 'rotation']).describe('Animated property.'),
  easing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']).default('linear'),
  keys: z.array(zKeyframe).min(2).describe('≥2 keyframes to interpolate.'),
}).strict();

const zSpriteLayer = z.object({
  type: z.literal('sprite'),
  spriteAssetId: z.string().min(1).describe('Asset-registry id of the sprite/sprite-animation to draw (never a path).'),
  clip: z.string().optional().describe('Named clip within a sprite-animation asset (idle/walk/…).'),
  drawSize: z.number().optional().describe('On-screen draw size in px.'),
  offsetY: z.number().optional().describe('Vertical draw offset in px.'),
  tracks: z.array(zTrack).optional().describe('Per-layer keyframe animation.'),
}).strict();

const zShapeLayer = z.object({
  type: z.literal('shape'),
  shape: z.enum(['circle', 'rect']).describe('Primitive kind.'),
  color: zRGBA,
  radius: z.number().optional().describe('Radius (circle) or half-extent (rect), px.'),
  tracks: z.array(zTrack).optional(),
}).strict();

export const zLayer = z.discriminatedUnion('type', [zSpriteLayer, zShapeLayer]);

export const zVisualState = z.object({
  mode: z.enum(['once', 'loop']).default('loop').describe('Playback mode for this state.'),
  layers: z.array(zLayer).min(1).describe('Draw stack (bottom→top) for this state.'),
}).strict();

export const zVisualConfig = z.object({
  id: z.number().int().describe('Same numeric id as the logical entry this visual belongs to.'),
  states: z.object({
    idle: zVisualState,
    move: zVisualState.optional(),
    attack: zVisualState.optional(),
    death: zVisualState.optional(),
  }).strict().describe('Per-state draw stacks; idle mandatory, the rest fall back to idle.'),
}).strict();

export type VisualConfig = z.infer<typeof zVisualConfig>;
export type VsmState = z.infer<typeof zVsmState>;
