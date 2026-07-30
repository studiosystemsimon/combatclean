// ─────────────────────────────────────────────────────────────────────────────
// STRINGS CONFIG (data layer — PURE)
// The single source of truth for user-facing COPY, referenced by a stable KEY so
// an entire locale swaps by loading a different strings JSON at startup with no
// code change (see CLAUDE.md · Central configuration). Code reads STRINGS.<...>;
// it never inlines a user-facing string. Non-string configs (colours in config.js,
// emoji/art in the asset registry) reference nothing here — this file is copy only.
//
// Coverage note: this holds the currently-migrated high-visibility surfaces (the
// merge board, gacha + gear screens, combat beats). Add new copy here by key as
// new text surfaces land — never inline it back into a component.
// ─────────────────────────────────────────────────────────────────────────────

export const STRINGS = {
  screens: {
    gear: 'Gear',
    summon: 'Summon',
    collection: 'Collection',
    map: 'Map',
  },

  // Zone display names — referenced by zone.nameKey in data/zones.js (data holds
  // the KEY; the view resolves the copy here). Swap a locale = swap this block.
  zones: {
    mossbog: 'Mossbog Fens',
    gloomwood: 'Gloomwood',
    boneyard: 'Boneyard Marches',
    emberfall: 'Emberfall Keep',
    frostvault: 'Frostvault Crypt',
    'dragons-ascent': "Dragon's Ascent",
  },

  // World-map screen copy.
  map: {
    title: 'World Map',
    span: 'Lv', // rendered as "Lv 1–10"
    cleared: 'CLEARED',
    here: 'HERE',
    locked: 'LOCKED',
    farmHint: 'Tap a cleared area to farm it',
    nodeNames: { combat: 'Battle', treasure: 'Treasure', elite: 'Elite', rest: 'Rest', boss: 'Boss' },
    afkTitle: 'AFK Income',
    perHr: '/hr',
    welcomeBack: 'Welcome back!',
    away: 'Away',
    collect: 'Collect',
    lootTitle: 'Loot',
    gotIt: 'Got it',
    startBody: 'Restart this zone from its first room?', // zone-start confirm dialog
    startGo: 'Start Zone',
    startCancel: 'Cancel',
  },

  board: {
    bestMerge: '✨ Best merge',
    coachGenerator: 'Tap to dispense · Drag to move',
    coachCobweb: 'Cobwebs lock tiles — merge this tile to break the web',
    unlocked: 'Unlocked!',
  },

  orders: {
    nextOrder: 'NEXT ORDER', // label under the pending arrival timer
    rerollHint: 'Reroll (usually worse)', // reroll-die tooltip
    special: 'SPECIAL', // ribbon on a special order (drops an S-tile)
    potion: 'LIMIT', // ribbon on a limit-potion order (fills limit energy)
  },

  // Merge-tier LABELS (the "+<name>" float on a merge). Rarity COLOURS for the same
  // tiers live in config.js · TIER_PRESENTATION (colours are tuning, not copy).
  merge: {
    tierNames: ['Crude', 'Sturdy', 'Keen', 'Fine', 'Superior', 'Elite', 'Legendary', 'Mythic'],
  },

  gacha: {
    summon: 'Summon',
    ten: '×10',
    pity: 'PITY',
    discount: '-10%',
  },

  gear: {
    levelUp: 'Level Up',
    maxLevel: 'MAX LEVEL',
    maxRarity: 'MAX RARITY',
    fusePrefix: 'Fuse ▲',
    empty: 'No gear yet — fulfil orders to open chests.',
    legend: 'Fuse = 2 same-slot + rarity items + coins → next rarity. Level spends gear-XP. 🔼 = ready to fuse. Equip on the Heroes screen.',
    level: 'Level',
    equippedBy: 'Equipped by',
    unequipped: 'Unequipped',
    power: 'POWER',
  },

  combat: {
    waveClear: 'WAVE CLEAR',
    bossSpecial: '⚠ BOSS SPECIAL ⚠',
    critical: 'CRITICAL!',
    limitBreak: 'LIMIT BREAK!',
    limitLabel: 'LIMIT', // short caps badge on a charged hero limit bar
    bossSlam: 'BOSS SLAM!',
    raise: 'RAISE!',
    lose: 'LOSE',
    complete: 'COMPLETE',
    level: 'Level',
    boss: 'BOSS',
    next: 'NEXT',
    areaComplete: 'AREA COMPLETE',
    areaContinue: 'CONTINUE',
    unlocked: 'unlocked!', // suffix after a newly-unlocked generator name in the AREA COMPLETE popup
    // ── Intros ──
    lvAbbr: 'LV',
    introLevel: 'LEVEL',
    introZone: 'ENTERING ZONE',
    bossAhead: '⚠  BOSS AHEAD  ⚠',
    bossReveal: '⚔  BOSS  ⚔',
    unknownName: '? ? ?',
    threat: 'THREAT',
    threatLabels: { 1: 'LOW', 2: 'RISING', 3: 'HIGH', 4: 'SEVERE', 5: 'EXTREME' },
  },

  reveal: {
    tapToContinue: 'TAP TO CONTINUE',
    skip: 'SKIP ▸▸',
    youSummoned: 'YOU SUMMONED',
    continueBtn: 'Continue',
  },
};
