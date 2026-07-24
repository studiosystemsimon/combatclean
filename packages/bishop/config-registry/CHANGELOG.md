# Changelog — @bishop/config-registry

All notable changes to this package are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning:
[Semantic Versioning](https://semver.org/). As a consumer, pin a version and read
the entry before bumping — **Added** = safe adoption, **Changed/Removed** = review
for breakage.

## [0.2.0] — 2026-07-23

### Changed — BREAKING

- **`tags` is now a `Record<string,string>` map** (was `string[]` of `"key:value"`
  strings) on both `zConfig` and `zKeyConfig`. Tags are UI/design grouping metadata
  only — the honest shape is a key→value map, not colon-encoded strings.
  ```jsonc
  // before
  "tags": ["category:currency", "class:currency"]
  // after
  "tags": { "category": "currency", "class": "currency" }
  ```
- **`getTagValue(tags, key)` signature changed** to take the map and is now just
  `tags?.[key]` (the `"key:"`-prefix parser is gone).

### Migration

- Convert tag data mechanically: `["k:v", …]` → `{ k: "v", … }` (split on the first
  `:`). Any consumer that indexed `tags` as an array or called the old
  `getTagValue` must move to map access.

### Principle (documented)

- A tag is **UI/design grouping over logic-irrelevant categorization** (e.g. all
  resources are logically a transactional amount; `category:currency` only groups
  them for the UI). **Never filter game logic on a tag** — a set you branch on is an
  enum: model it as a typed field (intrinsic) or a keyConfig + ref (extensible).

## [0.1.0] — 2026-07-23

Extends the reference vocabulary so a schema can declare two shapes that previously
had to be worked around (magic-string unions, null sentinels, or `z.record` keys
validated only at runtime — or not at all). Both are **additive**: existing schemas
and data validate unchanged.

### Added

- **`configRecord(target, keyField, valueSchema)`** — declare a `z.record` whose
  **KEYS are string references** into a category. The engine now validates every map
  key as a ref (a dangling key is a FATAL validation error) and surfaces it in
  `expand`/`refs`. Closes the gap where `z.record(z.string(), …)` left map keys
  (e.g. rarity-weight tables, modifier synergy maps) unvalidated.
  ```ts
  // before: keys silently unchecked
  rarityWeights: z.record(z.string(), z.number())
  // after: keys validated against the `rarities` category
  rarityWeights: configRecord("rarities", "key", z.number())
  ```
- **`stringConfigRefOrAll(target, keyField)`** — a string ref that also accepts the
  reserved wildcard token **`"*"`** (`ALL_MEMBERS_TOKEN`) meaning "every member of
  the target category". The token is engine-owned: the collector skips it and
  validation never flags it dangling. Use as a scalar or inside an array. Replaces
  `literal('all') | ref` unions and null/absent "means all" sentinels with a single
  self-documenting, VALIDATED value.
  ```ts
  kinds: z.array(stringConfigRefOrAll("gearSlots", "key"))
  // data: ["*"] = all slots · ["head","chest"] = those two
  ```
- **`resolveRefOrAll(value, allKeys)`** — read-time helper that expands a
  ref-or-all value (scalar or array) to concrete member keys (`"*"` → all `allKeys`).
  The consumer supplies the current member list (the engine has no runtime state).
- **Exported constants** `RECORD_KEY_REF_META`, `ALL_MEMBERS_META`,
  `ALL_MEMBERS_TOKEN` for tooling that inspects schema metadata.
- **`RefIndex.recordKey`** (`Map<field, {targets, keyField}>`) and
  **`RefIndex.string[*].allowAll`** — expose the new ref kinds to consumers of
  `buildRefIndex`. `CollectedRef.keyField?` carries the target keyField for
  record-key refs.
- `describeSchema`/`formatFields` (the `fields` authoring table) now surface a
  `configRecord` field's key-ref target next to its type.
- Package `vitest.config.ts` so the suite runs isolated from a consuming repo's
  root test config.

### Notes for consumers

- **Adoption is opt-in.** Nothing changes until a schema uses the new helpers.
- **`RefIndex` shape grew a required `recordKey` field.** This only affects code
  that CONSTRUCTS a `RefIndex` by hand (none is expected — always obtain it from
  `buildRefIndex`). Reading `RefIndex` is unaffected.
- **Not addressed here:** correlation is still by field NAME (a same-named ref field
  means the same target across categories). Position-aware ("structural") collection
  — which would also remove that constraint — remains a separate, deferred internal
  refactor with no API change.

## [0.0.1]

- Initial import: the game-agnostic logical-config engine — `zConfig`/`zKeyConfig`,
  `configRef`/`stringConfigRef`, the category manifest, never-reuse id allocation,
  schema + referential-integrity validation, `expand`/`refs` inspection, `describe`,
  and the CLI.
