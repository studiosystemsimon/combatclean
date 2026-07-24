// Browser-safe surface (no node:fs). The build/authoring surface with disk access is @bishop/config-registry/node;
// the Vite virtual-module plugin is @bishop/config-registry/vite.
export {
	zConfig,
	zKeyConfig,
	configRef,
	stringConfigRef,
	configRecord,
	stringConfigRefOrAll,
	resolveRefOrAll,
	getTagValue,
	CONFIG_REF_META,
	STRING_REF_META,
	RECORD_KEY_REF_META,
	ALL_MEMBERS_META,
	ALL_MEMBERS_TOKEN,
	type Config,
	type KeyConfig,
	type RefTarget,
} from "./base.js";
export {
	type ConfigCategory,
	type IdCategory,
	type KeyCategory,
	type SingletonCategory,
	type Manifest,
	isIdCategory,
	isKeyCategory,
	isSingletonCategory,
	byName,
} from "./manifest.js";
export {
	buildRefIndex,
	collectRefs,
	type RefIndex,
	type CollectedRef,
} from "./refs.js";
export {
	type IdLedger,
	inLane,
	nextId,
	nextIdForConfig,
	nextIds,
} from "./allocate.js";
export {
	buildInspectContext,
	expand,
	findRefs,
	keyFields,
	categoryList,
	type InspectContext,
	type RefHit,
} from "./inspect.js";
export {
	validateMerged,
	assertValidMerged,
	lintRefNaming,
} from "./validate.js";
export {
	describeSchema,
	formatFields,
	type FieldInfo,
} from "./describe.js";
