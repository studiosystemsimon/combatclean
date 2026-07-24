// === chains — merge-ladder logical config (config-registry KEY-kind) ===
//
// A CHAIN is a merge ladder (blade / bow / magic). Two identical items `(chain, level)` merge into
// `(chain, level+1)`; `tiers` is the ladder depth (levels 0..tiers-1). The key is OPAQUE and shared
// with generators, heroes' weapon, and combat VFX — NEVER rename it. key-kind because a chain is a
// coded spine, not data-only content. Presentation (display name) lives in UIConfig, keyed by this key.
import { z } from 'zod';
import { zKeyConfig } from '@bishop/config-registry';

export const zChainConfig = zKeyConfig
  .extend({
    tiers: z.number().int().positive().describe('Ladder depth — number of merge levels (items run level 0..tiers-1).'),
  })
  .strict();
