// === heroClasses — KEY-kind logical config ===
//
// The class axis (knight / mage / …). key-kind: the equip rule switches on it (class-bound slots).
// A hero-class references one (heroes.classKey); a class-bound gear piece references one
// (gearPieces.classKey). A class may be one hero or a family several heroes share. `key` is the class
// id; presentation (name/icon) lives in UIConfig, keyed by the same key.
import { zKeyConfig } from '@bishop/config-registry';

export const zHeroClassConfig = zKeyConfig.strict();
