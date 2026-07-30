// ─────────────────────────────────────────────────────────────────────────────
// ASSET REGISTRY (data layer — PURE)
// Single source of truth for every visual. Each entry has an emoji fallback +
// label, and (where art exists) an `art` path into /art/<path>.png. The view
// resolver (src/view/assets.js) bundles the art via import.meta.glob and prefers
// the image, falling back to the emoji. Swapping/adding art = edit this file only.
// ─────────────────────────────────────────────────────────────────────────────

export const ASSETS = {
  // ── Merge chains ──────────────────────────────────────────────────────────
  // NOTE: the chain IDs (blade / range / magic) are OPAQUE internal keys shared with the combat VFX +
  // hero-weapon system (config.js trailStyle / impactColor). Each 8-tier ladder obeys the three
  // cardinal laws (see merge-icon-author): clear differentiation, clear escalation, rising power.
  // Art + each icon's registration point / scale / rotation are authored in the trim tool and baked
  // into assets.json; these emoji/label pairs are only the resolver fallbacks (art always present).
  // Blades: forged steel → fire/solar (sword + shield).
  'blade.0': { emoji: '🗡️', label: 'Rustbit', art: 'merge/blade-0' },
  'blade.1': { emoji: '🗡️', label: 'Mended Iron', art: 'merge/blade-1' },
  'blade.2': { emoji: '⚔️', label: "Soldier's Steel", art: 'merge/blade-2' },
  'blade.3': { emoji: '⚔️', label: "Knight's Gilded", art: 'merge/blade-3' },
  'blade.4': { emoji: '⚔️', label: 'Emberforged', art: 'merge/blade-4' },
  'blade.5': { emoji: '🔥', label: 'Runeflame', art: 'merge/blade-5' },
  'blade.6': { emoji: '🔥', label: "Phoenix King's", art: 'merge/blade-6' },
  'blade.7': { emoji: '✨', label: 'Solar Sovereign', art: 'merge/blade-7' },
  // Range: feather → arrow → quiver → bow, then nature/storm ascension.
  'range.0': { emoji: '🪶', label: 'Feather', art: 'merge/range-0' },
  'range.1': { emoji: '➹', label: 'Arrow', art: 'merge/range-1' },
  'range.2': { emoji: '🎯', label: 'Quiver', art: 'merge/range-2' },
  'range.3': { emoji: '🏹', label: "Ranger's Bow", art: 'merge/range-3' },
  'range.4': { emoji: '🏹', label: "Warden's Gilded Bow", art: 'merge/range-4' },
  'range.5': { emoji: '🏹', label: 'Thornwood Bow', art: 'merge/range-5' },
  'range.6': { emoji: '⚡', label: 'Tempest Falcon Bow', art: 'merge/range-6' },
  'range.7': { emoji: '✨', label: 'Skybreaker Sovereign', art: 'merge/range-7' },
  // Magic: spellbooks — paper → folio → leather → arcane → cosmic → radiant.
  'magic.0': { emoji: '📄', label: 'Scrap', art: 'merge/magic-0' },
  'magic.1': { emoji: '📄', label: 'Loose Sheets', art: 'merge/magic-1' },
  'magic.2': { emoji: '📑', label: 'Bound Folio', art: 'merge/magic-2' },
  'magic.3': { emoji: '📖', label: 'Leather Spellbook', art: 'merge/magic-3' },
  'magic.4': { emoji: '📘', label: 'Ornate Spellbook', art: 'merge/magic-4' },
  'magic.5': { emoji: '📓', label: 'Arcane Grimoire', art: 'merge/magic-5' },
  'magic.6': { emoji: '🌌', label: 'Cosmic Codex', art: 'merge/magic-6' },
  'magic.7': { emoji: '✨', label: 'Radiant Tome', art: 'merge/magic-7' },

  // ── Generators ────────────────────────────────────────────────────────────
  // Levelled: art keys are `gen.<chain>.<level>` (0..4), resolved straight from the baked asset
  // registry (assets/combatclean/gen/); the display name comes from the generator's UI config
  // (GENERATORS[g].name). No per-level emoji/label defaults here — a generator has one name, not one
  // per tier (unlike item ladders above).

  // ── Gear (emoji only) ──────────────────────────────────────────────────────
  'gear.weapon': { emoji: '⚔️', label: 'Weapon', art: 'gear/weapon' },
  'gear.armor': { emoji: '🛡️', label: 'Armor', art: 'gear/armor' },
  'gear.accessory': { emoji: '💍', label: 'Accessory', art: 'gear/accessory' },

  // ── Heroes (art/heroes/<id>.png) ────────────────────────────────────────────
  'hero.knight': { emoji: '🤺', label: 'Knight', art: 'heroes/knight' },
  'hero.paladin': { emoji: '🛡️', label: 'Paladin', art: 'heroes/paladin' },
  'hero.templar': { emoji: '⚜️', label: 'Templar', art: 'heroes/templar' },
  'hero.barbarian': { emoji: '🪓', label: 'Barbarian', art: 'heroes/barbarian' },
  'hero.berserker': { emoji: '😤', label: 'Berserker', art: 'heroes/berserker' },
  'hero.dwarf-warrior': { emoji: '🧔', label: 'Dwarf Warrior', art: 'heroes/dwarf-warrior' },
  'hero.valkyrie': { emoji: '🦸‍♀️', label: 'Valkyrie', art: 'heroes/valkyrie' },
  'hero.monk': { emoji: '🥋', label: 'Monk', art: 'heroes/monk' },
  'hero.ranger': { emoji: '🏹', label: 'Ranger', art: 'heroes/ranger' },
  'hero.elf-archer': { emoji: '🧝', label: 'Elf Archer', art: 'heroes/elf-archer' },
  'hero.assassin': { emoji: '🥷', label: 'Assassin', art: 'heroes/assassin' },
  'hero.rogue': { emoji: '🗡️', label: 'Rogue', art: 'heroes/rogue' },
  'hero.dragoon': { emoji: '🐲', label: 'Dragoon', art: 'heroes/dragoon' },
  'hero.wizard': { emoji: '🧙', label: 'Wizard', art: 'heroes/wizard' },
  'hero.sorceress': { emoji: '🧙‍♀️', label: 'Sorceress', art: 'heroes/sorceress' },
  'hero.warlock': { emoji: '👺', label: 'Warlock', art: 'heroes/warlock' },
  'hero.necromancer': { emoji: '💀', label: 'Necromancer', art: 'heroes/necromancer' },
  'hero.druid': { emoji: '🌿', label: 'Druid', art: 'heroes/druid' },
  'hero.cleric': { emoji: '✨', label: 'Cleric', art: 'heroes/cleric' },
  'hero.bard': { emoji: '🎵', label: 'Bard', art: 'heroes/bard' },

  // ── Enemies (art/enemies/<id>.png) ──────────────────────────────────────────
  // Zone signature enemies (one per zone).
  // Zone bosses (per-zone gate; boss-1/boss-2 reuse the shipped generic stickers).
  // Boss megaboss stickers — shown on boss levels (cosmetic; cycle by level).

  // ── UI / currencies / rewards (art/ui/<name>.png) ──────────────────────────
  'ui.energy': { emoji: '⚡', label: 'Energy', art: 'ui/energy' },
  'ui.coin': { emoji: '🪙', label: 'Coins', art: 'ui/coin' },
  'ui.gem': { emoji: '💎', label: 'Gems', art: 'ui/gem' },
  'ui.heroXp': { emoji: '📘', label: 'Hero XP', art: 'ui/heroXp' },
  'ui.gearXp': { emoji: '🔧', label: 'Gear XP', art: 'ui/gearXp' },
  'ui.order': { emoji: '📜', label: 'Order', art: 'ui/order' },
  'ui.reroll': { emoji: '🎲', label: 'Reroll' }, // emoji-only until a die icon ships (add art: 'ui/reroll')
  'ui.reward': { emoji: '🎁', label: 'Reward', art: 'ui/reward' },
  'ui.chest': { emoji: '🧰', label: 'Chest', art: 'ui/chest' },
  // Per-rarity chests (common reuses the shipped PNG; higher tiers are emoji
  // placeholders — swap to real art via this registry with no code change).
  'ui.chest.common': { emoji: '📦', label: 'Common Chest', art: 'ui/chest' },
  'ui.chest.uncommon': { emoji: '🧰', label: 'Uncommon Chest', art: 'ui/chest-uncommon' },
  'ui.chest.rare': { emoji: '🎁', label: 'Rare Chest', art: 'ui/chest-rare' },
  'ui.chest.epic': { emoji: '💰', label: 'Epic Chest', art: 'ui/chest-epic' },
  'ui.chest.legendary': { emoji: '💎', label: 'Legendary Chest', art: 'ui/chest-legendary' },
  'ui.star': { emoji: '⭐', label: 'Star', art: 'ui/star' },
  'ui.power': { emoji: '💪', label: 'Power', art: 'ui/power' },
  // UI glyphs (emoji-only) — referenced by key so components never inline an emoji.
  'ui.pity': { emoji: '🛡', label: 'Pity' },
  'ui.timer': { emoji: '⏳', label: 'Timer' },
  'ui.locked': { emoji: '❓', label: 'Locked' },
  'ui.fuseFodder': { emoji: '🧩', label: 'Fuse fodder' },
  'ui.summonMachine': { emoji: '🎰', label: 'Summon' },
  // Bottom-nav tab icons (referenced by NavBar TABS icon keys).
  'ui.nav.heroes': { emoji: '🦸', label: 'Heroes' },
  'ui.nav.gear': { emoji: '🔧', label: 'Gear' },
  'ui.nav.merge': { emoji: '🧩', label: 'Merge' },
  'ui.nav.gacha': { emoji: '🎰', label: 'Gacha' },
  'ui.nav.map': { emoji: '🗺️', label: 'Map' },
  // Banner faces (referenced by banner.faceAsset in src/data/banners.js).
  'banner.exclusive': { emoji: '🐸', label: 'Exclusive' },
  'banner.mythic': { emoji: '🪐', label: 'Mythic' },
  'banner.mega': { emoji: '🧙', label: 'Mega' },

  // ── Weapon VFX glyphs ───────────────────────────────────────────────────────
  'fx.blade': { emoji: '⚔️', label: 'Slash' },
  'fx.range': { emoji: '🏹', label: 'Shot' },
  'fx.magic': { emoji: '🔮', label: 'Bolt' },

  // ── Ascension crystal + territory UNIQUE items (art/standalone/<name>.png) ────
  'ui.crystal': { emoji: '💎', label: 'Ascension Crystal', art: 'standalone/gem-ruby' },
  'piece.u-lilypad-aegis': { emoji: '🛡️', label: 'Lilypad Aegis', art: 'standalone/shield' },
  'piece.u-mireblade': { emoji: '🗡️', label: 'Mireblade', art: 'standalone/sword-falchion' },
  'piece.u-bog-charm': { emoji: '🔮', label: 'Bog Charm', art: 'standalone/orb-arcane' },
  'piece.u-hunter-cowl': { emoji: '🪖', label: "Hunter's Cowl", art: 'standalone/helm' },
  'piece.u-gloomthorn': { emoji: '🪄', label: 'Gloomthorn Staff', art: 'standalone/staff' },
  'piece.u-thornweave': { emoji: '📜', label: 'Thornweave', art: 'standalone/scroll' },
  'piece.u-ossuary-plate': { emoji: '🛡️', label: 'Ossuary Plate', art: 'standalone/shield' },
  'piece.u-bonereaper': { emoji: '🗡️', label: 'Bonereaper', art: 'standalone/sword-falchion' },
  'piece.u-grave-sigil': { emoji: '🗝️', label: 'Grave Sigil', art: 'standalone/key-gold' },
  'piece.u-magma-guard': { emoji: '🛡️', label: 'Magma Guard', art: 'standalone/shield' },
  'piece.u-cinderfang': { emoji: '⚔️', label: 'Cinderfang', art: 'standalone/sword-knight' },
  'piece.u-ember-band': { emoji: '💍', label: 'Ember Band', art: 'standalone/orb-fire' },
  'piece.u-glacial-ward': { emoji: '📘', label: 'Glacial Ward', art: 'standalone/tome' },
  'piece.u-rimebrand': { emoji: '🪄', label: 'Rimebrand', art: 'standalone/staff' },
  'piece.u-frost-locket': { emoji: '💧', label: 'Frost Locket', art: 'standalone/potion-blue' },
  'piece.u-scale-aegis': { emoji: '🪖', label: 'Scale Aegis', art: 'standalone/helm' },
  'piece.u-wyrmblade': { emoji: '⚔️', label: 'Wyrmblade', art: 'standalone/sword-knight' },
  'piece.u-dragonheart': { emoji: '❤️‍🔥', label: 'Dragonheart', art: 'standalone/potion-red' },

  // ── Zone key art (art/zones/<id>.png biome vignettes) ──────────────────────
  'zone.mossbog': { emoji: '🌿', label: 'Mossbog Fens', art: 'zones/zone-mossbog' },
  'zone.gloomwood': { emoji: '🌲', label: 'Gloomwood', art: 'zones/zone-gloomwood' },
  'zone.boneyard': { emoji: '🪦', label: 'Boneyard Marches', art: 'zones/zone-boneyard' },
  'zone.emberfall': { emoji: '🌋', label: 'Emberfall Keep', art: 'zones/zone-emberfall' },
  'zone.frostvault': { emoji: '🧊', label: 'Frostvault Crypt', art: 'zones/zone-frostvault' },
  'zone.dragons-ascent': { emoji: '🐉', label: "Dragon's Ascent", art: 'zones/zone-dragons-ascent' },

  // ── Map node-type glyphs (emoji-only; referenced by node.<type>) ────────────
  'node.combat': { emoji: '⚔️', label: 'Battle' },
  'node.treasure': { emoji: '🎁', label: 'Treasure' },
  'node.elite': { emoji: '👹', label: 'Elite' },
  'node.rest': { emoji: '⛺', label: 'Rest' },
  'node.boss': { emoji: '🐲', label: 'Boss' },

  // ── Special (S) merge tile — animated orb art from tools/anim-pipeline ────────
  'special.0': { emoji: '💀', label: 'Special', art: 'merge/special-0' },

  missing: { emoji: '❓', label: 'Unknown' },
};
