// ============================================================================
// Zundral — Game Constants
// Central module for all game-wide constants and configuration values.
// Import from here rather than defining magic numbers inline.
// ============================================================================

import type {
  UnitType,
  UnitCategory,
  XPLevelInfo,
  CommanderArchetype,
} from './types';

// ----------------------------------------------------------------------------
// Persistence / save system
// ----------------------------------------------------------------------------

/** Auto-save interval in milliseconds (30 seconds). */
export const AUTOSAVE_INTERVAL_MS = 30_000;

/** Maximum hours of offline progression that will be simulated on load. */
export const MAX_OFFLINE_HOURS = 12;

// ----------------------------------------------------------------------------
// Building progression formulas
// Buildings:
//   Production ×1.25 per level from base (Wood 1, Stone 1, Food 5, Iron 1)
//   Capacity  ×1.30 per level from base 100
// ----------------------------------------------------------------------------

export const PROGRESSION_FORMULA = {
  factors: { production: 1.25, capacity: 1.3 },
  base: {
    wood:  { production: 1, capacity: 100 },
    stone: { production: 1, capacity: 100 },
    food:  { production: 5, capacity: 100 },
    iron:  { production: 1, capacity: 100 },
  },
} as const;

// ----------------------------------------------------------------------------
// Warehouse progression formula
// Per-type capacity base 1000 at level 1, ×1.30 per level
// Upgrade cost base (L1) = 100 wood + 100 stone, ×1.50 per level
// ----------------------------------------------------------------------------

export const WAREHOUSE_FORMULA = {
  factors: { capacity: 1.3, cost: 1.5 },
  base: { level: 1, capacityPerType: 1000, costWood: 100, costStone: 100 },
} as const;

// ----------------------------------------------------------------------------
// Building upgrade costs
// Seeds are the L1→L2 costs; BUILDING_COST_FACTOR scales each subsequent level.
// BUILDING_COST_TABLE overrides the formula for buildings where exact values
// are known from the design spreadsheet.
// ----------------------------------------------------------------------------

export const BUILDING_COST_SEED: Record<'wood' | 'stone' | 'food' | 'iron', { wood: number; stone: number }> = {
  wood:  { wood:  67, stone:  27 }, // Lumber Mill L1→2
  stone: { wood:  75, stone:  60 }, // Quarry L1→2
  food:  { wood: 105, stone:  53 }, // Farm L1→2
  iron:  { wood:  27, stone:  67 }, // Iron Mine L1→2 (wood↔stone vs Lumber Mill)
};

/** Each level costs BUILDING_COST_FACTOR × the previous level's cost. */
export const BUILDING_COST_FACTOR = 1.5;

/**
 * Exact per-level cost table for buildings where spreadsheet values are known.
 * Index 0 = L1→L2, index 1 = L2→L3, etc.
 */
export const BUILDING_COST_TABLE: Partial<Record<'wood' | 'stone' | 'food' | 'iron', { wood: number[]; stone: number[] }>> = {
  wood: {
    wood:  [   67,  101,  151,  226,  339,  509,  763, 1145, 1717, 2576],
    stone: [   27,   41,   61,   91,  137,  205,  308,  463,  692, 1038],
  },
  iron: {
    // Iron Mine costs: wood↔stone swapped vs Lumber Mill
    wood:  [   27,   41,   61,   91,  137,  205,  308,  463,  692, 1038],
    stone: [   67,  101,  151,  226,  339,  509,  763, 1145, 1717, 2576],
  },
};

// ----------------------------------------------------------------------------
// Unit system
// ----------------------------------------------------------------------------

/** Maps each unit type to its broad category (infantry / ranged_infantry / cavalry). */
export const unitCategory: Record<UnitType, UnitCategory> = {
  militia:       'infantry',
  warrior:       'infantry',
  longsword:     'infantry',
  pikemen:       'infantry',
  archer:        'ranged_infantry',
  skirmisher:    'ranged_infantry',
  crossbowmen:   'ranged_infantry',
  light_cavalry: 'cavalry',
  heavy_cavalry: 'cavalry',
};

/** Iron cost to field one full squad of each unit type. */
export const ironCostPerSquad: Record<UnitType, number> = {
  militia:        0,
  skirmisher:    10,
  archer:        20,
  pikemen:       40,
  crossbowmen:   60,
  warrior:       80,  // Shieldmen
  longsword:     80,
  light_cavalry: 100,
  heavy_cavalry: 140,
};

/** Squad size and population cost per squad slot, indexed by unit category. */
export const squadConfig: Record<UnitCategory, { maxSize: number; reqPop: number }> = {
  infantry:        { maxSize: 10, reqPop: 10 },
  ranged_infantry: { maxSize: 10, reqPop: 10 },
  cavalry:         { maxSize: 10, reqPop: 15 },
};

/** Human-readable display name for each unit type. */
export const unitDisplayNames: Record<UnitType, string> = {
  warrior:       'Shieldmen',
  militia:       'Militia',
  longsword:     'Longswords',
  pikemen:       'Pikemen',
  light_cavalry: 'Light Cavalry',
  heavy_cavalry: 'Heavy Cavalry',
  archer:        'Archers',
  skirmisher:    'Skirmishers',
  crossbowmen:   'Crossbowmen',
};

/** Short gameplay description shown in tooltips. */
export const unitDescriptions: Record<UnitType, string> = {
  warrior:       'Defensive line infantry',
  militia:       'Cheap, low morale',
  longsword:     'Elite offensive infantry',
  pikemen:       'Anti-cavalry defensive wall',
  light_cavalry: 'Fast flanker and pursuit specialist',
  heavy_cavalry: 'Expensive shock cavalry',
  archer:        'Ranged support',
  skirmisher:    'Mobile harasser, better in melee than archers',
  crossbowmen:   'Armour-piercing ranged',
};

// ----------------------------------------------------------------------------
// Banner XP system
// ----------------------------------------------------------------------------

export const XP_GAIN_PER_ENEMY_KILL = 1;
export const XP_GAIN_SURVIVAL_BONUS = 10;
export const XP_GAIN_VICTORY_BONUS  = 20;

/** XP thresholds and smoothing factors for each banner experience level. */
export const XP_LEVELS: XPLevelInfo[] = [
  { level: 0, name: 'Green',     minXP:    0, smoothing: 0.0 },
  { level: 1, name: 'Trained',   minXP:  100, smoothing: 0.2 },
  { level: 2, name: 'Regular',   minXP:  300, smoothing: 0.4 },
  { level: 3, name: 'Veteran',   minXP:  700, smoothing: 0.6 },
  { level: 4, name: 'Elite',     minXP: 1500, smoothing: 0.7 },
  { level: 5, name: 'Legendary', minXP: 3100, smoothing: 0.8 },
];

// ----------------------------------------------------------------------------
// Commander XP system
// ----------------------------------------------------------------------------

/** XP required to advance from level 1 to level 2. Scales with 1.2^(N-1). */
export const BASE_COMMANDER_XP = 100;

// ----------------------------------------------------------------------------
// Commander archetype configurations
// ----------------------------------------------------------------------------

export const COMMANDER_ARCHETYPES: Record<
  CommanderArchetype,
  { rangedBonus: number; meleeBonus: number; label: string; description: string }
> = {
  ranged_specialist: {
    rangedBonus: 20,
    meleeBonus:   5,
    label:       'Ranged Specialist',
    description: 'Expert in archery and ranged warfare',
  },
  melee_specialist: {
    rangedBonus:  5,
    meleeBonus:  20,
    label:       'Melee Specialist',
    description: 'Master of close combat and melee tactics',
  },
  balanced_leader: {
    rangedBonus: 10,
    meleeBonus:  10,
    label:       'Balanced Leader',
    description: 'Versatile commander skilled in all combat',
  },
};

/** First names used when randomly generating a commander name. */
export const COMMANDER_FIRST_NAMES: string[] = [
  'Aldren', 'Bartholomew', 'Cedric', 'Darius', 'Eldric', 'Finnian', 'Gareth', 'Hector',
  'Ivan', 'Jareth', 'Kael', 'Lucian', 'Marcus', 'Nathaniel', 'Orion', 'Percival',
  'Quinn', 'Roderick', 'Sylas', 'Theron', 'Ulric', 'Valen', 'Wesley', 'Xander',
  'Yorick', 'Zephyr',
];

/** Titles prefixed to a commander's generated name. */
export const COMMANDER_TITLES: string[] = [
  'Sir', 'Lord', 'Captain', 'Commander', 'General', 'Marshal', 'Duke', 'Baron',
];
