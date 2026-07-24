// === gearSlots — KEY-kind logical config ===
//
// The equip slot families (weapon / armor / trinket). key-kind: equip constraints are coded around
// the slot enum. The `key` equals a gear instance's `slot`. Presentation (name/icon) lives in UIConfig.
import { zKeyConfig } from '@bishop/config-registry';

export const zGearSlotConfig = zKeyConfig.strict();
