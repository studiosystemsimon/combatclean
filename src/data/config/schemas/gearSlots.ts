// === gearSlots — KEY-kind logical config ===
//
// The equip slot families (weapon / hat / armor / boots / accessory / classAccessory). key-kind: the
// equip rule is coded around the slot enum. The `key` equals a gear instance's `slot`. A hero-class
// declares WHICH slots it has (heroes.slots / gearLoadout.defaultSlots). Presentation → UIConfig.
import { z } from 'zod';
import { zKeyConfig } from '@bishop/config-registry';

export const zGearSlotConfig = zKeyConfig.extend({
  classBound: z.boolean().optional().describe('True = this slot only accepts pieces whose classKey matches the hero-class (the class-specific accessory). Absent/false = any piece of this slot fits.'),
}).strict();
