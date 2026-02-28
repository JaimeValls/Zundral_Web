import React, { useEffect, useMemo, useState, useRef } from "react";
import BlacksmithUI from './BlacksmithUI';
import TechnologiesUI from './TechnologiesUI';
import LeaderboardUI from './LeaderboardUI';
import { persistence, simulateOfflineProgression, createDefaultGameState, GameState } from './persistence';
import { updateLeaderboardFromBattleResult, recalculateRanksAndTitles, createPlaceholderLeaderboard, type LeaderboardEntry, type BattleResult as LeaderboardBattleResult, type Faction } from './leaderboard';
import { useMobileDetection } from './hooks/useMobileDetection';
import zundralLogo from '../imgs/Zundral-compact.png';
import popIcon from '../imgs/pop-icon.png';
import lumberjackImg from '../imgs/buildings/lumbjerjack.png';
import backgroundImg from '../imgs/background/background01.png';
// Resource icons
import rWood from '../imgs/resources/r_wood.png';
import rStone from '../imgs/resources/r_stone.png';
import rFood from '../imgs/resources/r_food.png';
import rIron from '../imgs/resources/r_iron.png';
import rGold from '../imgs/resources/r_gold.png';
import rPopulation from '../imgs/resources/r_population.png';
import rTaxes from '../imgs/resources/r_taxes.png';

// Resource icon mapping
function getResourceIcon(label: string): string {
  const iconMap: Record<string, string> = {
    'Wood': rWood,
    'Stone': rStone,
    'Food': rFood,
    'Iron': rIron,
    'Gold': rGold,
    'Population': rPopulation,
    'Pop': rPopulation,
    'Taxes': rTaxes,
    'Happiness': rPopulation, // Fallback until r_happy.png is available
  };
  return iconMap[label] || rPopulation; // Default fallback
}

// === Progression (matches the document) ===
// Buildings:
//  - Production ×1.25 per level from base (Wood 1, Stone 1, Food 5)
//  - Capacity ×1.30 per level from base 100
const PROGRESSION_FORMULA = {
  factors: { production: 1.25, capacity: 1.3 },
  base: {
    wood: { production: 1, capacity: 100 },
    stone: { production: 1, capacity: 100 },
    food: { production: 5, capacity: 100 },
    iron: { production: 1, capacity: 100 }, // Same as stone
  },
} as const;

// Warehouse:
//  - Per-type capacity base 1000 at level 1
//  - Capacity ×1.30 per level
//  - Upgrade cost base (Level 1) = 100 wood + 100 stone, ×1.50 per level
const WAREHOUSE_FORMULA = {
  factors: { capacity: 1.3, cost: 1.5 },
  base: { level: 1, capacityPerType: 1000, costWood: 100, costStone: 100 },
} as const;

// Building upgrade cost seeds (from sheet). These are the L1→2 costs.
const BUILDING_COST_SEED: Record<"wood" | "stone" | "food" | "iron", { wood: number; stone: number }> = {
  wood: { wood: 67, stone: 27 },   // Lumber Mill L1→2 (seed, table overrides where present)
  stone: { wood: 75, stone: 60 },  // Quarry L1→2
  food: { wood: 105, stone: 53 }, // Farm L1→2
  iron: { wood: 27, stone: 67 },  // Iron Mine L1→2 (swapped from Lumber Mill: wood↔stone)
};
const BUILDING_COST_FACTOR = 1.5;

// Exact per-level cost table for Lumber (from spreadsheet screenshots)
// Index 0 is cost to go from L1→L2, index 1 is L2→L3, etc.
const BUILDING_COST_TABLE: Partial<Record<"wood" | "stone" | "food" | "iron", { wood: number[]; stone: number[] }>> = {
  wood: {
    wood: [67, 101, 151, 226, 339, 509, 763, 1145, 1717, 2576],
    stone: [27, 41, 61, 91, 137, 205, 308, 463, 692, 1038],
  },
  iron: {
    // Iron Mine costs: swapped from Lumber Mill (wood↔stone)
    wood: [27, 41, 61, 91, 137, 205, 308, 463, 692, 1038],
    stone: [67, 101, 151, 226, 339, 509, 763, 1145, 1717, 2576],
  },
};

// === Helpers ===
function getProgression(
  res: "wood" | "stone" | "food" | "iron",
  level: number,
  kind: "production" | "capacity",
) {
  const { factors, base } = PROGRESSION_FORMULA as any;
  const l0 = Math.max(0, level - 1);
  if (kind === "production") return base[res].production * Math.pow(factors.production, l0);
  if (kind === "capacity") return base[res].capacity * Math.pow(factors.capacity, l0);
  return 0;
}

function getBuildingCost(res: "wood" | "stone" | "food" | "iron", levelTo: number) {
  // Cost to reach `levelTo` from (levelTo-1) for the specific building.
  // stepIndex 0 = L1→L2, stepIndex 1 = L2→L3, etc.
  // For levelTo=2, we want stepIndex=0 (L1→L2 cost)
  const stepIndex = Math.max(0, levelTo - 2); // levelTo=2 → stepIndex=0 (L1→L2), levelTo=3 → stepIndex=1 (L2→L3)
  const table = (BUILDING_COST_TABLE as any)[res] as { wood: number[]; stone: number[] } | undefined;
  if (table && table.wood[stepIndex] != null && table.stone[stepIndex] != null) {
    return { wood: table.wood[stepIndex], stone: table.stone[stepIndex] };
  }
  const seed = BUILDING_COST_SEED[res];
  return {
    wood: Math.round(seed.wood * Math.pow(BUILDING_COST_FACTOR, stepIndex)),
    stone: Math.round(seed.stone * Math.pow(BUILDING_COST_FACTOR, stepIndex)),
  };
}

function getWarehouseCapacity(level: number) {
  const l0 = Math.max(0, level - 1);
  return WAREHOUSE_FORMULA.base.capacityPerType * Math.pow(WAREHOUSE_FORMULA.factors.capacity, l0);
}

function getWarehouseCost(levelTo: number) {
  // Cost to reach `levelTo` from levelTo-1
  const l0 = Math.max(0, levelTo - 1);
  return {
    wood: Math.round(WAREHOUSE_FORMULA.base.costWood * Math.pow(WAREHOUSE_FORMULA.factors.cost, l0)),
    stone: Math.round(WAREHOUSE_FORMULA.base.costStone * Math.pow(WAREHOUSE_FORMULA.factors.cost, l0)),
  };
}

// Types
interface WarehouseState { wood: number; stone: number; food: number; iron: number; gold: number }
interface WarehouseCap { wood: number; stone: number; food: number; iron: number; gold: number }

// Unit type definitions
type UnitType =
  | 'warrior'       // used as Shieldmen in UI
  | 'militia'
  | 'longsword'
  | 'pikemen'
  | 'light_cavalry'
  | 'heavy_cavalry'
  | 'archer'
  | 'skirmisher'
  | 'crossbowmen';

// Unit category for determining squad size and population requirements
type UnitCategory = 'infantry' | 'cavalry' | 'ranged_infantry';

// Unit category mapping
const unitCategory: Record<UnitType, UnitCategory> = {
  militia: 'infantry',
  warrior: 'infantry',
  longsword: 'infantry',
  pikemen: 'infantry',
  archer: 'ranged_infantry',
  skirmisher: 'ranged_infantry',
  crossbowmen: 'ranged_infantry',
  light_cavalry: 'cavalry',
  heavy_cavalry: 'cavalry'
};

// Iron cost per full squad for regular army recruitment
const ironCostPerSquad: Record<UnitType, number> = {
  militia: 0,
  skirmisher: 10,
  archer: 20,
  pikemen: 40,
  crossbowmen: 60,
  warrior: 80,        // Shieldmen
  longsword: 80,
  light_cavalry: 100,
  heavy_cavalry: 140
};

// Squad configuration based on category
const squadConfig: Record<UnitCategory, { maxSize: number; reqPop: number }> = {
  infantry: { maxSize: 10, reqPop: 10 },
  ranged_infantry: { maxSize: 10, reqPop: 10 },
  cavalry: { maxSize: 10, reqPop: 15 }
};

// Get iron cost per individual unit (soldier) for training
function getIronCostPerUnit(unitType: UnitType): number {
  const category = unitCategory[unitType];
  const config = squadConfig[category];
  const squadCost = ironCostPerSquad[unitType];
  // Cost per unit = total squad cost / max squad size
  return squadCost / config.maxSize;
}

// Unit display names
const unitDisplayNames: Record<UnitType, string> = {
  warrior: 'Shieldmen',
  militia: 'Militia',
  longsword: 'Longswords',
  pikemen: 'Pikemen',
  light_cavalry: 'Light Cavalry',
  heavy_cavalry: 'Heavy Cavalry',
  archer: 'Archers',
  skirmisher: 'Skirmishers',
  crossbowmen: 'Crossbowmen'
};

// Unit descriptions for UI
const unitDescriptions: Record<UnitType, string> = {
  warrior: 'Defensive line infantry',
  militia: 'Cheap, low morale',
  longsword: 'Elite offensive infantry',
  pikemen: 'Anti-cavalry defensive wall',
  light_cavalry: 'Fast flanker and pursuit specialist',
  heavy_cavalry: 'Expensive shock cavalry',
  archer: 'Ranged support',
  skirmisher: 'Mobile harasser, better in melee than archers',
  crossbowmen: 'Armour-piercing ranged'
};

// Division type: generic record of unit types to counts
type Division = Partial<Record<UnitType, number>>;

// ============================================================================
// Banner XP System
// ============================================================================

// XP gain constants (tunable)
const XP_GAIN_PER_ENEMY_KILL = 1;
const XP_GAIN_SURVIVAL_BONUS = 10;
const XP_GAIN_VICTORY_BONUS = 20;

// XP level definitions
type XPLevelInfo = {
  level: number;
  name: string;
  minXP: number;
  smoothing: number;
};

const XP_LEVELS: XPLevelInfo[] = [
  { level: 0, name: 'Green', minXP: 0, smoothing: 0.0 },
  { level: 1, name: 'Trained', minXP: 100, smoothing: 0.2 },
  { level: 2, name: 'Regular', minXP: 300, smoothing: 0.4 },
  { level: 3, name: 'Veteran', minXP: 700, smoothing: 0.6 },
  { level: 4, name: 'Elite', minXP: 1500, smoothing: 0.7 },
  { level: 5, name: 'Legendary', minXP: 3100, smoothing: 0.8 },
];

// Get level info from XP
function calculateLevelFromXP(xp: number): { level: number; levelName: string; xpCurrentLevel: number; xpNextLevel: number } {
  let level = 0;
  let levelName = 'Green';
  let xpCurrentLevel = 0;
  let xpNextLevel = 100;

  for (let i = XP_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= XP_LEVELS[i].minXP) {
      level = XP_LEVELS[i].level;
      levelName = XP_LEVELS[i].name;
      xpCurrentLevel = XP_LEVELS[i].minXP;
      xpNextLevel = i < XP_LEVELS.length - 1 ? XP_LEVELS[i + 1].minXP : XP_LEVELS[i].minXP + 1000; // Cap at max level
      break;
    }
  }

  return { level, levelName, xpCurrentLevel, xpNextLevel };
}

// Get smoothing factor for a level
function getXpSmoothingForLevel(level: number): number {
  const levelInfo = XP_LEVELS.find(l => l.level === level);
  return levelInfo ? levelInfo.smoothing : 0.0;
}

// Get min XP required for a level
function getMinXPForLevel(level: number): number {
  const levelInfo = XP_LEVELS.find(l => l.level === level);
  return levelInfo ? levelInfo.minXP : 0;
}

// ============================================================================
// Commander XP System
// ============================================================================

// Base XP required to go from level 1 to level 2
const BASE_COMMANDER_XP = 100;

// Calculate XP required to reach next level from current level N
// Formula: baseCommanderXP * (1.2 ** (N - 1))
function calculateCommanderXPToNextLevel(level: number): number {
  if (level < 1) return BASE_COMMANDER_XP;
  if (level >= 99) return Infinity; // Max level reached
  return Math.floor(BASE_COMMANDER_XP * Math.pow(1.2, level - 1));
}

// Update commander XP and handle level ups
// Returns updated commander with new level, currentXP, and xpToNextLevel
function updateCommanderXP(commander: Commander, xpGained: number): Commander {
  let currentLevel = commander.level || 1;
  let currentXP = (commander.currentXP || 0) + xpGained;

  // Commanders never lose XP, so ensure it's non-negative
  currentXP = Math.max(0, currentXP);

  // Handle level ups (can level up multiple times if enough XP)
  while (currentLevel < 99) {
    const xpNeeded = calculateCommanderXPToNextLevel(currentLevel);
    if (currentXP >= xpNeeded) {
      currentXP -= xpNeeded;
      currentLevel++;
    } else {
      break;
    }
  }

  // Cap at level 99
  if (currentLevel > 99) {
    currentLevel = 99;
    currentXP = 0; // At max level, XP resets to 0
  }

  const xpToNextLevel = currentLevel < 99 ? calculateCommanderXPToNextLevel(currentLevel) : Infinity;

  return {
    ...commander,
    level: currentLevel,
    currentXP: Math.floor(currentXP),
    xpToNextLevel,
  };
}

// Calculate level bonus multiplier: 1 + 0.01 * (level - 1)
// Level 1 = 1.00 (no bonus), Level 2 = 1.01 (+1%), Level 3 = 1.02 (+2%), etc.
function getCommanderLevelBonusMultiplier(level: number): number {
  return 1 + 0.01 * (level - 1);
}

// Calculate banner XP gain (before losses) - used for commander XP
function calculateBannerXPGain(
  enemyCasualties: number,
  victory: boolean,
  survived: boolean
): number {
  let xpGain = 0;
  // Gain from enemy kills
  xpGain += enemyCasualties * XP_GAIN_PER_ENEMY_KILL;
  // Survival bonus
  if (survived) {
    xpGain += XP_GAIN_SURVIVAL_BONUS;
  }
  // Victory bonus
  if (victory) {
    xpGain += XP_GAIN_VICTORY_BONUS;
  }
  return xpGain;
}

// Update banner XP after a battle
function updateBannerXP(
  banner: Banner,
  enemyCasualties: number,
  ownCasualties: number,
  startTroops: number,
  victory: boolean,
  survived: boolean
): Banner {
  // Initialize XP if not set
  let currentXP = banner.xp || 0;
  const currentLevel = banner.level ?? calculateLevelFromXP(currentXP).level;

  // Step 1: XP Gain
  // Gain from enemy kills
  currentXP += enemyCasualties * XP_GAIN_PER_ENEMY_KILL;

  // Survival bonus
  if (survived) {
    currentXP += XP_GAIN_SURVIVAL_BONUS;
  }

  // Victory bonus
  if (victory) {
    currentXP += XP_GAIN_VICTORY_BONUS;
  }

  // Step 2: XP Loss (based on casualty rate)
  if (startTroops > 0) {
    const casualtyRate = ownCasualties / startTroops;
    const smoothing = getXpSmoothingForLevel(currentLevel);
    const xpLossRatio = casualtyRate * (1 - smoothing);
    currentXP = currentXP * (1 - xpLossRatio);
  }

  // Clamp to minimum 0
  currentXP = Math.max(0, Math.floor(currentXP));

  // Step 3: Calculate new level
  let { level: newLevel } = calculateLevelFromXP(currentXP);

  // Step 4: Protection rules
  const casualtyRate = startTroops > 0 ? ownCasualties / startTroops : 0;
  const isAnnihilated = casualtyRate >= 1.0;

  // Max one level drop per non-annihilation battle
  if (!isAnnihilated && newLevel < currentLevel - 1) {
    newLevel = currentLevel - 1;
    currentXP = getMinXPForLevel(newLevel);
  }

  // Legendary floor (optional protection)
  if (currentLevel === 5 && !isAnnihilated && newLevel < 4) {
    newLevel = 4;
    currentXP = getMinXPForLevel(newLevel);
  }

  // Recalculate final values
  const finalCalc = calculateLevelFromXP(currentXP);

  return {
    ...banner,
    xp: currentXP,
    level: finalCalc.level,
    xpCurrentLevel: finalCalc.xpCurrentLevel,
    xpNextLevel: finalCalc.xpNextLevel,
  };
}

type Squad = {
  id: number;
  type: UnitType;
  maxSize: number;
  currentSize: number;
  slotIndex?: number;
};

type Banner = {
  id: number;
  name: string;
  units: string[]; // Legacy: kept for backward compatibility, but squads should be used
  squads: Squad[]; // New: tracks individual squad health
  status: 'idle' | 'training' | 'ready' | 'deployed' | 'destroyed';
  reqPop: number;
  recruited: number;
  type: 'regular' | 'mercenary'; // Banner type: regular (men-at-arms) or mercenary
  reinforcingSquadId?: number; // ID of squad being reinforced (for regular banners)
  trainingPaused?: boolean; // Whether training is paused
  customNamed?: boolean; // Whether the player has manually edited the name
  // XP system
  xp?: number; // Current XP (defaults to 0 if not set)
  level?: number; // Current level (computed from XP)
  xpCurrentLevel?: number; // Min XP for current level
  xpNextLevel?: number; // Min XP for next level
  // Commander system
  commanderId?: number | null; // ID of assigned commander, null if none
};

type BannerLossNotice = {
  id: string;
  bannerName: string;
  bannerType: Banner['type'];
  message: string;
};

type Mission = {
  id: number;
  name: string;
  description?: string;
  duration: number; // seconds
  status: 'available' | 'running' | 'completedRewardsPending' | 'completedRewardsClaimed' | 'archived';
  staged: number[]; // banner ids to send
  deployed: number[]; // banner ids currently out
  elapsed: number; // seconds progressed
  enemyComposition?: Division | { warrior?: number; archer?: number }; // For combat missions (supports both old and new format)
  battleResult?: BattleResult; // Store battle result
  bannerXP?: {
    bannerId: number;
    bannerName: string;
    xpGained: number;
    oldXP: number;
    newXP: number;
    oldLevel: number;
    newLevel: number;
    oldLevelName: string;
    newLevelName: string;
    xpCurrentLevel: number;
    xpNextLevel: number;
  }; // Store banner XP info from battle
  rewards?: { gold?: number; wood?: number; stone?: number; food?: number; iron?: number }; // Stored rewards
  rewardTier?: string; // Reward tier name (e.g., "Scout's Cache")
  cooldownEndTime?: number; // UTC timestamp when cooldown ends
  startTime?: number; // UTC timestamp when mission started
  isNew?: boolean; // Flag for NEW! label
};

type ExpeditionState = 'available' | 'funding' | 'readyToLaunch' | 'travelling' | 'completed';

// === Faction System Types ===
type FactionId = "Alsus" | "Atrox";

type FactionBranchId =
  | "Alsus_Tactics"     // Magnus War Council
  | "Alsus_Lux"         // Lux Guardians
  | "Alsus_Crowns"      // Pact of Crowns
  | "Atrox_Blood"       // Blood Legions
  | "Atrox_Fortress"    // Iron Bastions of Roctium
  | "Atrox_Spoils";     // Spoils of War

interface FactionPerkNode {
  id: string;
  faction: FactionId;
  branchId: FactionBranchId;
  tier: number;          // 1–5
  costFP: number;        // FP cost to unlock this node
  unlocked: boolean;
  name: string;          // Perk name (placeholder for now)
  description?: string; // Perk description (placeholder for now)
}

interface PlayerFactionState {
  availableFP: number;           // unassigned FP
  alsusFP: number;               // FP assigned to Alsus (total spent + unspent)
  atroxFP: number;               // FP assigned to Atrox (total spent + unspent)
  alsusUnspentFP: number;        // FP assigned to Alsus but not yet used on perks
  atroxUnspentFP: number;        // FP assigned to Atrox but not yet used on perks
  perks: Record<string, FactionPerkNode>; // key by node id
}

type FortressBuilding = {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  description: string; // e.g., "+400 Fort HP"
  getEffect: (level: number) => { fortHP?: number; archerSlots?: number; garrisonWarriors?: number; garrisonArchers?: number; storedSquads?: number };
  getUpgradeCost: (level: number) => { wood: number; stone: number };
};

type FortressStats = {
  fortHP: number;
  archerSlots: number;
  garrisonWarriors: number;
  garrisonArchers: number;
  storedSquads: number;
};

type SiegeRound = {
  round: number;
  fortHP: number;
  attackers: number;
  archers: number;
  killed: number;
  dmgToFort: number;
};

type InnerBattleStep = {
  step: number;
  phase: 'skirmish' | 'melee' | 'pursuit';
  defWarriors: number;
  defArchers: number;
  defenders: number;
  attackers: number;
  killedAttackers: number;
  killedDefenders: number;
};

type SiegeBattleResult = {
  outcome: 'fortress_holds_walls' | 'fortress_holds_inner' | 'fortress_falls' | 'stalemate';
  siegeRounds: number;
  finalFortHP: number;
  finalAttackers: number;
  finalDefenders: number;
  siegeTimeline: SiegeRound[];
  innerTimeline: InnerBattleStep[];
  initialFortHP: number;
  initialAttackers: number;
  initialGarrison: { warriors: number; archers: number };
  finalGarrison: { warriors: number; archers: number };
};

type Expedition = {
  expeditionId: string;
  title: string;
  shortSummary: string;
  description: string;
  state: ExpeditionState;
  requirements: {
    wood: { required: number; current: number };
    stone: { required: number; current: number };
    food: { required: number; current: number };
    population: { required: number; current: number };
  };
  travelProgress: number; // 0-100 for travelling state
  fortress?: {
    buildings: FortressBuilding[];
    stats: FortressStats;
    garrison: number[]; // Array of banner IDs stationed in the fortress
    lastBattle?: SiegeBattleResult; // Last siege battle result
  };
};

type BattleResult = {
  winner: 'player' | 'enemy' | 'draw';
  ticks: number;
  playerInitial: { warrior: number; archer: number; total: number };
  playerFinal: { warrior: number; archer: number; total: number; morale: number };
  enemyInitial: { warrior: number; archer: number; total: number };
  enemyFinal: { warrior: number; archer: number; total: number; morale: number };
  timeline: Array<{
    tick: number;
    phase: string;
    A_troops: number;
    B_troops: number;
    A_morale: number;
    B_morale: number;
    AtoB: number;
    BtoA: number;
  }>;
};

type BuildingCategory = 'always_available' | 'town_hall_gated';
type TownHallLevel = 1 | 2 | 3;

interface TownHallState {
  level: TownHallLevel;
}

// Training entry types
type TrainingEntryType = 'mercenary' | 'reinforcement';

interface TrainingEntry {
  id: number;
  type: TrainingEntryType;
  // For mercenary entries
  templateId?: string;
  arrivalTime?: number; // Time in seconds for arrival
  elapsedTime: number;
  status: 'arriving' | 'training';
  // For reinforcement entries
  bannerId?: number;
  squadId?: number;
  soldiersNeeded: number; // Total soldiers needed
  soldiersTrained: number; // Soldiers trained so far
}

interface BarracksState {
  level: number;
  trainingSlots: number;
  maxTemplates: number;
  trainingQueue: TrainingEntry[];
}

interface TavernState {
  level: number;
  activeFestival: boolean;
  festivalEndTime: number;
}

interface MilitaryAcademyState {
  level: number;
}

type CommanderArchetype = "ranged_specialist" | "melee_specialist" | "balanced_leader";

interface Commander {
  id: number;
  name: string;
  archetype: CommanderArchetype;
  rangedAttackBonusPercent: number;
  meleeAttackBonusPercent: number;
  assignedBannerId: number | null;
  // Leveling system
  level: number; // 1-99
  currentXP: number;
  xpToNextLevel: number;
}

// Commander archetype configurations
const COMMANDER_ARCHETYPES: Record<CommanderArchetype, { rangedBonus: number; meleeBonus: number; label: string; description: string }> = {
  ranged_specialist: {
    rangedBonus: 20,
    meleeBonus: 5,
    label: "Ranged Specialist",
    description: "Expert in archery and ranged warfare"
  },
  melee_specialist: {
    rangedBonus: 5,
    meleeBonus: 20,
    label: "Melee Specialist",
    description: "Master of close combat and melee tactics"
  },
  balanced_leader: {
    rangedBonus: 10,
    meleeBonus: 10,
    label: "Balanced Leader",
    description: "Versatile commander skilled in all combat"
  }
};

interface BannerTemplate {
  id: string;
  name: string;
  squads: Array<{ type: 'archer' | 'warrior'; count: number }>; // count = number of squads
  upkeepPerSecond: number;
  requiredPopulation: number;
  cost: number; // Gold cost
}

// House upgrade costs: Lvl 2 = 130W/110S, then +30% per level rounded up
function getHouseCost(levelTo: number) {
  if (levelTo === 2) {
    return { wood: 130, stone: 110 };
  }
  const base = { wood: 130, stone: 110 };
  const factor = Math.pow(1.3, levelTo - 2);
  return {
    wood: Math.ceil(base.wood * factor),
    stone: Math.ceil(base.stone * factor),
  };
}

function getHouseCapacity(level: number) {
  return 5 * level; // +5 capacity per level
}

// Town Hall upgrade costs
function getTownHallCost(levelTo: number) {
  if (levelTo === 2) {
    return { wood: 200, stone: 150 };
  }
  if (levelTo === 3) {
    return { wood: 300, stone: 250 };
  }
  return { wood: 0, stone: 0 };
}

// Barracks upgrade costs (30% increase per level)
function getBarracksCost(levelTo: number) {
  const base = { wood: 150, stone: 100 };
  const factor = Math.pow(1.3, levelTo - 1);
  return {
    wood: Math.ceil(base.wood * factor),
    stone: Math.ceil(base.stone * factor),
  };
}

// Military Academy upgrade costs (exactly 2x Barracks cost)
function getMilitaryAcademyCost(levelTo: number) {
  const barracksCost = getBarracksCost(levelTo);
  return {
    wood: barracksCost.wood * 2,
    stone: barracksCost.stone * 2,
  };
}

function getMilitaryAcademyBuildCost() {
  return getMilitaryAcademyCost(1);
}

function canBuildMilitaryAcademy(townHallLevel: TownHallLevel): boolean {
  return townHallLevel >= 2;
}

// Tavern upgrade costs (30% increase per level)
function getTavernCost(levelTo: number) {
  const base = { wood: 120, stone: 80 };
  const factor = Math.pow(1.3, levelTo - 1);
  return {
    wood: Math.ceil(base.wood * factor),
    stone: Math.ceil(base.stone * factor),
  };
}

// Building unlock requirements
function canBuildBarracks(townHallLevel: TownHallLevel): boolean {
  return townHallLevel >= 2;
}

function canBuildTavern(townHallLevel: TownHallLevel): boolean {
  return townHallLevel >= 2;
}

// Get max training slots based on barracks level
function getMaxTrainingSlots(barracksLevel: number): number {
  // Level 1: 1 slot, Level 2: 2 slots, Level 3: 3 slots
  return Math.min(barracksLevel, 3);
}

// Anchored Unit Picker Component
const AnchoredUnitPicker = ({
  isOpen,
  onClose,
  anchorRect,
  onSelectUnit,
  warehouse,
  currentUnitType
}: {
  isOpen: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  onSelectUnit: (unitType: UnitType) => void;
  warehouse: WarehouseState;
  currentUnitType?: UnitType;
}) => {
  const [selectedCategory, setSelectedCategory] = useState<UnitCategory>('infantry');
  const pickerRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobileDetection();

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Calculate position
  const positionStyle: React.CSSProperties = useMemo(() => {
    if (!anchorRect) return {};

    const PADDING = 12;
    const WIDTH = isMobile ? Math.min(window.innerWidth - (PADDING * 2), 340) : 340;
    const HEIGHT = isMobile ? 360 : 400; // Expected max height

    let top = anchorRect.bottom + 8;
    let left = anchorRect.left;

    // Center on mobile if it exceeds width
    if (isMobile) {
      left = (window.innerWidth - WIDTH) / 2;
    } else {
      // Desktop positioning
      if (left + WIDTH > window.innerWidth) {
        left = window.innerWidth - WIDTH - PADDING;
      }
      if (left < PADDING) {
        left = PADDING;
      }
    }

    // Flip vertically if too close to bottom
    if (top + HEIGHT > window.innerHeight) {
      top = anchorRect.top - HEIGHT - 8;
    }

    // Ensure it stays within viewport height
    top = Math.max(PADDING, Math.min(top, window.innerHeight - HEIGHT - PADDING));

    return {
      top: `${top + window.scrollY}px`,
      left: `${left + window.scrollX}px`,
      width: `${WIDTH}px`,
      position: 'absolute',
      zIndex: 60
    };
  }, [anchorRect, isMobile]);

  if (!isOpen || !anchorRect) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-50 transition-opacity animate-in fade-in duration-300" onClick={onClose} />

      <div
        ref={pickerRef}
        style={positionStyle}
        className={`max-h-[400px] flex flex-col bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-200`}
      >
        {/* Header */}
        <div className="flex flex-col gap-0.5 p-4 pb-3">
          <span className="text-[9px] font-black text-pink-500 uppercase tracking-[0.2em] leading-none">Deployment</span>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white uppercase tracking-tight">Select Unit Class</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors border border-slate-700/50"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Category Tabs - AAA Style */}
        <div className="flex px-4 gap-1 mb-2 border-b border-slate-800/50 pb-2">
          {(['infantry', 'ranged_infantry', 'cavalry'] as UnitCategory[]).map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${selectedCategory === cat
                ? 'text-pink-500 bg-pink-500/5'
                : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              {cat === 'infantry' ? 'Infantry' : cat === 'ranged_infantry' ? 'Ranged' : 'Cavalry'}
            </button>
          ))}
        </div>

        {/* Unit List - 2 Columns with h-14 rows to match banner slots */}
        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2.5 custom-scrollbar max-h-[280px]">
          {Object.entries(unitCategory)
            .filter(([_, cat]) => cat === selectedCategory)
            .map(([type, _]) => {
              const uType = type as UnitType;
              const cost = ironCostPerSquad[uType];
              const canAfford = warehouse.iron >= cost;
              const isSelected = currentUnitType === uType;

              return (
                <button
                  key={uType}
                  onClick={() => canAfford && onSelectUnit(uType)}
                  disabled={!canAfford}
                  className={`relative h-14 px-3 py-2 rounded-2xl border-2 transition-all flex items-center gap-3 ${isSelected
                    ? 'bg-emerald-500/5 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                    : canAfford
                      ? 'bg-slate-800/40 border-slate-800 hover:border-slate-700 active:scale-95'
                      : 'bg-slate-950/40 border-slate-900/50 opacity-40 grayscale'
                    }`}
                >
                  <span className={`text-2xl shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {unitCategory[uType] === 'ranged_infantry' ? '🏹' : unitCategory[uType] === 'cavalry' ? '🐴' : '⚔️'}
                  </span>

                  <div className="flex flex-col items-start min-w-0 overflow-hidden leading-tight">
                    <span className="text-[10px] font-black text-white uppercase truncate w-full">
                      {unitDisplayNames[uType]}
                    </span>
                    <span className={`text-[9px] font-bold ${cost === 0 ? 'text-emerald-500/60' : canAfford ? 'text-slate-500' : 'text-red-500/60'}`}>
                      {cost === 0 ? 'FREE' : `${cost} Iron`}
                    </span>
                  </div>

                  {isSelected && (
                    <div className="absolute top-1 right-1">
                      <span className="px-1 py-0.5 bg-emerald-500 text-white text-[6px] font-black uppercase rounded-[4px] tracking-tighter shadow-sm pulse-subtle">Active</span>
                    </div>
                  )}

                  {!canAfford && cost > 0 && !isSelected && (
                    <div className="absolute top-1 right-1">
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      </div>
    </>
  );
};




// === Squad Health and Loss Distribution System ===
type SquadHealthState = 'healthy' | 'yellow' | 'orange' | 'red' | 'destroyed';

function getSquadHealthState(currentSize: number, maxSize: number): SquadHealthState {
  if (currentSize === 0) return 'destroyed';
  if (currentSize === maxSize) return 'healthy';
  const ratio = currentSize / maxSize;
  if (ratio >= 0.7) return 'yellow'; // 7-9
  if (ratio >= 0.4) return 'orange'; // 4-6
  return 'red'; // 1-3
}

function getSquadColorClass(health: SquadHealthState): string {
  switch (health) {
    case 'healthy': return 'bg-slate-800 border-slate-700 text-slate-300';
    case 'yellow': return 'bg-yellow-900/30 border-yellow-600 text-yellow-300';
    case 'orange': return 'bg-orange-900/30 border-orange-600 text-orange-300';
    case 'red': return 'bg-red-900/30 border-red-600 text-red-300';
    case 'destroyed': return 'bg-red-950/50 border-red-800 text-red-400 opacity-60';
    default: return 'bg-slate-800 border-slate-700';
  }
}

// Initialize squads from units array (for backward compatibility)
function initializeSquadsFromUnits(units: string[], squadSeq: number, startEmpty: boolean = false): { squads: Squad[]; nextSeq: number } {
  const squads: Squad[] = [];
  let seq = squadSeq;
  units.forEach((unit, idx) => {
    const unitType = unit as UnitType;
    const category = unitCategory[unitType] || 'infantry';
    const config = squadConfig[category];
    squads.push({
      id: seq++,
      type: unitType,
      maxSize: config.maxSize,
      currentSize: startEmpty ? 0 : config.maxSize,
      slotIndex: idx
    });
  });
  return { squads, nextSeq: seq };
}

// Distribute losses across all squads in a banner
function distributeLossesToBanner(banner: Banner, totalLosses: number): Banner {
  if (totalLosses <= 0 || banner.squads.length === 0) return banner;

  const squads = banner.squads.map(s => ({ ...s })); // Deep copy
  let remainingLosses = totalLosses;

  // Calculate total current size
  const totalCurrentSize = squads.reduce((sum, s) => sum + s.currentSize, 0);

  // If losses >= total size, destroy all squads
  if (remainingLosses >= totalCurrentSize) {
    return {
      ...banner,
      squads: squads.map(s => ({ ...s, currentSize: 0 }))
    };
  }

  // Soft cap: 33% of total losses per squad
  const softCap = Math.max(1, Math.floor(totalLosses * 0.33));

  // First pass: apply 1 loss to each squad (if possible)
  const availableSquads = squads.filter(s => s.currentSize > 0);
  const firstPassLosses = Math.min(availableSquads.length, remainingLosses);

  for (let i = 0; i < firstPassLosses; i++) {
    if (availableSquads[i].currentSize > 0) {
      availableSquads[i].currentSize = Math.max(0, availableSquads[i].currentSize - 1);
      remainingLosses--;
    }
  }

  // Second pass: randomly distribute remaining losses
  while (remainingLosses > 0) {
    // Find squads that can take more losses (not at 0, not over soft cap)
    const eligibleSquads = squads.filter(s => {
      const lossesTaken = s.maxSize - s.currentSize;
      return s.currentSize > 0 && lossesTaken < softCap;
    });

    if (eligibleSquads.length === 0) {
      // All squads are at soft cap or destroyed, distribute to any remaining
      const remainingSquads = squads.filter(s => s.currentSize > 0);
      if (remainingSquads.length === 0) break;
      const randomSquad = remainingSquads[Math.floor(Math.random() * remainingSquads.length)];
      randomSquad.currentSize = Math.max(0, randomSquad.currentSize - 1);
      remainingLosses--;
    } else {
      // Randomly pick from eligible squads
      const randomSquad = eligibleSquads[Math.floor(Math.random() * eligibleSquads.length)];
      randomSquad.currentSize = Math.max(0, randomSquad.currentSize - 1);
      remainingLosses--;
    }
  }

  const finalSquads = squads;
  const newRecruited = finalSquads.reduce((sum, s) => sum + s.currentSize, 0);

  return {
    ...banner,
    squads: finalSquads,
    recruited: newRecruited
  };
}

// Calculate total losses for a banner from battle result
function calculateBannerLosses(
  _banner: Banner,
  battleResult: BattleResult
): number {
  const initialTotal = battleResult.playerInitial.total;
  const finalTotal = battleResult.playerFinal.total;
  return Math.max(0, Math.floor(initialTotal - finalTotal));
}

type LossEntry = { bannerId: number; count: number };

function distributeTypeLossesAcrossBanners(entries: LossEntry[], totalLosses: number): Map<number, number> {
  const allocation = new Map<number, number>();
  const roundedLosses = Math.round(totalLosses);
  if (roundedLosses <= 0 || entries.length === 0) return allocation;

  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  if (total <= 0) return allocation;

  const safeLosses = Math.min(roundedLosses, total);
  let allocated = 0;
  const fractionalShares: Array<{ bannerId: number; capacity: number; fractional: number }> = [];

  entries.forEach(entry => {
    const exactShare = (entry.count / total) * safeLosses;
    const baseLoss = Math.min(entry.count, Math.floor(exactShare));
    allocation.set(entry.bannerId, baseLoss);
    allocated += baseLoss;
    fractionalShares.push({
      bannerId: entry.bannerId,
      capacity: entry.count,
      fractional: exactShare - Math.floor(exactShare),
    });
  });

  let remaining = safeLosses - allocated;
  fractionalShares
    .sort((a, b) => b.fractional - a.fractional)
    .forEach(entry => {
      if (remaining <= 0) return;
      const current = allocation.get(entry.bannerId) || 0;
      if (current < entry.capacity) {
        allocation.set(entry.bannerId, current + 1);
        remaining--;
      }
    });

  return allocation;
}

function trimSquadsByType(squads: Squad[], type: UnitType, losses: number) {
  let remaining = Math.round(losses);
  if (remaining <= 0) return;

  const targets = squads.filter(s => s.type === type);
  if (targets.length === 0) return;

  while (remaining > 0) {
    let appliedThisCycle = false;
    for (const squad of targets) {
      if (remaining <= 0) break;
      if (squad.currentSize > 0) {
        squad.currentSize = Math.max(0, squad.currentSize - 1);
        remaining--;
        appliedThisCycle = true;
      }
    }
    if (!appliedThisCycle) break;
  }
}

// Distribute losses from a Division to squads by type
function distributeDivisionLossesToSquads(squads: Squad[], losses: Division) {
  for (const unitType in losses) {
    const typeLosses = losses[unitType as UnitType] || 0;
    if (typeLosses > 0) {
      trimSquadsByType(squads, unitType as UnitType, typeLosses);
    }
  }
}

// Initial building costs
function getBarracksBuildCost() {
  return { wood: 150, stone: 100 };
}

function getTavernBuildCost() {
  return { wood: 120, stone: 80 };
}

// Battle Chart Component
function BattleChart({ timeline }: { timeline: BattleResult['timeline'] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: Array<{ label: string; value: number; color: string }>;
    tick: number;
  } | null>(null);
  const [hoveredTick, setHoveredTick] = useState<number | null>(null);
  const graphDataRef = useRef<{
    sx: (x: number) => number;
    syT: (y: number) => number;
    syM: (y: number) => number;
    W: number;
    H: number;
    tMin: number;
    tMax: number;
    mMin: number;
    mMax: number;
    A_morale: number[];
    B_morale: number[];
    A_troops: number[];
    B_troops: number[];
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !timeline.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = canvas.clientHeight * 2;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(48, 10);
    const W = w - 76;
    const H = h - 40;

    const N = timeline.length || 1;
    const sx = (x: number) => (x - 1) / (N - 1 || 1) * W;

    const troopsAll = [...timeline.map(t => t.A_troops), ...timeline.map(t => t.B_troops)].filter(Number.isFinite);
    const moraleAll = [...timeline.map(t => t.A_morale), ...timeline.map(t => t.B_morale)].filter(Number.isFinite);
    const tMin = Math.min(...troopsAll, 0);
    const tMax = Math.max(...troopsAll, 1);
    const mMin = Math.min(...moraleAll, 0);
    const mMax = Math.max(...moraleAll, 1);
    const syT = (y: number) => H - (y - tMin) / (tMax - tMin || 1) * H;
    const syM = (y: number) => H - (y - mMin) / (mMax - mMin || 1) * H;

    // Store graph data for tooltip calculations
    const A_morale = timeline.map(r => r.A_morale);
    const B_morale = timeline.map(r => r.B_morale);
    const A_troops = timeline.map(r => r.A_troops);
    const B_troops = timeline.map(r => r.B_troops);

    graphDataRef.current = {
      sx, syT, syM, W, H, tMin, tMax, mMin, mMax,
      A_morale, B_morale, A_troops, B_troops
    };

    // Background
    ctx.fillStyle = '#0f141b';
    ctx.fillRect(0, 0, W, H);

    // Phase bands
    if (timeline.length) {
      const bands: Array<{ ph: string; s: number; e: number }> = [];
      let s = 0;
      let cur = timeline[0].phase;
      for (let i = 1; i < timeline.length; i++) {
        if (timeline[i].phase !== cur) {
          bands.push({ ph: cur, s: s + 1, e: i });
          s = i;
          cur = timeline[i].phase;
        }
      }
      bands.push({ ph: cur, s: s + 1, e: timeline.length });

      for (const b of bands) {
        const x0 = sx(b.s);
        const x1 = sx(b.e);
        let c = 'rgba(154,163,178,0.14)';
        if (b.ph === 'skirmish') c = 'rgba(45,156,255,0.16)';
        else if (b.ph === 'pursuit') c = 'rgba(255,93,93,0.16)';
        ctx.fillStyle = c;
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
        ctx.fillStyle = '#cfd6e1';
        ctx.font = 'bold 16px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(b.ph.charAt(0).toUpperCase() + b.ph.slice(1), x0 + (x1 - x0) / 2, 6);
      }
    }

    // Grid
    ctx.strokeStyle = '#202733';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = i * (H / 5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const x = i * (W / 10);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.strokeStyle = '#2c3545';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, W, H);

    // Y labels
    ctx.fillStyle = '#a7b0bd';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = tMin + (tMax - tMin) * i / 4;
      const y = syT(v);
      ctx.fillText(Math.round(v).toString(), -6, y);
    }
    ctx.fillText('Troops', -6, -6);
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const v = mMin + (mMax - mMin) * i / 4;
      const y = syM(v);
      ctx.fillText(Math.round(v).toString(), W + 6, y);
    }
    ctx.fillText('Morale', W + 6, -6);

    // Lines
    const draw = (arr: number[], sy: (y: number) => number, col: string) => {
      if (!arr.length) return;
      ctx.beginPath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.moveTo(sx(1), sy(arr[0]));
      for (let i = 1; i < arr.length; i++) {
        ctx.lineTo(sx(i + 1), sy(arr[i]));
      }
      ctx.stroke();
    };

    draw(A_morale, syM, '#6fb3ff');
    draw(B_morale, syM, '#ff8c00'); // Enemy morale: Orange
    draw(A_troops, syT, '#2d9cff');
    draw(B_troops, syT, '#ff5d5d');

    // Draw vertical guideline at hovered tick
    if (hoveredTick !== null && hoveredTick >= 1 && hoveredTick <= timeline.length) {
      const guidelineX = sx(hoveredTick);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(guidelineX, 0);
      ctx.lineTo(guidelineX, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [timeline, hoveredTick]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const data = graphDataRef.current;
    if (!canvas || !container || !data || !timeline.length) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Account for canvas translation (48, 10)
    const mouseX = (e.clientX - rect.left) * scaleX - 48;
    const mouseY = (e.clientY - rect.top) * scaleY - 10;

    // Find closest data point
    let closestTick = 1;
    let minDist = Infinity;

    for (let i = 0; i < timeline.length; i++) {
      const tick = i + 1;
      const x = data.sx(tick);
      const dist = Math.abs(mouseX - x);
      if (dist < minDist) {
        minDist = dist;
        closestTick = tick;
      }
    }

    // Only show tooltip if close enough (within 30 pixels)
    if (minDist < 30 && mouseX >= 0 && mouseX <= data.W && mouseY >= 0 && mouseY <= data.H) {
      const index = closestTick - 1;
      const tooltipData: Array<{ label: string; value: number; color: string }> = [];

      if (index >= 0 && index < timeline.length) {
        tooltipData.push({
          label: 'Player Morale',
          value: data.A_morale[index],
          color: '#6fb3ff'
        });
        tooltipData.push({
          label: 'Enemy Morale',
          value: data.B_morale[index],
          color: '#ff8c00'
        });
        tooltipData.push({
          label: 'Player Troops',
          value: data.A_troops[index],
          color: '#2d9cff'
        });
        tooltipData.push({
          label: 'Enemy Troops',
          value: data.B_troops[index],
          color: '#ff5d5d'
        });
      }

      setHoveredTick(closestTick);
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        data: tooltipData,
        tick: closestTick
      });
    } else {
      setHoveredTick(null);
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredTick(null);
    setTooltip(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-[300px] bg-[#0b0e12] border border-slate-700 rounded-lg cursor-crosshair"
        style={{ imageRendering: 'pixelated' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && tooltip.visible && (
        <div
          className="absolute pointer-events-none z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-2 text-xs"
          style={{
            left: `${tooltip.x + 10}px`,
            top: `${tooltip.y - 10}px`,
            transform: 'translateY(-100%)'
          }}
        >
          <div className="font-semibold text-slate-300 mb-1">Tick {tooltip.tick}</div>
          {tooltip.data.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }}></div>
              <span className="text-slate-400">{item.label}:</span>
              <span className="text-white font-semibold">{item.value.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Graph drawing functions (defined outside component for reuse)
function drawSiegeGraph(canvas: HTMLCanvasElement, timeline: SiegeRound[], fortHPmax: number, graphDataRef?: React.MutableRefObject<any>, hoveredRound?: number | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, w, h);
  if (!timeline.length) return;

  const maxAttackers = Math.max(...timeline.map(r => r.attackers), 1);
  const rounds = timeline[timeline.length - 1].round;

  const mapX = (t: number) => (t / rounds) * (w - 40) + 20;
  const mapY = (v: number, max: number) => h - 20 - (v / max) * (h - 40);

  // Store graph data for tooltip calculations
  if (graphDataRef) {
    graphDataRef.current = {
      mapX,
      mapY,
      w,
      h,
      fortHPmax,
      maxAttackers,
      rounds,
      fortHP: timeline.map(r => r.fortHP),
      attackers: timeline.map(r => r.attackers),
      timeline
    };
  }

  // Draw axes
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 10);
  ctx.lineTo(20, h - 20);
  ctx.lineTo(w - 10, h - 20);
  ctx.stroke();

  // Draw lines
  function drawLine(values: number[], max: number, colour: string) {
    if (!ctx) return;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const t = timeline[i].round;
      const x = mapX(t);
      const y = mapY(v, max);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawLine(timeline.map(r => r.fortHP), fortHPmax, '#2d9cff');
  drawLine(timeline.map(r => r.attackers), maxAttackers, '#ff5d5d');

  // Draw vertical guideline at hovered round
  if (hoveredRound !== null && hoveredRound !== undefined && ctx) {
    const guidelineX = mapX(hoveredRound);
    if (guidelineX >= 20 && guidelineX <= w - 10) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(guidelineX, 10);
      ctx.lineTo(guidelineX, h - 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawInnerBattleGraph(canvas: HTMLCanvasElement, timeline: InnerBattleStep[], graphDataRef?: React.MutableRefObject<any>, hoveredStep?: number | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, w, h);
  if (!timeline.length) return;

  const maxDef = Math.max(...timeline.map(r => r.defenders), 1);
  const maxAtk = Math.max(...timeline.map(r => r.attackers), 1);
  const steps = timeline[timeline.length - 1].step;

  const mapX = (t: number) => (t / steps) * (w - 40) + 20;
  const mapY = (v: number, max: number) => h - 20 - (v / max) * (h - 40);

  // Store graph data for tooltip calculations
  if (graphDataRef) {
    graphDataRef.current = {
      mapX,
      mapY,
      w,
      h,
      maxDef,
      maxAtk,
      steps,
      defenders: timeline.map(r => r.defenders),
      attackers: timeline.map(r => r.attackers),
      timeline
    };
  }

  // Draw axes
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 10);
  ctx.lineTo(20, h - 20);
  ctx.lineTo(w - 10, h - 20);
  ctx.stroke();

  // Draw lines
  function drawLine(values: number[], max: number, colour: string) {
    if (!ctx) return;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const t = timeline[i].step;
      const x = mapX(t);
      const y = mapY(v, max);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawLine(timeline.map(r => r.defenders), maxDef, '#2d9cff');
  drawLine(timeline.map(r => r.attackers), maxAtk, '#ff5d5d');

  // Draw vertical guideline at hovered step
  if (hoveredStep !== null && hoveredStep !== undefined) {
    const guidelineX = mapX(hoveredStep);
    if (guidelineX >= 20 && guidelineX <= w - 10) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(guidelineX, 10);
      ctx.lineTo(guidelineX, h - 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// Graph canvas components
function SiegeGraphCanvas({ timeline, fortHPmax }: { timeline: SiegeRound[]; fortHPmax: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphDataRef = useRef<any>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: Array<{ label: string; value: number; color: string }>;
    round: number;
  } | null>(null);
  const [hoveredRound, setHoveredRound] = useState<number | null>(null);

  useEffect(() => {
    if (canvasRef.current && timeline.length > 0) {
      // Small delay to ensure canvas is properly sized
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawSiegeGraph(canvasRef.current, timeline, fortHPmax, graphDataRef, hoveredRound);
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [timeline, fortHPmax, hoveredRound]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const data = graphDataRef.current;
    if (!canvas || !container || !data || !timeline.length) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Find closest data point
    let closestIndex = 0;
    let minDist = Infinity;

    for (let i = 0; i < timeline.length; i++) {
      const round = timeline[i].round;
      const x = data.mapX(round);
      const dist = Math.abs(mouseX - x);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }

    // Only show tooltip if close enough (within 30 pixels) and within bounds
    if (minDist < 30 && mouseX >= 20 && mouseX <= data.w - 10 && mouseY >= 10 && mouseY <= data.h - 20) {
      const tooltipData: Array<{ label: string; value: number; color: string }> = [];

      if (closestIndex >= 0 && closestIndex < timeline.length) {
        tooltipData.push({
          label: 'Fort HP',
          value: data.fortHP[closestIndex],
          color: '#2d9cff'
        });
        tooltipData.push({
          label: 'Remaining Attackers',
          value: data.attackers[closestIndex],
          color: '#ff5d5d'
        });
      }

      setHoveredRound(timeline[closestIndex].round);
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        data: tooltipData,
        round: timeline[closestIndex].round
      });
    } else {
      setHoveredRound(null);
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredRound(null);
    setTooltip(null);
  };

  if (timeline.length === 0) return null;

  return (
    <details className="mt-3 pt-3 border-t border-slate-700">
      <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
        Siege Graph
      </summary>
      <div ref={containerRef} className="mt-2 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-[220px] bg-slate-950 border border-slate-700 rounded-lg cursor-crosshair"
          style={{ imageRendering: 'crisp-edges' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {tooltip && tooltip.visible && (
          <div
            className="absolute pointer-events-none z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-2 text-xs"
            style={{
              left: `${tooltip.x + 10}px`,
              top: `${tooltip.y - 10}px`,
              transform: 'translateY(-100%)'
            }}
          >
            <div className="font-semibold text-slate-300 mb-1">Round {tooltip.round}</div>
            {tooltip.data.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }}></div>
                <span className="text-slate-400">{item.label}:</span>
                <span className="text-white font-semibold">{item.value.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-slate-400 mt-1">
          Blue line = Fort HP. Red line = remaining attackers.
        </div>
      </div>
    </details>
  );
}

function InnerBattleGraphCanvas({ timeline }: { timeline: InnerBattleStep[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphDataRef = useRef<any>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: Array<{ label: string; value: number; color: string }>;
    step: number;
  } | null>(null);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  useEffect(() => {
    if (canvasRef.current && timeline.length > 0) {
      // Small delay to ensure canvas is properly sized
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawInnerBattleGraph(canvasRef.current, timeline, graphDataRef, hoveredStep);
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [timeline, hoveredStep]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const data = graphDataRef.current;
    if (!canvas || !container || !data || !timeline.length) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Find closest data point
    let closestIndex = 0;
    let minDist = Infinity;

    for (let i = 0; i < timeline.length; i++) {
      const step = timeline[i].step;
      const x = data.mapX(step);
      const dist = Math.abs(mouseX - x);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }

    // Only show tooltip if close enough (within 30 pixels) and within bounds
    if (minDist < 30 && mouseX >= 20 && mouseX <= data.w - 10 && mouseY >= 10 && mouseY <= data.h - 20) {
      const tooltipData: Array<{ label: string; value: number; color: string }> = [];

      if (closestIndex >= 0 && closestIndex < timeline.length) {
        tooltipData.push({
          label: 'Inner Defenders',
          value: data.defenders[closestIndex],
          color: '#2d9cff'
        });
        tooltipData.push({
          label: 'Inner Attackers',
          value: data.attackers[closestIndex],
          color: '#ff5d5d'
        });
      }

      setHoveredStep(timeline[closestIndex].step);
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        data: tooltipData,
        step: timeline[closestIndex].step
      });
    } else {
      setHoveredStep(null);
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredStep(null);
    setTooltip(null);
  };

  if (timeline.length === 0) return null;

  return (
    <details className="mt-3 pt-3 border-t border-slate-700">
      <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
        Inner Battle Graph
      </summary>
      <div ref={containerRef} className="mt-2 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-[220px] bg-slate-950 border border-slate-700 rounded-lg cursor-crosshair"
          style={{ imageRendering: 'crisp-edges' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {tooltip && tooltip.visible && (
          <div
            className="absolute pointer-events-none z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-2 text-xs"
            style={{
              left: `${tooltip.x + 10}px`,
              top: `${tooltip.y - 10}px`,
              transform: 'translateY(-100%)'
            }}
          >
            <div className="font-semibold text-slate-300 mb-1">Step {tooltip.step}</div>
            {tooltip.data.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }}></div>
                <span className="text-slate-400">{item.label}:</span>
                <span className="text-white font-semibold">{item.value.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-slate-400 mt-1">
          Blue line = inner defenders. Red line = inner attackers. Phases: skirmish → melee → pursuit
        </div>
      </div>
    </details>
  );
}

// ============================================================================
// Banner Auto-Naming Functions
// ============================================================================

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getBannerRole(squads: Squad[]): string {
  if (squads.length === 0) return 'Mixed';

  const warriorCount = squads.filter(s => s.type === 'warrior').length;
  const archerCount = squads.filter(s => s.type === 'archer').length;
  const total = squads.length;

  const warriorPercent = (warriorCount / total) * 100;
  const archerPercent = (archerCount / total) * 100;

  if (warriorPercent >= 60) return 'Warrior';
  if (archerPercent >= 60) return 'Archer';
  return 'Mixed';
}

function getBannerComposition(squads: Squad[]): string {
  if (squads.length === 0) return '';

  // Count squads by type
  const counts: Record<string, number> = {};
  squads.forEach(squad => {
    const typeName = unitDisplayNames[squad.type] || squad.type;
    counts[typeName] = (counts[typeName] || 0) + 1;
  });

  // Sort by count (highest first), then by name
  const entries = Object.entries(counts)
    .filter(([_, count]) => count > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]; // Higher count first
      return a[0].localeCompare(b[0]); // Alphabetical if same count
    });

  return entries.map(([type, count]) => `${count} ${type}`).join(', ');
}

// Commander name generation
const COMMANDER_FIRST_NAMES = [
  "Aldren", "Bartholomew", "Cedric", "Darius", "Eldric", "Finnian", "Gareth", "Hector",
  "Ivan", "Jareth", "Kael", "Lucian", "Marcus", "Nathaniel", "Orion", "Percival",
  "Quinn", "Roderick", "Sylas", "Theron", "Ulric", "Valen", "Wesley", "Xander",
  "Yorick", "Zephyr"
];

const COMMANDER_TITLES = [
  "Sir", "Lord", "Captain", "Commander", "General", "Marshal", "Duke", "Baron"
];

function generateCommanderName(archetype: CommanderArchetype): string {
  const firstName = COMMANDER_FIRST_NAMES[Math.floor(Math.random() * COMMANDER_FIRST_NAMES.length)];
  const title = COMMANDER_TITLES[Math.floor(Math.random() * COMMANDER_TITLES.length)];
  return `${title} ${firstName}`;
}

function generateBannerName(bannerId: number, squads: Squad[]): string {
  const ordinal = getOrdinal(bannerId);
  const role = getBannerRole(squads);
  const composition = getBannerComposition(squads);

  return `${ordinal} ${role} Banner${composition ? ` (${composition})` : ''}`;
}

export default function ResourceVillageUI() {
  // === Warehouse (resources + level) ===
  const [warehouse, setWarehouse] = useState<WarehouseState>({ wood: 0, stone: 0, food: 0, iron: 0, gold: 0 });
  const [warehouseLevel, setWarehouseLevel] = useState(1);
  const [skillPoints, setSkillPoints] = useState(0);

  const warehouseCap = useMemo<WarehouseCap>(() => ({
    wood: getWarehouseCapacity(warehouseLevel),
    stone: getWarehouseCapacity(warehouseLevel),
    food: getWarehouseCapacity(warehouseLevel),
    iron: getWarehouseCapacity(warehouseLevel),
    gold: getWarehouseCapacity(warehouseLevel),
  }), [warehouseLevel]);

  // === Buildings ===
  const [lumberMill, setLumberMill] = useState({ level: 1, stored: 0, enabled: true, workers: 1 });
  const [quarry, setQuarry] = useState({ level: 1, stored: 0, enabled: true, workers: 1 });
  const [farm, setFarm] = useState({ level: 1, stored: 0, enabled: true, workers: 1 });
  const [ironMine, setIronMine] = useState({ level: 1, stored: 0, enabled: true, workers: 1 });
  const [house, setHouse] = useState(1); // House level (0 workers required, +5 cap per level)

  // === New Buildings ===
  const [townHall, setTownHall] = useState<TownHallState>({ level: 1 });
  const [barracks, setBarracks] = useState<BarracksState | null>(null);
  const [tavern, setTavern] = useState<TavernState | null>(null);
  const [militaryAcademy, setMilitaryAcademy] = useState<MilitaryAcademyState | null>(null);
  const [commanders, setCommanders] = useState<Commander[]>([]);

  // === Happiness System ===
  const [happiness, setHappiness] = useState(50); // Base 50

  // === Iron Consumption Feedback ===
  const [ironConsumptionFeedback, setIronConsumptionFeedback] = useState<{ message: string; timestamp: number } | null>(null);

  // === Banner Templates ===
  const [bannerTemplates, setBannerTemplates] = useState<BannerTemplate[]>([
    { id: 'spearmen', name: 'Bloody Warriors', squads: [{ type: 'warrior', count: 8 }], upkeepPerSecond: 0, requiredPopulation: 80, cost: 50 }, // 8 squads * 10 pop = 80
    { id: 'archers', name: 'Archers', squads: [{ type: 'archer', count: 8 }], upkeepPerSecond: 0, requiredPopulation: 80, cost: 50 }, // 8 squads * 10 pop = 80
    { id: 'mixed', name: 'Mixed Skirmish', squads: [{ type: 'warrior', count: 4 }, { type: 'archer', count: 4 }], upkeepPerSecond: 0, requiredPopulation: 80, cost: 50 }, // 8 squads * 10 pop = 80
  ]);

  // === Population & Taxes ===
  // EMERGENCY RULE: Population minimum is 1 (never zero)
  const [population, setPopulation] = useState(5); // starts at 5
  const [recruitmentMode, setRecruitmentMode] = useState<'regular' | 'forced'>('regular'); // Recruitment mode: regular (free workers only) or forced (can use working workers)
  const [tax, setTax] = useState<'very_low' | 'low' | 'normal' | 'high' | 'very_high'>('normal');

  // === Cheat Menu Visibility ===
  const [showCheatMenu, setShowCheatMenu] = useState(false);

  // === Fullscreen State ===
  const [isFullscreen, setIsFullscreen] = useState(false);

  // === Mobile Resource Rate Display State ===
  const [showingRateFor, setShowingRateFor] = useState<string | null>(null);
  const rateDisplayTimeoutRef = useRef<any>(null);

  // Clear rate display after 3 seconds or when clicking elsewhere
  useEffect(() => {
    if (showingRateFor) {
      if (rateDisplayTimeoutRef.current) {
        clearTimeout(rateDisplayTimeoutRef.current);
      }
      rateDisplayTimeoutRef.current = setTimeout(() => {
        setShowingRateFor(null);
      }, 3000);
    }
    return () => {
      if (rateDisplayTimeoutRef.current) {
        clearTimeout(rateDisplayTimeoutRef.current);
      }
    };
  }, [showingRateFor]);

  // Close rate display when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (showingRateFor && !(e.target as Element).closest('.mobile-resource-cell')) {
        setShowingRateFor(null);
      }
    };

    if (showingRateFor) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showingRateFor]);

  const handleResourceTap = (label: string, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (showingRateFor === label) {
      setShowingRateFor(null);
    } else {
      setShowingRateFor(label);
    }
  };

  // Check if fullscreen is supported and get the correct API
  const getFullscreenElement = () => {
    return document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement ||
      null;
  };

  const requestFullscreen = (): Promise<void> => {
    const element = document.documentElement;
    if (element.requestFullscreen) {
      return element.requestFullscreen() as Promise<void>;
    } else if ((element as any).webkitRequestFullscreen) {
      return (element as any).webkitRequestFullscreen() as Promise<void>;
    } else if ((element as any).mozRequestFullScreen) {
      return (element as any).mozRequestFullScreen() as Promise<void>;
    } else if ((element as any).msRequestFullscreen) {
      return (element as any).msRequestFullscreen() as Promise<void>;
    }
    return Promise.reject(new Error('Fullscreen not supported'));
  };

  const exitFullscreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    } else if ((document as any).mozCancelFullScreen) {
      (document as any).mozCancelFullScreen();
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen();
    }
  };

  const toggleFullscreen = () => {
    if (getFullscreenElement()) {
      exitFullscreen();
    } else {
      requestFullscreen();
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!getFullscreenElement());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Check initial state
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Attempt fullscreen on first user interaction
  useEffect(() => {
    // Try to enter fullscreen on first click/touch (browsers require user interaction)
    let hasAttemptedFullscreen = false;

    const attemptFullscreenOnInteraction = () => {
      if (!hasAttemptedFullscreen && !getFullscreenElement()) {
        hasAttemptedFullscreen = true;
        requestFullscreen().catch(() => {
          // Silently fail if fullscreen is not allowed
          // User can still use the button to enter fullscreen
        });
      }
    };

    // Try on first click
    document.addEventListener('click', attemptFullscreenOnInteraction, { once: true });
    // Try on first touch (for mobile)
    document.addEventListener('touchstart', attemptFullscreenOnInteraction, { once: true });

    return () => {
      document.removeEventListener('click', attemptFullscreenOnInteraction);
      document.removeEventListener('touchstart', attemptFullscreenOnInteraction);
    };
  }, []);

  const popCap = useMemo(() => getHouseCapacity(house), [house]);

  // === Happiness Calculation ===
  const happinessModifier = useMemo(() => {
    let base = 50;

    // Tax modifier
    if (tax === 'very_low') base += 30;
    else if (tax === 'low') base += 15;
    else if (tax === 'high') base -= 15;
    else if (tax === 'very_high') base -= 30;
    // normal tax: +0 (no change)

    // Tavern modifier
    if (tavern) {
      if (tavern.level === 1) base += 10;
      else if (tavern.level === 2) base += 20;
      else if (tavern.level === 3) base += 25;
    }

    // Festival modifier
    if (tavern?.activeFestival && Date.now() < tavern.festivalEndTime) {
      base += 15;
    }

    return Math.max(0, Math.min(100, base));
  }, [tax, tavern]);

  // Update happiness state
  useEffect(() => {
    setHappiness(happinessModifier);
  }, [happinessModifier]);

  // Check for expired festivals
  useEffect(() => {
    if (!tavern || !tavern.activeFestival) return;

    const checkFestival = setInterval(() => {
      if (tavern && tavern.activeFestival && Date.now() >= tavern.festivalEndTime) {
        setTavern(prev => prev ? { ...prev, activeFestival: false, festivalEndTime: 0 } : null);
      }
    }, 1000);

    return () => clearInterval(checkFestival);
  }, [tavern]);

  // === Net Population Change ===
  const netPopulationChange = useMemo(() => {
    // Base population change from tax
    let baseRate = 0;
    if (tax === 'very_low') baseRate = 1.2;
    else if (tax === 'low') baseRate = 0.8;
    else if (tax === 'normal') baseRate = 0.2;
    else if (tax === 'high') baseRate = -0.4;
    else if (tax === 'very_high') baseRate = -1.0;

    // Happiness-based modifier
    let happinessModifier = 0;
    if (happiness >= 80) {
      happinessModifier = 0.8;
    } else if (happiness >= 60) {
      happinessModifier = 0.4;
    } else if (happiness >= 40) {
      happinessModifier = 0.0;
    } else if (happiness >= 20) {
      happinessModifier = -0.4;
    } else {
      happinessModifier = -0.8;
    }

    return baseRate + happinessModifier;
  }, [tax, happiness]);

  // === Tabs ===
  const [mainTab, setMainTab] = useState<'production' | 'army' | 'missions' | 'expeditions' | 'leaderboard' | 'factions' | 'council'>('production');

  // Ensure army tab is only accessible when barracks is built
  useEffect(() => {
    if (mainTab === 'army' && (!barracks || barracks.level < 1)) {
      setMainTab('production');
    }

    // Clear army recruitment drafts when leaving the army tab
    if (mainTab !== 'army') {
      // bannersDraft removed - no need to clear
    }
  }, [mainTab, barracks]);

  // === Army / Banners builder state ===
  const [draftSquads, setDraftSquads] = useState<UnitType[]>([]); // Array of unit types for the draft banner
  const [banners, setBanners] = useState<Banner[]>([]);
  const [editingBannerId, setEditingBannerId] = useState<number | string | null>(null);
  const [bannersDraft, setBannersDraft] = useState<Banner | null>(null); // Singular draft for the edited banner

  // === Edit Mode Helpers ===
  const startEditingBanner = (bannerId: number | string) => {
    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;

    // Create deep copy for draft
    setBannersDraft(JSON.parse(JSON.stringify(banner)));
    setEditingBannerId(bannerId);
  };

  const cancelEditingBanner = () => {
    setBannersDraft(null);
    setEditingBannerId(null);
  };

  const updateBannerNameDraft = (name: string) => {
    if (!bannersDraft) return;
    setBannersDraft({ ...bannersDraft, name });
  };

  const confirmEditingBanner = () => {
    if (!bannersDraft || editingBannerId === null) return;

    setBanners(prev => prev.map(b =>
      b.id === editingBannerId ? bannersDraft : b
    ));

    setBannersDraft(null);
    setEditingBannerId(null);
    saveGame();
  };
  const [bannerHint, setBannerHint] = useState<{ id: number | string, message: string } | null>(null);

  useEffect(() => {
    if (bannerHint) {
      const timer = setTimeout(() => setBannerHint(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [bannerHint]);
  const [bannerSeq, setBannerSeq] = useState(1);
  const [commanderSeq, setCommanderSeq] = useState(1);
  const [squadSeq, setSquadSeq] = useState(1); // Global squad ID counter
  const squadSeqRef = useRef(1); // Ref to track current squadSeq for closures
  const [bannerLossNotices, setBannerLossNotices] = useState<BannerLossNotice[]>([]);
  const [armyTab, setArmyTab] = useState<'mercenaries' | 'regular'>('regular'); // New tab state for split views

  // Debug: Log notification state changes
  useEffect(() => {
    console.log('[STATE] bannerLossNotices changed. Count:', bannerLossNotices.length, 'Notices:', bannerLossNotices);
  }, [bannerLossNotices]);

  // Keep ref in sync with state
  useEffect(() => {
    squadSeqRef.current = squadSeq;
  }, [squadSeq]);

  // === Faction System ===
  const [factionState, setFactionState] = useState<PlayerFactionState>(() => ({
    availableFP: 0,
    alsusFP: 0,
    atroxFP: 0,
    alsusUnspentFP: 0,
    atroxUnspentFP: 0,
    perks: createPerkTree(),
  }));

  const [selectedFaction, setSelectedFaction] = useState<FactionId>('Alsus');

  // Faction functions
  function addFactionPoints(amount: number): void {
    setFactionState(prev => ({
      ...prev,
      availableFP: prev.availableFP + amount,
    }));
  }

  function assignFPToFaction(faction: FactionId, amount: number): void {
    setFactionState(prev => {
      if (prev.availableFP < amount) return prev;

      if (faction === 'Alsus') {
        return {
          ...prev,
          availableFP: prev.availableFP - amount,
          alsusFP: prev.alsusFP + amount,
          alsusUnspentFP: prev.alsusUnspentFP + amount,
        };
      } else {
        return {
          ...prev,
          availableFP: prev.availableFP - amount,
          atroxFP: prev.atroxFP + amount,
          atroxUnspentFP: prev.atroxUnspentFP + amount,
        };
      }
    });
  }

  function canUnlockPerk(nodeId: string): boolean {
    const node = factionState.perks[nodeId];
    if (!node || node.unlocked) return false;

    // Check faction FP
    const hasEnoughFP = node.faction === 'Alsus'
      ? factionState.alsusUnspentFP >= node.costFP
      : factionState.atroxUnspentFP >= node.costFP;

    if (!hasEnoughFP) return false;

    // Check if all lower tiers in the same branch are unlocked
    for (let tier = 1; tier < node.tier; tier++) {
      const lowerNodeId = `${node.branchId}_T${tier}`;
      const lowerNode = factionState.perks[lowerNodeId];
      if (!lowerNode || !lowerNode.unlocked) {
        return false;
      }
    }

    return true;
  }

  function unlockPerk(nodeId: string): boolean {
    if (!canUnlockPerk(nodeId)) return false;

    const node = factionState.perks[nodeId];
    setFactionState(prev => {
      const updatedPerks = { ...prev.perks };
      updatedPerks[nodeId] = { ...node, unlocked: true };

      if (node.faction === 'Alsus') {
        return {
          ...prev,
          perks: updatedPerks,
          alsusUnspentFP: prev.alsusUnspentFP - node.costFP,
        };
      } else {
        return {
          ...prev,
          perks: updatedPerks,
          atroxUnspentFP: prev.atroxUnspentFP - node.costFP,
        };
      }
    });

    return true;
  }

  // === Expeditions ===
  // === Leaderboard ===
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const REAL_PLAYER_ID = 'real_player';
  const REAL_PLAYER_NAME = 'REAL PLAYER';
  const REAL_PLAYER_FACTION: Faction = 'Alsus'; // TODO: Make this configurable

  const [expeditions, setExpeditions] = useState<Expedition[]>([
    {
      expeditionId: "godonis_mountain_expedition",
      title: "Whispers in the Mountains of Godonis",
      shortSummary: "Investigate the disappearances in the mountains of Godonis.",
      description: `During the night, people, and sometimes entire villages, disappear in the mountains of Godonis. The mountain clans are begging for help. We must send an expedition to find out what is happening.`,
      state: 'available',
      requirements: {
        wood: { required: 500, current: 0 },
        stone: { required: 250, current: 0 },
        food: { required: 1000, current: 0 },
        population: { required: 5, current: 0 },
      },
      travelProgress: 0,
    },
  ]);

  // === Reward Tier System ===
  type RewardTier = 'very_easy' | 'easy' | 'medium' | 'hard' | 'very_hard' | 'extreme';

  const REWARD_TIERS: Record<RewardTier, { name: string; flavor: string; icon: string; rewards: { gold: number; wood: number; stone: number; food: number; iron: number } }> = {
    very_easy: {
      name: "Scout's Cache",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "📦",
      rewards: { gold: 10, wood: 15, stone: 10, food: 20, iron: 5 }
    },
    easy: {
      name: "Raider's Loot",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "🎒",
      rewards: { gold: 25, wood: 40, stone: 30, food: 50, iron: 15 }
    },
    medium: {
      name: "War Chest",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "💼",
      rewards: { gold: 60, wood: 100, stone: 80, food: 120, iron: 40 }
    },
    hard: {
      name: "Commander's Supply Crate",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "📦",
      rewards: { gold: 150, wood: 250, stone: 200, food: 300, iron: 100 }
    },
    very_hard: {
      name: "Warlord's Hoard",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "🏆",
      rewards: { gold: 400, wood: 600, stone: 500, food: 800, iron: 250 }
    },
    extreme: {
      name: "Legendary Tribute",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "👑",
      rewards: { gold: 1000, wood: 1500, stone: 1200, food: 2000, iron: 600 }
    }
  };

  function getDifficultyTier(enemyTotal: number): RewardTier {
    if (enemyTotal <= 30) return 'very_easy';
    if (enemyTotal <= 100) return 'easy';
    if (enemyTotal <= 300) return 'medium';
    if (enemyTotal <= 600) return 'hard';
    if (enemyTotal <= 2500) return 'very_hard';
    return 'extreme';
  }

  function generateMissionRewards(enemyTotal: number): { tier: RewardTier; rewards: { gold: number; wood: number; stone: number; food: number; iron: number } } {
    const tier = getDifficultyTier(enemyTotal);
    const baseRewards = REWARD_TIERS[tier].rewards;

    // Scale rewards slightly based on enemy total for variety within same tier
    const scaleFactor = 1 + (enemyTotal % 100) / 1000; // Small variation (0-10%)

    return {
      tier,
      rewards: {
        gold: Math.floor(baseRewards.gold * scaleFactor),
        wood: Math.floor(baseRewards.wood * scaleFactor),
        stone: Math.floor(baseRewards.stone * scaleFactor),
        food: Math.floor(baseRewards.food * scaleFactor),
        iron: Math.floor(baseRewards.iron * scaleFactor),
      }
    };
  }

  // === Faction Perk Tree Definitions ===
  function createPerkTree(): Record<string, FactionPerkNode> {
    const perks: Record<string, FactionPerkNode> = {};

    // Alsus branches
    const alsusBranches: Array<{ id: FactionBranchId; name: string }> = [
      { id: 'Alsus_Tactics', name: 'Magnus War Council' },
      { id: 'Alsus_Lux', name: 'Lux Guardians' },
      { id: 'Alsus_Crowns', name: 'Pact of Crowns' },
    ];

    // Atrox branches
    const atroxBranches: Array<{ id: FactionBranchId; name: string }> = [
      { id: 'Atrox_Blood', name: 'Blood Legions' },
      { id: 'Atrox_Fortress', name: 'Iron Bastions of Roctium' },
      { id: 'Atrox_Spoils', name: 'Spoils of War' },
    ];

    // Create perks for Alsus (5 tiers per branch)
    alsusBranches.forEach(branch => {
      for (let tier = 1; tier <= 5; tier++) {
        const nodeId = `${branch.id}_T${tier}`;
        perks[nodeId] = {
          id: nodeId,
          faction: 'Alsus',
          branchId: branch.id,
          tier,
          costFP: tier,
          unlocked: false,
          name: `${branch.name} Tier ${tier}`,
          description: `Placeholder perk description for ${branch.name} tier ${tier}`,
        };
      }
    });

    // Create perks for Atrox (5 tiers per branch)
    atroxBranches.forEach(branch => {
      for (let tier = 1; tier <= 5; tier++) {
        const nodeId = `${branch.id}_T${tier}`;
        perks[nodeId] = {
          id: nodeId,
          faction: 'Atrox',
          branchId: branch.id,
          tier,
          costFP: tier,
          unlocked: false,
          name: `${branch.name} Tier ${tier}`,
          description: `Placeholder perk description for ${branch.name} tier ${tier}`,
        };
      }
    });

    return perks;
  }

  // === Master Mission Pool (20 missions) ===
  const MASTER_MISSION_POOL: Omit<Mission, 'status' | 'staged' | 'deployed' | 'elapsed' | 'battleResult' | 'rewards' | 'rewardTier' | 'cooldownEndTime' | 'isNew'>[] = [
    {
      id: 1,
      name: 'Scout the Forest',
      description: 'Your task is to explore the outskirts of the village and chart any nearby landmarks or threats. Expect light resistance. Current estimates suggest you may encounter one hostile squad. Proceed carefully, avoid unnecessary engagement, and return with a clear report of the terrain and enemy presence.',
      duration: 3,
      enemyComposition: { warrior: 15, archer: 5 }
    },
    {
      id: 2,
      name: 'Secure the Quarry Road',
      description: 'Your forces must secure the old road leading to the quarry. Enemy scouts have been sighted nearby, and resistance is expected to be significant. Intelligence indicates three warrior squads supported by one archer squad. Advance with caution, break their formation, and ensure the road is safe for future transport.',
      duration: 3,
      enemyComposition: { warrior: 90, archer: 30 }
    },
    {
      id: 3,
      name: 'Sweep the Northern Ridge',
      description: 'A fortified enemy group has settled along the northern ridge. This will be a demanding operation. Expect to face five warrior squads and one archer squad. Push through their defensive line, neutralise all threats, and reclaim control of the ridge for the village.',
      duration: 3,
      enemyComposition: { warrior: 300, archer: 50 }
    },
    {
      id: 4,
      name: 'Ambush the River Raiders',
      description: 'Your task is to clear the raiders operating along the riverbank. Scouts report small, fast-moving bands conducting ambushes on travellers. Expect light resistance composed of one warrior squad and a small archer detachment. Engage swiftly and secure the water route for the village.',
      duration: 3,
      enemyComposition: { warrior: 20, archer: 10 }
    },
    {
      id: 5,
      name: 'Purge the Old Mine',
      description: 'You must investigate the abandoned mine and eliminate any hostile presence within. Recent reports mention strange movements underground, likely from lurking creatures or desperate bandits. Expect two loosely organised squads with limited coordination. Push through the tunnels and restore safety to the area.',
      duration: 3,
      enemyComposition: { warrior: 35, archer: 15 }
    },
    {
      id: 6,
      name: 'Break the Southern Blockade',
      description: 'Enemy forces have erected a blockade on the southern path, disrupting trade and movement. Scouts confirm two warrior squads supported by one shielded unit holding the chokepoint. Expect a firm defensive stance. Break their line, dismantle the barricades, and reopen the route.',
      duration: 3,
      enemyComposition: { warrior: 130, archer: 30 }
    },
    {
      id: 7,
      name: 'Destroy the War Camp at Red Valley',
      description: 'A medium-sized war camp has been established in Red Valley, preparing forces for future assaults. Intelligence indicates three warrior squads, one archer squad, and an elite champion overseeing training. Expect organised resistance. Disrupt their preparations and cripple their ability to expand.',
      duration: 3,
      enemyComposition: { warrior: 360, archer: 90 }
    },
    {
      id: 8,
      name: 'Hunt the Plains Marauders',
      description: 'Marauders have been raiding farms across the plains, striking quickly before retreating. Scouts estimate one fast-moving warrior squad with two small archer groups in support. Expect unpredictable movement. Track them down, break their momentum, and restore security to the farmlands.',
      duration: 3,
      enemyComposition: { warrior: 50, archer: 30 }
    },
    {
      id: 9,
      name: 'Crush the Hilltop Outpost',
      description: 'A fortified outpost atop the northern hill is coordinating enemy patrols. Reports suggest two warrior squads and one archer squad defending the structure. Expect elevated positions and defensive tactics. Overwhelm their lines and reclaim the high ground.',
      duration: 3,
      enemyComposition: { warrior: 150, archer: 50 }
    },
    {
      id: 10,
      name: 'Cleanse the Bandit Warrens',
      description: 'A network of caves has become the base of a growing bandit force. Intelligence confirms three disorganised squads with mixed weaponry. Expect cramped fighting conditions and opportunistic strikes. Push through the warrens and eliminate their leadership.',
      duration: 3,
      enemyComposition: { warrior: 240, archer: 60 }
    },
    {
      id: 11,
      name: 'Eliminate the Elite Vanguard',
      description: 'Enemy commanders have deployed an elite vanguard to probe your defences. Scouts report one elite squad accompanied by two disciplined warrior units. Expect coordinated attacks and higher combat proficiency. Disrupt their advance and send a clear message.',
      duration: 3,
      enemyComposition: { warrior: 380, archer: 120 }
    },
    {
      id: 12,
      name: 'Retake the Fallen Watchtower',
      description: 'The old watchtower to the east has fallen to enemy hands. Reports indicate one warrior squad and one archer squad occupying the structure. Expect defenders to use elevation. Retake the tower and restore control of the eastern perimeter.',
      duration: 3,
      enemyComposition: { warrior: 60, archer: 40 }
    },
    {
      id: 13,
      name: 'Assault the Siege Workshop',
      description: 'A hidden workshop is producing siege equipment for future assaults. Intelligence estimates two warrior squads, one engineer squad, and a small archer detachment guarding the site. Expect traps and defensive constructs. Destroy the facility before production escalates.',
      duration: 3,
      enemyComposition: { warrior: 480, archer: 120 }
    },
    {
      id: 14,
      name: 'Clean the Marsh Ruins',
      description: 'Ancient ruins in the marshlands have become infested with hostile creatures. Scouts confirm two creature packs behaving like irregular squads with unpredictable patterns. Expect sudden engagements in difficult terrain. Purge the ruins and secure the wetlands.',
      duration: 3,
      enemyComposition: { warrior: 50, archer: 20 }
    },
    {
      id: 15,
      name: 'Intercept the Supply Caravan',
      description: 'A heavily guarded caravan is transporting weapons and armour to frontline forces. Intelligence indicates two warrior squads escorting multiple supply wagons. Expect disciplined defence and a mobile formation. Halt the caravan and seize the supplies.',
      duration: 3,
      enemyComposition: { warrior: 160, archer: 60 }
    },
    {
      id: 16,
      name: 'Break the Ironclad Phalanx',
      description: 'A highly trained phalanx is blocking a strategic mountain pass. Scouts report one phalanx unit supported by two elite warriors. Expect a strong frontal defence. Flank their formation, break their discipline, and reopen the pass.',
      duration: 3,
      enemyComposition: { warrior: 700, archer: 200 }
    },
    {
      id: 17,
      name: 'Storm the Fortress of Grey Ridge',
      description: 'A reinforced enemy fortress dominates Grey Ridge and controls several valleys. Intelligence confirms four warrior squads, two archer squads, and a veteran commander. Expect prolonged resistance. Breach their defences and reclaim the stronghold.',
      duration: 3,
      enemyComposition: { warrior: 2000, archer: 500 }
    },
    {
      id: 18,
      name: 'Defeat the Beastlord\'s Horde',
      description: 'A monstrous warlord has assembled a large horde of beasts and fanatics. Scouts estimate three beast packs supported by two frenzied warrior squads. Expect erratic and aggressive assaults. Hold formation and cut through the enemy swarm.',
      duration: 3,
      enemyComposition: { warrior: 2400, archer: 800 }
    },
    {
      id: 19,
      name: 'Burn the Great Encampment',
      description: 'A sprawling encampment is hosting large numbers of enemy troops and resources. Intelligence identifies five warrior squads, two archer units, and multiple auxiliary detachments. Expect widespread resistance across several positions. Torch the encampment and disrupt their supply network.',
      duration: 3,
      enemyComposition: { warrior: 4000, archer: 1000 }
    },
    {
      id: 20,
      name: 'Final Push: The Army of Ten Thousand',
      description: 'A massive enemy host is advancing toward the region. Scouts report an overwhelming formation comprising dozens of warrior squads, numerous archer regiments, and elite detachments. Expect extreme resistance. Strike decisively and prevent the enemy from overrunning the land.',
      duration: 3,
      enemyComposition: { warrior: 7500, archer: 2500 }
    },
  ];

  // Helper function to randomly select N missions from the pool, excluding current active mission IDs
  function selectRandomMissions(count: number, excludeIds: number[] = []): Mission[] {
    const available = MASTER_MISSION_POOL.filter(m => !excludeIds.includes(m.id));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(count, available.length));

    return selected.map(template => ({
      ...template,
      status: 'available' as const,
      staged: [],
      deployed: [],
      elapsed: 0,
      battleResult: undefined,
      rewards: undefined,
      rewardTier: undefined,
      cooldownEndTime: undefined,
      isNew: true // Mark as new when first generated
    }));
  }

  // Initialize with 3 random missions
  const [missions, setMissions] = useState<Mission[]>(() => selectRandomMissions(3));
  const [missionBannerSelector, setMissionBannerSelector] = useState<number | null>(null); // Mission ID showing banner selector
  const [missionLoading, setMissionLoading] = useState<number | null>(null); // Mission ID currently loading
  const [rewardModal, setRewardModal] = useState<null | { missionId: number }>(null);
  const [battleReport, setBattleReport] = useState<{
    missionId: number;
    result: BattleResult;
    bannerXP?: {
      bannerId: number;
      bannerName: string;
      xpGained: number;
      oldXP: number;
      newXP: number;
      oldLevel: number;
      newLevel: number;
      oldLevelName: string;
      newLevelName: string;
      xpCurrentLevel: number;
      xpNextLevel: number;
    };
    commanderXP?: {
      commanderId: number;
      commanderName: string;
      xpGained: number;
      oldLevel: number;
      newLevel: number;
      oldXP: number;
      newXP: number;
      xpToNextLevel: number;
    };
  } | null>(null);
  const [rewardPopup, setRewardPopup] = useState<{ missionId: number; tier: string; rewards: { gold?: number; wood?: number; stone?: number; food?: number; iron?: number } } | null>(null);
  const [blacksmithOpen, setBlacksmithOpen] = useState(false);
  const [technologiesOpen, setTechnologiesOpen] = useState(false);
  const [deleteBannerModal, setDeleteBannerModal] = useState<number | null>(null); // Banner ID to delete
  const [reinforcementModal, setReinforcementModal] = useState<{ bannerId: number; squadId: number; goldCost: number; soldiersNeeded: number; bannerName: string; squadType: string } | null>(null);
  const [disableBuildingModal, setDisableBuildingModal] = useState<{ resource: "wood" | "stone" | "food" | "iron"; buildingName: string } | null>(null);
  const [hireAndRefillModal, setHireAndRefillModal] = useState<{ bannerId: number; hireCost: number; refillCost: number; totalCost: number; bannerName: string } | null>(null);
  const [siegeAttackModal, setSiegeAttackModal] = useState<{ expeditionId: string; attackers: number } | null>(null);
  const [editingBannerName, setEditingBannerName] = useState<number | null>(null); // Banner ID being edited
  const [deleteSquadModal, setDeleteSquadModal] = useState<{ bannerId: number; squadId: number } | null>(null); // Modal for confirming single squad deletion

  // Anchored Unit Picker State (Redesign)
  const [anchoredPickerState, setAnchoredPickerState] = useState<{
    isOpen: boolean;
    bannerId: number;
    slotIndex: number;
    anchorRect: DOMRect | null;
  }>({
    isOpen: false,
    bannerId: 0,
    slotIndex: 0,
    anchorRect: null
  });
  const isMobile = useMobileDetection(); // Detect mobile/touch devices
  const [showRecruitmentInfo, setShowRecruitmentInfo] = useState(false);
  const [battleLoading, setBattleLoading] = useState<{ expeditionId: string; progress: number } | null>(null); // Battle loading state
  const [battleError, setBattleError] = useState<{ expeditionId: string; message: string } | null>(null); // Battle error state

  // === Persistence ===
  // Serialize current component state to GameState
  function serializeGameState(): GameState {
    return {
      version: 1,
      lastSaveUtc: Date.now(),
      totalPlayTime: 0, // TODO: Track play time

      warehouse,
      warehouseLevel,
      skillPoints,

      population,
      populationCap: popCap,
      recruitmentMode,
      tax,
      happiness,

      lumberMill,
      quarry,
      farm,
      ironMine,
      house,
      townHall,
      barracks,
      tavern: tavern ? {
        level: tavern.level,
        activeFestival: tavern.activeFestival || false,
        festivalEndTime: tavern.festivalEndTime || 0,
      } : null,
      militaryAcademy: militaryAcademy ? {
        level: militaryAcademy.level,
      } : null,
      commanders: commanders.map(c => ({
        id: c.id,
        name: c.name,
        archetype: c.archetype,
        rangedAttackBonusPercent: c.rangedAttackBonusPercent,
        meleeAttackBonusPercent: c.meleeAttackBonusPercent,
        assignedBannerId: c.assignedBannerId,
        level: c.level || 1,
        currentXP: c.currentXP || 0,
        xpToNextLevel: c.xpToNextLevel || calculateCommanderXPToNextLevel(c.level || 1),
      })),
      commanderSeq,

      banners: banners.map(b => ({
        ...b,
        customNamed: b.customNamed || false,
        commanderId: b.commanderId || null,
      })),
      bannerSeq,
      squadSeq,
      bannerLossNotices,

      missions: missions.map(m => ({
        ...m,
      })),

      expeditions: expeditions.map(exp => ({
        expeditionId: exp.expeditionId,
        title: exp.title,
        shortSummary: exp.shortSummary,
        description: exp.description,
        state: exp.state,
        requirements: exp.requirements,
        travelProgress: exp.travelProgress,
        fortress: exp.fortress ? {
          buildings: exp.fortress.buildings.map(b => ({
            id: b.id,
            name: b.name,
            level: b.level,
            maxLevel: b.maxLevel,
            description: b.description,
            // Functions are not serialized - will be reconstructed on load
          })),
          stats: exp.fortress.stats,
          garrison: exp.fortress.garrison || [],
          lastBattle: exp.fortress.lastBattle,
        } : undefined,
      })),

      mainTab,
      armyTab,
      leaderboard,

      factionState: {
        availableFP: factionState.availableFP,
        alsusFP: factionState.alsusFP,
        atroxFP: factionState.atroxFP,
        alsusUnspentFP: factionState.alsusUnspentFP,
        atroxUnspentFP: factionState.atroxUnspentFP,
        perks: Object.fromEntries(
          Object.entries(factionState.perks).map(([id, perk]) => [
            id,
            {
              id: perk.id,
              faction: perk.faction,
              branchId: perk.branchId,
              tier: perk.tier,
              costFP: perk.costFP,
              unlocked: perk.unlocked,
              name: perk.name,
              description: perk.description,
            }
          ])
        ),
      },

      tutorialCompleted: false,
      debugFlags: {},
    };
  }

  // Load GameState into component state
  function loadGameState(state: GameState) {
    setWarehouse(state.warehouse);
    setWarehouseLevel(state.warehouseLevel);
    setSkillPoints(state.skillPoints);

    setPopulation(state.population);
    setRecruitmentMode(state.recruitmentMode);
    setTax(state.tax);
    setHappiness(state.happiness);

    setLumberMill(state.lumberMill);
    setQuarry(state.quarry);
    setFarm(state.farm);
    setIronMine(state.ironMine || { level: 1, stored: 0, enabled: true, workers: 1 }); // Fallback for old saves
    setHouse(state.house);
    setTownHall(state.townHall as any);
    setBarracks(state.barracks);
    setTavern(state.tavern);
    setMilitaryAcademy(state.militaryAcademy);

    // Load commanders with backward compatibility for level fields
    setCommanders((state.commanders || []).map(c => ({
      ...c,
      level: c.level || 1,
      currentXP: c.currentXP || 0,
      xpToNextLevel: c.xpToNextLevel || calculateCommanderXPToNextLevel(c.level || 1),
    })));
    setCommanderSeq(state.commanderSeq || 1);

    setBanners(state.banners.map(b => {
      // Recalculate XP level info if XP is present
      const xp = b.xp || 0;
      const levelInfo = calculateLevelFromXP(xp);

      return {
        ...b,
        units: b.units || [],
        squads: b.squads || [],
        // Ensure XP fields are set (recalculate if missing)
        xp: xp,
        level: b.level !== undefined ? b.level : levelInfo.level,
        xpCurrentLevel: b.xpCurrentLevel !== undefined ? b.xpCurrentLevel : levelInfo.xpCurrentLevel,
        xpNextLevel: b.xpNextLevel !== undefined ? b.xpNextLevel : levelInfo.xpNextLevel,
        commanderId: b.commanderId || null,
      };
    }));
    setBannerSeq(state.bannerSeq);
    setSquadSeq(state.squadSeq);
    setBannerLossNotices(state.bannerLossNotices);

    // Load missions from save, ensuring we always have exactly 3
    if (state.missions && state.missions.length > 0) {
      const loadedMissions = state.missions.map(m => {
        // Migrate old "complete" status to new statuses
        let status = m.status;
        if ((status as any) === 'complete') {
          // If rewards exist and rewardTier exists, it was claimed; otherwise pending
          status = (m.rewards && m.rewardTier) ? 'completedRewardsClaimed' : 'completedRewardsPending';
        }
        return {
          ...m,
          status: status as Mission['status'],
          description: m.description || '',
          enemyComposition: m.enemyComposition || { warrior: 0, archer: 0 },
          rewardTier: m.rewardTier,
          isNew: m.isNew || false,
        };
      });

      // If we have fewer than 3 missions, fill up to 3 with random ones
      if (loadedMissions.length < 3) {
        const currentIds = loadedMissions.map(m => m.id);
        const additionalMissions = selectRandomMissions(3 - loadedMissions.length, currentIds);
        setMissions([...loadedMissions, ...additionalMissions]);
      } else if (loadedMissions.length > 3) {
        // If we have more than 3, keep only the first 3
        setMissions(loadedMissions.slice(0, 3));
      } else {
        setMissions(loadedMissions);
      }
    } else {
      // No saved missions, initialize with 3 random
      setMissions(selectRandomMissions(3));
    }

    setExpeditions(state.expeditions.map(exp => {
      if (!exp.fortress) return exp as unknown as Expedition;

      // Reconstruct fortress buildings with proper functions
      const buildingTemplates = createInitialFortressBuildings();
      const reconstructedBuildings = exp.fortress.buildings.map(savedBuilding => {
        const template = buildingTemplates.find(t => t.id === savedBuilding.id);
        if (template) {
          return {
            ...template,
            level: savedBuilding.level,
          };
        }
        // Fallback if template not found
        return {
          id: savedBuilding.id,
          name: savedBuilding.name,
          level: savedBuilding.level,
          maxLevel: savedBuilding.maxLevel,
          description: savedBuilding.description,
          getEffect: (level: number) => {
            // Reconstruct effect based on building type
            if (savedBuilding.id === 'palisade_wall') return { fortHP: 400 * level };
            if (savedBuilding.id === 'watch_post') return { archerSlots: WATCH_POST_ARCHERS_PER_LEVEL * level };
            if (savedBuilding.id === 'garrison_hut') return { garrisonWarriors: 5 * level, garrisonArchers: 5 * level };
            return {};
          },
          getUpgradeCost: (level: number) => {
            if (savedBuilding.id === 'palisade_wall') return { wood: 150 * level, stone: 75 * level };
            if (savedBuilding.id === 'watch_post') return { wood: 100 * level, stone: 50 * level };
            if (savedBuilding.id === 'garrison_hut') return { wood: 120 * level, stone: 60 * level };
            return { wood: 0, stone: 0 };
          },
        };
      });

      return {
        ...exp,
        fortress: {
          ...exp.fortress,
          buildings: reconstructedBuildings,
          garrison: exp.fortress.garrison || [],
        },
      };
    }));

    setMainTab(state.mainTab as any);
    setArmyTab(state.armyTab === 'banners' ? 'regular' : state.armyTab as any);

    // Load leaderboard, ensuring real player entry exists
    if (state.leaderboard && state.leaderboard.length > 0) {
      const hasRealPlayer = state.leaderboard.some(e => e.playerId === REAL_PLAYER_ID);
      if (!hasRealPlayer) {
        // Add real player if missing
        const updated = [...state.leaderboard, {
          playerId: REAL_PLAYER_ID,
          playerName: REAL_PLAYER_NAME,
          faction: REAL_PLAYER_FACTION,
          totalScore: 0,
          totalKills: 0,
          totalVictories: 0,
          rank: 0,
          title: 'Recruit',
        }];
        setLeaderboard(recalculateRanksAndTitles(updated));
      } else {
        setLeaderboard(state.leaderboard);
      }
    } else {
      // Initialize with placeholder data
      setLeaderboard(createPlaceholderLeaderboard(REAL_PLAYER_NAME, REAL_PLAYER_FACTION));
    }

    // Load faction state
    if (state.factionState) {
      const basePerks = createPerkTree();
      // Merge saved perks with base tree (in case new perks were added)
      const mergedPerks = { ...basePerks };
      Object.entries(state.factionState.perks).forEach(([id, savedPerk]) => {
        if (mergedPerks[id]) {
          mergedPerks[id] = {
            ...mergedPerks[id],
            unlocked: savedPerk.unlocked,
          };
        }
      });

      setFactionState({
        availableFP: state.factionState.availableFP || 0,
        alsusFP: state.factionState.alsusFP || 0,
        atroxFP: state.factionState.atroxFP || 0,
        alsusUnspentFP: state.factionState.alsusUnspentFP || 0,
        atroxUnspentFP: state.factionState.atroxUnspentFP || 0,
        perks: mergedPerks,
      });
    } else {
      // Initialize with default state
      setFactionState({
        availableFP: 0,
        alsusFP: 0,
        atroxFP: 0,
        alsusUnspentFP: 0,
        atroxUnspentFP: 0,
        perks: createPerkTree(),
      });
    }
  }

  // Load state on mount
  useEffect(() => {
    const saved = persistence.loadState();
    if (saved) {
      // Calculate offline time
      const now = Date.now();
      const deltaSeconds = Math.max(0, (now - saved.lastSaveUtc) / 1000);

      console.log(`[PERSISTENCE] Loading save. Offline time: ${deltaSeconds.toFixed(1)} seconds`);

      // Run offline simulation
      const simulated = simulateOfflineProgression(saved, deltaSeconds);

      // Load into component
      loadGameState(simulated);

      // Save after state has been updated (use setTimeout to ensure state is set)
      setTimeout(() => {
        const currentState = serializeGameState();
        persistence.saveState(currentState);
        console.log('[PERSISTENCE] Re-saved state after offline simulation');
      }, 200);

      console.log(`[PERSISTENCE] Loaded save, simulated ${deltaSeconds.toFixed(1)} seconds offline`);
    } else {
      console.log('[PERSISTENCE] No save found, starting fresh');
      // Initialize leaderboard with placeholder data on first load
      setLeaderboard(createPlaceholderLeaderboard(REAL_PLAYER_NAME, REAL_PLAYER_FACTION));
    }
  }, []); // Only run on mount

  // Fix stale closure issue: Use a ref to access the latest state serializer
  const stateSerializerRef = useRef(serializeGameState);
  stateSerializerRef.current = serializeGameState;

  // Set up auto-save (only once on mount)
  useEffect(() => {
    persistence.startAutoSave(() => {
      const state = stateSerializerRef.current();
      // Console log for debugging/confirmation (optional, but requested by plan)
      console.log('[PERSISTENCE] Auto-saving game state...');
      return state;
    });
    return () => {
      persistence.stopAutoSave();
    };
  }, []); // Empty dependency array is now safe because we use the ref

  // Save on critical actions (manual save triggers)
  function saveGame() {
    persistence.saveState(serializeGameState());
  }

  // Reset game
  function resetGame() {
    const confirmation = confirm(
      "⚠️ WARNING: RESET GAME PROGRESS ⚠️\n\n" +
      "You are about to completely WIPE your save file.\n\n" +
      "This will:\n" +
      "• Delete all resources, buildings, and units\n" +
      "• Reset your Commander and XP\n" +
      "• Restart the game from the tutorial\n\n" +
      "This action CANNOT be undone.\n\n" +
      "Are you absolutely sure?"
    );

    if (confirmation) {
      // Stop auto-save to prevent interference
      persistence.stopAutoSave();

      // Reset state - this will clear localStorage and save default state
      const defaultState = persistence.resetState();

      // Ensure the save is written before reloading
      // Use a small delay to ensure localStorage write completes
      setTimeout(() => {
        // Reload page - it will load the fresh default state from localStorage
        window.location.reload();
      }, 100);
    }
  }

  // === Army helpers ===
  // List of all regular recruitable unit types
  const regularUnitTypes: UnitType[] = [
    'militia',
    'warrior',
    'longsword',
    'pikemen',
    'light_cavalry',
    'heavy_cavalry',
    'archer',
    'skirmisher',
    'crossbowmen'
  ];

  function addSquad(t: UnitType) {
    setDraftSquads((s) => (s.length >= 8 ? s : [...s, t]));
  }

  // Legacy functions for backward compatibility (if needed elsewhere)
  function addWarriorSquad() {
    addSquad('warrior');
  }
  function addArcherSquad() {
    addSquad('archer');
  }
  function removeLastSquad() { setDraftSquads((s) => s.slice(0, -1)); }
  function clearDraft() { setDraftSquads([]); }

  // Calculate iron cost for a draft banner (array of unit types)
  function getIronCostForBanner(draftSquads: UnitType[]): number {
    return draftSquads.reduce((total, unitType) => {
      const costPerSquad = ironCostPerSquad[unitType] ?? 0;
      return total + costPerSquad;
    }, 0);
  }


  function confirmBanner() {
    if (draftSquads.length === 0) return;

    // Calculate and check iron cost
    const ironCost = getIronCostForBanner(draftSquads);
    const availableIron = warehouse.iron;

    if (availableIron < ironCost) {
      // Show error message - you can use alert for now or integrate with notification system
      alert(`Not enough Iron. Required: ${ironCost}, available: ${availableIron}.`);
      return;
    }

    // Initialize squads with health tracking - start empty (0/10) since banner hasn't been trained yet
    const { squads, nextSeq } = initializeSquadsFromUnits(draftSquads, squadSeq, true);

    // Generate auto-name based on composition
    const autoName = generateBannerName(bannerSeq, squads);

    // Calculate reqPop based on squad categories
    const totalReqPop = squads.reduce((sum, squad) => {
      const category = unitCategory[squad.type] || 'infantry';
      return sum + squadConfig[category].reqPop;
    }, 0);

    // Initialize XP for new banner
    const initialXP = 0;
    const initialLevelInfo = calculateLevelFromXP(initialXP);

    const next: Banner = {
      id: bannerSeq,
      name: autoName,
      units: draftSquads, // Keep for backward compatibility
      squads: squads,
      status: 'idle',
      reqPop: totalReqPop,
      recruited: 0,
      type: 'regular', // Men-at-arms are regular banners
      customNamed: false, // Auto-generated name
      xp: initialXP,
      level: initialLevelInfo.level,
      xpCurrentLevel: initialLevelInfo.xpCurrentLevel,
      xpNextLevel: initialLevelInfo.xpNextLevel,
    };
    // Deduct iron cost
    setWarehouse((w) => ({ ...w, iron: Math.max(0, w.iron - ironCost) }));

    setBanners((bs) => [...bs, next]);
    setBannerSeq((n) => n + 1);
    setSquadSeq(nextSeq);
    setDraftSquads([]);
  }

  // Banner name editing functions
  function updateBannerName(bannerId: number, newName: string) {
    setBanners((bs) => bs.map((b) => {
      if (b.id === bannerId) {
        const originalName = b.name;
        const nameChanged = newName.trim() !== originalName.trim();
        // Mark as custom if name actually changed from original
        const shouldBeCustom = nameChanged && newName.trim().length > 0;
        return {
          ...b,
          name: newName.trim() || originalName, // Don't allow empty names
          customNamed: shouldBeCustom ? true : (b.customNamed || false),
        };
      }
      return b;
    }));
  }

  function finishEditingBannerName() {
    setEditingBannerName(null);
    saveGame();
  }

  function cleanupBanner(bannerId: number): void {
    setBanners(prev => prev.filter(b => b.id !== bannerId));
    setBannerLossNotices(prev => prev.filter(notice => !notice.id.includes(`banner-${bannerId}`)));
  }



  function resetBannerName(bannerId: number) {
    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;

    const autoName = generateBannerName(bannerId, banner.squads);
    setBanners((bs) => bs.map((b) =>
      b.id === bannerId
        ? { ...b, name: autoName, customNamed: false }
        : b
    ));
    setEditingBannerName(null);
    saveGame();
  }

  // Regenerate auto-names when composition changes (if not custom)
  function regenerateBannerNameIfNeeded(bannerId: number, newSquads: Squad[]) {
    const banner = banners.find(b => b.id === bannerId);
    if (!banner || banner.customNamed) return; // Don't regenerate if custom

    const autoName = generateBannerName(bannerId, newSquads);
    if (autoName !== banner.name) {
      setBanners((bs) => bs.map((b) =>
        b.id === bannerId ? { ...b, name: autoName } : b
      ));
    }
  }

  function startTraining(id: number) {
    if (editingBannerId === id) return; // Hard lock: Cannot train while editing

    // Check if barracks exists and get max training slots
    if (!barracks || barracks.level < 1) {
      console.warn('[TRAINING] Barracks required to train banners');
      return;
    }

    const maxSlots = getMaxTrainingSlots(barracks.level);
    const currentlyTraining = banners.filter(b => b.type === 'regular' && b.status === 'training').length;

    if (currentlyTraining >= maxSlots) {
      console.warn(`[TRAINING] Training slots full: ${currentlyTraining}/${maxSlots}`);
      return;
    }

    setBanners((bs) => bs.map((b) => {
      if (b.id === id && (b.status === 'idle' || b.status === 'ready')) {
        // Ensure squads are initialized
        let displaySquads = b.squads;
        if (!displaySquads || displaySquads.length === 0) {
          const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
          displaySquads = squads;
        }

        // Check if banner has incomplete squads
        const hasIncompleteSquads = displaySquads.some(s => s.currentSize < s.maxSize);

        if (!hasIncompleteSquads) {
          console.warn('[TRAINING] All squads are at full strength');
          return b;
        }

        // Calculate how much population is still needed
        const totalNeeded = displaySquads.reduce((sum, squad) => sum + (squad.maxSize - squad.currentSize), 0);

        if (b.status === 'idle') {
          // New training: reset all squads to 0 and start fresh
          const resetSquads = displaySquads.map(s => ({ ...s, currentSize: 0 }));
          return { ...b, status: 'training', squads: resetSquads, recruited: 0, reqPop: totalNeeded, trainingPaused: false };
        } else {
          // Continuing training on a 'ready' banner: keep current squad sizes, train only what's missing
          return { ...b, status: 'training', squads: displaySquads, recruited: 0, reqPop: totalNeeded, trainingPaused: false };
        }
      }
      return b;
    }));
  }

  function toggleTrainingPause(id: number) {
    if (editingBannerId === id) return; // Hard lock: Cannot pause/resume while editing

    setBanners((bs) => bs.map((b) => {
      if (b.id === id && b.status === 'training') {
        return { ...b, trainingPaused: !b.trainingPaused };
      }
      return b;
    }));
    saveGame();
  }

  function stopTrainingBanner(id: number) {
    if (editingBannerId === id) return;
    setBanners((bs) => bs.map((b) => {
      if (b.id === id && b.status === 'training') {
        return { ...b, status: 'ready', trainingPaused: false };
      }
      return b;
    }));
    saveGame();
  }

  function confirmDeleteBanner() {
    if (deleteBannerModal === null) return;
    const id = deleteBannerModal;

    // @ts-ignore
    setBanners((bs: Banner[] | null) => {
      const actualBs = bs || [];
      const banner = actualBs.find(b => b.id === id);
      if (!banner) return bs;

      // Return population to the village (only for regular banners, not mercenaries)
      if (banner.type === 'regular' && banner.recruited > 0) {
        setPopulation(p => p + banner.recruited);
      }

      // Remove banner from missions if deployed
      if (banner.status === 'deployed') {
        setMissions((ms) => ms.map((m) => ({
          ...m,
          staged: m.staged.filter(bid => bid !== id),
          deployed: m.deployed.filter(bid => bid !== id),
        })));
      }

      return actualBs.filter(b => b.id !== id);
    });

    setDeleteBannerModal(null);
    saveGame();
  }

  function deleteBanner(id: number) {
    if (editingBannerId === id) return; // Hard lock: Cannot delete while editing
    setDeleteBannerModal(id);
  }

  function addSquadToBanner(bannerId: number, unitType: UnitType) {
    setBanners(bs => bs.map((b: Banner) => {
      if (b.id !== bannerId) return b;

      // Ensure squads are initialized
      let bannerSquads = b.squads;
      if (!bannerSquads || bannerSquads.length === 0) {
        const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
        bannerSquads = squads;
      }

      // Check if banner already has 8 squads
      if (bannerSquads.length >= 8) {
        return b;
      }

      // Check iron cost
      const ironCost = ironCostPerSquad[unitType];
      if (ironCost > 0 && warehouse.iron < ironCost) {
        alert(`Not enough Iron. Required: ${ironCost}, available: ${warehouse.iron}.`);
        return b;
      }

      // Deduct iron if needed
      if (ironCost > 0) {
        setWarehouse(w => ({ ...w, iron: Math.max(0, w.iron - ironCost) }));
      }

      // Create new squad
      const category = unitCategory[unitType];
      const config = squadConfig[category];
      const newSquad: Squad = {
        id: squadSeqRef.current++,
        type: unitType,
        maxSize: config.maxSize,
        currentSize: 0 // Start empty, needs training
      };

      const updatedSquads = [...bannerSquads, newSquad];
      const updatedUnits = updatedSquads.map(s => s.type);

      // Update squad sequence
      setSquadSeq(squadSeqRef.current);

      // Regenerate banner name if not custom named
      const newName = b.customNamed ? b.name : generateBannerName(b.id, updatedSquads);

      return {
        ...b,
        squads: updatedSquads,
        units: updatedUnits,
        name: newName,
        // Recalculate required population
        reqPop: updatedSquads.reduce((sum, s) => {
          const cat = unitCategory[s.type];
          return sum + squadConfig[cat].reqPop;
        }, 0)
      };
    }));

    saveGame();
  }

  // Update a specific slot with a unit type (or remove if unitType is null)
  function updateSlotInBanner(bannerId: number, slotIndex: number, unitType: UnitType | null) {
    // HARD LOCK check: Must be editing this specific banner
    if (bannerId !== editingBannerId || !bannersDraft) {
      // Just return silently as UI should be locked, or log warning
      console.warn("Attempted to modify banner without Edit Mode active");
      return;
    }

    const b = bannersDraft;

    // Ensure squads are initialized
    let bannerSquads = b.squads || [];
    let updatedSquads = [...bannerSquads];

    // If removing unit
    if (unitType === null) {
      updatedSquads = updatedSquads.filter(s => s.slotIndex !== slotIndex);
    } else {
      // Check iron cost if adding
      const ironCost = ironCostPerSquad[unitType];
      if (ironCost > 0 && warehouse.iron < ironCost) {
        alert(`Not enough Iron. Required: ${ironCost}, available: ${warehouse.iron}.`);
        return;
      }

      // Deduct iron if needed
      if (ironCost > 0) {
        setWarehouse(w => ({ ...w, iron: Math.max(0, w.iron - ironCost) }));
      }

      // Create new squad or update existing
      const category = unitCategory[unitType];
      const config = squadConfig[category];
      const existingSquadIndex = updatedSquads.findIndex(s => s.slotIndex === slotIndex);

      if (existingSquadIndex !== -1) {
        // Replace existing squad
        updatedSquads[existingSquadIndex] = {
          ...updatedSquads[existingSquadIndex],
          type: unitType,
          maxSize: config.maxSize,
          currentSize: 0 // Reset to 0 when changing unit type
        };
      } else {
        // Create new squad
        updatedSquads.push({
          id: squadSeqRef.current++,
          type: unitType,
          maxSize: config.maxSize,
          currentSize: 0,
          slotIndex: slotIndex
        });
        setSquadSeq(squadSeqRef.current);
      }
    }

    const updatedUnits = updatedSquads.map(s => s.type);

    // Regenerate banner name if not custom named
    const newName = b.customNamed ? b.name : generateBannerName(b.id, updatedSquads);

    // Update the draft
    setBannersDraft({
      ...b,
      squads: updatedSquads,
      units: updatedUnits,
      name: newName,
      // Recalculate required population
      reqPop: updatedSquads.reduce((sum, s) => {
        const cat = unitCategory[s.type];
        return sum + squadConfig[cat].reqPop;
      }, 0)
    });

    // NOTE: We do NOT saveGame() here. We wait for Confirm.
  }

  function createNewBanner() {
    const isRegularArmyTab = armyTab === 'regular';

    // Create a new empty banner
    const initialXP = 0;
    const initialLevelInfo = calculateLevelFromXP(initialXP);

    const newBanner: Banner = {
      id: bannerSeq,
      name: `Banner ${bannerSeq}`,
      units: [],
      squads: [],
      status: 'idle',
      reqPop: 0,
      recruited: 0,
      type: 'regular',
      customNamed: false,
      xp: initialXP,
      level: initialLevelInfo.level,
      xpCurrentLevel: initialLevelInfo.xpCurrentLevel,
      xpNextLevel: initialLevelInfo.xpNextLevel,
    };

    setBanners(bs => [...bs, newBanner]);
    if (isRegularArmyTab) {
      // Enter edit mode immediately
      // We manually set draft because 'banners' state update is async and startEditingBanner wouldn't find it yet
      setBannersDraft(JSON.parse(JSON.stringify(newBanner)));
      setEditingBannerId(newBanner.id);
    }

    setBannerSeq(n => n + 1);
    saveGame();
  }

  function confirmDeleteSquad() {
    if (!deleteSquadModal) return;

    const { bannerId, squadId } = deleteSquadModal;
    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;

    // Ensure squads are initialized
    let displaySquads = banner.squads;
    if (!displaySquads || displaySquads.length === 0) {
      const { squads } = initializeSquadsFromUnits(banner.units, squadSeqRef.current);
      displaySquads = squads;
    }

    const squad = displaySquads.find(s => s.id === squadId);
    if (!squad) return;

    // Calculate refunds (only for trained units)
    const category = unitCategory[squad.type];
    const config = squadConfig[category];
    const perUnitPop = config.reqPop / config.maxSize;
    const perUnitIron = (ironCostPerSquad[squad.type] || 0) / config.maxSize;
    const populationRefund = Math.floor(perUnitPop * squad.currentSize); // proportional to trained soldiers
    const ironRefund = Math.floor(perUnitIron * squad.currentSize * 0.5); // 50% of trained soldiers' iron cost

    // Apply refunds
    if (populationRefund > 0) {
      setPopulation(p => p + populationRefund);
    }
    setWarehouse(w => ({
      ...w,
      iron: Math.min(warehouseCap.iron, w.iron + ironRefund)
    }));

    // Remove squad from banner
    setBanners(bs => bs.map(b => {
      if (b.id !== bannerId) return b;

      // Ensure squads are initialized
      let bannerSquads = b.squads;
      if (!bannerSquads || bannerSquads.length === 0) {
        const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
        bannerSquads = squads;
      }

      // Remove the squad
      const remainingSquads = bannerSquads.filter(s => s.id !== squadId);

      // Update units array for backward compatibility
      const remainingUnits = remainingSquads.map(s => s.type);

      return {
        ...b,
        squads: remainingSquads,
        units: remainingUnits,
        // Recalculate required population
        reqPop: remainingSquads.reduce((sum, s) => {
          const cat = unitCategory[s.type];
          return sum + squadConfig[cat].reqPop;
        }, 0)
      };
    }));

    // Close modal
    setDeleteSquadModal(null);

    // Save game
    saveGame();
  }

  // === Missions helpers ===
  function assignBannerToMission(missionId: number, bannerId: number) {
    setMissions((ms) => ms.map((m) => {
      if (m.id !== missionId || m.status !== 'available') return m;
      // Replace staged with single banner (one banner per mission)
      return { ...m, staged: [bannerId] };
    }));
    // Close the selector after assignment
    setMissionBannerSelector(null);
  }

  function confirmSendMission(missionId: number) {
    const mission = missions.find(m => m.id === missionId);
    if (!mission || mission.status !== 'available') return;
    const staged = mission.staged;
    if (staged.length === 0) return;

    // Set loading state
    setMissionLoading(missionId);

    // Simulate mission processing (immediate for now, but can add delay if needed)
    setTimeout(() => {
      setMissions((ms) => ms.map((m) => m.id === missionId ? { ...m, status: 'running', deployed: staged, staged: [], elapsed: 0, startTime: Date.now() } : m));
      setBanners((bs) => bs.map((b) => staged.includes(b.id) ? { ...b, status: 'deployed' } : b));

      // Remove banners from fortress garrisons if they're being deployed on a mission
      setExpeditions((exps) => exps.map((exp) => {
        if (!exp.fortress) return exp;
        const garrison = exp.fortress.garrison || [];
        const updatedGarrison = garrison.filter(id => !staged.includes(id));
        if (updatedGarrison.length === garrison.length) return exp;
        return {
          ...exp,
          fortress: {
            ...exp.fortress,
            garrison: updatedGarrison
          }
        };
      }));

      setMissionLoading(null);
      saveGame(); // Save when mission starts
    }, 500); // Short delay for UX
  }
  function claimMissionReward(missionId: number) {
    const mission = missions.find(m => m.id === missionId);
    if (!mission || (mission.status as any) !== 'complete') return;

    // Calculate rewards if missing (retroactive for missions completed before rewards system)
    let rewards = mission.rewards;
    if (!rewards) {
      const enemyTotal = getEnemyTotal(mission.enemyComposition);
      const baseGold = enemyTotal > 0 ? Math.max(1, Math.floor(enemyTotal * 2)) : 1;
      rewards = {
        gold: baseGold,
        wood: enemyTotal > 0 ? Math.floor(enemyTotal * 0.5) : 0,
        stone: enemyTotal > 0 ? Math.floor(enemyTotal * 0.3) : 0
      };
    }

    // Grant rewards
    setWarehouse((w) => ({
      ...w,
      gold: w.gold + (rewards.gold || 0),
      wood: w.wood + (rewards.wood || 0),
      stone: w.stone + (rewards.stone || 0),
      food: w.food + (rewards.food || 0),
      iron: w.iron + (rewards.iron || 0)
    }));

    // Start cooldown and clear report/rewards
    const cooldownEndTime = Date.now() + (MISSION_COOLDOWN_SECONDS * 1000);
    setMissions((ms) => ms.map((m) =>
      m.id === missionId
        ? { ...m, status: 'available', elapsed: 0, deployed: [], staged: [], battleResult: undefined, rewards: undefined, cooldownEndTime }
        : m
    ));
    setRewardModal(null);
    saveGame(); // Save when mission reward is claimed
  }

  // === Fortress Building Config ===
  const WATCH_POST_ARCHERS_PER_LEVEL = 5; // Config: archers per Watch Post level

  // === Battle Config ===
  const BATTLE_PROGRESS_DURATION_MS = 3000; // Config: battle progress animation duration

  // === Mission Config ===
  const MISSION_COOLDOWN_SECONDS = 10; // Config: cooldown duration after claiming reward

  // === Fortress Building Definitions ===
  function createInitialFortressBuildings(): FortressBuilding[] {
    return [
      {
        id: 'palisade_wall',
        name: 'Palisade Wall',
        level: 1,
        maxLevel: 5,
        description: '+400 Fort HP',
        getEffect: (level) => ({ fortHP: 400 * level }),
        getUpgradeCost: (level) => ({ wood: 150 * level, stone: 75 * level }),
      },
      {
        id: 'watch_post',
        name: 'Watch Post',
        level: 1,
        maxLevel: 5,
        description: `+${WATCH_POST_ARCHERS_PER_LEVEL} Archer slots (max ${WATCH_POST_ARCHERS_PER_LEVEL} archers shooting from walls)`,
        getEffect: (level) => ({ archerSlots: WATCH_POST_ARCHERS_PER_LEVEL * level }),
        getUpgradeCost: (level) => ({ wood: 100 * level, stone: 50 * level }),
      },
      {
        id: 'garrison_hut',
        name: 'Garrison Hut',
        level: 1,
        maxLevel: 5,
        description: '+5 Garrison capacity',
        getEffect: (level) => ({ garrisonWarriors: 5 * level, garrisonArchers: 5 * level }),
        getUpgradeCost: (level) => ({ wood: 120 * level, stone: 60 * level }),
      },
    ];
  }

  function calculateFortressStats(buildings: FortressBuilding[]): FortressStats {
    const stats: FortressStats = {
      fortHP: 0,
      archerSlots: 0,
      garrisonWarriors: 0,
      garrisonArchers: 0,
      storedSquads: 1, // Base value
    };

    buildings.forEach(building => {
      const effect = building.getEffect(building.level);
      if (effect.fortHP) stats.fortHP += effect.fortHP;
      if (effect.archerSlots) stats.archerSlots += effect.archerSlots;
      if (effect.garrisonWarriors) stats.garrisonWarriors += effect.garrisonWarriors;
      if (effect.garrisonArchers) stats.garrisonArchers += effect.garrisonArchers;
      if (effect.storedSquads) stats.storedSquads += effect.storedSquads;
    });

    return stats;
  }

  // === Expeditions helpers ===
  function acceptExpedition(expeditionId: string) {
    setExpeditions((exps) => exps.map((exp) =>
      exp.expeditionId === expeditionId ? { ...exp, state: 'funding' } : exp
    ));
  }

  function sendResourceToExpedition(expeditionId: string, resourceType: 'wood' | 'stone' | 'food' | 'population') {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition || expedition.state !== 'funding') return;

    const req = expedition.requirements[resourceType];
    const remaining = req.required - req.current;
    if (remaining <= 0) return;

    let amountToSend = 0;
    let newWarehouse = { ...warehouse };
    let newPopulation = population;

    if (resourceType === 'population') {
      amountToSend = Math.min(remaining, newPopulation);
      newPopulation = Math.max(0, newPopulation - amountToSend);
      setPopulation(newPopulation);
    } else {
      const currentStock = warehouse[resourceType];
      amountToSend = Math.min(remaining, currentStock);
      newWarehouse = { ...newWarehouse, [resourceType]: Math.max(0, currentStock - amountToSend) };
      setWarehouse(newWarehouse);
    }

    if (amountToSend > 0) {
      setExpeditions((exps) => exps.map((exp) => {
        if (exp.expeditionId !== expeditionId) return exp;
        const newReq = { ...exp.requirements };
        newReq[resourceType] = { ...newReq[resourceType], current: newReq[resourceType].current + amountToSend };

        // Check if all requirements are met
        const allComplete =
          newReq.wood.current >= newReq.wood.required &&
          newReq.stone.current >= newReq.stone.required &&
          newReq.food.current >= newReq.food.required &&
          newReq.population.current >= newReq.population.required;

        return {
          ...exp,
          requirements: newReq,
          state: allComplete ? 'readyToLaunch' : 'funding',
        };
      }));
    }
  }

  function launchExpedition(expeditionId: string) {
    setExpeditions((exps) => exps.map((exp) =>
      exp.expeditionId === expeditionId ? { ...exp, state: 'travelling', travelProgress: 0 } : exp
    ));

    // Start 3-second timer
    let progress = 0;
    const interval = setInterval(() => {
      progress += 100 / 30; // 30 updates over 3 seconds (100ms each)
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        // Initialize fortress when expedition completes
        setExpeditions((exps) => exps.map((exp) => {
          if (exp.expeditionId !== expeditionId) return exp;
          const buildings = createInitialFortressBuildings();
          const stats = calculateFortressStats(buildings);
          return {
            ...exp,
            state: 'completed',
            travelProgress: 100,
            fortress: { buildings, stats, garrison: [] }
          };
        }));
      } else {
        setExpeditions((exps) => exps.map((exp) =>
          exp.expeditionId === expeditionId ? { ...exp, travelProgress: progress } : exp
        ));
      }
    }, 100);
  }

  function upgradeFortressBuilding(expeditionId: string, buildingId: string) {
    const exp = expeditions.find(e => e.expeditionId === expeditionId);
    if (!exp || !exp.fortress) return;

    const building = exp.fortress.buildings.find(b => b.id === buildingId);
    if (!building || building.level >= building.maxLevel) return;

    const nextLevel = building.level + 1;
    const cost = building.getUpgradeCost(nextLevel);

    // Check if player has enough resources
    if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return;

    // Deduct resources
    setWarehouse(w => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));

    // Upgrade building
    setExpeditions((exps) => exps.map((e) => {
      if (e.expeditionId !== expeditionId || !e.fortress) return e;

      const updatedBuildings = e.fortress.buildings.map(b =>
        b.id === buildingId ? { ...b, level: nextLevel } : b
      );

      // Recalculate stats
      const stats = calculateFortressStats(updatedBuildings);

      return {
        ...e,
        fortress: {
          ...e.fortress,
          buildings: updatedBuildings,
          stats,
        },
      };
    }));
  }

  function assignBannerToFortress(expeditionId: string, bannerId: number) {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress) return;

    const banner = banners.find(b => b.id === bannerId);
    if (!banner || banner.status !== 'ready') return;

    // Check if banner is already in garrison
    if ((expedition.fortress.garrison || []).includes(bannerId)) return;

    // Add banner to garrison
    setExpeditions((exps) => exps.map((exp) => {
      if (exp.expeditionId !== expeditionId || !exp.fortress) return exp;
      return {
        ...exp,
        fortress: {
          ...exp.fortress,
          garrison: [...(exp.fortress.garrison || []), bannerId]
        }
      };
    }));

    // Update banner status to deployed
    setBanners((bs) => bs.map((b) =>
      b.id === bannerId ? { ...b, status: 'deployed' } : b
    ));
  }

  function calculateGarrisonFromBanners(garrisonBannerIds: number[]): { warriors: number; archers: number } {
    let warriors = 0;
    let archers = 0;

    garrisonBannerIds.forEach(bannerId => {
      const banner = banners.find(b => b.id === bannerId);
      if (!banner || !banner.squads) return;

      banner.squads.forEach(squad => {
        if (squad.type === 'warrior') {
          warriors += squad.currentSize;
        } else if (squad.type === 'archer') {
          archers += squad.currentSize;
        }
      });
    });

    return { warriors, archers };
  }

  // Calculate active wall archers (limited by Watch Post capacity)
  // Watch Post only affects Phase 1 (walls up) - it's a capacity limit, not extra units
  function calculateActiveWallArchers(expeditionId: string): { available: number; capacity: number; active: number } {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress) {
      return { available: 0, capacity: 0, active: 0 };
    }

    // Get Watch Post level to calculate wall archer capacity
    const watchPost = expedition.fortress.buildings.find(b => b.id === 'watch_post');
    const watchPostLevel = watchPost?.level || 0;
    const wallArcherCapacity = watchPostLevel * WATCH_POST_ARCHERS_PER_LEVEL;

    // Calculate available archers from garrison banners (real units only)
    const garrisonBannerIds = expedition.fortress.garrison || [];
    const garrison = calculateGarrisonFromBanners(garrisonBannerIds);
    const availableArchers = garrison.archers || 0;

    // Active wall archers = min(available archers, wall capacity)
    // Watch Post never creates units, only limits how many can shoot
    const activeWallArchers = Math.min(availableArchers, wallArcherCapacity);

    return {
      available: availableArchers,
      capacity: wallArcherCapacity,
      active: activeWallArchers
    };
  }

  function applyFortressBattleCasualties(expeditionId: string, result: SiegeBattleResult): number[] {
    console.log('[BATTLE] applyFortressBattleCasualties called', { expeditionId, result });
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress || !expedition.fortress.garrison || expedition.fortress.garrison.length === 0) {
      console.log('[BATTLE] No fortress or garrison found');
      return [];
    }

    const garrisonIds = expedition.fortress.garrison;
    console.log('[BATTLE] Garrison IDs:', garrisonIds);
    const garrisonBanners = banners.filter(b => garrisonIds.includes(b.id));
    console.log('[BATTLE] Garrison banners found:', garrisonBanners.length, garrisonBanners.map(b => ({ id: b.id, name: b.name, type: b.type })));
    if (garrisonBanners.length === 0) {
      console.log('[BATTLE] No garrison banners found');
      return [];
    }

    const bannerInfos = garrisonBanners.map(banner => {
      const warriorCount = banner.squads
        ? banner.squads.filter(s => s.type === 'warrior').reduce((sum, squad) => sum + squad.currentSize, 0)
        : 0;
      const archerCount = banner.squads
        ? banner.squads.filter(s => s.type === 'archer').reduce((sum, squad) => sum + squad.currentSize, 0)
        : 0;
      return {
        id: banner.id,
        name: banner.name,
        type: banner.type,
        warriorCount,
        archerCount,
      };
    });

    const totalWarriors = bannerInfos.reduce((sum, info) => sum + info.warriorCount, 0);
    const totalArchers = bannerInfos.reduce((sum, info) => sum + info.archerCount, 0);
    if (totalWarriors === 0 && totalArchers === 0) return [];

    // Calculate final garrison counts
    let finalWarriors: number;
    let finalArchers: number;

    const totalInitial = totalWarriors + totalArchers;
    const initialTotal = result.initialGarrison.warriors + result.initialGarrison.archers;

    if (result.finalGarrison) {
      // Use explicit finalGarrison if available
      finalWarriors = Math.max(0, Math.round(result.finalGarrison.warriors));
      finalArchers = Math.max(0, Math.round(result.finalGarrison.archers));
    } else if (result.finalDefenders === 0 || (result.outcome === 'fortress_falls' && result.innerTimeline.length === 0)) {
      // All defenders were killed (either explicitly 0, or fortress fell without inner battle tracking)
      finalWarriors = 0;
      finalArchers = 0;
    } else {
      // finalGarrison not set but defenders remain - distribute proportionally
      if (totalInitial > 0) {
        const warriorRatio = totalWarriors / totalInitial;
        const archerRatio = totalArchers / totalInitial;
        finalWarriors = Math.max(0, Math.round(result.finalDefenders * warriorRatio));
        finalArchers = Math.max(0, Math.round(result.finalDefenders * archerRatio));
      } else {
        finalWarriors = totalWarriors;
        finalArchers = totalArchers;
      }
    }

    const warriorLosses = Math.max(0, totalWarriors - finalWarriors);
    const archerLosses = Math.max(0, totalArchers - finalArchers);

    console.log('[BATTLE] Loss calculation:', {
      totalWarriors,
      totalArchers,
      finalWarriors,
      finalArchers,
      warriorLosses,
      archerLosses,
      finalDefenders: result.finalDefenders,
      outcome: result.outcome
    });

    if (warriorLosses === 0 && archerLosses === 0) {
      console.log('[BATTLE] No losses detected, returning early');
      return [];
    }

    const warriorAllocation = distributeTypeLossesAcrossBanners(
      bannerInfos.map(info => ({ bannerId: info.id, count: info.warriorCount })),
      warriorLosses
    );
    const archerAllocation = distributeTypeLossesAcrossBanners(
      bannerInfos.map(info => ({ bannerId: info.id, count: info.archerCount })),
      archerLosses
    );

    const lossPerBanner = new Map<number, { warriors: number; archers: number }>();
    warriorAllocation.forEach((loss, bannerId) => {
      if (loss <= 0) return;
      const existing = lossPerBanner.get(bannerId) || { warriors: 0, archers: 0 };
      existing.warriors = loss;
      lossPerBanner.set(bannerId, existing);
    });
    archerAllocation.forEach((loss, bannerId) => {
      if (loss <= 0) return;
      const existing = lossPerBanner.get(bannerId) || { warriors: 0, archers: 0 };
      existing.archers = loss;
      lossPerBanner.set(bannerId, existing);
    });

    const destroyedIds: number[] = [];
    const noticesToAdd: BannerLossNotice[] = [];
    const commandersToUpdate: Commander[] = [];
    const timestamp = Date.now();

    // Process banners and collect notices
    const updatedBanners = banners.reduce<Banner[]>((next, banner) => {
      if (!garrisonIds.includes(banner.id)) {
        next.push(banner);
        return next;
      }

      const losses = lossPerBanner.get(banner.id);
      console.log('[BATTLE] Processing banner:', { id: banner.id, name: banner.name, type: banner.type, losses });
      if (!losses || (!losses.warriors && !losses.archers)) {
        console.log('[BATTLE] No losses for banner', banner.name);
        next.push(banner);
        return next;
      }

      if (!banner.squads || banner.squads.length === 0) {
        console.log('[BATTLE] Banner has no squads', banner.name);
        next.push(banner);
        return next;
      }

      // Calculate battle stats for XP
      const startTroops = banner.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
      const enemyCasualties = result.initialAttackers - result.finalAttackers;
      // Distribute enemy casualties proportionally across all garrison banners
      const totalGarrisonStart = garrisonBanners.reduce((sum, b) =>
        sum + b.squads.reduce((s, sq) => s + sq.currentSize, 0), 0);
      const bannerShare = totalGarrisonStart > 0 ? startTroops / totalGarrisonStart : 0;
      const bannerEnemyCasualties = Math.floor(enemyCasualties * bannerShare);

      const isVictory = result.outcome === 'fortress_holds_walls' || result.outcome === 'fortress_holds_inner';

      const updatedBanner: Banner = {
        ...banner,
        squads: banner.squads.map(squad => ({ ...squad })),
      };

      trimSquadsByType(updatedBanner.squads, 'warrior', losses.warriors || 0);
      trimSquadsByType(updatedBanner.squads, 'archer', losses.archers || 0);

      const totalRemaining = updatedBanner.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
      const totalLossesForBanner = (losses.warriors || 0) + (losses.archers || 0);
      const survived = totalRemaining > 0;
      const ownCasualties = startTroops - totalRemaining;

      // Calculate banner XP gain (for commander)
      const bannerXPGain = calculateBannerXPGain(bannerEnemyCasualties, isVictory, survived);

      // Update banner XP
      const bannerWithXP = updateBannerXP(
        updatedBanner,
        bannerEnemyCasualties,
        ownCasualties,
        startTroops,
        isVictory,
        survived
      );

      // Update commander XP if banner has a commander (store for later update)
      const bannerCommander = banner.commanderId
        ? commanders.find(c => c.id === banner.commanderId)
        : null;
      if (bannerCommander) {
        const updatedCommander = updateCommanderXP(bannerCommander, bannerXPGain);
        commandersToUpdate.push(updatedCommander);
      }

      if (totalRemaining <= 0) {
        destroyedIds.push(bannerWithXP.id);
        // Capture banner info from original banner before it's removed
        const bannerType = banner.type || 'regular';
        const bannerName = banner.name;
        const notice = {
          id: `${banner.id}-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          bannerName: bannerName,
          bannerType: bannerType,
          message: `${bannerName} was decimated in the battle.`,
        };
        console.log('[BATTLE] Banner destroyed, creating notice:', notice);
        noticesToAdd.push(notice);
        return next;
      }

      if (totalLossesForBanner > 0) {
        // Capture banner info from original banner
        const bannerType = banner.type || 'regular';
        const bannerName = banner.name;
        const notice = {
          id: `${banner.id}-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          bannerName: bannerName,
          bannerType: bannerType,
          message: `${bannerName} suffered ${totalLossesForBanner} losses defending the fortress.`,
        };
        noticesToAdd.push(notice);
      }

      next.push(bannerWithXP);
      return next;
    }, []);

    // Update banners state
    setBanners(updatedBanners);

    // Update commanders state
    if (commandersToUpdate.length > 0) {
      setCommanders((cs) => cs.map(c => {
        const updated = commandersToUpdate.find(u => u.id === c.id);
        return updated || c;
      }));
    }

    // Update notifications state
    console.log('[BATTLE] Finished processing banners. noticesToAdd.length:', noticesToAdd.length, 'noticesToAdd:', noticesToAdd);

    if (noticesToAdd.length > 0) {
      console.log('[BATTLE] Creating notifications:', noticesToAdd);
      setBannerLossNotices((prev) => {
        const updated = [...prev, ...noticesToAdd];
        console.log('[BATTLE] Updated notification state. Previous count:', prev.length, 'New count:', updated.length, 'All notices:', updated);
        return updated;
      });
    } else {
      console.log('[BATTLE] WARNING: No notifications to add (noticesToAdd is empty)');
    }

    return destroyedIds;
  }

  function runSiegeBattle(
    expeditionId: string,
    attackers: number
  ): SiegeBattleResult {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress) {
      throw new Error('Fortress not found');
    }

    const stats = getUnitStats();
    const p = getBattleParams();
    const baseCas = p.base_casualty_rate || 0.7;
    const maxRounds = 30;

    const fortHPmax = expedition.fortress.stats.fortHP;

    // Calculate actual garrison from stationed banners (real units only)
    // IMPORTANT: Never use stats.garrisonArchers/Warriors as actual units - those are capacity limits only
    const garrisonBannerIds = expedition.fortress.garrison || [];
    const actualGarrison = calculateGarrisonFromBanners(garrisonBannerIds);

    // Use ONLY actual units from banners - if no banners assigned, defenders = 0
    const garrisonArchers = actualGarrison.archers || 0;
    const garrisonWarriors = actualGarrison.warriors || 0;

    // Calculate active wall archers (limited by Watch Post capacity) for Phase 1 only
    const wallArchers = calculateActiveWallArchers(expeditionId);
    const activeArchers = wallArchers.active; // Only archers that can shoot from walls in phase 1

    // Debug logging
    console.log('[SIEGE] Defenders from banners:', { garrisonArchers, garrisonWarriors });
    console.log('[SIEGE] Watch Post capacity:', wallArchers.capacity, 'Active wall archers:', activeArchers);

    // Unit stats for siege
    const wSkirmish = stats.warrior?.skirmish_attack || 0;
    const wMelee = stats.warrior?.melee_attack || 15;
    const aSkirmish = stats.archer?.skirmish_attack || 15;

    let fortHP = fortHPmax;
    let remainingAttackers = attackers;
    const siegeTimeline: SiegeRound[] = [];
    let finalGarrison = { warriors: garrisonWarriors, archers: garrisonArchers };

    // Siege phase
    let rounds = 0;
    while (fortHP > 0 && remainingAttackers > 0 && rounds < maxRounds) {
      rounds++;

      const dmgFromArchers = (activeArchers / 100) * aSkirmish * baseCas;
      const killed = Math.min(remainingAttackers, dmgFromArchers);
      remainingAttackers -= killed;

      const fortDamagePerWarrior = wMelee * 0.2;
      const dmgToFort = remainingAttackers * fortDamagePerWarrior * baseCas;
      fortHP = Math.max(0, fortHP - dmgToFort);

      siegeTimeline.push({
        round: rounds,
        fortHP,
        attackers: remainingAttackers,
        archers: activeArchers,
        killed,
        dmgToFort
      });
    }

    // Inner battle phase (if walls fall)
    // IMPORTANT: Inner battle uses ONLY actual units from banners, NOT Watch Post capacity
    // Watch Post slots do NOT apply in inner battle - they only limit Phase 1 wall archers
    let innerTimeline: InnerBattleStep[] = [];
    if (fortHP <= 0 && remainingAttackers > 0 && (garrisonWarriors + garrisonArchers) > 0) {
      const battleStats = {
        warrior: { skirmish: wSkirmish, melee: wMelee },
        archer: { skirmish: aSkirmish, melee: aSkirmish * 0.3 }
      };
      console.log('[SIEGE] Starting inner battle with defenders:', { garrisonWarriors, garrisonArchers });
      innerTimeline = runInnerBattle(garrisonWarriors, garrisonArchers, remainingAttackers, battleStats, baseCas);
    } else if (fortHP <= 0 && remainingAttackers > 0) {
      console.log('[SIEGE] No inner battle - no defenders from banners');
    }

    // Determine outcome
    const lastSiege = siegeTimeline[siegeTimeline.length - 1];
    let outcome: SiegeBattleResult['outcome'];
    let finalAttackers = lastSiege.attackers;
    let finalDefenders = garrisonWarriors + garrisonArchers;

    if (lastSiege.attackers <= 0 && lastSiege.fortHP > 0) {
      outcome = 'fortress_holds_walls';
    } else if (lastSiege.fortHP <= 0 && lastSiege.attackers > 0) {
      if (innerTimeline.length > 0) {
        const lastInner = innerTimeline[innerTimeline.length - 1];
        finalAttackers = lastInner.attackers;
        finalDefenders = lastInner.defenders;
        finalGarrison = { warriors: lastInner.defWarriors, archers: lastInner.defArchers };
        if (finalDefenders > 0 && finalAttackers <= 0) {
          outcome = 'fortress_holds_inner';
        } else if (finalAttackers > 0 && finalDefenders <= 0) {
          outcome = 'fortress_falls';
        } else {
          outcome = 'stalemate';
        }
      } else {
        outcome = 'fortress_falls';
      }
    } else {
      outcome = 'stalemate';
    }

    return {
      outcome,
      siegeRounds: rounds,
      finalFortHP: lastSiege.fortHP,
      finalAttackers,
      finalDefenders,
      siegeTimeline,
      innerTimeline,
      initialFortHP: fortHPmax,
      initialAttackers: attackers,
      initialGarrison: { warriors: garrisonWarriors, archers: garrisonArchers },
      finalGarrison,
    };
  }

  function runInnerBattle(
    defWarriorsStart: number,
    defArchersStart: number,
    attackersStart: number,
    stats: { warrior: { skirmish: number; melee: number }; archer: { skirmish: number; melee: number } },
    baseCas: number
  ): InnerBattleStep[] {
    let defWarriors = defWarriorsStart;
    let defArchers = defArchersStart;
    let attackers = attackersStart;
    const tl: InnerBattleStep[] = [];
    let step = 0;
    const maxSteps = 50;

    while (attackers > 0 && (defWarriors + defArchers) > 0 && step < maxSteps) {
      step++;
      const defTotal = defWarriors + defArchers;

      let phase: 'skirmish' | 'melee' | 'pursuit';
      if (step <= 3) {
        phase = 'skirmish';
      } else if (step <= 13) {
        phase = 'melee';
      } else {
        phase = 'pursuit';
      }

      let killedAtk = 0;
      let killedDef = 0;

      if (phase === 'skirmish') {
        const defDmg = ((defArchers / 100) * stats.archer.skirmish + (defWarriors / 100) * stats.warrior.skirmish * 0.3) * baseCas;
        killedAtk = Math.min(attackers, defDmg);
        const atkDmg = (attackers / 100) * stats.warrior.skirmish * baseCas * 0.4;
        killedDef = Math.min(defTotal, atkDmg);
      } else if (phase === 'melee') {
        // Calculate weighted average melee stat for defenders (warriors + archers)
        const warriorShare = defTotal > 0 ? defWarriors / defTotal : 0;
        const archerShare = defTotal > 0 ? defArchers / defTotal : 0;
        const avgDefMelee = (warriorShare * stats.warrior.melee) + (archerShare * stats.archer.melee);

        const defDmg = (defTotal / 100) * avgDefMelee * baseCas;
        const atkDmg = (attackers / 100) * stats.warrior.melee * baseCas;
        killedAtk = Math.min(attackers, defDmg);
        killedDef = Math.min(defTotal, atkDmg);
      } else if (phase === 'pursuit') {
        // Calculate weighted average melee stat for defenders in pursuit
        const warriorShare = defTotal > 0 ? defWarriors / defTotal : 0;
        const archerShare = defTotal > 0 ? defArchers / defTotal : 0;
        const avgDefMelee = (warriorShare * stats.warrior.melee) + (archerShare * stats.archer.melee);

        if (attackers > defTotal) {
          const atkDmg = (attackers / 100) * stats.warrior.melee * baseCas * 1.2;
          killedDef = Math.min(defTotal, atkDmg);
        } else {
          const defDmg = (defTotal / 100) * avgDefMelee * baseCas * 1.2;
          killedAtk = Math.min(attackers, defDmg);
        }
      }

      if (defTotal > 0 && killedDef > 0) {
        const wShare = defWarriors / defTotal;
        const aShare = defArchers / defTotal;
        const kW = Math.min(defWarriors, killedDef * wShare);
        const kA = Math.min(defArchers, killedDef * aShare);
        defWarriors -= kW;
        defArchers -= kA;
      }

      attackers = Math.max(0, attackers - killedAtk);

      tl.push({
        step,
        phase,
        defWarriors,
        defArchers,
        defenders: defWarriors + defArchers,
        attackers,
        killedAttackers: killedAtk,
        killedDefenders: killedDef
      });
    }

    return tl;
  }

  function removeBannerFromFortress(expeditionId: string, bannerId: number) {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress) return;

    // Remove banner from garrison
    setExpeditions((exps) => exps.map((exp) => {
      if (exp.expeditionId !== expeditionId || !exp.fortress) return exp;
      return {
        ...exp,
        fortress: {
          ...exp.fortress,
          garrison: (exp.fortress.garrison || []).filter(id => id !== bannerId)
        }
      };
    }));

    // Update banner status back to ready
    setBanners((bs) => bs.map((b) =>
      b.id === bannerId ? { ...b, status: 'ready' } : b
    ));
  }

  function dismissBannerLossNotice(noticeId: string) {
    setBannerLossNotices((notices) => notices.filter((notice) => notice.id !== noticeId));
  }

  // Create reinforcement training entry
  function requestReinforcement(bannerId: number, squadId?: number) {
    if (editingBannerId === bannerId) return; // Hard lock: Cannot reinforce while editing

    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;

    // Guard: Don't allow reinforcing destroyed banners
    if (banner.status === 'destroyed') return;

    // Ensure banner has squads initialized
    let bannerWithSquads = banner;
    if (!bannerWithSquads.squads || bannerWithSquads.squads.length === 0) {
      const { squads, nextSeq } = initializeSquadsFromUnits(bannerWithSquads.units, squadSeq);
      bannerWithSquads = { ...bannerWithSquads, squads };
      setSquadSeq(nextSeq);
      squadSeqRef.current = nextSeq;
    }

    const isFullReinforcement = squadId === undefined;
    const squad = isFullReinforcement ? null : bannerWithSquads.squads.find(s => s.id === squadId);
    if (!isFullReinforcement && !squad) return;

    if (!isFullReinforcement && squad) {
      const missing = squad.maxSize - squad.currentSize;
      if (missing <= 0) return;

      // Handle mercenary vs regular banners differently
      if (banner.type === 'mercenary') {
        const goldCost = missing;
        setReinforcementModal({
          bannerId,
          squadId: squad.id,
          goldCost,
          soldiersNeeded: missing,
          bannerName: banner.name,
          squadType: unitDisplayNames[squad.type] || squad.type
        });
        return;
      }
    } else {
      // Full reinforcement: check if any squad is damaged
      const damagedSquads = bannerWithSquads.squads.filter(s => s.currentSize < s.maxSize);
      if (damagedSquads.length === 0) return;

      if (banner.type === 'mercenary') {
        const totalMissing = damagedSquads.reduce((sum, s) => sum + (s.maxSize - s.currentSize), 0);
        setHireAndRefillModal({
          bannerId,
          hireCost: 0,
          refillCost: totalMissing, // In this game, mercenary refill cost == missing population
          totalCost: totalMissing,
          bannerName: banner.name
        });
        return;
      }
    }

    if (banner.type === 'regular') {
      // Regular banner: Use normal training system (status: 'training')
      if (banner.status === 'training') return;

      setBanners((bs) => bs.map(b => {
        if (b.id !== bannerId) return b;

        const currentRecruited = b.squads.reduce((sum, s) => sum + s.currentSize, 0);
        const targetReqPop = b.squads.reduce((sum, s) => {
          const cat = unitCategory[s.type];
          return sum + (squadConfig[cat]?.reqPop || 10);
        }, 0);

        return {
          ...b,
          status: 'training',
          recruited: currentRecruited,
          reqPop: targetReqPop,
          reinforcingSquadId: squadId, // Track which squad is being reinforced, or undefined for all
        };
      }));
    }
  }

  // === Battle Simulation Functions ===
  // Unit stats state (can be updated with tested values from simulator)
  const [unitStats, setUnitStats] = useState<Record<UnitType, {
    skirmish_attack: number;
    skirmish_defence: number;
    melee_attack: number;
    melee_defence: number;
    pursuit: number;
    morale_per_100: number;
  }>>(() => {
    // Load from localStorage if available, otherwise use defaults
    const saved = localStorage.getItem('gameUnitStats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all new units are present
        return { ...getDefaultUnitStats(), ...parsed };
      } catch (e) {
        console.warn('Failed to parse saved unit stats, using defaults');
      }
    }
    return getDefaultUnitStats();
  });

  // Default unit stats (data-driven, easy to tweak)
  function getDefaultUnitStats(): Record<UnitType, {
    skirmish_attack: number;
    skirmish_defence: number;
    melee_attack: number;
    melee_defence: number;
    pursuit: number;
    morale_per_100: number;
  }> {
    return {
      // Existing units (unchanged)
      warrior: {
        skirmish_attack: 0,
        skirmish_defence: 15,
        melee_attack: 15,
        melee_defence: 12,
        pursuit: 3,
        morale_per_100: 110
      },
      archer: {
        skirmish_attack: 30,
        skirmish_defence: 6,
        melee_attack: 5,
        melee_defence: 5,
        pursuit: 4,
        morale_per_100: 80
      },
      // New ranged units
      skirmisher: {
        skirmish_attack: 18,
        skirmish_defence: 10,
        melee_attack: 10,
        melee_defence: 9,
        pursuit: 5,
        morale_per_100: 100
      },
      crossbowmen: {
        skirmish_attack: 42,
        skirmish_defence: 10,
        melee_attack: 3,
        melee_defence: 4,
        pursuit: 3,
        morale_per_100: 90
      },
      // New melee infantry
      militia: {
        skirmish_attack: 0,
        skirmish_defence: 8,
        melee_attack: 8,
        melee_defence: 6,
        pursuit: 2,
        morale_per_100: 70
      },
      longsword: {
        skirmish_attack: 0,
        skirmish_defence: 10,
        melee_attack: 22,
        melee_defence: 10,
        pursuit: 4,
        morale_per_100: 120
      },
      pikemen: {
        skirmish_attack: 0,
        skirmish_defence: 12,
        melee_attack: 10,
        melee_defence: 16,
        pursuit: 2,
        morale_per_100: 110
      },
      // New cavalry
      light_cavalry: {
        skirmish_attack: 6,
        skirmish_defence: 8,
        melee_attack: 16,
        melee_defence: 10,
        pursuit: 9,
        morale_per_100: 110
      },
      heavy_cavalry: {
        skirmish_attack: 4,
        skirmish_defence: 10,
        melee_attack: 24,
        melee_defence: 14,
        pursuit: 10,
        morale_per_100: 130
      }
    };
  }

  // Battle parameters state (can be updated from simulator) - MUST be before useEffect that uses setBattleParams
  const [battleParams, setBattleParams] = useState(() => {
    const saved = localStorage.getItem('gameBattleParams');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved battle params, using defaults');
      }
    }
    return {
      skirmish_ticks: 30,
      pursuit_ticks: 20,
      base_casualty_rate: 0.6,
      morale_per_casualty: 0.8,
      advantage_morale_tick: 3,
      break_pct: 35,
      rng_variance: 0.05
    };
  });

  // Listen for unit stats, battle params, and divisions updates from the combat simulator
  useEffect(() => {
    const handleStatsUpdate = (event: CustomEvent) => {
      const { stats, battleParams: newParams, divisions } = event.detail;
      if (stats) {
        setUnitStats(stats);
        localStorage.setItem('gameUnitStats', JSON.stringify(stats));
      }
      if (newParams) {
        setBattleParams(newParams);
        localStorage.setItem('gameBattleParams', JSON.stringify(newParams));
      }
      if (divisions) {
        localStorage.setItem('gameDivisions', JSON.stringify(divisions));
      }
    };

    window.addEventListener('unitStatsUpdated', handleStatsUpdate as EventListener);
    return () => {
      window.removeEventListener('unitStatsUpdated', handleStatsUpdate as EventListener);
    };
  }, []);

  // Functions to get current stats - these will always return the latest state values
  function getUnitStats() {
    return unitStats;
  }

  function getBattleParams() {
    return battleParams;
  }

  function per100(x: number) { return x / 100; }

  function total(div: Division) {
    let sum = 0;
    for (const unitType in div) {
      sum += div[unitType as UnitType] || 0;
    }
    return Math.max(0, sum);
  }

  // Helper to compute total from enemyComposition (works with both old {warrior, archer} and new Division format)
  function getEnemyTotal(comp: Division | { warrior?: number; archer?: number } | undefined): number {
    if (!comp) return 0;
    let sum = 0;
    for (const key in comp) {
      sum += (comp as any)[key] || 0;
    }
    return sum;
  }

  function morale(div: Division, stats: any) {
    let totalMorale = 0;
    for (const unitType in div) {
      const count = div[unitType as UnitType] || 0;
      const unitStat = stats[unitType as UnitType];
      if (unitStat) {
        totalMorale += per100(count) * unitStat.morale_per_100;
      }
    }
    return totalMorale;
  }

  function phaseStats(division: Division, stats: any, phase: string, commander?: Commander | null) {
    let EA = 0, ED = 0, P = 0;

    // Calculate level bonus multiplier if commander is present
    const levelBonusMultiplier = commander ? getCommanderLevelBonusMultiplier(commander.level || 1) : 1;

    for (const unitType in division) {
      const count = division[unitType as UnitType] || 0;
      const c100 = per100(count);
      const s = stats[unitType as UnitType];
      if (!s) continue;

      // Apply commander bonuses if present
      let skirmishAttack = s.skirmish_attack;
      let meleeAttack = s.melee_attack;
      let skirmishDefence = s.skirmish_defence;
      let meleeDefence = s.melee_defence;

      if (commander) {
        // Check if this is a ranged unit type
        const category = unitCategory[unitType as UnitType];
        const isRanged = category === 'ranged_infantry';
        const isMelee = category === 'infantry' || category === 'cavalry';

        if (isRanged) {
          // Ranged units: apply ranged bonus to skirmish attack, melee bonus to melee attack
          skirmishAttack = s.skirmish_attack * (1 + commander.rangedAttackBonusPercent / 100);
          meleeAttack = s.melee_attack * (1 + commander.meleeAttackBonusPercent / 100);
        } else if (isMelee) {
          // Melee units: apply melee bonus to melee attack, ranged bonus to skirmish attack (if any)
          meleeAttack = s.melee_attack * (1 + commander.meleeAttackBonusPercent / 100);
          skirmishAttack = s.skirmish_attack * (1 + commander.rangedAttackBonusPercent / 100);
        }

        // Apply level bonus multiplier to all stats (on top of archetype bonuses)
        skirmishAttack *= levelBonusMultiplier;
        meleeAttack *= levelBonusMultiplier;
        skirmishDefence *= levelBonusMultiplier;
        meleeDefence *= levelBonusMultiplier;
      }

      if (phase === 'skirmish') {
        EA += c100 * skirmishAttack;
        ED += c100 * skirmishDefence;
      } else if (phase === 'melee') {
        EA += c100 * meleeAttack;
        ED += c100 * meleeDefence;
      }
      P += c100 * s.pursuit;
    }
    return { EA: Math.max(0.1, EA), ED: Math.max(0.1, ED), P: Math.max(0, P) };
  }

  function applyCasualties(div: Division, losses: number) {
    const s = total(div);
    if (s <= 0 || losses <= 0) return;

    // Calculate proportional losses for each unit type
    for (const unitType in div) {
      const count = div[unitType as UnitType] || 0;
      const share = count / s;
      div[unitType as UnitType] = Math.max(0, count - losses * share);
    }
  }

  // Battle chart plotting function (based on battle simulator)
  function plotBattleChart(canvas: HTMLCanvasElement, timeline: BattleResult['timeline']) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = canvas.clientHeight * 2;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(48, 10);
    const W = w - 76;
    const H = h - 40;

    const N = timeline.length || 1;
    const sx = (x: number) => (x - 1) / (N - 1 || 1) * W;

    const troopsAll = [...timeline.map(t => t.A_troops), ...timeline.map(t => t.B_troops)].filter(Number.isFinite);
    const moraleAll = [...timeline.map(t => t.A_morale), ...timeline.map(t => t.B_morale)].filter(Number.isFinite);
    const tMin = Math.min(...troopsAll, 0);
    const tMax = Math.max(...troopsAll, 1);
    const mMin = Math.min(...moraleAll, 0);
    const mMax = Math.max(...moraleAll, 1);
    const syT = (y: number) => H - (y - tMin) / (tMax - tMin || 1) * H;
    const syM = (y: number) => H - (y - mMin) / (mMax - mMin || 1) * H;

    // Background
    ctx.fillStyle = '#0f141b';
    ctx.fillRect(0, 0, W, H);

    // Phase bands
    if (timeline.length) {
      const bands: Array<{ ph: string; s: number; e: number }> = [];
      let s = 0;
      let cur = timeline[0].phase;
      for (let i = 1; i < timeline.length; i++) {
        if (timeline[i].phase !== cur) {
          bands.push({ ph: cur, s: s + 1, e: i });
          s = i;
          cur = timeline[i].phase;
        }
      }
      bands.push({ ph: cur, s: s + 1, e: timeline.length });

      for (const b of bands) {
        const x0 = sx(b.s);
        const x1 = sx(b.e);
        let c = 'rgba(154,163,178,0.14)';
        if (b.ph === 'skirmish') c = 'rgba(45,156,255,0.16)';
        else if (b.ph === 'pursuit') c = 'rgba(255,93,93,0.16)';
        ctx.fillStyle = c;
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
        ctx.fillStyle = '#cfd6e1';
        ctx.font = 'bold 16px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(b.ph.charAt(0).toUpperCase() + b.ph.slice(1), x0 + (x1 - x0) / 2, 6);
      }
    }

    // Grid
    ctx.strokeStyle = '#202733';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = i * (H / 5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const x = i * (W / 10);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.strokeStyle = '#2c3545';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, W, H);

    // Y labels
    ctx.fillStyle = '#a7b0bd';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = tMin + (tMax - tMin) * i / 4;
      const y = syT(v);
      ctx.fillText(Math.round(v).toString(), -6, y);
    }
    ctx.fillText('Troops', -6, -6);
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const v = mMin + (mMax - mMin) * i / 4;
      const y = syM(v);
      ctx.fillText(Math.round(v).toString(), W + 6, y);
    }
    ctx.fillText('Morale', W + 6, -6);

    // Lines
    const draw = (arr: number[], sy: (y: number) => number, col: string) => {
      if (!arr.length) return;
      ctx.beginPath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.moveTo(sx(1), sy(arr[0]));
      for (let i = 1; i < arr.length; i++) {
        ctx.lineTo(sx(i + 1), sy(arr[i]));
      }
      ctx.stroke();
    };

    const A_morale = timeline.map(r => r.A_morale);
    const B_morale = timeline.map(r => r.B_morale);
    const A_troops = timeline.map(r => r.A_troops);
    const B_troops = timeline.map(r => r.B_troops);

    draw(A_morale, syM, '#6fb3ff');
    draw(B_morale, syM, '#ff8c00'); // Enemy morale: Orange
    draw(A_troops, syT, '#2d9cff');
    draw(B_troops, syT, '#ff5d5d');

    ctx.restore();
  }

  // Helper to compute warrior/archer totals from a division (for backward compatibility)
  function getWarriorArcherTotals(div: Division): { warrior: number; archer: number } {
    return {
      warrior: (div.warrior || 0) + (div.militia || 0) + (div.longsword || 0) + (div.pikemen || 0) + (div.light_cavalry || 0) + (div.heavy_cavalry || 0),
      archer: (div.archer || 0) + (div.skirmisher || 0) + (div.crossbowmen || 0)
    };
  }

  function simulateBattle(
    playerDiv: Division,
    enemyDiv: Division,
    playerCommander?: Commander | null
  ): BattleResult {
    const stats = getUnitStats();
    const p = getBattleParams();
    // Deep copy divisions
    const A: Division = {};
    const B: Division = {};
    for (const key in playerDiv) {
      A[key as UnitType] = playerDiv[key as UnitType];
    }
    for (const key in enemyDiv) {
      B[key as UnitType] = enemyDiv[key as UnitType];
    }

    // Capture initial states before battle (compute warrior/archer totals for backward compatibility)
    const playerInitialWA = getWarriorArcherTotals(A);
    const enemyInitialWA = getWarriorArcherTotals(B);
    const playerInitial = {
      warrior: playerInitialWA.warrior,
      archer: playerInitialWA.archer,
      total: total(A)
    };
    const enemyInitial = {
      warrior: enemyInitialWA.warrior,
      archer: enemyInitialWA.archer,
      total: total(B)
    };

    let mA = morale(A, stats);
    let mB = morale(B, stats);
    const mA0 = mA, mB0 = mB;
    const tA = Math.max(0, (p.break_pct || 20) / 100 * mA0);
    const tB = Math.max(0, (p.break_pct || 20) / 100 * mB0);
    let brokeA = false, brokeB = false;

    const tl: any[] = [];
    let tick = 0;

    function step(phase: string) {
      const SA = phaseStats(A, stats, phase, playerCommander);
      const SB = phaseStats(B, stats, phase);
      const sA = total(A) / 100;
      const sB = total(B) / 100;
      const rA = SA.EA / SB.ED;
      const rB = SB.EA / SA.ED;
      const nA = 1 + (Math.random() * 2 - 1) * p.rng_variance;
      const nB = 1 + (Math.random() * 2 - 1) * p.rng_variance;
      const lossB = p.base_casualty_rate * sA * rA * nA;
      const lossA = p.base_casualty_rate * sB * rB * nB;
      applyCasualties(A, lossA);
      applyCasualties(B, lossB);
      mB -= p.morale_per_casualty * lossB + p.advantage_morale_tick * Math.max(0, rA - 1);
      mA -= p.morale_per_casualty * lossA + p.advantage_morale_tick * Math.max(0, rB - 1);
      tick++;
      tl.push({
        tick,
        phase,
        A_troops: total(A),
        B_troops: total(B),
        A_morale: mA,
        B_morale: mB,
        AtoB: lossB,
        BtoA: lossA
      });
    }

    // Skirmish
    for (let i = 0; i < p.skirmish_ticks; i++) {
      if (total(A) <= 0 || total(B) <= 0 || mA <= tA || mB <= tB) break;
      step('skirmish');
    }

    // Melee until break
    let guard = 0;
    while (total(A) > 0 && total(B) > 0 && mA > tA && mB > tB) {
      step('melee');
      if (++guard > 5000) break;
    }

    if (mA <= tA && total(A) > 0) brokeA = true;
    if (mB <= tB && total(B) > 0) brokeB = true;

    let winner: 'player' | 'enemy' | 'draw' = 'draw';
    if ((mA <= tA || total(A) <= 0) && (mB <= tB || total(B) <= 0)) winner = 'draw';
    else if (mA <= tA || total(A) <= 0) winner = 'enemy';
    else if (mB <= tB || total(B) <= 0) winner = 'player';
    else winner = mA > mB ? 'player' : (mB > mA ? 'enemy' : (total(A) > total(B) ? 'player' : (total(B) > total(A) ? 'enemy' : 'draw')));

    // Pursuit
    if ((winner === 'player' || winner === 'enemy') && p.pursuit_ticks > 0) {
      for (let i = 0; i < p.pursuit_ticks; i++) {
        const SA = phaseStats(A, stats, 'melee', playerCommander);
        const SB = phaseStats(B, stats, 'melee');
        const base = 0.25;
        if (winner === 'player') {
          const lossB = base * Math.max(0, SA.P) / Math.max(1, total(B) / 100);
          applyCasualties(B, lossB);
          mB -= p.morale_per_casualty * lossB;
          tl.push({
            tick: ++tick,
            phase: 'pursuit',
            A_troops: total(A),
            B_troops: total(B),
            A_morale: mA,
            B_morale: mB,
            AtoB: lossB,
            BtoA: 0
          });
        } else {
          const lossA = base * Math.max(0, SB.P) / Math.max(1, total(A) / 100);
          applyCasualties(A, lossA);
          mA -= p.morale_per_casualty * lossA;
          tl.push({
            tick: ++tick,
            phase: 'pursuit',
            A_troops: total(A),
            B_troops: total(B),
            A_morale: mA,
            B_morale: mB,
            AtoB: 0,
            BtoA: lossA
          });
        }
        if (total(A) <= 0 || total(B) <= 0) break;
      }
    }

    const sA = total(A);
    const sB = total(B);

    // Compute final warrior/archer totals for backward compatibility
    const playerFinalWA = getWarriorArcherTotals(A);
    const enemyFinalWA = getWarriorArcherTotals(B);

    return {
      winner,
      ticks: tick,
      playerInitial,
      playerFinal: {
        warrior: playerFinalWA.warrior,
        archer: playerFinalWA.archer,
        total: sA,
        morale: mA
      },
      enemyInitial,
      enemyFinal: {
        warrior: enemyFinalWA.warrior,
        archer: enemyFinalWA.archer,
        total: sB,
        morale: mB
      },
      timeline: tl
    };
  }
  function handleBlacksmithUpgrade(itemId: string, cost: { iron: number; gold: number }) {
    setWarehouse((w) => ({
      ...w,
      iron: Math.max(0, w.iron - cost.iron),
      gold: Math.max(0, w.gold - cost.gold),
    }));
    // TODO: Update actual gear levels in your game state
  }
  function handleStartResearch(techId: string, cost: number) {
    setSkillPoints(prev => Math.max(0, prev - cost));
    // TODO: Track research state if needed
  }
  function handleCompleteResearch(techId: string) {
    // TODO: Apply technology effects when implemented
  }
  function requestTownHallUpgrade(currentLevel: number) {
    const to = currentLevel + 1;
    if (to > 3) return;
    const c = getTownHallCost(to);
    setPendingUpgrade({ res: "townhall", from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }
  function requestBarracksUpgrade(currentLevel: number) {
    if (!barracks) return;
    const to = currentLevel + 1;
    if (to > 3) return;
    const c = getBarracksCost(to);
    setPendingUpgrade({ res: "barracks", from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }
  function requestTavernUpgrade(currentLevel: number) {
    if (!tavern) return;
    const to = currentLevel + 1;
    if (to > 3) return;
    const c = getTavernCost(to);
    setPendingUpgrade({ res: "tavern", from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }
  function requestMilitaryAcademyUpgrade(currentLevel: number) {
    if (!militaryAcademy) return;
    const to = currentLevel + 1;
    if (to > 3) return;
    const c = getMilitaryAcademyCost(to);
    setPendingUpgrade({ res: "militaryAcademy", from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }
  function buildMilitaryAcademy() {
    if (!canBuildMilitaryAcademy(townHall.level)) return;
    if (militaryAcademy) return; // Already built
    const cost = getMilitaryAcademyBuildCost();
    if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return;

    // Pay the cost
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));

    // Build the military academy
    setMilitaryAcademy({
      level: 1,
    });
  }
  function buildBarracks() {
    if (!canBuildBarracks(townHall.level)) return;
    if (barracks) return; // Already built
    const cost = getBarracksBuildCost();
    if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return;

    // Pay the cost
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));

    // Build the barracks
    setBarracks({
      level: 1,
      trainingSlots: getMaxTrainingSlots(1),
      maxTemplates: 2,
      trainingQueue: [],
    });
  }
  function buildTavern() {
    if (!canBuildTavern(townHall.level)) return;
    if (tavern) return; // Already built
    const cost = getTavernBuildCost();
    if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return;

    // Pay the cost
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));

    // Build the tavern
    setTavern({
      level: 1,
      activeFestival: false,
      festivalEndTime: 0,
    });
  }

  // Commander recruitment and assignment
  const [commanderRecruitModal, setCommanderRecruitModal] = useState<boolean>(false);
  const [commanderAssignModal, setCommanderAssignModal] = useState<{ commanderId: number | null; bannerId?: number } | null>(null);
  const [candidateNames, setCandidateNames] = useState<Record<CommanderArchetype, string>>({
    ranged_specialist: '',
    melee_specialist: '',
    balanced_leader: ''
  });

  // Generate candidate names when modal opens
  useEffect(() => {
    if (commanderRecruitModal) {
      setCandidateNames({
        ranged_specialist: generateCommanderName('ranged_specialist'),
        melee_specialist: generateCommanderName('melee_specialist'),
        balanced_leader: generateCommanderName('balanced_leader')
      });
    }
  }, [commanderRecruitModal]);

  function recruitCommander(archetype: CommanderArchetype) {
    const maxCommanders = militaryAcademy?.level || 0;
    const currentCommanders = commanders.length;

    if (currentCommanders >= maxCommanders) {
      console.warn('[COMMANDER] Cannot recruit: max commanders reached');
      return;
    }

    const config = COMMANDER_ARCHETYPES[archetype];
    const initialLevel = 1;
    const newCommander: Commander = {
      id: commanderSeq,
      name: generateCommanderName(archetype),
      archetype,
      rangedAttackBonusPercent: config.rangedBonus,
      meleeAttackBonusPercent: config.meleeBonus,
      assignedBannerId: null,
      level: initialLevel,
      currentXP: 0,
      xpToNextLevel: calculateCommanderXPToNextLevel(initialLevel),
    };

    setCommanders([...commanders, newCommander]);
    setCommanderSeq(commanderSeq + 1);
    setCommanderRecruitModal(false);
  }

  function assignCommanderToBanner(commanderId: number, bannerId: number) {
    setCommanders(prevCommanders => prevCommanders.map(c =>
      c.id === commanderId ? { ...c, assignedBannerId: bannerId } : c
    ));
    setBanners(prevBanners => prevBanners.map(b =>
      b.id === bannerId ? { ...b, commanderId } : b
    ));
    // Ensure the draft reflects the change if we are currently editing this banner
    setBannersDraft(prevDraft => {
      if (prevDraft && prevDraft.id === bannerId) {
        return { ...prevDraft, commanderId };
      }
      return prevDraft;
    });
    setCommanderAssignModal(null);
    saveGame();
  }

  function unassignCommander(commanderId: number) {
    setCommanders(prevCommanders => {
      const commander = prevCommanders.find(c => c.id === commanderId);
      if (!commander || !commander.assignedBannerId) return prevCommanders;

      return prevCommanders.map(c =>
        c.id === commanderId ? { ...c, assignedBannerId: null } : c
      );
    });
    setBanners(prevBanners => prevBanners.map(b =>
      b.commanderId === commanderId ? { ...b, commanderId: null } : b
    ));
  }
  function startFestival() {
    if (!tavern || tavern.activeFestival) return;
    const cost = 50; // Gold cost
    if (warehouse.gold < cost) return;

    setWarehouse(w => ({ ...w, gold: w.gold - cost }));
    setTavern(prev => prev ? {
      ...prev,
      activeFestival: true,
      festivalEndTime: Date.now() + 300000, // 5 minutes
    } : null);
  }
  function startBarracksTraining(templateId: string) {
    console.log('[HIRE DEBUG] Starting hire for template:', templateId);
    const template = bannerTemplates.find(t => t.id === templateId);
    if (!template) {
      console.error('[HIRE DEBUG] Template not found:', templateId);
      return;
    }

    // Use functional updates to prevent stale state and race conditions
    setBarracks(prev => {
      if (!prev) {
        console.warn('[HIRE DEBUG] Barracks is null');
        return prev;
      }
      if (prev.trainingQueue.length >= prev.trainingSlots) {
        console.warn('[HIRE DEBUG] Training slots full:', prev.trainingQueue.length, '/', prev.trainingSlots);
        return prev;
      }

      // Check if this template is already in the queue (prevent duplicates)
      if (prev.trainingQueue.some(job => job.templateId === templateId)) {
        console.warn('[HIRE DEBUG] Already hiring this template');
        return prev; // Already hiring this template
      }

      // Check if player has enough gold
      if (warehouse.gold < template.cost) {
        console.warn('[HIRE DEBUG] Not enough gold. Have:', warehouse.gold, 'Need:', template.cost);
        return prev;
      }

      // Pay the cost immediately
      setWarehouse(w => ({ ...w, gold: Math.max(0, w.gold - template.cost) }));

      const newHiring: TrainingEntry = {
        id: Date.now(),
        type: 'mercenary',
        templateId,
        arrivalTime: 5, // 5 seconds arrival time
        elapsedTime: 0,
        status: 'arriving',
        soldiersNeeded: 0,
        soldiersTrained: 0,
      };

      console.log('[HIRE DEBUG] Job created:', newHiring);
      return {
        ...prev,
        trainingQueue: [...prev.trainingQueue, newHiring],
      };
    });
  }

  // === Worker demand and assignment ===
  const workerDemand = useMemo(() => {
    let total = 0;
    if (lumberMill.enabled) total += lumberMill.level;
    if (quarry.enabled) total += quarry.level;
    if (farm.enabled) total += farm.level;
    if (ironMine.enabled) total += ironMine.level;
    return total;
  }, [lumberMill.enabled, lumberMill.level, quarry.enabled, quarry.level, farm.enabled, farm.level, ironMine.enabled, ironMine.level]);

  // Calculate actual assigned workers (not just demand)
  const actualWorkers = useMemo(() => {
    return lumberMill.workers + quarry.workers + farm.workers + ironMine.workers;
  }, [lumberMill.workers, quarry.workers, farm.workers, ironMine.workers]);

  // Calculate free workers correctly: population - actual assigned workers
  const freeWorkers = useMemo(() => population - actualWorkers, [population, actualWorkers]);

  // === Population Breakdown (for visualization) ===
  // Locked workers: only 1 total (from the farm - minimum to keep it running)
  const lockedWorkers = useMemo(() => {
    // Only count 1 locked worker total (from farm)
    return farm.enabled && farm.workers > 0 ? 1 : 0;
  }, [farm.enabled, farm.workers]);

  // Buffer workers: all other workers assigned to buildings (beyond the 1 locked)
  const bufferWorkers = useMemo(() => {
    // Total workers on all buildings minus the 1 locked worker
    const totalWorkersOnBuildings = lumberMill.workers + quarry.workers + farm.workers + ironMine.workers;
    return Math.max(0, totalWorkersOnBuildings - 1); // Subtract the 1 locked worker
  }, [lumberMill.workers, quarry.workers, farm.workers, ironMine.workers]);

  // Free population: unassigned people
  const freePop = useMemo(() => {
    return Math.max(0, population - lockedWorkers - bufferWorkers);
  }, [population, lockedWorkers, bufferWorkers]);

  // Safe and risky recruits (for display)
  const safeRecruits = freePop;
  const riskyRecruits = bufferWorkers;

  // Ensure breakdown doesn't exceed capacity (safety clamp) - memoized
  const clampedLocked = useMemo(() => Math.min(lockedWorkers, popCap), [lockedWorkers, popCap]);
  const clampedBuffer = useMemo(() => Math.min(bufferWorkers, Math.max(0, popCap - clampedLocked)), [bufferWorkers, popCap, clampedLocked]);
  const clampedFree = useMemo(() => Math.min(freePop, Math.max(0, popCap - clampedLocked - clampedBuffer)), [freePop, popCap, clampedLocked, clampedBuffer]);

  const workerSurplus = useMemo(() => population - workerDemand, [population, workerDemand]);
  const workerDeficit = workerSurplus < 0 ? -workerSurplus : 0;

  // Emergency mechanic: Ensure farm is always enabled (population is always >= 1)
  useEffect(() => {
    if (population >= 1 && !farm.enabled) {
      setFarm(b => ({ ...b, enabled: true }));
    }
  }, [population, farm.enabled]);

  // Assign workers evenly across enabled buildings
  // Emergency mechanic: Farm ALWAYS gets exactly 1 worker if population >= 1, and this worker cannot be reassigned
  useEffect(() => {
    // Emergency: Farm must always be enabled (population is always >= 1)
    if (population >= 1 && !farm.enabled) {
      setFarm(b => ({ ...b, enabled: true }));
      return; // Will re-run after farm is enabled
    }

    const enabledBuildings = [
      { type: 'wood' as const, level: lumberMill.level, enabled: lumberMill.enabled },
      { type: 'stone' as const, level: quarry.level, enabled: quarry.enabled },
      { type: 'food' as const, level: farm.level, enabled: farm.enabled },
      { type: 'iron' as const, level: ironMine.level, enabled: ironMine.enabled },
    ].filter(b => b.enabled);

    // Emergency: If no buildings enabled, at least enable farm (population is always >= 1)
    if (enabledBuildings.length === 0) {
      setFarm(b => ({ ...b, enabled: true, workers: 1 }));
      setLumberMill(b => ({ ...b, workers: 0 }));
      setQuarry(b => ({ ...b, workers: 0 }));
      setIronMine(b => ({ ...b, workers: 0 }));
      return;
    }

    let availableWorkers = Math.max(0, population);

    // EMERGENCY MECHANIC: Farm ALWAYS gets at least 1 worker if population >= 1
    // This worker is reserved and cannot be reassigned to other buildings
    let farmWorkers = 0;
    if (population >= 1 && farm.enabled) {
      farmWorkers = 1;
      availableWorkers = Math.max(0, availableWorkers - 1);
    }

    // Create assignments for ALL enabled buildings
    // Farm starts at 1 (emergency), others start at 0
    const assignments: { type: 'wood' | 'stone' | 'food' | 'iron'; workers: number; level: number }[] = enabledBuildings.map(b => ({
      type: b.type,
      workers: b.type === 'food' ? farmWorkers : 0, // Farm starts with its emergency worker
      level: b.level,
    }));

    // Distribute remaining workers to ALL buildings (round-robin, including farm)
    // Farm can get additional workers up to its level
    let remaining = availableWorkers;
    let buildingIndex = 0;
    while (remaining > 0 && buildingIndex < assignments.length * 10) { // safety limit
      const assignment = assignments[buildingIndex % assignments.length];
      if (assignment.workers < assignment.level) {
        assignment.workers += 1;
        remaining -= 1;
      }
      buildingIndex += 1;
      // If all buildings are at max, break
      if (assignments.every(a => a.workers >= a.level)) break;
    }

    // Apply assignments - all buildings get their assigned workers
    assignments.forEach(a => {
      if (a.type === 'wood') setLumberMill(b => ({ ...b, workers: a.workers }));
      if (a.type === 'stone') setQuarry(b => ({ ...b, workers: a.workers }));
      if (a.type === 'food') setFarm(b => ({ ...b, workers: a.workers }));
      if (a.type === 'iron') setIronMine(b => ({ ...b, workers: a.workers }));
    });
  }, [population, lumberMill.level, lumberMill.enabled, quarry.level, quarry.enabled, farm.level, farm.enabled, ironMine.level, ironMine.enabled]);

  // === Production Bonuses ===
  const happinessProductionBonus = useMemo(() => {
    if (happiness >= 70) return 1.05; // +5% to all production
    if (tavern?.level === 3) return 1.05; // Tavern L3 bonus
    return 1.0;
  }, [happiness, tavern?.level]);

  // === Derived rates & caps (scaled by workers) ===
  const lumberRate = useMemo(() => {
    if (!lumberMill.enabled || lumberMill.workers === 0) return 0;
    const effectiveLevel = Math.min(lumberMill.level, lumberMill.workers);
    const baseRate = getProgression("wood", effectiveLevel, "production");
    return baseRate * happinessProductionBonus;
  }, [lumberMill.level, lumberMill.workers, lumberMill.enabled, happinessProductionBonus]);

  const stoneRate = useMemo(() => {
    if (!quarry.enabled || quarry.workers === 0) return 0;
    const effectiveLevel = Math.min(quarry.level, quarry.workers);
    const baseRate = getProgression("stone", effectiveLevel, "production");
    return baseRate * happinessProductionBonus;
  }, [quarry.level, quarry.workers, quarry.enabled, happinessProductionBonus]);

  const foodRate = useMemo(() => {
    if (!farm.enabled || farm.workers === 0) return 0;
    const effectiveLevel = Math.min(farm.level, farm.workers);
    const baseRate = getProgression("food", effectiveLevel, "production");
    return baseRate * happinessProductionBonus;
  }, [farm.level, farm.workers, farm.enabled, happinessProductionBonus]);

  const ironRate = useMemo(() => {
    if (!ironMine.enabled || ironMine.workers === 0) return 0;
    const effectiveLevel = Math.min(ironMine.level, ironMine.workers);
    const baseRate = getProgression("iron", effectiveLevel, "production");
    return baseRate * happinessProductionBonus;
  }, [ironMine.level, ironMine.workers, ironMine.enabled, happinessProductionBonus]);

  // === Food consumption ===
  const foodConsumption = useMemo(() => population, [population]); // 1 food per worker per second
  const netFoodRate = useMemo(() => foodRate - foodConsumption, [foodRate, foodConsumption]);

  // === Population growth rate (depends on netFoodRate and food storage) ===
  // NOTE: This is kept for backward compatibility but netPopulationChange is the primary system
  const popRate = useMemo(() => {
    // Use the new netPopulationChange system, but respect food availability for positive growth
    if (netPopulationChange > 0) {
      const totalFood = warehouse.food + farm.stored;
      const hasFoodStorage = totalFood > 0;
      const hasPositiveNetRate = netFoodRate >= 1;

      // Allow growth if we have food storage OR positive net rate
      if (hasFoodStorage || hasPositiveNetRate) {
        return population < popCap ? netPopulationChange : 0;
      }
      // Only block growth if food storage is zero AND net rate is insufficient
      return 0;
    }
    // Negative growth (from high taxes) happens regardless of food
    return netPopulationChange;
  }, [netPopulationChange, population, popCap, netFoodRate, warehouse.food, farm.stored]);

  const lumberCap = useMemo(() => getProgression("wood", lumberMill.level, "capacity"), [lumberMill.level]);
  const stoneCap = useMemo(() => getProgression("stone", quarry.level, "capacity"), [quarry.level]);
  const foodCap = useMemo(() => getProgression("food", farm.level, "capacity"), [farm.level]);
  const ironCap = useMemo(() => getProgression("iron", ironMine.level, "capacity"), [ironMine.level]);

  // === Gold Income Calculation ===
  // Gold income scales with population, with 50 population as the reference point
  const goldIncomePerSecond = useMemo(() => {
    const referencePopulation = 50; // Reference population for gold calculation
    const baseGoldPerSecondAtNormalTax = 1.0; // Base gold/sec at Normal tax with 50 population

    // Effective population ensures we never use zero (minimum 1)
    const effectivePopulation = Math.max(1, population);

    // Population factor: how much the current population scales the base income
    const populationFactor = effectivePopulation / referencePopulation;

    // Tax multiplier (same as before)
    let taxMultiplier = 1.0;
    if (tax === 'very_low') taxMultiplier = 0.6;
    else if (tax === 'low') taxMultiplier = 0.85;
    else if (tax === 'normal') taxMultiplier = 1.0;
    else if (tax === 'high') taxMultiplier = 1.25;
    else if (tax === 'very_high') taxMultiplier = 1.5;

    // Final formula: base * populationFactor * taxMultiplier
    return baseGoldPerSecondAtNormalTax * populationFactor * taxMultiplier;
  }, [tax, population]);

  // === Tick loop (1s) ===
  useEffect(() => {
    const id = setInterval(() => {
      // Gold income from taxes
      setWarehouse((w) => ({
        ...w,
        gold: Math.min(warehouseCap.gold, w.gold + goldIncomePerSecond)
      }));

      // production fill
      setLumberMill((b) => ({ ...b, stored: Math.min(lumberCap, b.stored + lumberRate) }));
      setQuarry((b) => ({ ...b, stored: Math.min(stoneCap, b.stored + stoneRate) }));
      setIronMine((b) => ({ ...b, stored: Math.min(ironCap, b.stored + ironRate) }));

      // Food production and consumption
      setFarm((b) => {
        // First, add production
        const afterProduction = Math.min(foodCap, b.stored + foodRate);
        // Then, consume from farm storage first
        const consumedFromFarm = Math.min(afterProduction, foodConsumption);
        const remainingConsumption = foodConsumption - consumedFromFarm;
        const newFarmStored = Math.max(0, afterProduction - consumedFromFarm);

        // Consume remaining from warehouse
        setWarehouse((w) => {
          const consumedFromWarehouse = Math.min(w.food, remainingConsumption);
          return { ...w, food: Math.max(0, w.food - consumedFromWarehouse) };
        });

        return { ...b, stored: newFarmStored };
      });

      // population drift + training consumption + starvation
      // EMERGENCY RULE: Population can never be zero, minimum is 1
      let nextPop = Math.max(1, Math.min(popCap, population + netPopulationChange));

      // If food reaches zero and net food rate is negative, decrease population by 1/sec
      // But never below 1 (emergency rule)
      const totalFood = warehouse.food + farm.stored;
      if (totalFood <= 0 && netFoodRate < 0) {
        nextPop = Math.max(1, nextPop - 1);
      }

      let bannersChanged = false;
      const nextBanners = banners.map((b) => ({
        ...b,
        squads: b.squads ? b.squads.map(s => ({ ...s })) : []
      }));

      // Track available iron (updated as we consume it)
      let availableIron = warehouse.iron;

      // Get max training slots for regular banners
      const maxTrainingSlots = barracks ? getMaxTrainingSlots(barracks.level) : 0;

      // Get all regular banners that are training, sorted by ID (first come, first served)
      const trainingBanners = nextBanners
        .filter(b => b.type === 'regular' && b.status === 'training' && !b.trainingPaused && b.recruited < b.reqPop)
        .sort((a, b) => a.id - b.id); // Process in order of creation

      // Only process the first N banners (up to max slots)
      const bannersToProcess = trainingBanners.slice(0, maxTrainingSlots);

      // Process each banner sequentially (only the first ones get population)
      for (const banner of bannersToProcess) {
        if (nextPop <= 1) break; // Emergency rule: keep at least 1 population

        // Check recruitment mode
        const currentActualWorkers = lumberMill.workers + quarry.workers + farm.workers;
        const currentFreeWorkers = Math.max(0, population - currentActualWorkers);

        const canRecruit = recruitmentMode === 'regular'
          ? currentFreeWorkers > 0  // Regular: only use free workers (keep at least 1 free)
          : true;  // Forced: can use working workers too (but still keep at least 1 total pop)

        if (canRecruit) {
          const bannerIndex = nextBanners.findIndex(b => b.id === banner.id);
          if (bannerIndex !== -1) {
            // Ensure squads are initialized
            if (!nextBanners[bannerIndex].squads || nextBanners[bannerIndex].squads.length === 0) {
              const { squads } = initializeSquadsFromUnits(nextBanners[bannerIndex].units, squadSeqRef.current);
              nextBanners[bannerIndex].squads = squads.map(s => ({ ...s }));
              bannersChanged = true;
            }

            // Update squad currentSize as training progresses
            if (nextBanners[bannerIndex].squads && nextBanners[bannerIndex].squads.length > 0) {
              let totalIronCost = 0;
              let unitsTrained = 0;
              let unitsToTrain: Array<{ squadId: number; count: number }> = [];

              if (nextBanners[bannerIndex].reinforcingSquadId !== undefined) {
                // Reinforcement: update specific squad
                const squadToReinforce = nextBanners[bannerIndex].squads.find(s => s.id === nextBanners[bannerIndex].reinforcingSquadId);
                if (squadToReinforce && squadToReinforce.currentSize < squadToReinforce.maxSize) {
                  const ironCostPerUnit = getIronCostPerUnit(squadToReinforce.type);
                  if (availableIron >= ironCostPerUnit) {
                    totalIronCost = ironCostPerUnit;
                    unitsTrained = 1;
                    unitsToTrain.push({ squadId: squadToReinforce.id, count: 1 });
                  }
                }
              } else {
                // New training: distribute recruited population across squads (1 per second per squad)
                let remainingToAssign = 1; // We recruited 1 person this second
                for (let i = 0; i < nextBanners[bannerIndex].squads.length && remainingToAssign > 0; i++) {
                  const squad = nextBanners[bannerIndex].squads[i];
                  if (squad.currentSize < squad.maxSize) {
                    const canAdd = Math.min(remainingToAssign, squad.maxSize - squad.currentSize);
                    const ironCostPerUnit = getIronCostPerUnit(squad.type);
                    const totalCostForSquad = ironCostPerUnit * canAdd;

                    if (availableIron >= totalIronCost + totalCostForSquad) {
                      totalIronCost += totalCostForSquad;
                      unitsTrained += canAdd;
                      unitsToTrain.push({ squadId: squad.id, count: canAdd });
                      remainingToAssign -= canAdd;
                    } else {
                      // Not enough iron - can't train this unit
                      break;
                    }
                  }
                }
              }

              // Only proceed if we have enough iron and can train at least one unit
              // Note: totalIronCost can be 0 for militia (free units), so we check unitsTrained > 0
              if (unitsTrained > 0 && availableIron >= totalIronCost) {
                // Consume iron (update local tracker and state)
                availableIron -= totalIronCost;
                setWarehouse(w => ({ ...w, iron: Math.max(0, w.iron - totalIronCost) }));

                // Consume population and update squads
                nextBanners[bannerIndex].recruited += 1; // 1 pop / sec / training banner
                nextPop = Math.max(1, nextPop - 1);
                bannersChanged = true;

                // Update squad sizes (create new squad objects for React)
                nextBanners[bannerIndex].squads = nextBanners[bannerIndex].squads.map(squad => {
                  const toTrain = unitsToTrain.find(ut => ut.squadId === squad.id);
                  if (toTrain) {
                    return { ...squad, currentSize: Math.min(squad.maxSize, squad.currentSize + toTrain.count) };
                  }
                  return squad;
                });

                // Show feedback if iron was consumed
                setIronConsumptionFeedback({
                  message: `-${totalIronCost.toFixed(1)} Iron (retraining ${unitsTrained} unit${unitsTrained > 1 ? 's' : ''})`,
                  timestamp: Date.now()
                });
                // Clear feedback after 2 seconds
                setTimeout(() => {
                  setIronConsumptionFeedback(prev => {
                    // Only clear if it's the same feedback (prevent race conditions)
                    if (prev && Date.now() - prev.timestamp >= 2000) {
                      return null;
                    }
                    return prev;
                  });
                }, 2000);
              }
            } else {
              // No squads initialized yet, just consume population (shouldn't happen, but handle gracefully)
              nextBanners[bannerIndex].recruited += 1;
              nextPop = Math.max(1, nextPop - 1);
              bannersChanged = true;
            }
          }
        }
      }

      // Check for completed training
      nextBanners.forEach((bb) => {
        if (bb.status === 'training' && bb.recruited >= bb.reqPop) {
          // Ensure squads are initialized
          if (!bb.squads || bb.squads.length === 0) {
            const { squads } = initializeSquadsFromUnits(bb.units, squadSeqRef.current);
            bb.squads = squads.map(s => ({ ...s }));
            bannersChanged = true;
          }

          // Also verify all squads are at full strength
          if (bb.squads && bb.squads.length > 0) {
            const allSquadsFull = bb.squads.every(squad => squad.currentSize >= squad.maxSize);
            if (allSquadsFull) {
              bb.status = 'ready';
              bb.reinforcingSquadId = undefined; // Clear reinforcement tracking
              bannersChanged = true;
            }
          }
        }
      });

      if (bannersChanged) setBanners(nextBanners);

      // Update population after training consumption
      setPopulation(nextPop);

      // missions
      let missionsChanged = false;
      let capturedBannerXP: Mission['bannerXP'] = undefined;
      const nextMissions = missions.map((m) => {
        if (m.status !== 'running') return m;
        const elapsed = m.elapsed + 1;
        if (elapsed >= m.duration) {
          // Run combat for missions with enemy composition
          let battleResult: BattleResult | undefined = undefined;
          if (m.enemyComposition && m.deployed.length > 0) {
            const playerBanner = banners.find(b => b.id === m.deployed[0]);
            if (playerBanner) {
              // Ensure banner has squads initialized (use ref for closure access)
              let bannerWithSquads = playerBanner;
              if (!bannerWithSquads.squads || bannerWithSquads.squads.length === 0) {
                const { squads, nextSeq } = initializeSquadsFromUnits(bannerWithSquads.units, squadSeqRef.current);
                bannerWithSquads = { ...bannerWithSquads, squads };
                setSquadSeq(nextSeq);
                squadSeqRef.current = nextSeq;
              }

              // Convert banner squads to division format (use currentSize, not maxSize)
              const playerDiv: Division = {};
              bannerWithSquads.squads.forEach(squad => {
                const unitType = squad.type;
                playerDiv[unitType] = (playerDiv[unitType] || 0) + squad.currentSize;
              });
              // Get commander for this banner if assigned
              const bannerCommander = bannerWithSquads.commanderId
                ? commanders.find(c => c.id === bannerWithSquads.commanderId)
                : null;
              battleResult = simulateBattle(playerDiv, m.enemyComposition || {}, bannerCommander);

              // Calculate battle stats for XP
              const startTroops = bannerWithSquads.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
              const enemyCasualties = battleResult.enemyInitial.total - battleResult.enemyFinal.total;
              const isVictory = battleResult.winner === 'player';

              // Store old XP and level for battle report
              const oldXP = bannerWithSquads.xp || 0;
              const oldLevelInfo = bannerWithSquads.level !== undefined && bannerWithSquads.xpCurrentLevel !== undefined && bannerWithSquads.xpNextLevel !== undefined
                ? {
                  level: bannerWithSquads.level,
                  levelName: XP_LEVELS.find(l => l.level === bannerWithSquads.level)?.name || 'Green',
                  xpCurrentLevel: bannerWithSquads.xpCurrentLevel,
                  xpNextLevel: bannerWithSquads.xpNextLevel
                }
                : calculateLevelFromXP(oldXP);

              // Apply losses to banner
              const losses = calculateBannerLosses(bannerWithSquads, battleResult);
              let updatedBanner = distributeLossesToBanner(bannerWithSquads, losses);

              // Check if banner is destroyed (0 troops remaining)
              const totalTroops = updatedBanner.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
              const bannerStatus = totalTroops === 0 ? 'destroyed' : 'ready';
              const survived = totalTroops > 0;
              const ownCasualties = startTroops - totalTroops;

              // Calculate banner XP gain (for commander)
              const bannerXPGain = calculateBannerXPGain(enemyCasualties, isVictory, survived);

              // Update banner XP
              updatedBanner = updateBannerXP(
                updatedBanner,
                enemyCasualties,
                ownCasualties,
                startTroops,
                isVictory,
                survived
              );

              // Store commander XP info for battle report (before update)
              let commanderXPInfo: { commanderId: number; commanderName: string; xpGained: number; oldLevel: number; newLevel: number; oldXP: number; newXP: number; xpToNextLevel: number } | undefined = undefined;
              if (bannerCommander) {
                const oldCommanderLevel = bannerCommander.level || 1;
                const oldCommanderXP = bannerCommander.currentXP || 0;
                const updatedCommander = updateCommanderXP(bannerCommander, bannerXPGain);
                const newCommanderLevel = updatedCommander.level;
                const newCommanderXP = updatedCommander.currentXP;
                const commanderXPGained = bannerXPGain; // Commanders get the same XP as banner gains

                commanderXPInfo = {
                  commanderId: bannerCommander.id,
                  commanderName: bannerCommander.name,
                  xpGained: commanderXPGained,
                  oldLevel: oldCommanderLevel,
                  newLevel: newCommanderLevel,
                  oldXP: oldCommanderXP,
                  newXP: newCommanderXP,
                  xpToNextLevel: updatedCommander.xpToNextLevel,
                };

                setCommanders((cs) => cs.map(c => c.id === bannerCommander.id ? updatedCommander : c));
              }

              // Calculate XP gained and new level info
              const newXP = updatedBanner.xp || 0;
              const xpGained = newXP - oldXP;
              const newLevelInfo = updatedBanner.level !== undefined && updatedBanner.xpCurrentLevel !== undefined && updatedBanner.xpNextLevel !== undefined
                ? {
                  level: updatedBanner.level,
                  levelName: XP_LEVELS.find(l => l.level === updatedBanner.level)?.name || 'Green',
                  xpCurrentLevel: updatedBanner.xpCurrentLevel,
                  xpNextLevel: updatedBanner.xpNextLevel
                }
                : calculateLevelFromXP(newXP);

              // Store XP info for battle report
              const bannerXPInfo = {
                bannerId: bannerWithSquads.id,
                bannerName: bannerWithSquads.name,
                xpGained,
                oldXP,
                newXP,
                oldLevel: oldLevelInfo.level,
                newLevel: newLevelInfo.level,
                oldLevelName: oldLevelInfo.levelName,
                newLevelName: newLevelInfo.levelName,
                xpCurrentLevel: newLevelInfo.xpCurrentLevel,
                xpNextLevel: newLevelInfo.xpNextLevel,
              };

              // Update banner in state with losses and XP applied
              setBanners((bs) => bs.map((b) =>
                b.id === bannerWithSquads.id ? { ...updatedBanner, status: bannerStatus } :
                  m.deployed.includes(b.id) ? { ...b, status: 'ready' } : b
              ));

              // Store XP info for later use in mission return
              capturedBannerXP = bannerXPInfo;

              // Show battle report with XP info
              setBattleReport({ missionId: m.id, result: battleResult, bannerXP: bannerXPInfo, commanderXP: commanderXPInfo });

              // Update leaderboard
              if (battleResult) {
                const enemyUnitsKilled = battleResult.enemyInitial.total - battleResult.enemyFinal.total;
                const isVictory = battleResult.winner === 'player';
                const leaderboardBattleResult: LeaderboardBattleResult = {
                  enemyUnitsKilled,
                  isVictory,
                  playerId: REAL_PLAYER_ID,
                  playerName: REAL_PLAYER_NAME,
                  faction: REAL_PLAYER_FACTION,
                };
                setLeaderboard(prev => updateLeaderboardFromBattleResult(prev, leaderboardBattleResult));
              }
            }
          } else {
            // No combat, just bring banners back (preserve destroyed status)
            setBanners((bs) => bs.map((b) =>
              m.deployed.includes(b.id) && b.status !== 'destroyed'
                ? { ...b, status: 'ready' }
                : b
            ));
          }

          // Check if player won the battle
          const isVictory = battleResult && battleResult.winner === 'player';

          if (isVictory) {
            // Player won - calculate rewards and set to pending
            const enemyTotal = getEnemyTotal(m.enemyComposition);
            // For non-combat missions, give a small base reward
            const baseGold = enemyTotal > 0 ? Math.max(1, Math.floor(enemyTotal * 2)) : 1;
            const rewards = {
              gold: baseGold,
              wood: enemyTotal > 0 ? Math.floor(enemyTotal * 0.5) : 0,
              stone: enemyTotal > 0 ? Math.floor(enemyTotal * 0.3) : 0
            };

            missionsChanged = true;
            return { ...m, status: 'completedRewardsPending', elapsed: m.duration, deployed: [], battleResult, bannerXP: capturedBannerXP, rewards };
          } else {
            // Player lost - no rewards, mission becomes available for retry
            missionsChanged = true;
            return { ...m, status: 'available', elapsed: m.duration, deployed: [], battleResult, bannerXP: capturedBannerXP, rewards: undefined, rewardTier: undefined };
          }
        }
        missionsChanged = true;
        return { ...m, elapsed };
      });
      if (missionsChanged) setMissions(nextMissions as Mission[]);

      // Unified training queue processing (mercenaries + reinforcements)
      // Use the same nextPop that was already modified by banner training
      if (barracks) {
        const completedMercenaryJobs: Array<{ templateId: string; jobId: number }> = [];
        // nextPop is already defined above and modified by banner training

        // Process the queue
        const updatedBarracks = (() => {
          if (!barracks) return null;

          // Count active training entries
          const activeTraining = barracks.trainingQueue.filter(e => e.status === 'training').length;
          const activeArriving = barracks.trainingQueue.filter(e => e.status === 'arriving').length;
          const availableSlots = barracks.trainingSlots - activeTraining;

          // Move 'arriving' entries to 'training' if slots are available
          let slotsToFill = availableSlots;

          const updatedQueue = barracks.trainingQueue.map(job => {
            // Process mercenary 'arriving' entries
            if (job.type === 'mercenary' && job.status === 'arriving') {
              const newElapsed = job.elapsedTime + 1;
              if (newElapsed >= (job.arrivalTime || 0)) {
                // Mercenary arrival complete - will create banner outside state update
                console.log('[GAME LOOP] Mercenary job completed! ID:', job.id, 'Template:', job.templateId);
                completedMercenaryJobs.push({ templateId: job.templateId || '', jobId: job.id });
                return null; // Remove from queue
              }
              // Move to training if slot available
              if (slotsToFill > 0 && newElapsed >= (job.arrivalTime || 0)) {
                slotsToFill--;
                return { ...job, elapsedTime: newElapsed, status: 'training' as const };
              }
              return { ...job, elapsedTime: newElapsed };
            }

            // Process 'training' entries (both mercenary and reinforcement)
            if (job.status === 'training') {
              // For reinforcement entries, train soldiers (only mercenary banners use barracks queue)
              if (job.type === 'reinforcement' && job.bannerId !== undefined && job.squadId !== undefined) {
                const banner = banners.find(b => b.id === job.bannerId);
                const isMercenary = banner?.type === 'mercenary';

                // For mercenary banners, consume gold (1 per unit)
                // For regular banners, consume population
                if (isMercenary) {
                  // Consume gold if available
                  if (warehouse.gold >= 1 && job.soldiersTrained < job.soldiersNeeded) {
                    setWarehouse(w => ({ ...w, gold: Math.max(0, w.gold - 1) }));
                    const newTrained = job.soldiersTrained + 1;

                    // Update squad currentSize
                    setBanners((bs) => bs.map(b => {
                      if (b.id !== job.bannerId) return b;

                      // Ensure squads are initialized
                      let displaySquads = b.squads;
                      if (!displaySquads || displaySquads.length === 0) {
                        const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
                        displaySquads = squads;
                      }

                      return {
                        ...b,
                        squads: displaySquads.map(s =>
                          s.id === job.squadId ? { ...s, currentSize: Math.min(s.maxSize, s.currentSize + 1) } : s
                        )
                      };
                    }));

                    // Check if complete
                    if (newTrained >= job.soldiersNeeded) {
                      return null; // Remove from queue when complete
                    }

                    return { ...job, soldiersTrained: newTrained };
                  }
                  // No gold available, keep entry but don't progress
                  return job;
                } else {
                  // Regular banner: consume population AND iron if available (keep at least 1 population)
                  const squad = banner?.squads?.find(s => s.id === job.squadId);
                  if (squad && nextPop > 1 && job.soldiersTrained < job.soldiersNeeded) {
                    const ironCostPerUnit = getIronCostPerUnit(squad.type);

                    // Use availableIron from the main training loop (barracks processes after main training)
                    // But since setWarehouse batches updates, we need to check the current warehouse state
                    // For now, use warehouse.iron but this will be updated by the main training loop's setWarehouse calls
                    if (warehouse.iron >= ironCostPerUnit) {
                      // Consume iron
                      setWarehouse(w => ({ ...w, iron: Math.max(0, w.iron - ironCostPerUnit) }));

                      // Consume population
                      nextPop = Math.max(1, nextPop - 1);
                      const newTrained = job.soldiersTrained + 1;

                      // Update squad currentSize
                      setBanners((bs) => bs.map(b => {
                        if (b.id !== job.bannerId) return b;

                        // Ensure squads are initialized
                        let displaySquads = b.squads;
                        if (!displaySquads || displaySquads.length === 0) {
                          const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
                          displaySquads = squads;
                        }

                        return {
                          ...b,
                          squads: displaySquads.map(s =>
                            s.id === job.squadId ? { ...s, currentSize: Math.min(s.maxSize, s.currentSize + 1) } : s
                          )
                        };
                      }));

                      // Show feedback
                      setIronConsumptionFeedback({
                        message: `-${ironCostPerUnit.toFixed(1)} Iron (retraining 1 unit)`,
                        timestamp: Date.now()
                      });
                      setTimeout(() => {
                        setIronConsumptionFeedback(prev => {
                          if (prev && Date.now() - prev.timestamp >= 2000) {
                            return null;
                          }
                          return prev;
                        });
                      }, 2000);

                      // Check if complete
                      if (newTrained >= job.soldiersNeeded) {
                        return null; // Remove from queue when complete
                      }

                      return { ...job, soldiersTrained: newTrained };
                    }
                    // Not enough iron available, keep entry but don't progress
                    return job;
                  }
                  // No population available, keep entry but don't progress
                  return job;
                }
              }

              // For mercenary entries in training (shouldn't happen, but handle gracefully)
              return job;
            }

            // Move 'arriving' reinforcement entries to 'training' if slots available
            if (job.type === 'reinforcement' && job.status === 'arriving' && slotsToFill > 0) {
              slotsToFill--;
              return { ...job, status: 'training' as const };
            }

            return job;
          }).filter(Boolean) as TrainingEntry[];

          return { ...barracks, trainingQueue: updatedQueue };
        })();

        // Update barracks state
        if (updatedBarracks) {
          setBarracks(updatedBarracks);
        }

        // Create banners for completed mercenary jobs
        const completedJobs = completedMercenaryJobs;

        // Create banners outside of barracks state update to prevent duplicates
        console.log('[BANNER DEBUG] Checking completedJobs:', completedJobs.length);
        if (completedJobs.length > 0) {
          console.log('[BANNER DEBUG] Processing', completedJobs.length, 'completed job(s)');

          // Prepare all new banners first
          const newBanners: Banner[] = [];
          let nextSeq = bannerSeq;

          completedJobs.forEach(({ templateId }) => {
            // Find template from current bannerTemplates (from dependency)
            const template = bannerTemplates.find(t => t.id === templateId);
            if (!template) {
              console.error('[BANNER DEBUG] Template not found:', templateId, 'Available:', bannerTemplates.map(t => t.id));
              return;
            }

            const squads: string[] = [];
            template.squads.forEach(s => {
              for (let i = 0; i < s.count; i++) {
                squads.push(s.type); // Each count is a squad
              }
            });

            // Initialize squads with health tracking (use ref for closure access)
            const { squads: squadObjects, nextSeq: newSquadSeq } = initializeSquadsFromUnits(squads, squadSeqRef.current);
            setSquadSeq(newSquadSeq);
            squadSeqRef.current = newSquadSeq;

            // Generate auto-name based on composition
            const bannerId = nextSeq++;
            const autoName = generateBannerName(bannerId, squadObjects);

            // Initialize XP for new mercenary banner
            const initialXP = 0;
            const initialLevelInfo = calculateLevelFromXP(initialXP);

            newBanners.push({
              id: bannerId,
              name: autoName,
              units: squads, // Keep for backward compatibility
              squads: squadObjects,
              status: 'ready',
              reqPop: template.requiredPopulation,
              recruited: template.requiredPopulation,
              type: 'mercenary', // Mark as mercenary banner
              customNamed: false, // Auto-generated name
              xp: initialXP,
              level: initialLevelInfo.level,
              xpCurrentLevel: initialLevelInfo.xpCurrentLevel,
              xpNextLevel: initialLevelInfo.xpNextLevel,
            });
          });

          // Update states separately to ensure React processes them correctly
          if (newBanners.length > 0) {
            console.log('[BANNER DEBUG] Creating', newBanners.length, 'banner(s):', newBanners.map(b => `${b.name} (id: ${b.id})`));

            // Update bannerSeq first
            setBannerSeq(nextSeq);

            // Then update banners state - use functional update to get latest state
            setBanners(bs => {
              const updated = [...bs, ...newBanners];
              console.log('[BANNER DEBUG] Banner state updated. Previous:', bs.length, 'New total:', updated.length, 'Banners:', updated.map(b => b.name));
              return updated;
            });
          } else {
            console.warn('[BANNER DEBUG] No banners created from', completedJobs.length, 'completed jobs');
          }
        }
      }

      // EMERGENCY RULE: Ensure population never goes below 1
      setPopulation(Math.max(1, nextPop));
    }, 1000);
    return () => clearInterval(id);
  }, [lumberRate, stoneRate, foodRate, foodConsumption, netFoodRate, lumberCap, stoneCap, foodCap, netPopulationChange, population, banners, missions, warehouse.food, warehouse.iron, farm.stored, popCap, barracks, bannerTemplates, bannerSeq, recruitmentMode, lumberMill.workers, quarry.workers, farm.workers, warehouseCap, goldIncomePerSecond, squadSeqRef]);

  // === Mission Cooldown Timer ===
  useEffect(() => {
    const missionsWithCooldown = missions.filter(m => m.cooldownEndTime && m.cooldownEndTime > Date.now());
    if (missionsWithCooldown.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setMissions((ms) => {
        return ms.map((m) => {
          if (m.cooldownEndTime && m.cooldownEndTime <= now) {
            // Cooldown expired - replace with new random mission from pool
            // Exclude all currently active mission IDs to avoid duplicates
            const currentMissionIds = ms.map(m => m.id);
            const newMissions = selectRandomMissions(1, currentMissionIds);
            return newMissions[0] || m; // Fallback to current if no replacement found
          }
          return m;
        });
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [missions]);

  // Clamp resources if capacity changes
  useEffect(() => {
    setWarehouse((w) => ({
      ...w,
      wood: Math.min(w.wood, warehouseCap.wood),
      stone: Math.min(w.stone, warehouseCap.stone),
      food: Math.min(w.food, warehouseCap.food),
      iron: Math.min(w.iron, warehouseCap.iron),
      gold: Math.min(w.gold, warehouseCap.gold),
    }));
  }, [warehouseCap.wood, warehouseCap.stone, warehouseCap.food, warehouseCap.iron, warehouseCap.gold]);

  // === Warehouse free per type ===
  const warehouseFree: WarehouseState = {
    wood: warehouseCap.wood - warehouse.wood,
    stone: warehouseCap.stone - warehouse.stone,
    food: warehouseCap.food - warehouse.food,
    iron: warehouseCap.iron - warehouse.iron,
    gold: warehouseCap.gold - warehouse.gold,
  };

  // === Collection ===
  function collect(from: "wood" | "stone" | "food" | "iron") {
    setWarehouse((w) => {
      const clone = { ...w } as WarehouseState;
      if (from === "wood") clone.wood += Math.min(lumberMill.stored, warehouseFree.wood);
      if (from === "stone") clone.stone += Math.min(quarry.stored, warehouseFree.stone);
      if (from === "food") clone.food += Math.min(farm.stored, warehouseFree.food);
      if (from === "iron") clone.iron += Math.min(ironMine.stored, warehouseFree.iron);
      return clone;
    });
    if (from === "wood") setLumberMill((b) => ({ ...b, stored: 0 }));
    if (from === "stone") setQuarry((b) => ({ ...b, stored: 0 }));
    if (from === "food") setFarm((b) => ({ ...b, stored: 0 }));
    if (from === "iron") setIronMine((b) => ({ ...b, stored: 0 }));
  }

  function collectAll() {
    setWarehouse((w) => ({
      ...w,
      wood: w.wood + Math.min(lumberMill.stored, warehouseFree.wood),
      stone: w.stone + Math.min(quarry.stored, warehouseFree.stone),
      food: w.food + Math.min(farm.stored, warehouseFree.food),
      iron: w.iron + Math.min(ironMine.stored, warehouseFree.iron),
    }));
    setLumberMill((b) => ({ ...b, stored: 0 }));
    setQuarry((b) => ({ ...b, stored: 0 }));
    setFarm((b) => ({ ...b, stored: 0 }));
    setIronMine((b) => ({ ...b, stored: 0 }));
  }

  // === Upgrade flows with confirmation ===
  const [pendingUpgrade, setPendingUpgrade] = useState<
    | null
    | { res: "wood" | "stone" | "food" | "iron" | "warehouse" | "house" | "townhall" | "barracks" | "tavern" | "militaryAcademy"; from: number; to: number; cost: { wood: number; stone: number } }
  >(null);

  function requestUpgrade(res: "wood" | "stone" | "food" | "iron" | "warehouse" | "house", currentLevel: number) {
    if (res === "warehouse") {
      const to = currentLevel + 1;
      const c = getWarehouseCost(to);
      setPendingUpgrade({ res, from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
      return;
    }
    if (res === "house") {
      const to = currentLevel + 1;
      const c = getHouseCost(to);
      setPendingUpgrade({ res, from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
      return;
    }
    const to = currentLevel + 1;
    const c = getBuildingCost(res, to);
    setPendingUpgrade({ res, from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }

  function confirmUpgrade() {
    if (!pendingUpgrade) return;
    const { res, to, cost } = pendingUpgrade;

    if (res === "warehouse") {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setWarehouseLevel(to);
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "house") {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setHouse(to);
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "townhall") {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setTownHall({ level: to as TownHallLevel });
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "barracks" && barracks) {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setBarracks({
        ...barracks,
        level: to,
        trainingSlots: getMaxTrainingSlots(to),
        maxTemplates: to * 2,
      });
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "tavern" && tavern) {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setTavern({ ...tavern, level: to });
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "militaryAcademy" && militaryAcademy) {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setMilitaryAcademy({ ...militaryAcademy, level: to });
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    // Building upgrades, deduct both wood & stone per doc
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));
    if (res === "wood") setLumberMill((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("wood", to, "capacity")), workers: b.enabled ? Math.min(to, b.workers) : 0 }));
    if (res === "stone") setQuarry((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("stone", to, "capacity")), workers: b.enabled ? Math.min(to, b.workers) : 0 }));
    if (res === "food") setFarm((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("food", to, "capacity")), workers: b.enabled ? Math.min(to, b.workers) : 0 }));
    if (res === "iron") setIronMine((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("iron", to, "capacity")), workers: b.enabled ? Math.min(to, b.workers) : 0 }));
    setPendingUpgrade(null);
    saveGame(); // Save after building upgrade
  }

  function cancelUpgrade() { setPendingUpgrade(null); }

  // Handle escape key and prevent body scroll when modal is open
  useEffect(() => {
    if (!pendingUpgrade) {
      // Don't reset overflow when modal closes - let CSS handle it
      return;
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelUpgrade();
      }
    };

    document.addEventListener("keydown", handleEscape);
    // Only prevent scroll when modal is actually open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      // Restore original overflow state
      document.body.style.overflow = originalOverflow;
    };
  }, [pendingUpgrade]);

  // === Building enable/disable ===
  function toggleBuilding(building: 'wood' | 'stone' | 'food' | 'iron') {
    if (building === 'wood') {
      setLumberMill(b => ({ ...b, enabled: !b.enabled, workers: 0 })); // Workers will be reassigned by useEffect
    }
    if (building === 'stone') {
      setQuarry(b => ({ ...b, enabled: !b.enabled, workers: 0 })); // Workers will be reassigned by useEffect
    }
    if (building === 'iron') {
      setIronMine(b => ({ ...b, enabled: !b.enabled, workers: 0 })); // Workers will be reassigned by useEffect
    }
    if (building === 'food') {
      // Emergency mechanic: Prevent disabling farm (population is always >= 1)
      // Farm must always be enabled to maintain minimum food production
      // Don't allow disabling - farm is critical for survival
      return;
    }
  }

  // === UI bits ===
  const RES_META: Record<"wood" | "stone" | "food" | "iron", { name: string; short: "W" | "S" | "F" | "I" }> = {
    wood: { name: "Wood", short: "W" },
    stone: { name: "Stone", short: "S" },
    food: { name: "Food", short: "F" },
    iron: { name: "Iron", short: "I" },
  };

  function formatInt(n: number) { return Math.floor(n).toLocaleString(); }

  function formatCap(n: number) { return Math.floor(n).toLocaleString(); }
  function pct(a: number, b: number) { return Math.max(0, Math.min(100, Math.floor((a / b) * 100))); }
  function formatShort(n: number) {
    const abs = Math.floor(n);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}K`;
    return abs.toLocaleString();
  }

  function formatRate(rate: number): string {
    const abs = Math.abs(rate);
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
    if (abs >= 1) return abs.toFixed(1);
    return abs.toFixed(2);
  }

  function RowBar({ value, max, label }: { value: number; max: number; label?: string }) {
    const p = pct(value, max);
    const barHeight = label ? 'h-4 sm:h-5' : 'h-1.5';
    return (
      <div className={`${barHeight} rounded bg-slate-800 overflow-hidden relative flex items-center`}>
        <div className="h-full bg-sky-500" style={{ width: `${p}%` }} />
        {label && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] sm:text-[10px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              {label}
            </span>
          </div>
        )}
      </div>
    );
  }

  function CostBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return <span className={`text-[10px] font-semibold ${ok ? "text-emerald-600" : "text-red-600"}`}>{children}</span>;
  }

  // === Top resource strip ===
  // === Population Pill with Breakdown Visualization ===
  function PopulationPill({
    value,
    cap,
    rate,
    trend,
    trendTooltip,
    trendColor,
    statusColor,
    lockedWorkers,
    bufferWorkers,
    freePop
  }: {
    value: number;
    cap: number;
    rate: number;
    trend?: string;
    trendTooltip?: string;
    trendColor?: string;
    statusColor?: 'red' | 'yellow' | 'green';
    lockedWorkers: number;
    bufferWorkers: number;
    freePop: number;
  }) {
    const valueColor = statusColor === 'red' ? 'text-red-500' : statusColor === 'yellow' ? 'text-yellow-500' : statusColor === 'green' ? 'text-emerald-500' : '';

    // Memoize bar calculations - only recalculate when INTEGER population changes
    // Round population to integer - bar only updates when someone actually enters/leaves
    const integerPopulation = Math.floor(value);

    const barCalculations = useMemo(() => {
      // Calculate percentages for the stacked bar relative to CAPACITY
      // Each segment represents its count as a percentage of total capacity
      // This ensures correct proportions regardless of population value
      const lockedPct = cap > 0 ? (lockedWorkers / cap) * 100 : 0;
      const bufferPct = cap > 0 ? (bufferWorkers / cap) * 100 : 0;
      const freePct = cap > 0 ? (freePop / cap) * 100 : 0;

      // Total filled portion = sum of all segments
      const totalFilledPct = lockedPct + bufferPct + freePct;

      // Empty capacity is the remainder
      const emptyPct = Math.max(0, 100 - totalFilledPct);

      // Safe recruits marker position (at the boundary between green and orange)
      const markerPct = lockedPct + bufferPct;
      const showMarker = bufferWorkers > 0; // Only show marker if there are buffer workers

      return {
        totalFilledPct,
        scaledLockedPct: lockedPct,
        scaledBufferPct: bufferPct,
        scaledFreePct: freePct,
        emptyPct,
        markerPct,
        showMarker
      };
    }, [Math.floor(value), cap, lockedWorkers, bufferWorkers, freePop]); // Recalculate when integer population, capacity, or breakdown values change

    const { totalFilledPct, scaledLockedPct, scaledBufferPct, scaledFreePct, emptyPct, markerPct, showMarker } = barCalculations;

    // Safe and risky recruits
    const safeRecruits = freePop;
    const riskyRecruits = bufferWorkers;

    // Tooltip text with breakdown info
    const tooltipText = `Total: ${value} / ${cap}
${lockedWorkers === 1 ? '1 locked worker' : `${lockedWorkers} locked workers`} (keep buildings running)
Workers: ${bufferWorkers}
Free: ${Math.round(freePop * 10) / 10}
Safe recruits (unassigned people): ${safeRecruits}`;

    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 px-0.5 sm:px-1.5 py-0.5 sm:py-1 shadow-sm flex gap-0.5 sm:gap-1.5" title={tooltipText}>
        {/* Icon column */}
        <div className="flex-shrink-0 flex items-center">
          <img src={rPopulation} alt="Population" className="h-4 w-4 sm:h-6 sm:w-6 object-contain drop-shadow-md" />
        </div>
        {/* Content column */}
        <div className="flex-1 min-w-0">
          {/* Single line: Pop value and timer */}
          <div className="text-[9px] sm:text-xs font-bold select-none flex items-center gap-1 sm:gap-1.5 flex-wrap">
            <span className={valueColor || ''}>Pop {formatShort(value)} / {formatShort(cap)}</span>
            {trend && (
              <span className={`text-[8px] sm:text-[10px] font-normal ${trendColor || 'text-slate-500'}`} title={trendTooltip || trend}>
                {trend}
              </span>
            )}
          </div>
          {/* Stacked bar visualization */}
          <div className="mt-0.5 sm:mt-1 h-0.5 sm:h-1 rounded bg-slate-800 border border-slate-700 overflow-hidden relative">
            {/* Red segment: Locked workers */}
            {scaledLockedPct > 0 && (
              <div
                className="h-full bg-red-600 absolute left-0 top-0"
                style={{ width: `${scaledLockedPct}%` }}
              />
            )}
            {/* Orange segment: Buffer workers */}
            {scaledBufferPct > 0 && (
              <div
                className="h-full bg-orange-500 absolute top-0"
                style={{ left: `${scaledLockedPct}%`, width: `${scaledBufferPct}%` }}
              />
            )}
            {/* Green segment: Free population */}
            {scaledFreePct > 0 && (
              <div
                className="h-full bg-emerald-500 absolute top-0"
                style={{ left: `${scaledLockedPct + scaledBufferPct}%`, width: `${scaledFreePct}%` }}
              />
            )}
            {/* Empty capacity (grey) */}
            {emptyPct > 0 && (
              <div
                className="h-full bg-slate-700 absolute top-0"
                style={{ left: `${totalFilledPct}%`, width: `${emptyPct}%` }}
              />
            )}
            {/* Marker at safe recruitment boundary (between green and orange) */}
            {showMarker && scaledBufferPct > 0 && (
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-yellow-400 z-10 shadow-sm"
                style={{ left: `${scaledLockedPct + scaledBufferPct}%`, marginLeft: '-1px' }}
                title="Safe recruitment limit"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Mobile Resource Cell (compact with tap-to-show rate) ===
  function MobileResourceCell({ label, value, cap, rate = 0 }: { label: string; value: number; cap: number; rate?: number }) {
    const isFood = label === 'Food';
    const rateColor = rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-500';
    const rateSign = rate > 0 ? '+' : '';
    const showRate = showingRateFor === label;

    // Food text color based on rate
    const valueTextColor = isFood
      ? (rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-100')
      : 'text-slate-100';

    const fillPercentage = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;

    return (
      <button
        onClick={(e) => handleResourceTap(label, e)}
        onTouchStart={(e) => handleResourceTap(label, e)}
        className="mobile-resource-cell relative flex items-center gap-0.5 px-0.5 py-0.5 rounded-lg border border-slate-700/50 touch-manipulation active:opacity-90 transition-opacity flex-shrink-0 overflow-hidden"
        style={{ minHeight: '32px' }}
      >
        {/* Background fill - darker base */}
        <div className="absolute inset-0 bg-slate-900/90" />

        {/* Progress fill - colored strip from left to right */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="h-full bg-cyan-500/40 transition-all duration-300"
            style={{ width: `${fillPercentage}%` }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 flex items-center gap-0.5">
          {/* Icon */}
          <img
            src={getResourceIcon(label)}
            alt={label}
            className="h-3.5 w-3.5 flex-shrink-0 object-contain drop-shadow-md"
          />

          {/* Amount - no max capacity text */}
          <span className={`text-[10px] font-bold ${valueTextColor} leading-tight drop-shadow-sm whitespace-nowrap`}>
            {formatShort(value)}
          </span>
          {showRate && (
            <span className={`text-[9px] font-normal ${rateColor} leading-tight drop-shadow-sm whitespace-nowrap`}>
              {rateSign}{formatRate(rate)}/s
            </span>
          )}
        </div>
      </button>
    );
  }

  function ResourcePill({ label, value, cap, rate = 0, showBar = true, trend, statusColor, workerInfo, className = '' }: { label: string; value: number; cap: number; rate?: number; showBar?: boolean; trend?: string; statusColor?: 'red' | 'yellow' | 'green'; workerInfo?: string; className?: string }) {
    const isFood = label === 'Food';
    const isResource = ['Wood', 'Stone', 'Food', 'Iron', 'Gold'].includes(label);
    const rateColor = rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-500';
    const rateSign = rate > 0 ? '+' : '';
    const showRate = showingRateFor === label;

    // Food text color based on rate
    const valueTextColor = isFood
      ? (rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-100')
      : 'text-slate-100';

    // Hide label for Wood, Stone, Food, Iron, Gold (icon is the identifier), but keep it for Skill Points
    const shouldHideLabel = ['Wood', 'Stone', 'Food', 'Iron', 'Gold'].includes(label);

    const fillPercentage = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;

    // For resources (Wood, Stone, Food, Iron, Gold), use clickable button with background fill
    if (isResource) {
      return (
        <button
          onClick={(e) => handleResourceTap(label, e)}
          onTouchStart={(e) => handleResourceTap(label, e)}
          className={`mobile-resource-cell relative rounded-lg border border-slate-700 bg-slate-900 px-1 sm:px-1.5 py-0.5 sm:py-0.5 shadow-sm flex items-center gap-0.5 sm:gap-1 overflow-hidden touch-manipulation active:opacity-90 transition-opacity flex-shrink-0 ${className}`}
        >
          {/* Background fill - darker base */}
          <div className="absolute inset-0 bg-slate-900" />

          {/* Progress fill - colored strip from left to right */}
          {showBar && (
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="h-full bg-cyan-500/30 transition-all duration-300"
                style={{ width: `${fillPercentage}%` }}
              />
            </div>
          )}

          {/* Content */}
          <div className="relative z-10 flex items-center gap-0.5 sm:gap-1">
            {/* Icon */}
            <img src={getResourceIcon(label)} alt={label} className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 object-contain drop-shadow-md" />
            {/* Value */}
            <span className={`text-[9px] sm:text-[10px] font-bold select-none ${valueTextColor} whitespace-nowrap`}>
              {formatShort(value)}
            </span>
            {showRate && (
              <span className={`text-[9px] sm:text-[10px] font-normal ${rateColor} whitespace-nowrap`}>
                {rateSign}{formatRate(rate)}/s
              </span>
            )}
            {trend && (
              <span className={`text-[9px] sm:text-[10px] font-normal ${trend.includes('-') ? 'text-red-500' : trend.includes('+') ? 'text-emerald-500' : 'text-slate-500'} whitespace-nowrap`}>
                {trend}
              </span>
            )}
            {workerInfo && (
              <span className="text-[9px] sm:text-[10px] text-slate-500 font-normal whitespace-nowrap">
                ({workerInfo})
              </span>
            )}
          </div>
        </button>
      );
    }

    // Skill Points - non-clickable, no progress fill, keep original behavior
    return (
      <div className={`rounded-xl border border-slate-700 bg-slate-900 px-1 sm:px-1.5 py-1 shadow-sm flex gap-1 sm:gap-1.5 ${className}`}>
        {/* Icon column */}
        <div className="flex-shrink-0 flex items-center">
          <img src={getResourceIcon(label)} alt={label} className="h-5 w-5 sm:h-6 sm:w-6 object-contain drop-shadow-md" />
        </div>
        {/* Content column */}
        <div className="flex-1 min-w-0">
          {/* Single line: Name and value */}
          <div className="text-[10px] sm:text-xs font-bold select-none flex items-center gap-1.5 flex-wrap">
            <span className={statusColor === 'red' ? 'text-red-500' : statusColor === 'yellow' ? 'text-yellow-500' : statusColor === 'green' ? 'text-emerald-500' : ''}>
              {label} {formatShort(value)}
            </span>
            {trend && (
              <span className={`text-[9px] sm:text-[10px] font-normal ${trend.includes('-') ? 'text-red-500' : trend.includes('+') ? 'text-emerald-500' : 'text-slate-500'}`}>
                {trend}
              </span>
            )}
            {workerInfo && (
              <span className="text-[9px] sm:text-[10px] text-slate-500 font-normal">
                ({workerInfo})
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Settings Button (replaces Logo) ===
  function LogoPill() {
    return (
      <button
        onClick={() => setShowCheatMenu(prev => !prev)}
        className="rounded-lg border border-slate-700 bg-slate-900 px-0.5 py-0.5 sm:px-1 sm:py-1 shadow-sm flex items-center justify-center hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer touch-manipulation flex-shrink-0"
        title="Settings / Cheat Menu"
        style={{ minHeight: '28px', minWidth: '28px', maxWidth: '32px' }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>
    );
  }

  // === Fullscreen Toggle Button ===
  function FullscreenPill() {
    return (
      <button
        onClick={toggleFullscreen}
        className="rounded-lg border border-slate-700 bg-slate-900 px-0.5 py-0.5 sm:px-1 sm:py-1 shadow-sm flex items-center justify-center hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer touch-manipulation flex-shrink-0"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        style={{ minHeight: '28px', minWidth: '28px', maxWidth: '32px' }}
      >
        {isFullscreen ? (
          // Exit fullscreen icon (arrows pointing inwards)
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
            />
          </svg>
        ) : (
          // Enter fullscreen icon (arrows pointing outwards)
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        )}
      </button>
    );
  }



  // === Taxes Pill ===
  function TaxesPill() {
    const taxLabels: Record<typeof tax, string> = {
      'very_low': 'Very Low',
      'low': 'Low',
      'normal': 'Normal',
      'high': 'High',
      'very_high': 'Very High'
    };

    const taxColors: Record<typeof tax, string> = {
      'very_low': 'text-emerald-500',
      'low': 'text-lime-500',
      'normal': 'text-yellow-400',
      'high': 'text-orange-500',
      'very_high': 'text-red-500'
    };

    const taxOrder: Array<typeof tax> = ['very_low', 'low', 'normal', 'high', 'very_high'];
    const currentIndex = taxOrder.indexOf(tax);
    const canDecrease = currentIndex > 0;
    const canIncrease = currentIndex < taxOrder.length - 1;

    const decreaseTax = () => {
      if (canDecrease) {
        setTax(taxOrder[currentIndex - 1]);
      }
    };

    const increaseTax = () => {
      if (canIncrease) {
        setTax(taxOrder[currentIndex + 1]);
      }
    };

    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 px-0.5 sm:px-1.5 py-0.5 sm:py-1 shadow-sm flex items-center gap-0.5 sm:gap-1.5">
        {/* Icon on the left */}
        <div className="flex-shrink-0 flex items-center">
          <img src={rTaxes} alt="Taxes" className="h-4 w-4 sm:h-6 sm:w-6 object-contain drop-shadow-md" />
        </div>
        {/* Text stack: Taxes title with tax level below */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="text-[9px] sm:text-xs font-bold select-none">Taxes</div>
          <div className={`text-[8px] sm:text-[10px] font-semibold ${taxColors[tax]}`}>{taxLabels[tax]}</div>
        </div>
        {/* Control buttons on the right, vertically centered */}
        <div className="flex-shrink-0 flex items-center gap-0.5 sm:gap-1.5">
          <button
            onClick={decreaseTax}
            disabled={!canDecrease}
            className={`px-0.5 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-xs font-semibold touch-manipulation ${canDecrease
              ? 'bg-slate-800 active:bg-slate-700 hover:bg-slate-700 text-white'
              : 'bg-slate-800/50 text-slate-500 cursor-not-allowed'
              }`}
            title={canDecrease ? 'Decrease taxes' : 'Taxes are already at minimum'}
          >
            −
          </button>
          <button
            onClick={increaseTax}
            disabled={!canIncrease}
            className={`px-0.5 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-xs font-semibold touch-manipulation ${canIncrease
              ? 'bg-slate-800 active:bg-slate-700 hover:bg-slate-700 text-white'
              : 'bg-slate-800/50 text-slate-500 cursor-not-allowed'
              }`}
            title={canIncrease ? 'Increase taxes' : 'Taxes are already at maximum'}
          >
            +
          </button>
        </div>
      </div>
    );
  }

  // === Compact Building Row ===
  function BuildingRow({
    name,
    res,
    level,
    rate,
    stored,
    cap,
    onCollect,
    enabled,
    workers,
    requiredWorkers,
    onToggle,
    toggleDisabled,
    onRequestDisable,
  }: {
    name: string;
    res: "wood" | "stone" | "food" | "iron";
    level: number;
    rate: number;
    stored: number;
    cap: number;
    onCollect: () => void;
    enabled: boolean;
    workers: number;
    requiredWorkers: number;
    onToggle: () => void;
    toggleDisabled?: boolean;
    onRequestDisable?: () => void;
  }) {
    const nextLevel = level + 1;
    const nextCost = getBuildingCost(res, nextLevel);
    const enoughWood = warehouse.wood >= nextCost.wood;
    const enoughStone = warehouse.stone >= nextCost.stone;
    const affordable = enoughWood && enoughStone;
    const meta = RES_META[res];
    const effectiveLevel = Math.min(level, workers);

    // Calculate fill percentage for Collect button color
    const fillPercent = cap > 0 ? (stored / cap) * 100 : 0;
    const isWarehouseFull = (warehouseFree as any)[res] <= 0;
    const isBlocked = stored > 0 && isWarehouseFull && enabled;

    const getCollectButtonColor = () => {
      if (stored <= 0) return 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600'; // Disabled state
      if (isBlocked) return 'bg-red-600 active:bg-red-700 hover:bg-red-700'; // Blocked - red
      if (fillPercent >= 100) return 'bg-emerald-400 active:bg-emerald-500 hover:bg-emerald-500'; // Full - pure green
      if (fillPercent >= 75) return 'bg-emerald-500 active:bg-emerald-600 hover:bg-emerald-600'; // High fill - strong green
      if (fillPercent >= 25) return 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700'; // Medium fill - clearly green
      return 'bg-emerald-700 active:bg-emerald-800 hover:bg-emerald-800'; // Low fill - slightly green
    };

    const handleCollectClick = () => {
      if (isBlocked) {
        // Show toast message
        const toast = document.createElement('div');
        toast.textContent = 'Warehouse full';
        toast.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-semibold animate-in fade-in duration-200';
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.animation = 'fade-out 0.3s ease-out';
          setTimeout(() => toast.remove(), 300);
        }, 2000);
        return;
      }
      onCollect();
    };

    return (
      <div className={`rounded-lg border ${enabled ? 'border-slate-800' : 'border-slate-600 opacity-75'} bg-slate-900 p-2 sm:p-3 w-full`}>
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden">
            {res === 'wood' ? (
              <img src={lumberjackImg} alt={name} className="w-full h-full object-cover" />
            ) : (
              <div className="text-slate-500 text-xs sm:text-sm font-semibold">{meta.short}</div>
            )}
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Disable icon - far left */}
              {enabled ? (
                <button
                  className="rounded-lg bg-slate-900 px-1 py-1 sm:px-1.5 sm:py-1.5 shadow-sm flex items-center justify-center hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer touch-manipulation flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={onRequestDisable || onToggle}
                  disabled={toggleDisabled}
                  title={toggleDisabled ? "Farm cannot be disabled (required for survival)" : "Disable building (releases workers)"}
                  style={{ minHeight: '24px', minWidth: '24px', maxWidth: '28px' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-red-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 8l8 8M16 8l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              ) : (
                <button
                  className="rounded-lg bg-slate-900 px-1 py-1 sm:px-1.5 sm:py-1.5 shadow-sm flex items-center justify-center hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer touch-manipulation flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={onToggle}
                  disabled={toggleDisabled}
                  title="Enable building"
                  style={{ minHeight: '24px', minWidth: '24px', maxWidth: '28px' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-emerald-400"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              )}
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">{name}</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {level}</div>
              {/* Production text - green */}
              <div className="text-[9px] sm:text-[10px] text-emerald-400 flex-shrink-0">+{formatRate(rate)} {meta.short}/s</div>
              {/* Workers text */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Workers: {workers}/{requiredWorkers}</div>
              {workers < requiredWorkers && (
                <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-amber-900 text-amber-200 flex-shrink-0">
                  Effective Lv {effectiveLevel}
                </div>
              )}
            </div>
            {/* Level-up block, Progress bar, and Collect button row - 3 column layout */}
            <div className="mt-0.5 sm:mt-1 grid grid-cols-3 gap-1 items-center w-full max-[340px]:grid-cols-2 max-[340px]:grid-rows-2">
              {/* Column 1: Level-up block - left aligned */}
              <div className="flex items-center justify-start w-full min-w-0">
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center overflow-hidden ${affordable
                      ? `bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold`
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => requestUpgrade(res, level)}
                    disabled={!affordable}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Column 2: Progress bar - center aligned, fills column width */}
              <div className="flex items-center justify-center min-w-0 w-full max-[340px]:col-span-2 max-[340px]:row-start-2">
                <div className="w-full">
                  <RowBar value={stored} max={cap} label={`${formatInt(stored)} / ${formatCap(cap)}`} />
                </div>
              </div>

              {/* Column 3: Collect button - right aligned */}
              <div className="flex items-center justify-end w-full max-[340px]:col-start-2 max-[340px]:row-start-1">
                <button
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs ${getCollectButtonColor()} text-white disabled:opacity-50 touch-manipulation min-h-[44px] sm:min-h-0 relative flex-shrink-0 overflow-hidden ${fillPercent >= 100 && stored > 0 && !isBlocked ? 'shimmer-gold' : ''} ${isBlocked ? 'pulse-red' : ''}`}
                  onClick={handleCollectClick}
                  disabled={stored <= 0 || (!isBlocked && (warehouseFree as any)[res] <= 0) || !enabled}
                  title={isBlocked ? "Warehouse full - Click to see message" : (warehouseFree as any)[res] <= 0 ? "Warehouse full for this resource" : `Collect ${meta.name}`}
                >
                  <span className="relative z-10 flex items-center gap-1">
                    Collect <img src={getResourceIcon(meta.name)} alt={meta.name} className="h-3.5 w-3.5 sm:h-4 sm:w-4 object-contain drop-shadow-md" />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === House Row ===
  function HouseRow() {
    const nextLevel = house + 1;
    const nextCost = getHouseCost(nextLevel);
    const enoughWood = warehouse.wood >= nextCost.wood;
    const enoughStone = warehouse.stone >= nextCost.stone;
    const affordable = enoughWood && enoughStone;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">🏠</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">House</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {house}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Capacity: {formatInt(popCap)}</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Workers: 0 (no workers required)</div>
            </div>
            {/* Upgrade block row */}
            <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
              {/* Upgrade block: costs + arrow button */}
              <div className="flex items-center gap-[5px] flex-shrink-0">
                {/* Costs - can wrap */}
                <div className="flex items-center gap-0.5 flex-wrap">
                  {nextCost.wood > 0 && (
                    <div className="flex items-center gap-0.5">
                      <img
                        src={getResourceIcon('Wood')}
                        alt="Wood"
                        className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                      />
                      <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                        {formatInt(nextCost.wood)}
                      </span>
                    </div>
                  )}
                  {nextCost.stone > 0 && (
                    <div className="flex items-center gap-0.5">
                      <img
                        src={getResourceIcon('Stone')}
                        alt="Stone"
                        className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                      />
                      <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                        {formatInt(nextCost.stone)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Arrow-up button - fixed position */}
                <button
                  className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                    ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                    : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                    } disabled:cursor-not-allowed`}
                  onClick={() => requestUpgrade("house", house)}
                  disabled={!affordable}
                  title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel} (+5 capacity)`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === Town Hall Row ===
  function TownHallRow() {
    const nextLevel = townHall.level + 1;
    const canUpgrade = nextLevel <= 3;
    const nextCost = canUpgrade ? getTownHallCost(nextLevel) : null;
    const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
    const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
    const affordable = canUpgrade && enoughWood && enoughStone;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">🏛️</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Town Hall</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {townHall.level}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Net Pop: {netPopulationChange > 0 ? '+' : ''}{netPopulationChange.toFixed(1)}/s</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Happiness: {happiness}</div>
            </div>
            {/* Unlocks info - compact subtext */}
            {(townHall.level >= 2 || townHall.level >= 3) && (
              <div className="text-[9px] sm:text-[10px] text-slate-400 mt-0.5 flex-shrink-0">
                {townHall.level >= 2 && "Unlocks: Barracks, Tavern"}
                {townHall.level >= 3 && " | Market, Guard Tower (planned)"}
              </div>
            )}
            {/* Upgrade block row */}
            {canUpgrade && nextCost && (
              <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                {/* Upgrade block: costs + arrow button */}
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => requestTownHallUpgrade(townHall.level)}
                    disabled={!affordable}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Barracks Row ===
  function BarracksRow() {
    if (!barracks) {
      const canBuild = canBuildBarracks(townHall.level);
      const buildCost = getBarracksBuildCost();
      const hasEnoughWood = warehouse.wood >= buildCost.wood;
      const hasEnoughStone = warehouse.stone >= buildCost.stone;
      const canAfford = hasEnoughWood && hasEnoughStone;

      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
            {/* Building Icon Frame */}
            <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
              <div className="text-slate-500 text-xs sm:text-sm font-semibold">⚔️</div>
            </div>
            {/* Content area - no flex-1, shrinks to content */}
            <div className="min-w-0 flex-shrink-0">
              {/* Header block - shrink to content */}
              <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
                {/* Building name */}
                <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Barracks</div>
                {/* Locked message - compact subtext */}
                {!canBuild && (
                  <div className="text-[9px] sm:text-[10px] text-red-400 flex-shrink-0">Requires Town Hall Level 2</div>
                )}
              </div>
              {/* Upgrade block row */}
              {canBuild && (
                <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                  {/* Upgrade block: costs + arrow button */}
                  <div className="flex items-center gap-[5px] flex-shrink-0">
                    {/* Costs - can wrap */}
                    <div className="flex items-center gap-0.5 flex-wrap">
                      {buildCost.wood > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Wood')}
                            alt="Wood"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${hasEnoughWood ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(buildCost.wood)}
                          </span>
                        </div>
                      )}
                      {buildCost.stone > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Stone')}
                            alt="Stone"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${hasEnoughStone ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(buildCost.stone)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Build button - fixed position */}
                    <button
                      className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${canAfford
                        ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                        : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                        } disabled:cursor-not-allowed`}
                      onClick={buildBarracks}
                      disabled={!canAfford}
                      title={!canAfford ? `Need more Wood/Stone in warehouse` : `Build Barracks`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    const nextLevel = barracks.level + 1;
    const canUpgrade = nextLevel <= 3;
    const nextCost = canUpgrade ? getBarracksCost(nextLevel) : null;
    const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
    const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
    const affordable = canUpgrade && enoughWood && enoughStone;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">⚔️</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Barracks</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {barracks.level}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Slots: {barracks.trainingSlots}</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Active: {barracks.trainingQueue.length}/{barracks.trainingSlots}</div>
            </div>
            {/* Upgrade block row */}
            {canUpgrade && nextCost && (
              <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                {/* Upgrade block: costs + arrow button */}
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => requestBarracksUpgrade(barracks.level)}
                    disabled={!affordable}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Tavern Row ===
  function MilitaryAcademyRow() {
    if (!militaryAcademy) {
      const canBuild = canBuildMilitaryAcademy(townHall.level);
      const cost = getMilitaryAcademyBuildCost();
      const enoughWood = warehouse.wood >= cost.wood;
      const enoughStone = warehouse.stone >= cost.stone;
      const affordable = enoughWood && enoughStone;

      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
            {/* Building Icon Frame */}
            <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
              <div className="text-slate-500 text-xs sm:text-sm font-semibold">🎓</div>
            </div>
            {/* Content area - no flex-1, shrinks to content */}
            <div className="min-w-0 flex-shrink-0">
              {/* Header block - shrink to content */}
              <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
                {/* Building name */}
                <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Military Academy</div>
                {/* Locked message - compact subtext */}
                {!canBuild && (
                  <div className="text-[9px] sm:text-[10px] text-red-400 flex-shrink-0">Requires Town Hall Level 2</div>
                )}
              </div>
              {/* Upgrade block row */}
              {canBuild && (
                <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                  {/* Upgrade block: costs + arrow button */}
                  <div className="flex items-center gap-[5px] flex-shrink-0">
                    {/* Costs - can wrap */}
                    <div className="flex items-center gap-0.5 flex-wrap">
                      {cost.wood > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Wood')}
                            alt="Wood"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(cost.wood)}
                          </span>
                        </div>
                      )}
                      {cost.stone > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Stone')}
                            alt="Stone"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(cost.stone)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Build button - fixed position */}
                    <button
                      className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center overflow-hidden ${affordable
                        ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                        : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                        } disabled:cursor-not-allowed`}
                      onClick={buildMilitaryAcademy}
                      disabled={!affordable}
                      title={!affordable ? `Need more Wood/Stone in warehouse` : `Build Military Academy`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    const nextLevel = militaryAcademy.level + 1;
    const nextCost = nextLevel <= 3 ? getMilitaryAcademyCost(nextLevel) : null;
    const canUpgrade = nextLevel <= 3;
    const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
    const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
    const affordable = canUpgrade && nextCost && enoughWood && enoughStone;
    const maxCommanders = militaryAcademy.level;
    const currentCommanders = commanders.length;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">🎓</div>
          </div>
          <div className="min-w-0 flex-shrink-0">
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Military Academy</div>
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {militaryAcademy.level}</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Commanders: {currentCommanders}/{maxCommanders}</div>
            </div>
            {/* Upgrade block row */}
            {canUpgrade && nextCost && (
              <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                {/* Upgrade block: costs + arrow button */}
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => requestMilitaryAcademyUpgrade(militaryAcademy.level)}
                    disabled={!affordable}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function TavernRow() {
    if (!tavern) {
      const canBuild = canBuildTavern(townHall.level);
      const buildCost = getTavernBuildCost();
      const hasEnoughWood = warehouse.wood >= buildCost.wood;
      const hasEnoughStone = warehouse.stone >= buildCost.stone;
      const canAfford = hasEnoughWood && hasEnoughStone;

      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
            {/* Building Icon Frame */}
            <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
              <div className="text-slate-500 text-xs sm:text-sm font-semibold">🍺</div>
            </div>
            {/* Content area - no flex-1, shrinks to content */}
            <div className="min-w-0 flex-shrink-0">
              {/* Header block - shrink to content */}
              <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
                {/* Building name */}
                <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Tavern</div>
                {/* Locked message - compact subtext */}
                {!canBuild && (
                  <div className="text-[9px] sm:text-[10px] text-red-400 flex-shrink-0">Requires Town Hall Level 2</div>
                )}
              </div>
              {/* Upgrade block row */}
              {canBuild && (
                <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                  {/* Upgrade block: costs + arrow button */}
                  <div className="flex items-center gap-[5px] flex-shrink-0">
                    {/* Costs - can wrap */}
                    <div className="flex items-center gap-0.5 flex-wrap">
                      {buildCost.wood > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Wood')}
                            alt="Wood"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${hasEnoughWood ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(buildCost.wood)}
                          </span>
                        </div>
                      )}
                      {buildCost.stone > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Stone')}
                            alt="Stone"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${hasEnoughStone ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(buildCost.stone)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Build button - fixed position */}
                    <button
                      className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${canAfford
                        ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                        : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                        } disabled:cursor-not-allowed`}
                      onClick={buildTavern}
                      disabled={!canAfford}
                      title={!canAfford ? `Need more Wood/Stone in warehouse` : `Build Tavern`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    const nextLevel = tavern.level + 1;
    const canUpgrade = nextLevel <= 3;
    const nextCost = canUpgrade ? getTavernCost(nextLevel) : null;
    const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
    const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
    const affordable = canUpgrade && enoughWood && enoughStone;
    const festivalActive = tavern.activeFestival && Date.now() < tavern.festivalEndTime;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">🍺</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Tavern</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {tavern.level}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Happiness: +{tavern.level === 1 ? 10 : tavern.level === 2 ? 20 : 25}</div>
              {festivalActive && (
                <div className="text-[9px] sm:text-[10px] text-amber-400 flex-shrink-0">Festival Active!</div>
              )}
            </div>
            {/* Total happiness - compact subtext */}
            <div className="text-[9px] sm:text-[10px] text-slate-400 mt-0.5 flex-shrink-0">
              Total: {happiness} ({happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'})
            </div>
            {/* Action buttons row */}
            <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
              {/* Festival button */}
              {tavern.level >= 1 && !festivalActive && (
                <>
                  <button
                    onClick={startFestival}
                    disabled={warehouse.gold < 50}
                    className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs disabled:opacity-50 touch-manipulation min-h-[44px] sm:min-h-0 flex-shrink-0"
                    title={warehouse.gold < 50 ? "Need 50 Gold" : "Start Festival"}
                  >
                    Start Festival (50 Gold)
                  </button>
                </>
              )}
              {/* Upgrade block */}
              {canUpgrade && nextCost && (
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => requestTavernUpgrade(tavern.level)}
                    disabled={!affordable}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === Taxes Row ===
  function TaxesRow() {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">💰</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Taxes</div>
            </div>
            {/* Info text - compact subtext */}
            <div className="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 flex-shrink-0">Taxes are now managed from the top bar.</div>
          </div>
        </div>
      </div>
    );
  }

  // === Compact Warehouse Row ===
  function WarehouseRow() {
    const nextLevel = warehouseLevel + 1;
    const nextCost = getWarehouseCost(nextLevel);
    const enoughWood = warehouse.wood >= nextCost.wood;
    const enoughStone = warehouse.stone >= nextCost.stone;
    const affordable = enoughWood && enoughStone;

    // Calculate total stored and check for blocked state
    const totalStored = lumberMill.stored + quarry.stored + farm.stored + ironMine.stored;
    const hasStored = totalStored > 0;
    const isBlocked = hasStored && (
      (lumberMill.stored > 0 && warehouseFree.wood <= 0) ||
      (quarry.stored > 0 && warehouseFree.stone <= 0) ||
      (farm.stored > 0 && warehouseFree.food <= 0) ||
      (ironMine.stored > 0 && warehouseFree.iron <= 0)
    );

    const handleCollectAllClick = () => {
      if (isBlocked) {
        // Show toast message
        const toast = document.createElement('div');
        toast.textContent = 'Warehouse full for one or more resources';
        toast.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-semibold animate-in fade-in duration-200';
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.animation = 'fade-out 0.3s ease-out';
          setTimeout(() => toast.remove(), 300);
        }, 2000);
        return;
      }
      collectAll();
    };

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">📦</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Warehouse</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {warehouseLevel}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Caps: W/S/F {formatCap(warehouseCap.wood)}/{formatCap(warehouseCap.stone)}/{formatCap(warehouseCap.food)}</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Stored: W {formatInt(warehouse.wood)} S {formatInt(warehouse.stone)} F {formatInt(warehouse.food)}</div>
            </div>
            {/* Action buttons row - 2 column layout (Level-up + Collect All) */}
            <div className="mt-0.5 sm:mt-1 grid grid-cols-2 gap-1 items-center">
              {/* Column 1: Level-up block - left aligned */}
              <div className="flex items-center justify-start">
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => requestUpgrade("warehouse", warehouseLevel)}
                    disabled={!affordable}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Column 2: Collect All button - right aligned */}
              <div className="flex items-center justify-end">
                <button
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs text-white disabled:opacity-50 touch-manipulation min-h-[44px] sm:min-h-0 flex-shrink-0 relative overflow-hidden ${!hasStored
                    ? 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600'
                    : isBlocked
                      ? 'bg-red-600 active:bg-red-700 hover:bg-red-700 pulse-red'
                      : 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700'
                    }`}
                  onClick={handleCollectAllClick}
                  disabled={!hasStored && !isBlocked}
                  title={isBlocked ? "Warehouse full for one or more resources - Click to see message" : (!hasStored ? "No resources to collect" : "Collect all resources")}
                >
                  <span className="relative z-10">Collect All</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === Dev self-tests (run once in browser) ===
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      // Building production/capacity checks
      console.assert(Math.abs(getProgression("wood", 2, "production") - 1.25) < 1e-6, "Wood L2 prod");
      console.assert(Math.abs(getProgression("wood", 3, "capacity") - 169) < 1e-6, "Wood L3 cap");
      console.assert(Math.abs(getProgression("food", 1, "production") - 5) < 1e-6, "Food base prod");
      console.assert(Math.abs(getProgression("food", 2, "production") - 6.25) < 1e-6, "Food L2 prod");

      // Building cost checks vs doc seeds & tables
      // getBuildingCost(res, levelTo) returns cost to go from (levelTo-1) → levelTo
      const qc = getBuildingCost("stone", 2); // Quarry L1→L2 cost
      console.assert(qc.wood === 75 && qc.stone === 60, "Quarry L1→L2 cost");
      const fc = getBuildingCost("food", 2); // Farm L1→L2 cost
      console.assert(fc.wood === 105 && fc.stone === 53, "Farm L1→L2 cost");
      const lc2 = getBuildingCost("wood", 2); // Lumber L1→L2 cost
      console.assert(lc2.wood === 67 && lc2.stone === 27, "Lumber L1→L2 cost");
      const lc3 = getBuildingCost("wood", 3); // Lumber L2→L3 cost
      console.assert(lc3.wood === 101 && lc3.stone === 41, "Lumber L2→L3 cost");
      const lc4 = getBuildingCost("wood", 4); // Lumber L3→L4 cost
      console.assert(lc4.wood === 151 && lc4.stone === 61, "Lumber L3→L4 cost");
      const lc5 = getBuildingCost("wood", 5); // Lumber L4→L5 cost
      console.assert(lc5.wood === 226 && lc5.stone === 91, "Lumber L4→L5 cost");

      // Banner cap test (max 8 squads)
      {
        const max = 8;
        let comp: string[] = [];
        const add = (t: string) => { if (comp.length < max) comp = [...comp, t]; };
        for (let i = 0; i < 10; i++) add('archer');
        console.assert(comp.length === 8, 'Banner max 8 squads enforced');
      }

      // Taxes mapping quick check
      // Test removed - tax system now uses 5 levels with different base rates
      // Old test: const r = (t: 'low'|'normal'|'high') => (t==='low'?1:t==='high'?-1:0);
      // New system: very_low=1.2, low=0.8, normal=0.2, high=-0.4, very_high=-1.0

      // Extra tests: banner reqPop and one-tick training consumption
      {
        const squads = ['archer', 'warrior', 'warrior'];
        const req = 10 * squads.length; // 10 pop per squad
        console.assert(req === 30, 'reqPop formula: 10 per squad');
        let pop = 3;
        let d: any = { id: 1, name: 'T', units: squads, status: 'training', reqPop: 10, recruited: 0 };
        let nextPop = Math.max(0, pop + 0);
        if (d.status === 'training' && d.recruited < d.reqPop && nextPop > 0) { d.recruited += 1; nextPop -= 1; }
        console.assert(d.recruited === 1 && nextPop === 2, 'training tick consumes 1 pop');
      }

      // Warehouse checks
      console.assert(Math.abs(getWarehouseCapacity(1) - 1000) < 1e-6, "WH L1 cap");
      console.assert(Math.abs(getWarehouseCapacity(2) - 1300) < 1e-6, "WH L2 cap");
      const c1 = getWarehouseCost(1); // Level 1 base cost
      console.assert(c1.wood === 100 && c1.stone === 100, "WH base cost");
      const c2 = getWarehouseCost(2); // next level cost *1.5
      console.assert(c2.wood === 150 && c2.stone === 150, "WH L2 cost");
    } catch (e) {
      console.warn("Self-tests failed", e);
    }
  }, []);

  return (
    <div className="min-h-screen w-full text-slate-100 p-2 sm:p-4 md:p-6 lg:p-8 relative mobile-landscape-fullscreen">
      {/* Background Image */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: `url(${backgroundImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed'
        }}
      />
      {/* Dark overlay for readability */}
      <div className="fixed inset-0 -z-10 bg-slate-950/75" />
      {/* Fixed Top Menu - Resources, Cheat Panel, and Navigation */}
      <div className="fixed top-0 left-0 right-0 z-50 px-0.5 sm:px-1 py-0 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        {/* Resource Bar - Horizontal scrolling on mobile, flex on desktop */}
        <div className="w-full">
          <div className="flex flex-nowrap gap-0.5 mb-0 overflow-x-auto sm:overflow-x-visible items-center justify-between" style={{ maxHeight: 'min(75px, 14vh)', scrollbarWidth: 'thin' }}>
            <div className="flex flex-nowrap gap-0.5 items-center flex-shrink-0">
              <LogoPill />
              {(() => {
                // Compute shortened timer text
                let trendText = "Stable";
                let trendTooltip = "Population stable";
                let trendColor = 'text-slate-500';

                if (netPopulationChange !== 0) {
                  const secondsPerVillager = Math.abs(1 / netPopulationChange);
                  let timeText: string;
                  let fullTimeText: string;

                  if (secondsPerVillager <= 60) {
                    // Use seconds, round to nearest whole second
                    const seconds = Math.round(secondsPerVillager);
                    timeText = `${seconds}s`;
                    fullTimeText = `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
                  } else {
                    // Convert to minutes, round to nearest minute
                    const minutes = Math.round(secondsPerVillager / 60);
                    timeText = `${minutes}m`;
                    fullTimeText = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
                  }

                  // Build final text using direction - format: (+1 / 5s) or (-1 / 30s)
                  const direction = netPopulationChange > 0 ? "gain" : "loss";
                  if (direction === "gain") {
                    trendText = `(+1 / ${timeText})`;
                    trendTooltip = `+1 villager every ${fullTimeText}`;
                    trendColor = 'text-emerald-500';
                  } else if (direction === "loss") {
                    trendText = `(-1 / ${timeText})`;
                    trendTooltip = `-1 villager every ${fullTimeText}`;
                    trendColor = 'text-red-500';
                  }
                }

                return (
                  <PopulationPill
                    value={population}
                    cap={popCap}
                    rate={netPopulationChange}
                    trend={trendText}
                    trendTooltip={trendTooltip}
                    trendColor={trendColor}
                    statusColor={workerDeficit > 0 ? 'red' : workerSurplus > 0 ? 'green' : 'yellow'}
                    lockedWorkers={clampedLocked}
                    bufferWorkers={clampedBuffer}
                    freePop={clampedFree}
                  />
                );
              })()}
              <TaxesPill />
              <div className="rounded-xl border border-slate-700 bg-slate-900 px-0.5 sm:px-1.5 py-0.5 sm:py-1 shadow-sm flex flex-col">
                {/* Top line: Number */}
                <div className="flex items-center gap-0.5 sm:gap-1">
                  <span className={`text-[9px] sm:text-xs font-bold select-none ${happiness >= 70 ? 'text-emerald-500' : happiness <= 40 ? 'text-red-500' : 'text-yellow-500'}`}>
                    😊 {happiness}
                  </span>
                </div>
                {/* Second line: Status text */}
                <div className="text-[8px] sm:text-[10px] text-slate-500">
                  {happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'}
                </div>
              </div>
              {/* Mobile & Desktop: Full resource pills (Reflow & Scale) */}
              <div className="flex flex-wrap gap-1 items-center justify-center sm:justify-start w-full sm:w-auto origin-top transform scale-90 sm:scale-100">
                <ResourcePill label="Wood" value={warehouse.wood} cap={warehouseCap.wood} rate={lumberRate} />
                <ResourcePill label="Stone" value={warehouse.stone} cap={warehouseCap.stone} rate={stoneRate} />
                <ResourcePill label="Food" value={warehouse.food} cap={warehouseCap.food} rate={netFoodRate} />
                <ResourcePill
                  label="Iron"
                  value={warehouse.iron}
                  cap={warehouseCap.iron}
                  rate={ironRate}
                  trend={ironConsumptionFeedback ? ironConsumptionFeedback.message : undefined}
                />
                <ResourcePill label="Gold" value={warehouse.gold} cap={warehouseCap.gold} rate={goldIncomePerSecond} />
              </div>
            </div>
            {/* Fullscreen button on the right */}
            <FullscreenPill />
          </div>
        </div>

        {/* Cheat Area for Testing */}
        {showCheatMenu && (
          <div className="max-w-game mx-auto mb-1 sm:mb-1.5 p-1.5 sm:p-2 rounded-lg border-2 border-amber-500 bg-amber-950/30">
            <div className="flex items-center justify-between mb-0.5 sm:mb-1">
              <div className="text-[9px] sm:text-[10px] font-semibold text-amber-200">🧪 CHEAT PANEL (Testing)</div>
              <button
                onClick={() => setShowCheatMenu(false)}
                className="px-2 py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
                title="Hide cheat panel (click logo to show again)"
              >
                Hide
              </button>
            </div>
            <div className="flex gap-1 sm:gap-1.5 flex-wrap">
              <button
                onClick={() => setWarehouse(w => ({ ...w, wood: Math.min(warehouseCap.wood, w.wood + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Wood
              </button>
              <button
                onClick={() => setWarehouse(w => ({ ...w, stone: Math.min(warehouseCap.stone, w.stone + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Stone
              </button>
              <button
                onClick={() => setWarehouse(w => ({ ...w, food: Math.min(warehouseCap.food, w.food + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Food
              </button>
              <button
                onClick={() => setWarehouse(w => ({ ...w, iron: Math.min(warehouseCap.iron, w.iron + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Iron
              </button>
              <button
                onClick={() => setWarehouse(w => ({ ...w, gold: Math.min(warehouseCap.gold, w.gold + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Gold
              </button>
              <button
                onClick={() => setSkillPoints(prev => prev + 5)}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +5 Skill Points
              </button>
              <button
                onClick={() => {
                  addFactionPoints(1);
                  saveGame();
                }}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-purple-600 active:bg-purple-700 hover:bg-purple-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +1 Faction Point
              </button>
              <button
                onClick={() => {
                  addFactionPoints(10);
                  saveGame();
                }}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-purple-600 active:bg-purple-700 hover:bg-purple-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +10 Faction Points
              </button>
              <button
                onClick={() => {
                  // Shuffle missions: replace current 3 with 3 new random ones
                  const newMissions = selectRandomMissions(3);
                  setMissions(newMissions);
                  setMissionBannerSelector(null); // Close any open selectors
                }}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-blue-600 active:bg-blue-700 hover:bg-blue-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                Shuffle Missions
              </button>
              <button
                onClick={resetGame}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-red-600 active:bg-red-700 hover:bg-red-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                Reset Game
              </button>
              <button
                onClick={toggleFullscreen}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
                title={isFullscreen ? "Exit fullscreen mode" : "Enter fullscreen mode"}
              >
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
            </div>
            {/* Simulators Section */}
            <div className="mt-2 pt-2 border-t border-amber-700/50">
              <div className="text-[8px] sm:text-[9px] text-amber-300/70 mb-1 font-semibold">Simulators</div>
              <div className="flex gap-1 sm:gap-1.5 flex-wrap">
                <a
                  href="/fortress_siege_simulator.html"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    // Find the Godonis expedition fortress stats
                    const godonisExp = expeditions.find(exp => exp.expeditionId === 'godonis_mountain_expedition');
                    if (godonisExp?.fortress?.stats) {
                      const stats = godonisExp.fortress.stats;
                      // Calculate actual garrison from banners
                      const garrisonBannerIds = godonisExp.fortress.garrison || [];
                      const actualGarrison = calculateGarrisonFromBanners(garrisonBannerIds);
                      // Calculate wall archer capacity from Watch Post level
                      const wallArchers = calculateActiveWallArchers('godonis_mountain_expedition');
                      localStorage.setItem('fortressSimulatorStats', JSON.stringify({
                        fortHP: stats.fortHP,
                        fortArcherSlots: wallArchers.capacity, // Wall archer capacity from Watch Post
                        garrisonArchers: actualGarrison.archers || stats.garrisonArchers,
                        garrisonWarriors: actualGarrison.warriors || stats.garrisonWarriors,
                      }));
                    }
                  }}
                  className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0 inline-flex items-center gap-1"
                >
                  🏰 Fortress Simulator
                </a>
                <a
                  href="/ck_3_style_battle_simulator_ui_single_file_html.html"
                  target="_blank"
                  rel="noreferrer"
                  className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0 inline-flex items-center gap-1"
                >
                  ⚔ Combat Simulator
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Menu - Mobile tabs below HUD, desktop tabs in nav */}
        <div className="max-w-game mx-auto">
          {/* Mobile Tab Menu - Shows below HUD */}
          <div className="flex md:hidden mb-0.5 mt-1 overflow-x-auto gap-1 pb-0.5" style={{ scrollbarWidth: 'thin' }}>
            <button
              onClick={() => setMainTab('production')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'production' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Buildings
            </button>
            <button
              onClick={() => setMainTab('council')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'council' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Council
            </button>
            <button
              onClick={() => {
                if (barracks && barracks.level >= 1) {
                  setMainTab('army');
                }
              }}
              disabled={!barracks || barracks.level < 1}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${!barracks || barracks.level < 1
                ? 'bg-red-900/50 text-red-300 border border-red-800 opacity-75'
                : mainTab === 'army'
                  ? 'bg-slate-900 text-white border border-slate-600'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Army
            </button>
            <button
              onClick={() => setMainTab('missions')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'missions' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Missions
            </button>
            <button
              onClick={() => setMainTab('expeditions')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'expeditions' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Expeditions
            </button>
            <button
              onClick={() => setMainTab('leaderboard')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'leaderboard' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Leaderboard
            </button>
            <button
              onClick={() => setMainTab('factions')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'factions' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Factions
            </button>
            <button
              onClick={() => setBlacksmithOpen(true)}
              className="px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] bg-slate-800 text-slate-300 border border-slate-700"
            >
              Blacksmith
            </button>
            <button
              onClick={() => setTechnologiesOpen(true)}
              className="px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] bg-slate-800 text-slate-300 border border-slate-700"
            >
              Technologies
            </button>
          </div>

          {/* Desktop Tab Menu - Hidden on mobile */}
          <div className="hidden md:flex mb-1 items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden border border-slate-700">
              <button
                onClick={() => setMainTab('production')}
                className={`px-2 py-1 text-xs ${mainTab === 'production' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Buildings
              </button>
              <button
                onClick={() => setMainTab('council')}
                className={`px-2 py-1 text-xs ${mainTab === 'council' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Council
              </button>
              <button
                onClick={() => {
                  if (barracks && barracks.level >= 1) {
                    setMainTab('army');
                  }
                }}
                disabled={!barracks || barracks.level < 1}
                className={`px-2 py-1 text-xs ${!barracks || barracks.level < 1
                  ? 'bg-red-900 text-red-300 cursor-not-allowed opacity-75'
                  : mainTab === 'army'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-700'
                  }`}
                title={!barracks || barracks.level < 1 ? 'Requires Barracks Level 1' : 'Army'}
              >
                Army
              </button>
              <button
                onClick={() => setMainTab('missions')}
                className={`px-2 py-1 text-xs ${mainTab === 'missions' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Missions
              </button>
              <button
                onClick={() => setMainTab('expeditions')}
                className={`px-2 py-1 text-xs ${mainTab === 'expeditions' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Expeditions
              </button>
              <button
                onClick={() => setMainTab('leaderboard')}
                className={`px-2 py-1 text-xs ${mainTab === 'leaderboard' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Leaderboard
              </button>
              <button
                onClick={() => setMainTab('factions')}
                className={`px-2 py-1 text-xs ${mainTab === 'factions' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Factions
              </button>
              <button
                onClick={() => setBlacksmithOpen(true)}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600"
              >
                Blacksmith
              </button>
              <button
                onClick={() => setTechnologiesOpen(true)}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600"
              >
                Technologies
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer to prevent content from going under fixed header - Responsive height */}
      {/* On mobile, account for HUD height + tabs + padding */}
      <div className="h-[60px] sm:h-[65px] md:h-[70px]"></div>

      {/* Main Content - Buildings (Default) */}
      {mainTab === 'production' && (
        <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 mt-1 sm:mt-1 md:mt-2">
          <div className="grid grid-cols-2 max-[340px]:grid-cols-1 gap-2 sm:gap-3 md:gap-4">
            <BuildingRow
              name="Lumber Mill"
              res="wood"
              level={lumberMill.level}
              rate={lumberRate}
              stored={lumberMill.stored}
              cap={lumberCap}
              onCollect={() => collect("wood")}
              enabled={lumberMill.enabled}
              workers={lumberMill.workers}
              requiredWorkers={lumberMill.level}
              onToggle={() => toggleBuilding('wood')}
              onRequestDisable={() => setDisableBuildingModal({ resource: 'wood', buildingName: 'Lumber Mill' })}
            />
            <BuildingRow
              name="Quarry"
              res="stone"
              level={quarry.level}
              rate={stoneRate}
              stored={quarry.stored}
              cap={stoneCap}
              onCollect={() => collect("stone")}
              enabled={quarry.enabled}
              workers={quarry.workers}
              requiredWorkers={quarry.level}
              onToggle={() => toggleBuilding('stone')}
              onRequestDisable={() => setDisableBuildingModal({ resource: 'stone', buildingName: 'Quarry' })}
            />
            <BuildingRow
              name="Iron Mine"
              res="iron"
              level={ironMine.level}
              rate={ironRate}
              stored={ironMine.stored}
              cap={ironCap}
              onCollect={() => collect("iron")}
              enabled={ironMine.enabled}
              workers={ironMine.workers}
              requiredWorkers={ironMine.level}
              onToggle={() => toggleBuilding('iron')}
              onRequestDisable={() => setDisableBuildingModal({ resource: 'iron', buildingName: 'Iron Mine' })}
            />
            <BuildingRow
              name="Farm"
              res="food"
              level={farm.level}
              rate={foodRate}
              stored={farm.stored}
              cap={foodCap}
              onCollect={() => collect("food")}
              enabled={farm.enabled}
              workers={farm.workers}
              requiredWorkers={farm.level}
              onToggle={() => toggleBuilding('food')}
              toggleDisabled={true}
            />
            <HouseRow />
            <TownHallRow />
            <BarracksRow />
            <TavernRow />
            <MilitaryAcademyRow />
            <WarehouseRow />
          </div>
        </section>
      )}

      {mainTab === 'army' && (
        <section className={`max-w-game mx-auto px-4 sm:px-6 ${isMobile ? 'pb-32 pt-0' : 'pb-24 pt-1'}`}>


          {/* Army Tab Navigation - Compact Segmented Control */}
          <div className="mb-2">
            <div className="flex p-0.5 bg-slate-900 rounded-lg border border-slate-700">
              <button
                onClick={() => setArmyTab('mercenaries')}
                className={`flex-1 px-3 py-1 text-xs font-semibold rounded transition-colors ${armyTab === 'mercenaries'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-300'
                  }`}
              >
                Mercenaries
              </button>
              <button
                onClick={() => setArmyTab('regular')}
                className={`flex-1 px-3 py-1 text-xs font-semibold rounded transition-colors ${armyTab === 'regular'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-300'
                  }`}
              >
                Regular Army
              </button>
            </div>
          </div>

          {!barracks && (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center mt-3">
              <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center mx-auto mb-4 border border-slate-700">
                <span className="text-2xl">⚔️</span>
              </div>
              <h3 className="text-sm font-semibold text-white mb-2">Barracks Required</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">Build a Barracks to begin forming your army.</p>
              <button
                onClick={() => setMainTab('production')}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
              >
                Go to Buildings
              </button>
            </div>
          )}

          {/* Mercenaries Tab Content */}
          {armyTab === 'mercenaries' && barracks && (
            <div className={`animate-in fade-in slide-in-from-bottom-4 duration-500 ${isMobile ? 'space-y-4 mt-2' : 'space-y-6 mt-4'}`}>
              <div className="flex items-center justify-between px-1">
                <div className="flex flex-col">
                  <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none">Mercenary Contracts</h3>
                </div>
                <div className="text-[9px] font-semibold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-1 rounded-lg">
                  Slots: {barracks.trainingSlots}
                </div>
              </div>

              {/* Mercenary Cards - Compact Style */}
              <div className="space-y-2">
                {bannerTemplates.slice(0, barracks.maxTemplates).map(template => {
                  const hasEnoughGold = warehouse.gold >= template.cost;
                  const isAlreadyHiring = barracks.trainingQueue.some(job => job.templateId === template.id);
                  const canHire = barracks.trainingQueue.length < barracks.trainingSlots && hasEnoughGold && !isAlreadyHiring;

                  const hasWarriors = template.squads.some(s => s.type === 'warrior');
                  const hasArchers = template.squads.some(s => s.type === 'archer');
                  const roleTag = hasWarriors && hasArchers ? 'Mixed' : hasWarriors ? 'Melee' : 'Ranged';
                  const roleIcon = roleTag === 'Melee' ? '⚔️' : roleTag === 'Ranged' ? '🏹' : '⚡';
                  const totalSoldiers = template.squads.reduce((sum, s) => sum + s.count, 0) * 10;

                  return (
                    <div
                      key={template.id}
                      className={`rounded-lg border bg-slate-900 p-2 sm:p-3 transition-all ${isAlreadyHiring ? 'border-blue-500' : 'border-slate-800'
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        {/* Icon */}
                        <div className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
                          <span className="text-lg sm:text-xl">{roleIcon}</span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs sm:text-sm font-semibold text-slate-200 truncate mb-0.5">{template.name}</h4>
                          <div className="flex gap-1.5 flex-wrap">
                            {/* Unit Composition - Detailed Breakdown */}
                            {template.squads.map((squad, idx) => {
                              const squadIcon = unitCategory[squad.type] === 'ranged_infantry' ? '🏹' :
                                unitCategory[squad.type] === 'cavalry' ? '🐴' : '⚔️';
                              const squadCount = squad.count * 10;

                              return (
                                <div
                                  key={idx}
                                  className="h-5 sm:h-6 px-1.5 rounded bg-slate-800/60 border border-slate-700 flex items-center gap-1"
                                >
                                  <span className="text-[10px] sm:text-xs leading-none">{squadIcon}</span>
                                  <span className="text-[9px] sm:text-[10px] text-slate-300 font-medium">{unitDisplayNames[squad.type]}</span>
                                  <span className="text-[9px] text-slate-500">×{squadCount}</span>
                                </div>
                              );
                            })}

                            {/* Arrival Time Badge */}
                            <span className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800/50">
                              5s arrival
                            </span>

                            {/* Role Tag */}
                            <span className={`text-[9px] sm:text-[10px] px-1 py-0.5 rounded border ${roleTag === 'Melee' ? 'text-red-400 bg-red-950/30 border-red-900/50' :
                              roleTag === 'Ranged' ? 'text-emerald-400 bg-emerald-950/30 border-emerald-900/50' :
                                'text-blue-400 bg-blue-950/30 border-blue-900/50'
                              }`}>
                              {roleTag}
                            </span>
                          </div>
                        </div>

                        {/* Cost & Action */}
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-0.5">
                            <span className={`text-xs font-semibold ${hasEnoughGold ? 'text-emerald-600' : 'text-red-600'}`}>
                              {formatShort(template.cost)}
                            </span>
                            <img src={getResourceIcon('Gold')} className="w-3 h-3" alt="gold" />
                          </div>
                          <button
                            onClick={() => startBarracksTraining(template.id)}
                            disabled={!canHire}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${canHire
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                              }`}
                          >
                            {isAlreadyHiring ? 'Hiring' : 'Hire'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Training Queue - Compact Display */}
              {barracks.trainingQueue.length > 0 && (
                <div className="mt-3 p-2 rounded-lg bg-slate-950/50 border border-slate-800">
                  <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-1.5">
                    Training: {barracks.trainingQueue.length}/{barracks.trainingSlots}
                  </div>
                  <div className="space-y-1.5">
                    {barracks.trainingQueue.map(job => {
                      const progress = (job.elapsedTime / (job.arrivalTime || 1)) * 100;
                      return (
                        <div key={job.id} className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                            <div
                              className="h-full bg-emerald-500 transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-slate-400 font-semibold whitespace-nowrap">
                            {job.elapsedTime}s / {job.arrivalTime || 0}s
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Stationed Mercenaries */}
              <div className="mt-3 pt-3 border-t border-slate-800">
                <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Stationed</div>
                <div className="space-y-2">
                  {banners.filter(b => b.type === 'mercenary').length === 0 ? (
                    <div className="text-xs text-slate-600 italic">No mercenaries stationed</div>
                  ) : (
                    banners.filter(b => b.type === 'mercenary').map(b => (
                      <div key={b.id} className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">{b.name}</span>
                        <button
                          onClick={() => setDeleteBannerModal(b.id)}
                          className="w-6 h-6 rounded bg-red-950/30 text-red-500 flex items-center justify-center text-xs hover:bg-red-500 hover:text-white transition-all"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}


          {armyTab === 'regular' && barracks && (
            <div className={`space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 ${isMobile ? 'mt-2' : 'mt-4'}`}>
              {/* Recruitment Strategy - Compact */}
              <div className="flex items-center justify-between p-2 rounded-lg border border-slate-700 bg-slate-900 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-500 font-semibold uppercase">Strategy:</span>
                  <span className="text-xs font-semibold text-slate-200">
                    {recruitmentMode === 'regular' ? 'Stable Growth' : 'Total Mobilization'}
                  </span>
                </div>
                <div className="flex p-0.5 bg-slate-950 rounded border border-slate-800">
                  <button
                    onClick={() => setRecruitmentMode('regular')}
                    className={`px-2 py-0.5 text-[9px] rounded font-semibold transition-colors ${recruitmentMode === 'regular' ? 'bg-emerald-600 text-white' : 'text-slate-500'
                      }`}
                  >
                    Regular
                  </button>
                  <button
                    onClick={() => setRecruitmentMode('forced')}
                    className={`px-2 py-0.5 text-[9px] rounded font-semibold transition-colors ${recruitmentMode === 'forced' ? 'bg-red-600 text-white' : 'text-slate-500'
                      }`}
                  >
                    Forced
                  </button>
                </div>
              </div>
              {isMobile && (
                <div className="mb-2">
                  <button
                    onClick={() => setShowRecruitmentInfo(!showRecruitmentInfo)}
                    className="text-[9px] text-slate-600 font-bold flex items-center gap-1"
                  >
                    {showRecruitmentInfo ? 'Hide details' : 'Learn more'}
                    <span className="text-[7px]">{showRecruitmentInfo ? '▲' : '▼'}</span>
                  </button>
                  {showRecruitmentInfo && (
                    <div className="mt-1 text-[10px] text-slate-400 p-2 rounded-lg bg-slate-950/50 border border-slate-800/50">
                      {recruitmentMode === 'regular'
                        ? "Uses ONLY free population. Slow, safe."
                        : "Drafts active workers. Fast, costly."}
                    </div>
                  )}
                </div>
              )}

              {/* Banners Section Header */}
              <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Regular Army</div>

              {/* Banner List Section */}
              <div className={`${isMobile ? 'space-y-4 pb-32' : 'space-y-6'}`}>
                {banners.filter(b => b.type === 'regular').length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-slate-800 bg-slate-900 flex flex-col items-center gap-2">
                    <span className="text-2xl">🏴</span>
                    <span className="text-xs font-semibold text-slate-400 uppercase">No Banners</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {banners.filter(b => b.type === 'regular').map((b) => {
                      const isEditing = b.id === editingBannerId;
                      const isGlobalEditing = editingBannerId !== null;
                      const isDisabled = isGlobalEditing && !isEditing;
                      const commander = b.commanderId ? commanders.find(c => c.id === b.commanderId) : null;
                      const isTraining = b.status === 'training';

                      const handleSlotClick = (e: React.MouseEvent, idx: number) => {
                        e.stopPropagation();
                        if (!isEditing) {
                          setBannerHint({ id: b.id, message: "Editing is OFF. Click Edit to modify." });
                          return;
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        setAnchoredPickerState({
                          isOpen: true,
                          bannerId: b.id,
                          slotIndex: idx,
                          anchorRect: rect
                        });
                      };

                      return (
                        <div
                          key={b.id}
                          className={`rounded-lg border bg-slate-900 p-2 transition-all relative group ${isDisabled ? 'opacity-40 pointer-events-none grayscale border-slate-800' : 'opacity-100'} ${isEditing ? 'border-blue-500 shadow-sm' : 'border-slate-800'}`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Icon & Basic Info */}
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              {/* Commander Icon (Left placement, interactive) */}
                              <div
                                className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center shadow-sm border cursor-pointer transition-colors ${commander ? 'bg-blue-900/20 border-blue-800 text-blue-400 hover:bg-blue-900/40' : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700'}`}
                                onClick={(e) => { e.stopPropagation(); setCommanderAssignModal({ commanderId: null, bannerId: b.id }); }}
                                title={commander ? "Change Commander" : "Assign Commander"}
                              >
                                <span className={commander ? 'text-lg' : 'text-base'}>{commander ? '⚔️' : '👤'}</span>
                              </div>

                              {/* Banner Icon (Compact) */}
                              <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center shadow-sm border ${commander ? 'bg-blue-900/20 border-blue-800' : 'bg-slate-800 border-slate-700'}`}>
                                <span className="text-lg">{commander ? '⚔️' : '🏴'}</span>
                              </div>

                              {/* Banner Name & Status Column */}
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {!isEditing ? (
                                    <h3
                                      className="text-sm font-bold text-slate-200 truncate cursor-pointer hover:text-slate-400"
                                      onClick={() => !isEditing && setBannerHint({ id: b.id, message: "Editing is OFF. Click Edit to modify." })}
                                    >
                                      {b.name}
                                    </h3>
                                  ) : (
                                    <input
                                      type="text"
                                      value={bannersDraft && bannersDraft.id === b.id ? bannersDraft.name : b.name}
                                      onChange={(e) => updateBannerNameDraft(e.target.value)}
                                      className="bg-slate-900 border border-slate-600 text-white text-sm font-semibold px-2 py-1 rounded focus:border-blue-500 focus:bg-slate-800 outline-none w-40 transition-colors shadow-inner"
                                      autoFocus
                                      placeholder="Banner Name..."
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  )}

                                  {/* Badges - Tight group */}
                                  <div className="flex items-center gap-1">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-semibold ${b.status === 'ready' ? 'text-emerald-400 bg-emerald-950/30 border-emerald-900/50' : (b.status as string) === 'training' ? 'text-blue-400 bg-blue-950/30 border-blue-900/50' : 'text-amber-500 bg-amber-950/30 border-amber-900/50'}`}>
                                      {b.status}
                                    </span>
                                  </div>
                                </div>

                                {/* Commander Subtext (Name only if assigned) */}
                                <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                                  <span>{commander ? `Cmdr. ${commander.name}` : ''}</span>

                                </div>
                              </div>

                              {/* Progression Information Area (Moved inside left group) */}
                              {!isEditing && (
                                <div className="hidden sm:flex items-center gap-3 ml-2 px-3 py-1.5 rounded-lg bg-slate-950/40 border border-slate-800/50 shrink-0">
                                  {/* Tier Badge (Compact - Warning: Static Label) */}
                                  <div className="h-5 px-1.5 min-w-[20px] rounded bg-slate-800 flex items-center justify-center border border-slate-700">
                                    <span className="text-slate-400 font-bold text-[10px] tracking-tight">T{b.level || 1}</span>
                                  </div>

                                  {/* XP Bar & Stats */}
                                  <div className="flex flex-col justify-center min-w-[120px]">
                                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium mb-1 leading-none">
                                      <span>XP Progress</span>
                                      <span>{Math.floor(b.xp || 0)} <span className="text-slate-600">/</span> {b.xpNextLevel || 100}</span>
                                    </div>
                                    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                                      <div
                                        className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)] relative"
                                        style={{ width: `${Math.max(0, Math.min(100, ((b.xp || 0) - (b.xpCurrentLevel || 0)) / ((b.xpNextLevel || 100) - (b.xpCurrentLevel || 0)) * 100))}%` }}
                                      >
                                        <div className="absolute inset-0 bg-white/20"></div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>


                            {/* Actions Group (Right aligned on desktop) */}
                            <div className="flex items-center gap-2 justify-end">
                              {isEditing ? (
                                <>
                                  <button onClick={() => cancelEditingBanner()} className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-[10px] sm:text-xs font-semibold hover:bg-slate-700">Cancel</button>
                                  <button onClick={() => confirmEditingBanner()} className="px-3 py-1 rounded bg-emerald-600 text-white text-[10px] sm:text-xs font-semibold hover:bg-emerald-500">Save</button>
                                </>
                              ) : (
                                <>
                                  {/* Train Button */}
                                  {(() => {
                                    const needsTraining = b.squads ? b.squads.some(s => s.currentSize < s.maxSize) : b.recruited < b.reqPop;

                                    if (needsTraining || isTraining) {
                                      return (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const newStatus = isTraining ? 'idle' : 'training';
                                            setBanners(prev => prev.map(banner => banner.id === b.id ? { ...banner, status: newStatus } : banner));
                                          }}
                                          className={`px-2 py-1 rounded-lg text-[10px] sm:text-xs font-semibold border ${isTraining ? 'bg-blue-900/20 text-blue-400 border-blue-800' : 'bg-amber-900/20 text-amber-500 border-amber-800'}`}
                                        >
                                          {isTraining ? 'Training...' : 'Train'}
                                        </button>
                                      );
                                    }
                                    return null;
                                  })()}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); startEditingBanner(b.id); }}
                                    disabled={isGlobalEditing}
                                    className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px] sm:text-xs font-semibold border border-slate-700 hover:bg-slate-700 disabled:opacity-50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); deleteBanner(b.id); }}
                                    disabled={isGlobalEditing}
                                    className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 text-[10px] sm:text-xs font-semibold border border-slate-700 hover:text-red-400 hover:border-red-900/50 hover:bg-red-950/20 disabled:opacity-50 transition-colors"
                                    title="Delete Banner"
                                  >
                                    🗑️
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Formation Grid - Integrated tightly */}
                          <div className="mt-2 border-t border-slate-800/50 pt-2">
                            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                              {Array.from({ length: 8 }).map((_, idx) => {
                                let displaySquads = b.squads || [];
                                const squad = displaySquads.some(s => s.slotIndex !== undefined)
                                  ? displaySquads.find(s => s.slotIndex === idx)
                                  : displaySquads[idx];

                                return (
                                  <button
                                    key={idx}
                                    disabled={!isEditing}
                                    onClick={(e) => handleSlotClick(e, idx)}
                                    title={squad ? unitDisplayNames[squad.type] : isEditing ? "Add Unit" : "Empty Slot"}
                                    className={`relative h-9 sm:h-10 rounded-md border flex items-center px-1.5 transition-all overflow-hidden gap-1.5 ${squad
                                      ? 'bg-slate-800/60 border-slate-700 hover:border-slate-500'
                                      : isEditing ? 'bg-slate-900/50 border-slate-800 border-dashed hover:border-slate-600 hover:bg-slate-800/50' : 'bg-slate-950/20 border-slate-800/20 border-dashed'
                                      } ${!isEditing ? 'cursor-default' : 'cursor-pointer'}`}
                                  >
                                    {squad ? (
                                      <>
                                        {/* Icon */}
                                        <span className="text-sm shrink-0 leading-none filter drop-shadow-sm">
                                          {unitCategory[squad.type] === 'ranged_infantry' ? '🏹' : unitCategory[squad.type] === 'cavalry' ? '🐴' : '⚔️'}
                                        </span>

                                        {/* Name & Progress */}
                                        <div className="flex flex-col min-w-0 flex-1 leading-none justify-center h-full py-0.5">
                                          <div className="flex items-center justify-between gap-1 w-full">
                                            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-200 truncate">{unitDisplayNames[squad.type]}</span>
                                            <span className={`text-[9px] font-medium shrink-0 ${squad.currentSize < squad.maxSize ? 'text-amber-400' : 'text-slate-500'}`}>
                                              {squad.currentSize}/{squad.maxSize}
                                            </span>
                                          </div>

                                          {/* Tiny progress bar at bottom of text area */}
                                          <div className="w-full h-0.5 bg-slate-950/50 rounded-full mt-0.5 overflow-hidden">
                                            <div
                                              className={`h-full rounded-full transition-all duration-500 ${squad.currentSize < squad.maxSize ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                              style={{ width: `${(squad.currentSize / squad.maxSize) * 100}%` }}
                                            />
                                          </div>
                                        </div>
                                      </>
                                    ) : (
                                      isEditing && (
                                        <div className="flex items-center gap-1.5 opacity-50 w-full">
                                          <span className="text-slate-500 text-xs">➕</span>
                                          <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide truncate">Select Unit</span>
                                        </div>
                                      )
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Hint Overlay if needed */}
                          {bannerHint && bannerHint.id === b.id && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60 rounded-lg animate-in fade-in duration-200" onClick={() => setBannerHint(null)}>
                              <div className="bg-slate-900 border border-slate-700 px-3 py-2 rounded shadow-xl text-xs text-slate-300 font-semibold">
                                ⚠️ Edit mode OFF
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>

              {/* New Banner Button - Compact */}
              <button
                onClick={() => createNewBanner()}
                className="w-full p-3 rounded-lg border border-dashed border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-emerald-500/50 transition-colors flex items-center justify-center gap-2"
              >
                <span className="text-lg">+</span>
                <span className="text-xs font-semibold text-slate-400">Form New Banner</span>
              </button>
            </div>
          )
          }

          <AnchoredUnitPicker
            isOpen={anchoredPickerState.isOpen}
            onClose={() => setAnchoredPickerState(prev => ({ ...prev, isOpen: false }))}
            anchorRect={anchoredPickerState.anchorRect}
            warehouse={warehouse}
            currentUnitType={(() => {
              const banner = banners.find(b => b.id === anchoredPickerState.bannerId);
              if (!banner) return undefined;
              const squads = banner.squads || [];
              const squad = squads.find(s => s.slotIndex === anchoredPickerState.slotIndex);
              return squad ? squad.type : undefined;
            })()}
            onSelectUnit={(unitType) => {
              if (anchoredPickerState.bannerId !== null && anchoredPickerState.slotIndex !== null) {
                // Update banner immediately for visual feedback
                // Generate shared ID for consistency
                const squadId = Date.now();

                // Update banner immediately for visual feedback
                setBanners(prev => prev.map(banner => {
                  if (banner.id !== anchoredPickerState.bannerId) return banner;

                  const squads = banner.squads || [];
                  const existingSquadIndex = squads.findIndex(s => s.slotIndex === anchoredPickerState.slotIndex);

                  const newSquad = {
                    id: squadId,
                    type: unitType,
                    slotIndex: anchoredPickerState.slotIndex,
                    maxSize: 10,
                    currentSize: 10, // Start fully trained
                    count: 1
                  };

                  let updatedSquads;
                  if (existingSquadIndex >= 0) {
                    updatedSquads = [...squads];
                    updatedSquads[existingSquadIndex] = newSquad;
                  } else {
                    updatedSquads = [...squads, newSquad];
                  }

                  return { ...banner, squads: updatedSquads };
                }));

                // ALSO update draft so save doesn't wipe it
                if (bannersDraft && bannersDraft.id === anchoredPickerState.bannerId) {
                  const squads = bannersDraft.squads || [];
                  const existingSquadIndex = squads.findIndex(s => s.slotIndex === anchoredPickerState.slotIndex);

                  const newSquad = {
                    id: squadId, // Same ID as live
                    type: unitType,
                    slotIndex: anchoredPickerState.slotIndex,
                    maxSize: 10,
                    currentSize: 10,
                    count: 1
                  };

                  let updatedSquads;
                  if (existingSquadIndex >= 0) {
                    updatedSquads = [...squads];
                    updatedSquads[existingSquadIndex] = newSquad;
                  } else {
                    updatedSquads = [...squads, newSquad];
                  }

                  setBannersDraft({ ...bannersDraft, squads: updatedSquads });
                }

                setAnchoredPickerState(prev => ({ ...prev, isOpen: false }));
              }
            }}
          />
        </section>
      )}

      {
        mainTab === 'leaderboard' && (
          <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
            <h2 className="text-base sm:text-lg md:text-xl font-semibold">Kill Score Leaderboard</h2>
            <LeaderboardUI leaderboard={leaderboard} realPlayerId={REAL_PLAYER_ID} />
          </section>
        )
      }

      {
        mainTab === 'council' && (
          <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
            <h2 className="text-base sm:text-lg md:text-xl font-semibold">Council - Commanders</h2>

            {/* Military Academy Status */}
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              {!militaryAcademy || militaryAcademy.level === 0 ? (
                <div className="text-slate-400">
                  <p className="font-semibold mb-2">A Military Academy is required to recruit a commander</p>
                  {!militaryAcademy && canBuildMilitaryAcademy(townHall.level) && (
                    <button
                      onClick={buildMilitaryAcademy}
                      className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                    >
                      Build Military Academy ({getMilitaryAcademyBuildCost().wood} Wood, {getMilitaryAcademyBuildCost().stone} Stone)
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-semibold">Military Academy Level: {militaryAcademy.level}</div>
                      <div className="text-sm text-slate-400">Commanders: {commanders.length} / {militaryAcademy.level}</div>
                    </div>
                    {militaryAcademy.level < 3 && (
                      <button
                        onClick={() => requestMilitaryAcademyUpgrade(militaryAcademy.level)}
                        className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                      >
                        Upgrade (Lvl {militaryAcademy.level + 1})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Recruit Commander Button */}
            {militaryAcademy && militaryAcademy.level > 0 && commanders.length < militaryAcademy.level && (
              <button
                onClick={() => setCommanderRecruitModal(true)}
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                Recruit Commander
              </button>
            )}

            {/* Available Commanders List */}
            {militaryAcademy && militaryAcademy.level > 0 && (
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <h3 className="font-semibold mb-3">Available Commanders</h3>
                {commanders.filter(c => c.assignedBannerId === null).length === 0 ? (
                  <p className="text-slate-400 text-sm">No available commanders. Recruit one to get started.</p>
                ) : (
                  <div className="space-y-2">
                    {commanders.filter(c => c.assignedBannerId === null).map(commander => {
                      const config = COMMANDER_ARCHETYPES[commander.archetype];
                      const level = commander.level || 1;
                      const currentXP = commander.currentXP || 0;
                      const xpToNextLevel = commander.xpToNextLevel || calculateCommanderXPToNextLevel(level);
                      const levelBonus = level - 1;
                      return (
                        <div key={commander.id} className="bg-slate-900 rounded p-3 border border-slate-700">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <div className="font-semibold">{commander.name}</div>
                                <div className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded font-semibold">
                                  Lv {level}
                                </div>
                              </div>
                              <div className="text-xs text-slate-400">{config.label}</div>
                              <div className="text-xs text-slate-300 mt-1">
                                +{commander.rangedAttackBonusPercent}% ranged, +{commander.meleeAttackBonusPercent}% melee
                              </div>
                              {levelBonus > 0 && (
                                <div className="text-xs text-emerald-400 mt-1">
                                  +{levelBonus}% all troop stats
                                </div>
                              )}
                              {/* XP Progress Bar */}
                              {level < 99 && (
                                <div className="mt-2">
                                  <div className="h-1.5 rounded-full overflow-hidden bg-slate-700">
                                    <div
                                      className="h-full bg-blue-500 transition-all"
                                      style={{
                                        width: `${Math.max(0, Math.min(100, (currentXP / xpToNextLevel) * 100))}%`
                                      }}
                                    />
                                  </div>
                                  <div className="text-xs text-slate-400 mt-0.5">
                                    {currentXP.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP
                                  </div>
                                </div>
                              )}
                              {level >= 99 && (
                                <div className="text-xs text-amber-400 mt-1 font-semibold">
                                  Max Level
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => setCommanderAssignModal({ commanderId: commander.id })}
                              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm ml-2"
                            >
                              Assign to banner
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Assigned Commanders List */}
            {militaryAcademy && militaryAcademy.level > 0 && commanders.filter(c => c.assignedBannerId !== null).length > 0 && (
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <h3 className="font-semibold mb-3">Assigned Commanders</h3>
                <div className="space-y-2">
                  {commanders.filter(c => c.assignedBannerId !== null).map(commander => {
                    const banner = banners.find(b => b.id === commander.assignedBannerId);
                    const config = COMMANDER_ARCHETYPES[commander.archetype];
                    const level = commander.level || 1;
                    const currentXP = commander.currentXP || 0;
                    const xpToNextLevel = commander.xpToNextLevel || calculateCommanderXPToNextLevel(level);
                    const levelBonus = level - 1;
                    return (
                      <div key={commander.id} className="bg-slate-900 rounded p-3 border border-slate-700">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-semibold">{commander.name}</div>
                              <div className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded font-semibold">
                                Lv {level}
                              </div>
                            </div>
                            <div className="text-xs text-slate-400">{config.label}</div>
                            <div className="text-xs text-slate-300 mt-1">
                              Assigned to: <strong>{banner?.name || 'Unknown Banner'}</strong>
                            </div>
                            {levelBonus > 0 && (
                              <div className="text-xs text-emerald-400 mt-1">
                                +{levelBonus}% all troop stats
                              </div>
                            )}
                            {/* XP Progress Bar */}
                            {level < 99 && (
                              <div className="mt-2">
                                <div className="h-1.5 rounded-full overflow-hidden bg-slate-700">
                                  <div
                                    className="h-full bg-blue-500 transition-all"
                                    style={{
                                      width: `${Math.max(0, Math.min(100, (currentXP / xpToNextLevel) * 100))}%`
                                    }}
                                  />
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                  {currentXP.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP
                                </div>
                              </div>
                            )}
                            {level >= 99 && (
                              <div className="text-xs text-amber-400 mt-1 font-semibold">
                                Max Level
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => unassignCommander(commander.id)}
                            className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-sm ml-2"
                          >
                            Unassign
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recruit Commander Modal */}
            {commanderRecruitModal && (
              <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
                <div className="w-full max-w-2xl rounded-2xl bg-slate-900 p-6 border border-slate-800">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold">Recruit Commander</h3>
                    <button
                      onClick={() => setCommanderRecruitModal(false)}
                      className="text-slate-400 hover:text-white text-2xl"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-sm text-slate-400 mb-4">Choose one of the following candidates:</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(['ranged_specialist', 'melee_specialist', 'balanced_leader'] as CommanderArchetype[]).map(archetype => {
                      const config = COMMANDER_ARCHETYPES[archetype];
                      const candidateName = candidateNames[archetype] || generateCommanderName(archetype);
                      return (
                        <div
                          key={archetype}
                          className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-blue-500 cursor-pointer transition-colors"
                          onClick={() => recruitCommander(archetype)}
                        >
                          <div className="text-center mb-3">
                            <div className="text-4xl mb-2">⚔️</div>
                            <div className="font-semibold">{candidateName}</div>
                            <div className="text-xs text-slate-400">{config.label}</div>
                          </div>
                          <div className="text-xs text-slate-300 mt-2">
                            <div>+{config.rangedBonus}% Ranged Attack</div>
                            <div>+{config.meleeBonus}% Melee Attack</div>
                          </div>
                          <div className="text-xs text-slate-400 mt-2">{config.description}</div>
                          <button
                            className="w-full mt-3 px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              recruitCommander(archetype);
                            }}
                          >
                            Recruit
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        )
      }

      {
        mainTab === 'factions' && (
          <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
            <h2 className="text-base sm:text-lg md:text-xl font-semibold">Factions</h2>

            {/* FP Summary */}
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-slate-400 text-xs mb-1">Available FP</div>
                  <div className="text-white font-semibold text-lg">{factionState.availableFP}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs mb-1">Alsus</div>
                  <div className="text-white font-semibold">{factionState.alsusFP} FP ({factionState.alsusUnspentFP} unspent)</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs mb-1">Atrox</div>
                  <div className="text-white font-semibold">{factionState.atroxFP} FP ({factionState.atroxUnspentFP} unspent)</div>
                </div>
              </div>

              {/* Assign FP Buttons */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => assignFPToFaction('Alsus', 1)}
                  disabled={factionState.availableFP < 1}
                  className={`px-3 py-1.5 rounded text-sm ${factionState.availableFP < 1
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                >
                  Assign 1 FP to Alsus
                </button>
                <button
                  onClick={() => assignFPToFaction('Atrox', 1)}
                  disabled={factionState.availableFP < 1}
                  className={`px-3 py-1.5 rounded text-sm ${factionState.availableFP < 1
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                    }`}
                >
                  Assign 1 FP to Atrox
                </button>
              </div>
            </div>

            {/* Faction Selection */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setSelectedFaction('Alsus')}
                className={`px-4 py-2 rounded-lg font-semibold ${selectedFaction === 'Alsus'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
              >
                Alsus
              </button>
              <button
                onClick={() => setSelectedFaction('Atrox')}
                className={`px-4 py-2 rounded-lg font-semibold ${selectedFaction === 'Atrox'
                  ? 'bg-red-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
              >
                Atrox
              </button>
            </div>

            {/* Perk Trees */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(() => {
                const branches = selectedFaction === 'Alsus'
                  ? [
                    { id: 'Alsus_Tactics' as FactionBranchId, name: 'Magnus War Council', desc: 'Tactics / Army Quality' },
                    { id: 'Alsus_Lux' as FactionBranchId, name: 'Lux Guardians', desc: 'Defence / Healing / Morale' },
                    { id: 'Alsus_Crowns' as FactionBranchId, name: 'Pact of Crowns', desc: 'Economy / Stability' },
                  ]
                  : [
                    { id: 'Atrox_Blood' as FactionBranchId, name: 'Blood Legions', desc: 'Offence / Aggression' },
                    { id: 'Atrox_Fortress' as FactionBranchId, name: 'Iron Bastions of Roctium', desc: 'Fortifications / Counter-attack' },
                    { id: 'Atrox_Spoils' as FactionBranchId, name: 'Spoils of War', desc: 'Raiding / Loot' },
                  ];

                return branches.map(branch => {
                  const branchPerks = Object.values(factionState.perks)
                    .filter(p => p.branchId === branch.id)
                    .sort((a, b) => a.tier - b.tier);

                  return (
                    <div key={branch.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                      <h3 className="text-sm font-semibold mb-1">{branch.name}</h3>
                      <p className="text-xs text-slate-400 mb-3">{branch.desc}</p>
                      <div className="space-y-2">
                        {branchPerks.map(perk => {
                          const canUnlock = canUnlockPerk(perk.id);
                          const unspentFP = selectedFaction === 'Alsus' ? factionState.alsusUnspentFP : factionState.atroxUnspentFP;

                          return (
                            <div
                              key={perk.id}
                              className={`rounded-lg border p-2 ${perk.unlocked
                                ? 'border-emerald-600 bg-emerald-900/20'
                                : canUnlock
                                  ? 'border-slate-600 bg-slate-800 cursor-pointer hover:bg-slate-700'
                                  : 'border-slate-700 bg-slate-800/50 opacity-60'
                                }`}
                              onClick={() => {
                                if (!perk.unlocked && canUnlock) {
                                  unlockPerk(perk.id);
                                  saveGame();
                                }
                              }}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="text-xs font-semibold">{perk.name}</div>
                                <div className="text-xs text-slate-400">Tier {perk.tier}</div>
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="text-xs text-slate-400">Cost: {perk.costFP} FP</div>
                                {perk.unlocked ? (
                                  <div className="text-xs text-emerald-400">✓ Unlocked</div>
                                ) : !canUnlock && unspentFP < perk.costFP ? (
                                  <div className="text-xs text-red-400">Not enough Faction Points assigned to {selectedFaction}.</div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </section>
        )
      }

      {
        mainTab === 'missions' && (
          <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
            <h2 className="text-base sm:text-lg md:text-xl font-semibold">Missions</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Left: ready banners info panel */}
              <div className="md:col-span-1 rounded-xl border border-slate-800 bg-slate-900 p-3">
                <div className="text-sm font-semibold mb-2">Ready Banners</div>
                {banners.filter(b => b.status === 'ready').length === 0 ? (
                  <div className="text-xs text-slate-500">No ready banners.</div>
                ) : (
                  <div className="space-y-2">
                    {banners.filter(b => b.status === 'ready').map((b) => {
                      // Check if this banner is assigned to any mission
                      const assignedMission = missions.find(m => m.status === 'available' && m.staged.includes(b.id));
                      const isAssigned = assignedMission !== undefined;
                      const totalTroops = b.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;

                      return (
                        <div
                          key={b.id}
                          className={`rounded-lg border p-2 transition-colors ${isAssigned
                            ? 'border-red-500 bg-red-900/20 opacity-75'
                            : 'border-slate-700 bg-slate-800'
                            }`}
                        >
                          <div className={`text-sm font-semibold ${isAssigned ? 'text-red-300' : ''}`}>
                            {b.name}
                            {isAssigned && <span className="ml-2 text-xs text-red-400">(Unavailable)</span>}
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            {totalTroops} troops
                            {b.squads && b.squads.length > 0 && (
                              <span className="ml-1">
                                ({b.squads.map(s => `${s.currentSize} ${s.type}`).join(', ')})
                              </span>
                            )}
                          </div>
                          {isAssigned && assignedMission && (
                            <div className="mt-2 flex items-center justify-between">
                              <div className="text-xs text-red-400">
                                Assigned to: {assignedMission.name}
                              </div>
                              <button
                                onClick={() => {
                                  // Open selector for this mission to allow changing banner
                                  setMissionBannerSelector(assignedMission.id);
                                }}
                                className="px-2 py-0.5 rounded text-[10px] bg-slate-700 hover:bg-slate-600 text-white"
                                title="Assign different banner"
                              >
                                Change
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right: missions list */}
              <div className="md:col-span-2 space-y-3">
                {missions.map((m) => {
                  const readyBanners = banners.filter(b => b.status === 'ready');
                  const hasReadyBanners = readyBanners.length > 0;
                  const assignedBannerId = m.staged.length > 0 ? m.staged[0] : null;
                  const assignedBanner = assignedBannerId ? banners.find(b => b.id === assignedBannerId) : null;
                  const isSelectorOpen = missionBannerSelector === m.id;
                  const isLoading = missionLoading === m.id;
                  const secsLeft = Math.max(0, m.duration - m.elapsed);
                  const hasReport = m.battleResult !== undefined;
                  const hasRewards = m.rewards !== undefined;
                  const isOnCooldown = m.cooldownEndTime !== undefined && m.cooldownEndTime > Date.now();
                  const cooldownSeconds = isOnCooldown ? Math.ceil((m.cooldownEndTime! - Date.now()) / 1000) : 0;

                  // Determine mission state
                  const isReady = m.status === 'available' && !isOnCooldown;
                  const isCompletedRewardPending = m.status === 'completedRewardsPending';
                  const isCompletedRewardsClaimed = m.status === 'completedRewardsClaimed';
                  const isFailed = m.status === 'available' && m.battleResult && m.battleResult.winner !== 'player';

                  return (
                    <div key={m.id} className={`rounded-xl border ${m.isNew ? 'border-red-500' : 'border-slate-800'} bg-slate-900 p-3`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold">{m.name}</div>
                          {isCompletedRewardsClaimed && (
                            <span className="px-2 py-0.5 bg-emerald-900 text-emerald-200 text-xs font-semibold rounded">
                              Completed
                            </span>
                          )}
                          {isFailed && (
                            <span className="px-2 py-0.5 bg-red-900 text-red-200 text-xs font-semibold rounded">
                              Failed
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {m.isNew && (
                            <div className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
                              NEW!
                            </div>
                          )}
                          {isReady && (
                            <>
                              {!assignedBanner ? (
                                <button
                                  onClick={() => {
                                    // Clear NEW flag when interacting with mission
                                    if (m.isNew) {
                                      setMissions((ms) => ms.map((mission) =>
                                        mission.id === m.id ? { ...mission, isNew: false } : mission
                                      ));
                                    }
                                    // Auto-select if only one banner
                                    if (readyBanners.length === 1) {
                                      assignBannerToMission(m.id, readyBanners[0].id);
                                    } else {
                                      setMissionBannerSelector(isSelectorOpen ? null : m.id);
                                    }
                                  }}
                                  disabled={!hasReadyBanners}
                                  className={`px-3 py-1.5 rounded text-sm ${!hasReadyBanners
                                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                                    }`}
                                  title={!hasReadyBanners ? 'Train a banner in the Army tab first' : ''}
                                >
                                  Assign banner
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => {
                                      // Clear NEW flag when interacting with mission
                                      if (m.isNew) {
                                        setMissions((ms) => ms.map((mission) =>
                                          mission.id === m.id ? { ...mission, isNew: false } : mission
                                        ));
                                      }
                                      // Open selector to allow changing banner
                                      setMissionBannerSelector(isSelectorOpen ? null : m.id);
                                    }}
                                    disabled={isLoading}
                                    className={`px-3 py-1.5 rounded text-sm ${isLoading
                                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                                      }`}
                                    title="Change assigned banner"
                                  >
                                    Change banner
                                  </button>
                                  <button
                                    onClick={() => confirmSendMission(m.id)}
                                    disabled={isLoading}
                                    className={`px-3 py-1.5 rounded text-sm ${isLoading
                                      ? 'bg-slate-600 cursor-not-allowed'
                                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                      }`}
                                  >
                                    {isLoading ? 'In progress...' : 'Send mission'}
                                  </button>
                                </>
                              )}
                            </>
                          )}
                          {m.status === 'running' && (
                            <div className="text-xs text-slate-500">{secsLeft}s left</div>
                          )}
                          {isCompletedRewardPending && hasReport && m.battleResult && (
                            <button
                              onClick={() => {
                                setBattleReport({ missionId: m.id, result: m.battleResult!, bannerXP: m.bannerXP });
                              }}
                              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                            >
                              View report
                            </button>
                          )}
                          {isFailed && hasReport && m.battleResult && (
                            <button
                              onClick={() => {
                                setBattleReport({ missionId: m.id, result: m.battleResult!, bannerXP: m.bannerXP });
                              }}
                              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                              title="View previous battle report"
                            >
                              View report
                            </button>
                          )}
                          {isCompletedRewardsClaimed && (
                            <>
                              {hasReport && m.battleResult && (
                                <button
                                  onClick={() => {
                                    // Clear NEW flag when viewing report
                                    if (m.isNew) {
                                      setMissions((ms) => ms.map((mission) =>
                                        mission.id === m.id ? { ...mission, isNew: false } : mission
                                      ));
                                    }
                                    setBattleReport({ missionId: m.id, result: m.battleResult!, bannerXP: m.bannerXP });
                                  }}
                                  className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                                >
                                  View report
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  // Remove this mission and replace with new one
                                  // Exclude current mission ID and all other mission IDs to ensure we get a truly new mission
                                  const currentIds = missions.map(mission => mission.id);
                                  const newMissions = selectRandomMissions(1, currentIds);
                                  if (newMissions.length > 0) {
                                    setMissions((ms) => ms.map((mission) =>
                                      mission.id === m.id ? newMissions[0] : mission
                                    ));
                                  }
                                  saveGame();
                                }}
                                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
                                title="Remove this completed mission and get a new one"
                              >
                                ✕ Close
                              </button>
                            </>
                          )}
                          {isOnCooldown && (
                            <div className="text-xs text-slate-400">
                              Available in {cooldownSeconds}s
                            </div>
                          )}
                        </div>
                      </div>

                      {m.description && (
                        <div className="mt-2 text-xs text-slate-400 leading-relaxed">
                          {m.description}
                        </div>
                      )}

                      {/* Rewards summary for completed missions */}
                      {isCompletedRewardsClaimed && m.rewardTier && m.rewards && (
                        <div className="mt-2 text-xs text-amber-300 font-semibold">
                          Rewards collected: {m.rewardTier}: {[
                            m.rewards.food ? `${formatInt(m.rewards.food)} Food` : null,
                            m.rewards.wood ? `${formatInt(m.rewards.wood)} Wood` : null,
                            m.rewards.stone ? `${formatInt(m.rewards.stone)} Stone` : null,
                            m.rewards.iron ? `${formatInt(m.rewards.iron)} Iron` : null,
                            m.rewards.gold ? `${formatInt(m.rewards.gold)} Gold` : null,
                          ].filter(Boolean).join(', ')}
                        </div>
                      )}

                      {/* Enemy troop count */}
                      {m.enemyComposition && (() => {
                        const comp = m.enemyComposition as Division;
                        const total = getEnemyTotal(comp);
                        const unitCounts: string[] = [];
                        for (const unitType in comp) {
                          const count = comp[unitType as UnitType] || 0;
                          if (count > 0) {
                            unitCounts.push(`${count} ${unitDisplayNames[unitType as UnitType] || unitType}`);
                          }
                        }
                        return (
                          <div className="mt-2 text-xs font-semibold text-slate-300">
                            Enemies: {total} troops ({unitCounts.join(', ')})
                          </div>
                        );
                      })()}

                      {/* Banner selector dropdown */}
                      {m.status === 'available' && isSelectorOpen && (
                        <div className="mt-3 pt-3 border-t border-slate-700">
                          <div className="text-xs font-semibold text-slate-300 mb-2">Choose banner</div>
                          <div className="space-y-1.5">
                            {readyBanners.map((b) => {
                              const totalTroops = b.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;
                              const isCurrentlyAssigned = assignedBannerId === b.id;
                              return (
                                <button
                                  key={b.id}
                                  onClick={() => assignBannerToMission(m.id, b.id)}
                                  className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${isCurrentlyAssigned
                                    ? 'bg-emerald-900/30 border-emerald-500 hover:bg-emerald-900/40'
                                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 hover:border-slate-600'
                                    }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className={`text-sm font-semibold ${isCurrentlyAssigned ? 'text-emerald-300' : ''}`}>
                                      {b.name}
                                    </div>
                                    {isCurrentlyAssigned && (
                                      <span className="text-xs text-emerald-400 font-semibold">(Selected)</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    {totalTroops} troops
                                    {b.squads && b.squads.length > 0 && (
                                      <span className="ml-1">
                                        ({b.squads.map(s => `${s.currentSize} ${s.type}`).join(', ')})
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Assigned banner display */}
                      {m.status === 'available' && assignedBanner && (
                        <div className="mt-2 text-xs text-slate-300">
                          Assigned: <span className="text-emerald-400 font-semibold">{assignedBanner.name}</span>
                        </div>
                      )}

                      {/* Progress */}
                      {m.status !== 'available' && (
                        <div className="mt-2">
                          <RowBar value={m.elapsed} max={m.duration} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )
      }

      {
        mainTab === 'expeditions' && (
          <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
            <h2 className="text-base sm:text-lg md:text-xl font-semibold">Expeditions</h2>
            <div className="space-y-3">
              {expeditions.map((exp) => {
                return (
                  <div key={exp.expeditionId} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="font-semibold text-sm mb-1">{exp.title}</div>
                        <div className="text-xs text-slate-400 mb-2">{exp.shortSummary}</div>
                        {(exp.state === 'available' || exp.state === 'funding' || exp.state === 'readyToLaunch') && (
                          <div className="text-xs text-slate-300 whitespace-pre-line mt-2">{exp.description}</div>
                        )}
                      </div>
                      {exp.state === 'completed' && (
                        <div className="text-xs px-2 py-1 rounded bg-emerald-900 text-emerald-200">Completed</div>
                      )}
                    </div>

                    {/* Available state: Show Accept button */}
                    {exp.state === 'available' && (
                      <div className="mt-3">
                        <div className="text-xs text-slate-300 mb-3">
                          Preparation requires 500 Wood, 250 Stone, 1000 Food and 5 Population.
                        </div>
                        <button
                          onClick={() => acceptExpedition(exp.expeditionId)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                        >
                          Accept Expedition
                        </button>
                      </div>
                    )}

                    {/* Funding state: Show requirements with progress bars */}
                    {exp.state === 'funding' && (
                      <div className="mt-3 space-y-2">
                        <div className="text-xs font-semibold text-slate-300 mb-2">Resource Progress:</div>
                        {(['wood', 'stone', 'food', 'population'] as const).map((resourceType) => {
                          const req = exp.requirements[resourceType];
                          const isComplete = req.current >= req.required;
                          const currentStock = resourceType === 'population'
                            ? population
                            : warehouse[resourceType];
                          const canSend = currentStock > 0 && !isComplete;
                          const progress = Math.min(100, (req.current / req.required) * 100);

                          return (
                            <div key={resourceType} className="flex items-center gap-2 text-xs">
                              <span className="capitalize w-20">{resourceType === 'population' ? 'Population' : resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}:</span>
                              <span className={isComplete ? 'text-emerald-400' : 'text-slate-300'}>
                                {formatInt(req.current)} / {formatInt(req.required)}
                              </span>
                              <div className="flex-1 h-1.5 rounded bg-slate-800 overflow-hidden">
                                <div
                                  className={`h-full ${isComplete ? 'bg-emerald-500' : 'bg-sky-500'}`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              {!isComplete && (
                                <button
                                  onClick={() => sendResourceToExpedition(exp.expeditionId, resourceType)}
                                  disabled={!canSend}
                                  className={`px-1.5 py-0.5 rounded text-xs font-bold ${canSend
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                    : 'bg-red-900 text-red-300 cursor-not-allowed opacity-75'
                                    }`}
                                  title={canSend ? `Send ${resourceType}` : `Insufficient ${resourceType}`}
                                >
                                  +
                                </button>
                              )}
                              {isComplete && <span className="text-emerald-400 text-[10px]">✓</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ReadyToLaunch state: Show completed requirements and Launch button */}
                    {exp.state === 'readyToLaunch' && (
                      <div className="mt-3 space-y-3">
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-slate-300 mb-2">Resource Progress:</div>
                          {(['wood', 'stone', 'food', 'population'] as const).map((resourceType) => {
                            const req = exp.requirements[resourceType];
                            return (
                              <div key={resourceType} className="flex items-center gap-2 text-xs">
                                <span className="capitalize w-20">{resourceType === 'population' ? 'Population' : resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}:</span>
                                <span className="text-emerald-400">
                                  {formatInt(req.current)} / {formatInt(req.required)}
                                </span>
                                <div className="flex-1 h-1.5 rounded bg-slate-800 overflow-hidden">
                                  <div className="h-full bg-emerald-500" style={{ width: '100%' }} />
                                </div>
                                <span className="text-emerald-400 text-[10px]">✓</span>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => launchExpedition(exp.expeditionId)}
                          className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                        >
                          Launch Expedition
                        </button>
                      </div>
                    )}

                    {/* Travelling state: Show progress bar */}
                    {exp.state === 'travelling' && (
                      <div className="mt-3">
                        <div className="text-xs text-slate-300 mb-2">The expedition is travelling through the mountain passes of Godonis...</div>
                        <div className="h-2 rounded bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-sky-500 transition-all duration-100"
                            style={{ width: `${exp.travelProgress}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">Travelling</div>
                      </div>
                    )}

                    {/* Completed state: Show completion message and fortress section */}
                    {exp.state === 'completed' && exp.fortress && (
                      <div className="mt-3 space-y-4">
                        <div className="text-xs text-emerald-400">
                          The expedition was successful. A frontier fortress has been established in the mountains of Godonis.
                        </div>

                        {/* Frontier Fortress Section */}
                        <div className="mt-4 pt-4 border-t border-slate-700">
                          <div className="text-sm font-semibold mb-3">Frontier Fortress of Godonis</div>

                          {/* Fortress Stats Summary */}
                          {(() => {
                            const wallArchers = calculateActiveWallArchers(exp.expeditionId);
                            const watchPost = exp.fortress.buildings.find(b => b.id === 'watch_post');
                            const watchPostLevel = watchPost?.level || 0;
                            return (
                              <div className="text-xs text-slate-300 mb-3">
                                Fort HP: <span className="text-slate-100">{formatInt(exp.fortress.stats.fortHP)}</span> |
                                Watch Post: <span className="text-slate-100">Lv {watchPostLevel}</span> |
                                Wall Archers: <span className="text-slate-100">{formatInt(wallArchers.active)} / {formatInt(wallArchers.capacity)}</span> |
                                Garrison: <span className="text-slate-100">{formatInt(exp.fortress.stats.garrisonWarriors)} Warriors, {formatInt(exp.fortress.stats.garrisonArchers)} Archers</span> |
                                Stored Squads: <span className="text-slate-100">{formatInt(exp.fortress.stats.storedSquads)}</span>
                              </div>
                            );
                          })()}
                          <div className="text-[10px] text-slate-500 mb-3">
                            These stats feed the Fortress Simulator.
                          </div>

                          {/* Fortress Buildings List */}
                          <div className="space-y-2">
                            {exp.fortress.buildings.map((building) => {
                              const nextLevel = building.level + 1;
                              const canUpgrade = nextLevel <= building.maxLevel;
                              const nextCost = canUpgrade ? building.getUpgradeCost(nextLevel) : null;
                              const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
                              const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
                              const affordable = canUpgrade && enoughWood && enoughStone;
                              const nextEffect = canUpgrade ? building.getEffect(nextLevel) : null;
                              const currentEffect = building.getEffect(building.level);

                              return (
                                <div key={building.id} className="rounded-lg border border-slate-800 bg-slate-800 p-2">
                                  <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-baseline gap-1.5 flex-wrap">
                                        <div className="text-sm font-semibold truncate">{building.name}</div>
                                        <div className="text-[10px] px-1 py-0.5 rounded bg-slate-700">Lv {building.level}</div>
                                        <div className="text-[10px] text-slate-400">
                                          {building.id === 'watch_post'
                                            ? `+${currentEffect.archerSlots || 0} Archer slots (max ${currentEffect.archerSlots || 0} archers shooting from walls)`
                                            : building.description
                                          }
                                        </div>
                                      </div>
                                      {building.id === 'watch_post' && (
                                        <div className="text-[10px] text-slate-500 mt-1" title="Watch Post: Allows up to X archers from the defending banners to fire from the walls during the first phase of the siege.">
                                          Allows up to {currentEffect.archerSlots || 0} archers from defending banners to fire from walls during phase 1.
                                        </div>
                                      )}
                                      {canUpgrade && nextEffect && (
                                        <div className="text-[10px] text-slate-500 mt-1">
                                          Next level: {
                                            nextEffect.fortHP ? `+${nextEffect.fortHP - (currentEffect.fortHP || 0)} Fort HP` :
                                              nextEffect.archerSlots ? `+${nextEffect.archerSlots - (currentEffect.archerSlots || 0)} Archer slots (max ${nextEffect.archerSlots} archers shooting from walls)` :
                                                nextEffect.garrisonWarriors ? `+${nextEffect.garrisonWarriors - (currentEffect.garrisonWarriors || 0)} Garrison capacity` :
                                                  ''
                                          }
                                        </div>
                                      )}
                                    </div>
                                    {canUpgrade && nextCost && (
                                      <div className="text-right">
                                        <div className="text-[10px] text-slate-500 mb-0.5">Cost: W {formatInt(nextCost.wood)} S {formatInt(nextCost.stone)}</div>
                                        <button
                                          className="px-2 py-1 rounded-lg text-xs bg-slate-900 text-white disabled:opacity-50"
                                          onClick={() => upgradeFortressBuilding(exp.expeditionId, building.id)}
                                          disabled={!affordable}
                                          title={!affordable ? "Not enough resources" : `Upgrade to Lvl ${nextLevel}`}
                                        >
                                          Upgrade
                                        </button>
                                      </div>
                                    )}
                                    {!canUpgrade && (
                                      <div className="text-[10px] text-slate-500">Max Level</div>
                                    )}
                                  </div>

                                  {/* Progression Information Area */}
                                  {/* This is a placeholder for now, will be implemented when buildings have XP */}
                                  {/* {!isEditing && (
                                    <div className="hidden sm:flex items-center gap-3 ml-2 px-3 py-1.5 rounded-lg bg-slate-950/40 border border-slate-800/50 shrink-0">
                                      <div className="w-9 h-9 rounded-md bg-blue-600 shadow-sm flex items-center justify-center border border-blue-500/50">
                                        <span className="text-white font-bold text-sm tracking-tight">T{building.level || 1}</span>
                                      </div>
                                      <div className="flex flex-col justify-center min-w-[120px]">
                                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium mb-1 leading-none">
                                          <span>XP Progress</span>
                                          <span>{Math.floor(building.xp || 0)} <span className="text-slate-600">/</span> {building.xpNextLevel || 100}</span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                                          <div
                                            className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)] relative"
                                            style={{ width: `${Math.max(0, Math.min(100, ((building.xp || 0) - (building.xpCurrentLevel || 0)) / ((building.xpNextLevel || 100) - (building.xpCurrentLevel || 0)) * 100))}%` }}
                                          >
                                            <div className="absolute inset-0 bg-white/20"></div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )} */}
                                </div>
                              );
                            })}
                          </div>

                          {/* Fortress Garrison Section */}
                          <div className="mt-4 pt-4 border-t border-slate-700">
                            <div className="text-sm font-semibold mb-2">Fortress Garrison</div>

                            {/* Currently Stationed Banners */}
                            {(exp.fortress.garrison?.length ?? 0) > 0 && (
                              <div className="mb-3">
                                <div className="text-xs text-slate-400 mb-1.5">Stationed Banners:</div>
                                <div className="space-y-1.5">
                                  {(exp.fortress.garrison || []).map((bannerId) => {
                                    const banner = banners.find(b => b.id === bannerId);
                                    if (!banner) return null;

                                    // Calculate total troops
                                    const totalTroops = banner.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;

                                    return (
                                      <div key={bannerId} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800 p-1.5">
                                        <div className="flex items-center gap-2">
                                          <div className="text-xs font-semibold">{banner.name}</div>
                                          <div className="text-[10px] text-slate-400">
                                            {totalTroops} troops
                                          </div>
                                        </div>
                                        <button
                                          onClick={() => removeBannerFromFortress(exp.expeditionId, bannerId)}
                                          className="px-2 py-0.5 rounded text-[10px] bg-red-900 hover:bg-red-800 text-red-200"
                                          title="Remove from fortress"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Available Ready Banners */}
                            {(() => {
                              const garrison = exp.fortress.garrison || [];
                              const readyBanners = banners.filter(b =>
                                b.status === 'ready' &&
                                !garrison.includes(b.id)
                              );

                              if (readyBanners.length === 0 && garrison.length === 0) {
                                return (
                                  <div className="text-xs text-slate-500">
                                    No ready banners available. Train banners in the Army section to assign them to the fortress.
                                  </div>
                                );
                              }

                              if (readyBanners.length === 0) {
                                return null;
                              }

                              return (
                                <div>
                                  <div className="text-xs text-slate-400 mb-1.5">Available Banners:</div>
                                  <div className="space-y-1.5">
                                    {readyBanners.map((banner) => {
                                      const totalTroops = banner.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;

                                      return (
                                        <div key={banner.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800 p-1.5">
                                          <div className="flex items-center gap-2">
                                            <div className="text-xs font-semibold">{banner.name}</div>
                                            <div className="text-[10px] text-slate-400">
                                              {totalTroops} troops
                                            </div>
                                          </div>
                                          <button
                                            onClick={() => assignBannerToFortress(exp.expeditionId, banner.id)}
                                            className="px-2 py-0.5 rounded text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white"
                                            title="Assign to fortress"
                                          >
                                            Assign
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Attack Button */}
                          <div className="mt-3 pt-3 border-t border-slate-700">
                            {(() => {
                              const isLoading = battleLoading?.expeditionId === exp.expeditionId;
                              const hasReport = !!(exp.fortress?.lastBattle);
                              const error = battleError?.expeditionId === exp.expeditionId ? battleError.message : null;

                              // Debug: ensure button always renders
                              console.log('[Attack Button Debug]', {
                                expeditionId: exp.expeditionId,
                                isLoading,
                                hasReport,
                                lastBattle: exp.fortress?.lastBattle,
                                buttonShouldRender: true
                              });

                              const handleAttack = () => {
                                if (hasReport) {
                                  // Scroll to battle report
                                  const reportElement = document.getElementById(`battle-report-${exp.expeditionId}`);
                                  if (reportElement) {
                                    reportElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }
                                  return;
                                }

                                // Clear any previous error
                                setBattleError(null);

                                // Start loading state
                                setBattleLoading({ expeditionId: exp.expeditionId, progress: 0 });

                                // Run battle simulation immediately
                                try {
                                  const result = runSiegeBattle(exp.expeditionId, 100);
                                  const destroyedBanners = applyFortressBattleCasualties(exp.expeditionId, result);

                                  // Update expedition with battle result
                                  setExpeditions((exps) => exps.map((e) => {
                                    if (e.expeditionId !== exp.expeditionId || !e.fortress) return e;
                                    const updatedGarrison = destroyedBanners.length > 0
                                      ? (e.fortress.garrison || []).filter(id => !destroyedBanners.includes(id))
                                      : e.fortress.garrison;
                                    return {
                                      ...e,
                                      fortress: {
                                        ...e.fortress,
                                        garrison: updatedGarrison,
                                        lastBattle: result
                                      }
                                    };
                                  }));

                                  // Update leaderboard from siege battle
                                  if (result) {
                                    // Calculate enemy units killed (attackers killed)
                                    const lastRound = result.siegeTimeline[result.siegeTimeline.length - 1];
                                    const enemyUnitsKilled = result.initialAttackers - lastRound.attackers;

                                    // Determine if victory (fortress holds)
                                    const isVictory = result.outcome === 'fortress_holds_walls' || result.outcome === 'fortress_holds_inner';

                                    const leaderboardBattleResult: LeaderboardBattleResult = {
                                      enemyUnitsKilled,
                                      isVictory,
                                      playerId: REAL_PLAYER_ID,
                                      playerName: REAL_PLAYER_NAME,
                                      faction: REAL_PLAYER_FACTION,
                                    };
                                    setLeaderboard(prev => updateLeaderboardFromBattleResult(prev, leaderboardBattleResult));
                                  }

                                  // Animate progress bar over BATTLE_PROGRESS_DURATION_MS
                                  const startTime = Date.now();
                                  const updateInterval = 16; // ~60fps
                                  const progressInterval = setInterval(() => {
                                    const elapsed = Date.now() - startTime;
                                    const progress = Math.min(100, (elapsed / BATTLE_PROGRESS_DURATION_MS) * 100);

                                    setBattleLoading({ expeditionId: exp.expeditionId, progress });

                                    if (progress >= 100) {
                                      clearInterval(progressInterval);
                                      // Loading complete - clear loading state and scroll to report
                                      setTimeout(() => {
                                        setBattleLoading(null);
                                        // Scroll to report after a brief delay
                                        setTimeout(() => {
                                          const reportElement = document.getElementById(`battle-report-${exp.expeditionId}`);
                                          if (reportElement) {
                                            reportElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                          }
                                        }, 100);
                                      }, 50);
                                    }
                                  }, updateInterval);
                                } catch (err) {
                                  // Error handling
                                  console.error('Siege battle error:', err);
                                  setBattleLoading(null);
                                  setBattleError({
                                    expeditionId: exp.expeditionId,
                                    message: err instanceof Error ? err.message : 'Error running siege battle. Please try again.'
                                  });
                                }
                              };

                              return (
                                <div className="space-y-2">
                                  <button
                                    onClick={handleAttack}
                                    disabled={isLoading}
                                    className={`w-full px-3 py-2 rounded-lg text-white text-sm font-semibold transition-colors ${isLoading
                                      ? 'bg-slate-600 cursor-not-allowed'
                                      : hasReport
                                        ? 'bg-slate-700 hover:bg-slate-600'
                                        : 'bg-red-700 hover:bg-red-600'
                                      }`}
                                  >
                                    {isLoading ? 'Battle in progress...' : hasReport ? 'View report' : '⚔ Attack Fortress'}
                                  </button>

                                  {/* Progress Bar */}
                                  {isLoading && battleLoading && (
                                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-red-500 transition-all duration-75 ease-out"
                                        style={{ width: `${battleLoading.progress || 0}%` }}
                                      />
                                    </div>
                                  )}

                                  {/* Error Message */}
                                  {error && (
                                    <div className="text-xs text-red-400 mt-1">
                                      {error}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>

                          {/* Battle Report */}
                          {exp.fortress.lastBattle && (
                            <div id={`battle-report-${exp.expeditionId}`} className="mt-4 pt-4 border-t border-slate-700">
                              <div className="text-sm font-semibold mb-3">Battle Report</div>
                              {(() => {
                                const battle = exp.fortress.lastBattle!;
                                const firstRound = battle.siegeTimeline[0];
                                const lastRound = battle.siegeTimeline[battle.siegeTimeline.length - 1];

                                // Calculate totals
                                const totalAttackersKilled = battle.initialAttackers - lastRound.attackers;
                                const totalDamageToFort = battle.initialFortHP - lastRound.fortHP;
                                const wallsDestroyed = lastRound.fortHP <= 0;

                                // Outcome descriptions
                                const outcomeInfo = {
                                  fortress_holds_walls: {
                                    title: 'Fortress Holds',
                                    color: 'text-emerald-400',
                                    description: 'The attackers were repelled before breaching the walls.'
                                  },
                                  fortress_holds_inner: {
                                    title: 'Fortress Holds',
                                    color: 'text-emerald-400',
                                    description: 'The walls were breached, but the garrison successfully defended the inner fortress.'
                                  },
                                  fortress_falls: {
                                    title: 'Fortress Falls',
                                    color: 'text-red-400',
                                    description: 'The attackers breached the walls and overwhelmed the defenders.'
                                  },
                                  stalemate: {
                                    title: 'Stalemate',
                                    color: 'text-amber-400',
                                    description: 'Both sides suffered heavy losses with no clear victor.'
                                  }
                                };

                                const outcome = outcomeInfo[battle.outcome];

                                return (
                                  <div className="space-y-3 text-xs">
                                    {/* Outcome */}
                                    <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-slate-400">Result:</span>
                                        <span className={`font-semibold ${outcome.color}`}>
                                          {outcome.title}
                                        </span>
                                      </div>
                                      <div className="text-slate-300 text-[11px]">
                                        {outcome.description}
                                      </div>
                                    </div>

                                    {/* Siege Phase Summary */}
                                    <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                      <div className="font-semibold text-slate-300 mb-2">Siege on the Walls</div>
                                      <div className="space-y-1.5 text-[11px] text-slate-300">
                                        <div>
                                          The attackers ({formatInt(battle.initialAttackers)} warriors) assaulted the fortress walls over <strong>{battle.siegeRounds}</strong> rounds.
                                        </div>
                                        <div>
                                          The defenders' archers on the walls killed <span className="text-red-300 font-semibold">{formatInt(totalAttackersKilled)}</span> attackers.
                                        </div>
                                        <div>
                                          The attackers damaged the walls, reducing fort HP from <span className="text-blue-300">{formatInt(battle.initialFortHP)}</span> to <span className="text-blue-300">{formatInt(lastRound.fortHP)}</span> ({formatInt(totalDamageToFort)} damage).
                                        </div>
                                        {wallsDestroyed ? (
                                          <div className="text-amber-400 font-semibold">
                                            The walls were breached! The attackers broke through.
                                          </div>
                                        ) : (
                                          <div className="text-emerald-400 font-semibold">
                                            The walls held strong. The attackers were repelled.
                                          </div>
                                        )}
                                      </div>

                                      {/* Siege Phase Detailed Logs */}
                                      <details className="mt-3 pt-3 border-t border-slate-700" open>
                                        <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
                                          Siege Logs ({battle.siegeTimeline.length} rounds)
                                        </summary>
                                        <div className="mt-2 max-h-60 overflow-y-auto">
                                          <table className="w-full text-[10px] border-collapse">
                                            <thead>
                                              <tr className="bg-slate-900 border-b border-slate-700">
                                                <th className="p-1 text-left text-slate-300">Round</th>
                                                <th className="p-1 text-right text-slate-300">Wall HP</th>
                                                <th className="p-1 text-right text-slate-300">Attackers</th>
                                                <th className="p-1 text-right text-slate-300">Archers</th>
                                                <th className="p-1 text-right text-slate-300">Killed</th>
                                                <th className="p-1 text-right text-slate-300">Wall Dmg</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {battle.siegeTimeline.map((round, idx) => {
                                                const prevRound = idx > 0 ? battle.siegeTimeline[idx - 1] : null;
                                                const attackersAtStart = prevRound ? prevRound.attackers : battle.initialAttackers;
                                                const fortHPAtStart = prevRound ? prevRound.fortHP : battle.initialFortHP;

                                                return (
                                                  <tr key={idx} className="border-b border-slate-800 hover:bg-slate-900">
                                                    <td className="p-1 text-slate-200 font-semibold">{round.round}</td>
                                                    <td className="p-1 text-right">
                                                      <span className="text-blue-300">{formatInt(round.fortHP)}</span>
                                                      <span className="text-slate-500">/{formatInt(battle.initialFortHP)}</span>
                                                      {prevRound && (
                                                        <span className="text-red-400 text-[9px] ml-1">
                                                          (-{formatInt(fortHPAtStart - round.fortHP)})
                                                        </span>
                                                      )}
                                                    </td>
                                                    <td className="p-1 text-right">
                                                      <span className="text-red-300">{formatInt(round.attackers)}</span>
                                                      {prevRound && (
                                                        <span className="text-red-400 text-[9px] ml-1">
                                                          (-{formatInt(attackersAtStart - round.attackers)})
                                                        </span>
                                                      )}
                                                    </td>
                                                    <td className="p-1 text-right text-blue-200">{formatInt(round.archers)}</td>
                                                    <td className="p-1 text-right text-red-400">{formatInt(round.killed)}</td>
                                                    <td className="p-1 text-right text-amber-300">{formatInt(round.dmgToFort)}</td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>

                                        {/* Siege Graph */}
                                        <SiegeGraphCanvas
                                          timeline={battle.siegeTimeline}
                                          fortHPmax={battle.initialFortHP}
                                        />
                                      </details>
                                    </div>

                                    {/* Inner Battle Summary */}
                                    {battle.innerTimeline.length > 0 && (
                                      <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                        <div className="font-semibold text-slate-300 mb-2">Inner Battle</div>
                                        {(() => {
                                          const firstInner = battle.innerTimeline[0];
                                          const lastInner = battle.innerTimeline[battle.innerTimeline.length - 1];
                                          const defendersKilled = battle.initialGarrison.warriors + battle.initialGarrison.archers - lastInner.defenders;
                                          const attackersKilledInInner = firstInner.attackers - lastInner.attackers;

                                          return (
                                            <>
                                              <div className="space-y-1.5 text-[11px] text-slate-300">
                                                <div>
                                                  After breaching the walls, <span className="text-red-300 font-semibold">{formatInt(firstInner.attackers)}</span> attackers engaged the garrison ({formatInt(battle.initialGarrison.warriors)} warriors, {formatInt(battle.initialGarrison.archers)} archers) inside the fortress.
                                                </div>
                                                <div>
                                                  The battle lasted <strong>{battle.innerTimeline.length}</strong> steps through skirmish, melee, and pursuit phases.
                                                </div>
                                                <div>
                                                  The defenders lost <span className="text-blue-300 font-semibold">{formatInt(defendersKilled)}</span> troops.
                                                </div>
                                                <div>
                                                  The attackers lost <span className="text-red-300 font-semibold">{formatInt(attackersKilledInInner)}</span> more troops in the inner battle.
                                                </div>
                                                <div className="mt-2 pt-2 border-t border-slate-700">
                                                  <div className="text-slate-400">Final State:</div>
                                                  <div className="flex gap-4 mt-1">
                                                    <div>
                                                      <span className="text-slate-400">Defenders:</span>{' '}
                                                      <span className="text-blue-300 font-semibold">{formatInt(lastInner.defenders)}</span> remaining
                                                    </div>
                                                    <div>
                                                      <span className="text-slate-400">Attackers:</span>{' '}
                                                      <span className="text-red-300 font-semibold">{formatInt(lastInner.attackers)}</span> remaining
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>

                                              {/* Inner Battle Detailed Logs */}
                                              <details className="mt-3 pt-3 border-t border-slate-700" open>
                                                <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
                                                  Inner Battle Logs ({battle.innerTimeline.length} steps)
                                                </summary>
                                                <div className="mt-2 max-h-60 overflow-y-auto">
                                                  <table className="w-full text-[10px] border-collapse">
                                                    <thead>
                                                      <tr className="bg-slate-900 border-b border-slate-700">
                                                        <th className="p-1 text-left text-slate-300">Step</th>
                                                        <th className="p-1 text-left text-slate-300">Phase</th>
                                                        <th className="p-1 text-right text-slate-300">Def. Warriors</th>
                                                        <th className="p-1 text-right text-slate-300">Def. Archers</th>
                                                        <th className="p-1 text-right text-slate-300">Def. Total</th>
                                                        <th className="p-1 text-right text-slate-300">Attackers</th>
                                                        <th className="p-1 text-right text-slate-300">Def. Killed</th>
                                                        <th className="p-1 text-right text-slate-300">Atk. Killed</th>
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {battle.innerTimeline.map((step, idx) => {
                                                        const prevStep = idx > 0 ? battle.innerTimeline[idx - 1] : null;
                                                        const defendersAtStart = prevStep ? prevStep.defenders : (battle.initialGarrison.warriors + battle.initialGarrison.archers);
                                                        const attackersAtStart = prevStep ? prevStep.attackers : firstInner.attackers;

                                                        return (
                                                          <tr key={idx} className="border-b border-slate-800 hover:bg-slate-900">
                                                            <td className="p-1 text-slate-200 font-semibold">{step.step}</td>
                                                            <td className="p-1 text-slate-300 capitalize">{step.phase}</td>
                                                            <td className="p-1 text-right text-blue-200">{formatInt(step.defWarriors)}</td>
                                                            <td className="p-1 text-right text-blue-200">{formatInt(step.defArchers)}</td>
                                                            <td className="p-1 text-right">
                                                              <span className="text-blue-300">{formatInt(step.defenders)}</span>
                                                              {prevStep && (
                                                                <span className="text-red-400 text-[9px] ml-1">
                                                                  (-{formatInt(defendersAtStart - step.defenders)})
                                                                </span>
                                                              )}
                                                            </td>
                                                            <td className="p-1 text-right">
                                                              <span className="text-red-300">{formatInt(step.attackers)}</span>
                                                              {prevStep && (
                                                                <span className="text-red-400 text-[9px] ml-1">
                                                                  (-{formatInt(attackersAtStart - step.attackers)})
                                                                </span>
                                                              )}
                                                            </td>
                                                            <td className="p-1 text-right text-blue-400">{formatInt(step.killedDefenders)}</td>
                                                            <td className="p-1 text-right text-red-400">{formatInt(step.killedAttackers)}</td>
                                                          </tr>
                                                        );
                                                      })}
                                                    </tbody>
                                                  </table>
                                                </div>

                                                {/* Inner Battle Graph */}
                                                <InnerBattleGraphCanvas
                                                  timeline={battle.innerTimeline}
                                                />
                                              </details>
                                            </>
                                          );
                                        })()}
                                      </div>
                                    )}

                                    {/* Final Statistics */}
                                    <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                      <div className="font-semibold text-slate-300 mb-2">Casualties</div>
                                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                                        <div>
                                          <div className="text-slate-400">Attackers Lost:</div>
                                          <div className="text-red-300 font-semibold">
                                            {formatInt(battle.initialAttackers - battle.finalAttackers)} / {formatInt(battle.initialAttackers)}
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-slate-400">Defenders Lost:</div>
                                          <div className="text-blue-300 font-semibold">
                                            {formatInt((battle.initialGarrison.warriors + battle.initialGarrison.archers) - battle.finalDefenders)} / {formatInt(battle.initialGarrison.warriors + battle.initialGarrison.archers)}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )
      }

      {/* Upgrade Confirmation Bottom Sheet */}
      {
        pendingUpgrade && (() => {
          const getBuildingName = (res: string) => {
            const names: Record<string, string> = {
              "wood": "Lumber Mill",
              "stone": "Quarry",
              "food": "Farm",
              "iron": "Iron Mine",
              "house": "House",
              "townhall": "Town Hall",
              "barracks": "Barracks",
              "tavern": "Tavern",
              "militaryAcademy": "Military Academy",
              "warehouse": "Warehouse",
            };
            return names[res] || "Building";
          };

          const getBuildingIcon = (res: string) => {
            if (res === "wood") return lumberjackImg;
            // For other buildings, use emoji or placeholder
            const icons: Record<string, string> = {
              "stone": "⛏️",
              "food": "🌾",
              "iron": "⚒️",
              "house": "🏠",
              "townhall": "🏛️",
              "barracks": "⚔️",
              "tavern": "🍺",
              "militaryAcademy": "🎓",
              "warehouse": "📦",
            };
            return icons[res] || "🏗️";
          };

          const buildingName = getBuildingName(pendingUpgrade.res);
          const buildingIcon = getBuildingIcon(pendingUpgrade.res);
          const cost = pendingUpgrade.cost;
          const enoughWood = warehouse.wood >= cost.wood;
          const enoughStone = warehouse.stone >= cost.stone;
          const affordable = enoughWood && enoughStone;

          // Calculate benefits
          const getBenefits = () => {
            const benefits: string[] = [];
            const { res, from, to } = pendingUpgrade;

            if (res === "wood" || res === "stone" || res === "food" || res === "iron") {
              const currentCap = getProgression(res, from, "capacity");
              const nextCap = getProgression(res, to, "capacity");
              const capIncrease = Math.floor(nextCap - currentCap);
              if (capIncrease > 0) {
                benefits.push(`Capacity: +${formatInt(capIncrease)}`);
              }

              const currentProd = getProgression(res, from, "production");
              const nextProd = getProgression(res, to, "production");
              const prodIncrease = (nextProd - currentProd).toFixed(1);
              if (parseFloat(prodIncrease) > 0) {
                benefits.push(`Production: +${prodIncrease}/s`);
              }

              // Worker slots increase
              benefits.push(`Worker slots: ${from} → ${to}`);
            } else if (res === "house") {
              const currentCap = getHouseCapacity(from);
              const nextCap = getHouseCapacity(to);
              const capIncrease = nextCap - currentCap;
              if (capIncrease > 0) {
                benefits.push(`Population capacity: +${capIncrease}`);
              }
            } else if (res === "warehouse") {
              const currentCap = Math.floor(1000 * Math.pow(1.3, from - 1));
              const nextCap = Math.floor(1000 * Math.pow(1.3, to - 1));
              const capIncrease = nextCap - currentCap;
              if (capIncrease > 0) {
                benefits.push(`Storage capacity: +${formatInt(capIncrease)} per resource`);
              }
            } else if (res === "townhall") {
              benefits.push(`Unlocks new buildings and features`);
            }

            return benefits;
          };

          const benefits = getBenefits();

          return (
            <div
              className="fixed inset-0 bg-black/60 z-[9999] flex items-end justify-center sm:items-center p-0 sm:p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  cancelUpgrade();
                }
              }}
            >
              <div
                className="w-full sm:w-[92%] md:w-[600px] max-h-[70vh] bg-slate-900 rounded-t-3xl sm:rounded-2xl border-t border-l border-r border-slate-800 shadow-2xl relative z-[10000] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 border-b border-slate-800 flex-shrink-0">
                  {/* Building Icon */}
                  <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden">
                    {pendingUpgrade.res === "wood" ? (
                      <img src={buildingIcon} alt={buildingName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-2xl sm:text-3xl">{buildingIcon}</div>
                    )}
                  </div>

                  {/* Title and Level Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-lg sm:text-xl font-semibold mb-1">Level Up</h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm sm:text-base text-slate-300">{buildingName}</span>
                      <span className="text-xs sm:text-sm px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-semibold">Lv {pendingUpgrade.from}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-xs sm:text-sm px-2 py-0.5 rounded-md bg-emerald-900/50 text-emerald-300 font-semibold">Lv {pendingUpgrade.to}</span>
                    </div>
                  </div>

                  {/* Close Button */}
                  <button
                    onClick={cancelUpgrade}
                    className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors"
                    aria-label="Close"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6">
                  {/* Costs Section */}
                  <div className="mb-6 sm:mb-8">
                    <h5 className="text-sm font-semibold text-slate-400 mb-3">Cost</h5>
                    <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                      {cost.wood > 0 && (
                        <div className="flex items-center gap-2">
                          <img
                            src={getResourceIcon('Wood')}
                            alt="Wood"
                            className="h-5 w-5 sm:h-6 sm:w-6 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <div className="flex flex-col">
                            <span className={`text-base sm:text-lg font-semibold ${enoughWood ? "text-emerald-400" : "text-red-400"}`}>
                              {formatInt(cost.wood)}
                            </span>
                            <span className="text-[10px] sm:text-xs text-slate-500">Owned: {formatInt(warehouse.wood)}</span>
                          </div>
                        </div>
                      )}
                      {cost.stone > 0 && (
                        <div className="flex items-center gap-2">
                          <img
                            src={getResourceIcon('Stone')}
                            alt="Stone"
                            className="h-5 w-5 sm:h-6 sm:w-6 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <div className="flex flex-col">
                            <span className={`text-base sm:text-lg font-semibold ${enoughStone ? "text-emerald-400" : "text-red-400"}`}>
                              {formatInt(cost.stone)}
                            </span>
                            <span className="text-[10px] sm:text-xs text-slate-500">Owned: {formatInt(warehouse.stone)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    {!affordable && (
                      <div className="mt-3 text-sm text-red-400 font-medium">Not enough resources</div>
                    )}
                  </div>

                  {/* Benefits Section */}
                  {benefits.length > 0 && (
                    <div className="mb-4 sm:mb-6">
                      <h5 className="text-sm font-semibold text-slate-400 mb-3">You gain</h5>
                      <div className="space-y-2">
                        {benefits.map((benefit, idx) => (
                          <div key={idx} className="text-sm sm:text-base text-slate-300 flex items-center gap-2">
                            <span className="text-emerald-400">✓</span>
                            <span>{benefit}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Buttons */}
                <div className="px-4 sm:px-6 pt-4 border-t border-slate-800 flex gap-3 sm:gap-4 justify-end flex-shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                  <button
                    onClick={cancelUpgrade}
                    className="px-5 sm:px-6 py-3 sm:py-3.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm sm:text-base transition-colors touch-manipulation min-h-[44px] sm:min-h-0"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmUpgrade}
                    disabled={!affordable}
                    className={`px-5 sm:px-6 py-3 sm:py-3.5 rounded-xl font-semibold text-sm sm:text-base transition-colors touch-manipulation min-h-[44px] sm:min-h-0 ${affordable
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white active:bg-emerald-800"
                      : "bg-slate-700 text-slate-400 cursor-not-allowed opacity-50"
                      }`}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      }

      {/* Delete Banner Confirmation Modal */}
      {
        deleteBannerModal !== null && (() => {
          const banner = banners.find(b => b.id === deleteBannerModal);
          if (!banner) return null;
          return (
            <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
              <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
                <h4 className="text-lg font-semibold mb-2">{banner.type === 'mercenary' ? 'Dismiss Banner' : 'Delete Banner'}</h4>
                <p className="text-sm mb-4">
                  Are you sure you want to {banner.type === 'mercenary' ? 'dismiss' : 'delete'} <strong>{banner.name}</strong>?
                </p>
                <div className="text-sm mb-4 space-y-1">
                  <div>This will:</div>
                  <div>• Erase the banner permanently</div>
                  {banner.type === 'regular' && banner.recruited > 0 && (
                    <div>• Return <strong>{banner.recruited}</strong> population to the village</div>
                  )}
                  {banner.type === 'mercenary' && (
                    <div className="text-slate-400">• No population will be returned (mercenary banner)</div>
                  )}
                  {banner.status === 'deployed' && (
                    <div className="text-amber-400">• Remove banner from active mission</div>
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setDeleteBannerModal(null)}
                    className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteBanner}
                    className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      }

      {/* Disable Building Confirmation Modal */}
      {
        disableBuildingModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-[9999]">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800 relative z-[10000]">
              <h4 className="text-lg font-semibold mb-2">Disable building?</h4>
              <p className="text-sm mb-4">
                Are you sure you want to disable <strong>{disableBuildingModal.buildingName}</strong>?
              </p>
              <div className="text-sm mb-4 space-y-1 text-slate-300">
                <div>Disabling stops this building from producing resources.</div>
                <div>All workers assigned to this building will be released and become available again.</div>
                <div>You can enable the building later to resume production.</div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDisableBuildingModal(null)}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    toggleBuilding(disableBuildingModal.resource);
                    setDisableBuildingModal(null);
                  }}
                  className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Siege Attack Modal */}
      {
        siegeAttackModal && (() => {
          const expedition = expeditions.find(exp => exp.expeditionId === siegeAttackModal.expeditionId);
          if (!expedition?.fortress) return null;

          const garrison = calculateGarrisonFromBanners(expedition.fortress.garrison || []);
          const totalGarrison = garrison.warriors + garrison.archers;

          return (
            <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
              <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
                <h4 className="text-lg font-semibold mb-2">Attack Fortress</h4>
                <div className="text-sm mb-4 space-y-2">
                  <div>
                    <div className="text-slate-400">Fortress Stats:</div>
                    <div className="text-xs text-slate-300 ml-2">
                      Fort HP: {formatInt(expedition.fortress.stats.fortHP)} |
                      Archer Slots: {formatInt(expedition.fortress.stats.archerSlots)} |
                      Garrison: {formatInt(garrison.warriors)} Warriors, {formatInt(garrison.archers)} Archers
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Number of Attackers:</label>
                    <input
                      type="number"
                      min="1"
                      value={siegeAttackModal.attackers}
                      onChange={(e) => setSiegeAttackModal({ ...siegeAttackModal, attackers: parseInt(e.target.value) || 100 })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setSiegeAttackModal(null)}
                    className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      try {
                        const result = runSiegeBattle(siegeAttackModal.expeditionId, siegeAttackModal.attackers);
                        const destroyedBanners = applyFortressBattleCasualties(siegeAttackModal.expeditionId, result);
                        setExpeditions((exps) => exps.map((exp) => {
                          if (exp.expeditionId !== siegeAttackModal.expeditionId || !exp.fortress) return exp;
                          const updatedGarrison = destroyedBanners.length > 0
                            ? (exp.fortress.garrison || []).filter(id => !destroyedBanners.includes(id))
                            : exp.fortress.garrison;
                          return {
                            ...exp,
                            fortress: {
                              ...exp.fortress,
                              garrison: updatedGarrison,
                              lastBattle: result
                            }
                          };
                        }));
                        setSiegeAttackModal(null);
                      } catch (error) {
                        console.error('Siege battle error:', error);
                        alert('Error running siege battle. Please try again.');
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                  >
                    Launch Attack
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      }

      {/* Mercenary Reinforcement Confirmation Modal */}
      {
        reinforcementModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
              <h4 className="text-lg font-semibold mb-2">Reinforce Squad</h4>
              <p className="text-sm mb-4">
                Reinforce <strong>{reinforcementModal.squadType} Squad</strong> in <strong>{reinforcementModal.bannerName}</strong>?
              </p>
              <div className="text-sm mb-4 space-y-1">
                <div>Soldiers needed: <strong>{reinforcementModal.soldiersNeeded}</strong></div>
                <div>Gold cost: <strong className={warehouse.gold >= reinforcementModal.goldCost ? 'text-emerald-400' : 'text-red-400'}>{reinforcementModal.goldCost}</strong></div>
                <div className="text-xs text-slate-400 mt-2">
                  This will consume {reinforcementModal.goldCost} gold over time as the squad is reinforced.
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setReinforcementModal(null)}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Create reinforcement entry
                    const { bannerId, squadId, soldiersNeeded } = reinforcementModal;
                    if (!barracks) {
                      setReinforcementModal(null);
                      return;
                    }

                    // Guard: Don't allow reinforcing destroyed banners
                    const banner = banners.find(b => b.id === bannerId);
                    if (!banner || banner.status === 'destroyed') {
                      setReinforcementModal(null);
                      return;
                    }

                    // Check if this squad already has a reinforcement entry
                    const hasActiveReinforcement = barracks.trainingQueue.some(
                      entry => entry.type === 'reinforcement' && entry.bannerId === bannerId && entry.squadId === squadId
                    );
                    if (hasActiveReinforcement) {
                      setReinforcementModal(null);
                      return;
                    }

                    // Check if training slots are available
                    const activeEntries = barracks.trainingQueue.filter(e => e.status === 'training' || e.status === 'arriving');
                    const availableSlots = barracks.trainingSlots - activeEntries.length;

                    // Create reinforcement training entry in barracks queue
                    const reinforcementEntry: TrainingEntry = {
                      id: Date.now(),
                      type: 'reinforcement',
                      bannerId,
                      squadId,
                      soldiersNeeded,
                      soldiersTrained: 0,
                      elapsedTime: 0,
                      status: availableSlots > 0 ? 'training' : 'arriving',
                    };

                    setBarracks(prev => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        trainingQueue: [...prev.trainingQueue, reinforcementEntry],
                      };
                    });

                    setReinforcementModal(null);
                  }}
                  disabled={warehouse.gold < reinforcementModal.goldCost}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Reinforce Modal */}
      {
        hireAndRefillModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
              <h4 className="text-lg font-semibold mb-2">Reinforce</h4>
              <p className="text-sm mb-4">
                Refill all damaged squads in <strong>{hireAndRefillModal.bannerName}</strong>?
              </p>
              <div className="text-sm mb-4 space-y-1">
                <div>Refill damaged squads: <strong>{hireAndRefillModal.refillCost}</strong> Gold</div>
                <div className="mt-2 pt-2 border-t border-slate-700">
                  Total cost: <strong className={warehouse.gold >= hireAndRefillModal.totalCost ? 'text-emerald-400' : 'text-red-400'}>{hireAndRefillModal.totalCost}</strong> Gold
                </div>
                {warehouse.gold < hireAndRefillModal.totalCost && (
                  <div className="text-xs text-red-400 mt-1">
                    Insufficient gold. You need {hireAndRefillModal.totalCost - warehouse.gold} more gold.
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setHireAndRefillModal(null)}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!barracks || warehouse.gold < hireAndRefillModal.totalCost) {
                      setHireAndRefillModal(null);
                      return;
                    }

                    // Refill all damaged squads in the existing banner
                    const banner = banners.find(b => b.id === hireAndRefillModal.bannerId);

                    // Guard: Don't allow reinforcing destroyed banners
                    if (!banner || banner.status === 'destroyed') {
                      setHireAndRefillModal(null);
                      return;
                    }

                    // Deduct gold
                    setWarehouse(w => ({ ...w, gold: w.gold - hireAndRefillModal.totalCost }));

                    if (banner) {
                      let displaySquads = banner.squads;
                      if (!displaySquads || displaySquads.length === 0) {
                        const { squads } = initializeSquadsFromUnits(banner.units, squadSeqRef.current);
                        displaySquads = squads;
                      }

                      // Create reinforcement entries for all damaged squads
                      displaySquads.forEach(squad => {
                        if (squad.currentSize < squad.maxSize) {
                          const missing = squad.maxSize - squad.currentSize;
                          // Check if already has reinforcement entry
                          const hasActiveReinforcement = barracks.trainingQueue.some(
                            entry => entry.type === 'reinforcement' && entry.bannerId === banner.id && entry.squadId === squad.id
                          );
                          if (!hasActiveReinforcement) {
                            const activeEntries = barracks.trainingQueue.filter(e => e.status === 'training' || e.status === 'arriving');
                            const availableSlots = barracks.trainingSlots - activeEntries.length;

                            const reinforcementEntry: TrainingEntry = {
                              id: Date.now() + Math.random(), // Unique ID
                              type: 'reinforcement',
                              bannerId: banner.id,
                              squadId: squad.id,
                              soldiersNeeded: missing,
                              soldiersTrained: 0,
                              elapsedTime: 0,
                              status: availableSlots > 0 ? 'training' : 'arriving',
                            };

                            setBarracks(prev => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                trainingQueue: [...prev.trainingQueue, reinforcementEntry],
                              };
                            });
                          }
                        }
                      });
                    }

                    setHireAndRefillModal(null);
                  }}
                  disabled={warehouse.gold < hireAndRefillModal.totalCost}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Reward Modal */}
      {
        rewardModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-4 border border-slate-800 text-center">
              <h4 className="text-lg font-semibold mb-2">Mission Complete</h4>
              <p className="text-sm mb-4">You received <strong>1 Gold</strong>.</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => claimMissionReward(rewardModal.missionId)} className="px-3 py-2 rounded-xl bg-amber-500 text-white">Collect</button>
              </div>
            </div>
          </div>
        )
      }

      {/* Blacksmith Modal */}
      <BlacksmithUI
        isOpen={blacksmithOpen}
        onClose={() => setBlacksmithOpen(false)}
        warehouse={{ iron: warehouse.iron, gold: warehouse.gold }}
        onUpgrade={handleBlacksmithUpgrade}
      />

      {/* Technologies Modal */}
      <TechnologiesUI
        isOpen={technologiesOpen}
        onClose={() => setTechnologiesOpen(false)}
        skillPoints={skillPoints}
        onStartResearch={handleStartResearch}
        onCompleteResearch={handleCompleteResearch}
      />

      {/* Battle Report Modal */}
      {
        battleReport && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Battle Report - {missions.find(m => m.id === battleReport.missionId)?.name}</h2>
                <button onClick={() => {
                  const mission = missions.find(m => m.id === battleReport.missionId);
                  // Only show reward popup if player won and rewards haven't been claimed yet
                  const isVictory = battleReport.result.winner === 'player';
                  if (isVictory && mission && mission.status === 'completedRewardsPending' && mission.enemyComposition) {
                    const enemyTotal = getEnemyTotal(mission.enemyComposition);
                    const { tier, rewards } = generateMissionRewards(enemyTotal);
                    setBattleReport(null);
                    setRewardPopup({ missionId: mission.id, tier, rewards });
                  } else {
                    // Player lost or rewards already claimed - just close
                    setBattleReport(null);
                  }
                }} className="text-slate-400 hover:text-white text-2xl">✕</button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-slate-800 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Player Forces</h3>
                  <div className="text-sm space-y-1">
                    <div className="text-slate-400 text-xs mb-1">Initial</div>
                    <div>Warriors: {battleReport.result.playerInitial.warrior.toFixed(0)}</div>
                    <div>Archers: {battleReport.result.playerInitial.archer.toFixed(0)}</div>
                    <div>Total: {battleReport.result.playerInitial.total.toFixed(0)}</div>
                    <div className="text-slate-400 text-xs mt-2 mb-1">Final</div>
                    <div>Warriors: {battleReport.result.playerFinal.warrior.toFixed(0)}</div>
                    <div>Archers: {battleReport.result.playerFinal.archer.toFixed(0)}</div>
                    <div>Total: {battleReport.result.playerFinal.total.toFixed(0)}</div>
                    <div>Morale: {battleReport.result.playerFinal.morale.toFixed(1)}</div>
                  </div>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Enemy Forces</h3>
                  <div className="text-sm space-y-1">
                    <div className="text-slate-400 text-xs mb-1">Initial</div>
                    <div>Warriors: {battleReport.result.enemyInitial.warrior.toFixed(0)}</div>
                    <div>Archers: {battleReport.result.enemyInitial.archer.toFixed(0)}</div>
                    <div>Total: {battleReport.result.enemyInitial.total.toFixed(0)}</div>
                    <div className="text-slate-400 text-xs mt-2 mb-1">Final</div>
                    <div>Warriors: {battleReport.result.enemyFinal.warrior.toFixed(0)}</div>
                    <div>Archers: {battleReport.result.enemyFinal.archer.toFixed(0)}</div>
                    <div>Total: {battleReport.result.enemyFinal.total.toFixed(0)}</div>
                    <div>Morale: {battleReport.result.enemyFinal.morale.toFixed(1)}</div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 p-4 rounded-lg mb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold mb-2">Result</h3>
                    <div className="text-lg">
                      Winner: <span className={battleReport.result.winner === 'player' ? 'text-emerald-400' : battleReport.result.winner === 'enemy' ? 'text-red-400' : 'text-amber-400'}>
                        {battleReport.result.winner === 'player' ? 'Player Victory' : battleReport.result.winner === 'enemy' ? 'Enemy Victory' : 'Draw'}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400 mt-1">Battle lasted {battleReport.result.ticks} ticks</div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Surviving Troops</h3>
                    <div className="text-sm space-y-1">
                      <div>
                        <span className="text-slate-400">Player: </span>
                        <span className="text-emerald-400">{battleReport.result.playerFinal.total.toFixed(0)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Enemy: </span>
                        <span className="text-red-400">{battleReport.result.enemyFinal.total.toFixed(0)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Banner Overview */}
              {battleReport.bannerXP && (() => {
                const banner = banners.find(b => b.id === battleReport.bannerXP!.bannerId);
                const initialTroops = battleReport.result.playerInitial.total;
                const finalTroops = battleReport.result.playerFinal.total;
                const losses = initialTroops - finalTroops;
                const isDestroyed = finalTroops === 0;

                return (
                  <div className={`bg-slate-800 rounded-lg p-4 mb-4 border ${isDestroyed ? 'border-red-700' : 'border-slate-700'}`}>
                    <h3 className="text-sm font-semibold text-slate-300 mb-3">
                      Banner Overview: {battleReport.bannerXP.bannerName}
                    </h3>
                    {isDestroyed ? (
                      <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-3 mb-3">
                        <div className="text-red-400 font-bold text-sm">⚠️ Banner Destroyed</div>
                        <div className="text-xs text-red-300 mt-1">All units have been lost in battle.</div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-slate-400 text-xs mb-1">Initial Troops</div>
                            <div className="text-white font-semibold">{initialTroops.toFixed(0)}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs mb-1">Final Troops</div>
                            <div className="text-emerald-400 font-semibold">{finalTroops.toFixed(0)}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs mb-1">Losses</div>
                            <div className="text-red-400 font-semibold">-{losses.toFixed(0)}</div>
                          </div>
                        </div>
                        {banner && banner.squads && banner.squads.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-700">
                            <div className="text-slate-400 text-xs mb-2">Squad Status:</div>
                            <div className="space-y-1">
                              {banner.squads.map((squad, idx) => {
                                const squadLosses = squad.maxSize - squad.currentSize;
                                const squadDestroyed = squad.currentSize === 0;
                                return (
                                  <div key={squad.id || idx} className="flex items-center justify-between text-xs">
                                    <span className={squadDestroyed ? 'text-red-400 line-through' : 'text-slate-300'}>
                                      {unitDisplayNames[squad.type]} Squad
                                    </span>
                                    <div className="flex items-center gap-2">
                                      {squadDestroyed ? (
                                        <span className="text-red-400 font-semibold">Destroyed</span>
                                      ) : (
                                        <>
                                          <span className="text-slate-400">
                                            {squad.currentSize}/{squad.maxSize}
                                          </span>
                                          {squadLosses > 0 && (
                                            <span className="text-red-400">
                                              (-{squadLosses})
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Banner XP Display */}
              {battleReport.bannerXP && (
                <div className="bg-slate-800 rounded-lg p-4 mb-4 border border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Banner Experience: {battleReport.bannerXP.bannerName}
                  </h3>
                  <div className="space-y-3">
                    {/* XP Gained */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">XP Gained:</span>
                      <span className={`font-semibold ${battleReport.bannerXP.xpGained > 0 ? 'text-emerald-400' : battleReport.bannerXP.xpGained < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {battleReport.bannerXP.xpGained > 0 ? '+' : ''}{battleReport.bannerXP.xpGained.toLocaleString()} XP
                      </span>
                    </div>

                    {/* Level Up Indicator */}
                    {battleReport.bannerXP.newLevel > battleReport.bannerXP.oldLevel && (
                      <div className="bg-emerald-600/20 border border-emerald-500/50 rounded-lg p-3 mb-2">
                        <div className="text-emerald-400 font-bold text-sm mb-1">🎉 Level Up!</div>
                        <div className="text-xs text-slate-300">
                          <span className="text-slate-400">Lvl {battleReport.bannerXP.oldLevel} – {battleReport.bannerXP.oldLevelName}</span>
                          <span className="mx-2">→</span>
                          <span className="text-emerald-400 font-semibold">Lvl {battleReport.bannerXP.newLevel} – {battleReport.bannerXP.newLevelName}</span>
                        </div>
                      </div>
                    )}

                    {/* Level Down Indicator */}
                    {battleReport.bannerXP.newLevel < battleReport.bannerXP.oldLevel && (
                      <div className="bg-red-600/20 border border-red-500/50 rounded-lg p-3 mb-2">
                        <div className="text-red-400 font-bold text-sm mb-1">⚠️ Level Down</div>
                        <div className="text-xs text-slate-300">
                          <span className="text-slate-400">Lvl {battleReport.bannerXP.oldLevel} – {battleReport.bannerXP.oldLevelName}</span>
                          <span className="mx-2">→</span>
                          <span className="text-red-400 font-semibold">Lvl {battleReport.bannerXP.newLevel} – {battleReport.bannerXP.newLevelName}</span>
                        </div>
                      </div>
                    )}

                    {/* Current Level and XP Progress */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Current Level:</span>
                        <span className="text-blue-300 font-semibold">
                          Lvl {battleReport.bannerXP.newLevel} – {battleReport.bannerXP.newLevelName}
                        </span>
                      </div>

                      {/* XP Progress Bar */}
                      <div className="w-full">
                        <div className="h-2 rounded-full overflow-hidden bg-slate-700">
                          <div
                            className="h-full bg-blue-500 transition-all"
                            style={{
                              width: `${Math.max(0, Math.min(100, ((battleReport.bannerXP.newXP - battleReport.bannerXP.xpCurrentLevel) / (battleReport.bannerXP.xpNextLevel - battleReport.bannerXP.xpCurrentLevel || 1)) * 100))}%`
                            }}
                          />
                        </div>
                        <div className="text-xs text-slate-400 mt-1 text-right">
                          {battleReport.bannerXP.newXP.toLocaleString()} / {battleReport.bannerXP.xpNextLevel.toLocaleString()} XP
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Commander XP Display */}
              {battleReport.commanderXP && (
                <div className="bg-slate-800 rounded-lg p-4 mb-4 border border-blue-700">
                  <h3 className="text-sm font-semibold text-blue-300 mb-3">
                    Commander Experience: {battleReport.commanderXP.commanderName}
                  </h3>
                  <div className="space-y-3">
                    {/* XP Gained */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">XP Gained:</span>
                      <span className="font-semibold text-emerald-400">
                        +{battleReport.commanderXP.xpGained.toLocaleString()} XP
                      </span>
                    </div>

                    {/* Level Up Indicator */}
                    {battleReport.commanderXP.newLevel > battleReport.commanderXP.oldLevel && (
                      <div className="bg-emerald-600/20 border border-emerald-500/50 rounded-lg p-3 mb-2">
                        <div className="text-emerald-400 font-bold text-sm mb-1">🎉 Level Up!</div>
                        <div className="text-xs text-slate-300">
                          <span className="text-slate-400">Lv {battleReport.commanderXP.oldLevel}</span>
                          <span className="mx-2">→</span>
                          <span className="text-emerald-400 font-semibold">Lv {battleReport.commanderXP.newLevel}</span>
                        </div>
                      </div>
                    )}

                    {/* Current Level and XP Progress */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Current Level:</span>
                        <span className="text-blue-300 font-semibold">
                          Lv {battleReport.commanderXP.newLevel}
                        </span>
                      </div>

                      {/* XP Progress Bar */}
                      {battleReport.commanderXP.newLevel < 99 && (
                        <div className="w-full">
                          <div className="h-2 rounded-full overflow-hidden bg-slate-700">
                            <div
                              className="h-full bg-blue-500 transition-all"
                              style={{
                                width: `${Math.max(0, Math.min(100, (battleReport.commanderXP.newXP / battleReport.commanderXP.xpToNextLevel) * 100))}%`
                              }}
                            />
                          </div>
                          <div className="text-xs text-slate-400 mt-1 text-right">
                            {battleReport.commanderXP.newXP.toLocaleString()} / {battleReport.commanderXP.xpToNextLevel.toLocaleString()} XP
                          </div>
                        </div>
                      )}
                      {battleReport.commanderXP.newLevel >= 99 && (
                        <div className="text-xs text-amber-400 font-semibold">
                          Max Level Reached
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Battle Graph */}
              <div className="bg-slate-800 p-4 rounded-lg mb-4">
                <h3 className="font-semibold mb-2">Battle Graph</h3>
                <BattleChart timeline={battleReport.result.timeline} />
                <div className="flex flex-wrap gap-4 mt-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-[#6fb3ff]"></span>
                    <span className="text-slate-400">Player morale</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-[#ff8c00]"></span>
                    <span className="text-slate-400">Enemy morale</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-[#2d9cff]"></span>
                    <span className="text-slate-400">Player troops</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-[#ff5d5d]"></span>
                    <span className="text-slate-400">Enemy troops</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">Battle Timeline</h3>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left p-2">Tick</th>
                        <th className="text-left p-2">Phase</th>
                        <th className="text-right p-2">P Troops</th>
                        <th className="text-right p-2">E Troops</th>
                        <th className="text-right p-2">P Morale</th>
                        <th className="text-right p-2">E Morale</th>
                        <th className="text-right p-2">P→E</th>
                        <th className="text-right p-2">E→P</th>
                      </tr>
                    </thead>
                    <tbody>
                      {battleReport.result.timeline.map((row, i) => (
                        <tr key={i} className="border-b border-slate-700/50">
                          <td className="p-2">{row.tick}</td>
                          <td className="p-2">{row.phase}</td>
                          <td className="text-right p-2">{row.A_troops.toFixed(1)}</td>
                          <td className="text-right p-2">{row.B_troops.toFixed(1)}</td>
                          <td className="text-right p-2">{row.A_morale.toFixed(1)}</td>
                          <td className="text-right p-2">{row.B_morale.toFixed(1)}</td>
                          <td className="text-right p-2">{row.AtoB?.toFixed(2) || '—'}</td>
                          <td className="text-right p-2">{row.BtoA?.toFixed(2) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {(() => {
                const mission = missions.find(m => m.id === battleReport.missionId);
                const isCompleted = mission?.status === 'completedRewardsClaimed';
                const isRewardsPending = mission?.status === 'completedRewardsPending';
                const isVictory = battleReport.result.winner === 'player';

                if (isCompleted) {
                  return (
                    <button
                      onClick={() => setBattleReport(null)}
                      className="mt-4 w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold"
                    >
                      Back
                    </button>
                  );
                }

                if (!isVictory) {
                  // Player lost - no rewards, just close button
                  return (
                    <button
                      onClick={() => setBattleReport(null)}
                      className="mt-4 w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold"
                    >
                      Close
                    </button>
                  );
                }

                return (
                  <button
                    onClick={() => {
                      // Only show reward popup if player won and rewards haven't been claimed yet
                      if (isRewardsPending && mission?.enemyComposition) {
                        const enemyTotal = getEnemyTotal(mission.enemyComposition);
                        const { tier, rewards } = generateMissionRewards(enemyTotal);
                        setBattleReport(null);
                        setRewardPopup({ missionId: mission.id, tier, rewards });
                      } else {
                        setBattleReport(null);
                      }
                    }}
                    className="mt-4 w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold"
                  >
                    {isRewardsPending ? 'Continue' : 'Close'}
                  </button>
                );
              })()}
            </div>
          </div>
        )
      }

      {/* Reward Popup Modal */}
      {
        rewardPopup && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-slate-900 border-2 border-amber-600 rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl">
              <div className="text-center mb-6">
                <div className="text-6xl mb-4">{REWARD_TIERS[rewardPopup.tier as RewardTier].icon}</div>
                <h2 className="text-3xl font-bold text-amber-400 mb-2">
                  {REWARD_TIERS[rewardPopup.tier as RewardTier].name}
                </h2>
                <p className="text-slate-300 text-sm">
                  {REWARD_TIERS[rewardPopup.tier as RewardTier].flavor}
                </p>
              </div>

              {/* Rewards List */}
              <div className="bg-slate-800 rounded-lg p-4 mb-6 border border-slate-700">
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Rewards:</h3>
                <div className="space-y-2">
                  {(rewardPopup.rewards.gold || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-400">💰</span>
                        <span className="text-slate-300">Gold</span>
                      </div>
                      <span className="text-yellow-400 font-semibold">{formatInt(rewardPopup.rewards.gold || 0)}</span>
                    </div>
                  )}
                  {(rewardPopup.rewards.wood || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-600">🪵</span>
                        <span className="text-slate-300">Wood</span>
                      </div>
                      <span className="text-amber-400 font-semibold">{formatInt(rewardPopup.rewards.wood || 0)}</span>
                    </div>
                  )}
                  {(rewardPopup.rewards.stone || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">🪨</span>
                        <span className="text-slate-300">Stone</span>
                      </div>
                      <span className="text-slate-300 font-semibold">{formatInt(rewardPopup.rewards.stone || 0)}</span>
                    </div>
                  )}
                  {(rewardPopup.rewards.food || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-green-400">🌾</span>
                        <span className="text-slate-300">Food</span>
                      </div>
                      <span className="text-green-400 font-semibold">{formatInt(rewardPopup.rewards.food || 0)}</span>
                    </div>
                  )}
                  {(rewardPopup.rewards.iron || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">⚙️</span>
                        <span className="text-slate-300">Iron</span>
                      </div>
                      <span className="text-gray-300 font-semibold">{formatInt(rewardPopup.rewards.iron || 0)}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  // Add rewards to warehouse
                  setWarehouse((w) => ({
                    ...w,
                    gold: Math.min(warehouseCap.gold, w.gold + (rewardPopup.rewards.gold || 0)),
                    wood: Math.min(warehouseCap.wood, w.wood + (rewardPopup.rewards.wood || 0)),
                    stone: Math.min(warehouseCap.stone, w.stone + (rewardPopup.rewards.stone || 0)),
                    food: Math.min(warehouseCap.food, w.food + (rewardPopup.rewards.food || 0)),
                    iron: Math.min(warehouseCap.iron, w.iron + (rewardPopup.rewards.iron || 0)),
                  }));

                  // Mark mission as completedRewardsClaimed and store reward tier
                  setMissions((ms) => ms.map((m) =>
                    m.id === rewardPopup.missionId
                      ? { ...m, status: 'completedRewardsClaimed' as const, rewardTier: rewardPopup.tier, rewards: rewardPopup.rewards }
                      : m
                  ));

                  // Close popup
                  setRewardPopup(null);

                  // Save game after claiming rewards
                  saveGame();
                }}
                className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-bold text-lg text-white transition-colors shadow-lg"
              >
                Claim Rewards
              </button>
            </div>
          </div>
        )
      }



      {/* Delete Squad Confirmation Modal */}
      {
        deleteSquadModal && (() => {
          const banner = banners.find(b => b.id === deleteSquadModal.bannerId);
          if (!banner) return null;

          // Ensure squads are initialized
          let displaySquads = banner.squads;
          if (!displaySquads || displaySquads.length === 0) {
            const { squads } = initializeSquadsFromUnits(banner.units, squadSeqRef.current);
            displaySquads = squads;
          }

          const squad = displaySquads.find(s => s.id === deleteSquadModal.squadId);
          if (!squad) return null;

          // Calculate refunds (only for trained units)
          const category = unitCategory[squad.type];
          const config = squadConfig[category];
          const perUnitPop = config.reqPop / config.maxSize;
          const perUnitIron = (ironCostPerSquad[squad.type] || 0) / config.maxSize;
          const populationRefund = Math.floor(perUnitPop * squad.currentSize); // proportional to trained soldiers
          const ironRefund = Math.floor(perUnitIron * squad.currentSize * 0.5); // 50% of trained soldiers' iron cost

          return (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
              <div className="bg-slate-900 border-2 border-red-600 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
                <h4 className="text-lg font-semibold mb-4 text-red-400">Delete Squad</h4>
                <p className="text-sm text-slate-300 mb-4">
                  Are you sure you want to delete this squad from <strong>{banner.name}</strong>?
                </p>

                {/* Squad to delete */}
                <div className="bg-slate-800 rounded-lg p-3 mb-4 border border-slate-700">
                  <div className="text-xs font-semibold text-slate-400 mb-2">Squad to delete:</div>
                  <div className="flex flex-wrap gap-1">
                    <span className="px-2 py-1 rounded text-xs bg-red-900/50 border border-red-700 text-red-200">
                      {unitDisplayNames[squad.type]} Squad ({squad.currentSize}/{squad.maxSize})
                    </span>
                  </div>
                </div>

                {/* Refunds */}
                <div className="bg-slate-800 rounded-lg p-3 mb-4 border border-slate-700">
                  <div className="text-xs font-semibold text-slate-400 mb-2">Resources recovered:</div>
                  <div className="space-y-1 text-sm">
                    {populationRefund > 0 ? (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Population:</span>
                        <span className="text-green-400 font-semibold">+{populationRefund}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Population:</span>
                        <span className="text-slate-500 text-xs">No refund (squad is empty)</span>
                      </div>
                    )}
                    {ironRefund > 0 ? (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Iron (50%):</span>
                        <span className="text-gray-300 font-semibold">+{ironRefund}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Iron (50%):</span>
                        <span className="text-slate-500 text-xs">No refund (squad is empty)</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setDeleteSquadModal(null);
                    }}
                    className="flex-1 px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteSquad}
                    className="flex-1 px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-semibold"
                  >
                    Delete Squad
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      }

      {/* Assign Commander Modal - Available from any tab */}
      {
        commanderAssignModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 border border-slate-800">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">Assign Commander</h3>
                <button
                  onClick={() => setCommanderAssignModal(null)}
                  className="text-slate-400 hover:text-white text-2xl"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                {commanderAssignModal.bannerId
                  ? 'Select a commander to assign to this banner:'
                  : 'Select a banner to assign this commander to:'}
              </p>
              {commanderAssignModal.bannerId ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {commanders.filter(c => c.assignedBannerId === null).length === 0 ? (
                    <div className="space-y-3">
                      <p className="text-slate-400 text-sm">No available commanders. Recruit one first.</p>
                      <button
                        onClick={() => {
                          setCommanderAssignModal(null);
                          setMainTab('council');
                        }}
                        className="w-full px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                      >
                        Go to Council to Recruit Commander
                      </button>
                    </div>
                  ) : (
                    commanders.filter(c => c.assignedBannerId === null).map(commander => {
                      const config = COMMANDER_ARCHETYPES[commander.archetype];
                      return (
                        <button
                          key={commander.id}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (commanderAssignModal?.bannerId) {
                              assignCommanderToBanner(commander.id, commanderAssignModal.bannerId);
                            }
                          }}
                          className="w-full text-left px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
                        >
                          <div className="font-semibold">{commander.name}</div>
                          <div className="text-xs text-slate-400">{config.label}</div>
                          <div className="text-xs text-slate-300">
                            +{commander.rangedAttackBonusPercent}% ranged, +{commander.meleeAttackBonusPercent}% melee
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {banners.filter(b => !b.commanderId).map(banner => (
                    <button
                      key={banner.id}
                      onClick={() => {
                        if (commanderAssignModal.commanderId) {
                          assignCommanderToBanner(commanderAssignModal.commanderId, banner.id);
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
                    >
                      <div className="font-semibold">{banner.name}</div>
                      <div className="text-xs text-slate-400">
                        {banner.squads.length} squads • {banner.status}
                      </div>
                    </button>
                  ))}
                  {banners.filter(b => !b.commanderId).length === 0 && (
                    <p className="text-slate-400 text-sm">No banners available (all have commanders assigned)</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      }

      {/* Bottom Navigation - Mobile Only */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur border-t border-slate-800">
        <div className="grid grid-cols-5 gap-1 p-1">
          <button
            onClick={() => setMainTab('production')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'production'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">🏭</span>
            <span className="text-[10px] font-semibold">Buildings</span>
          </button>
          <button
            onClick={() => setMainTab('council')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'council'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">👥</span>
            <span className="text-[10px] font-semibold">Council</span>
          </button>
          <button
            onClick={() => {
              if (barracks && barracks.level >= 1) {
                setMainTab('army');
              }
            }}
            disabled={!barracks || barracks.level < 1}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${!barracks || barracks.level < 1
              ? 'bg-transparent text-slate-600 cursor-not-allowed opacity-50'
              : mainTab === 'army'
                ? 'bg-slate-800 text-white'
                : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
            title={!barracks || barracks.level < 1 ? 'Requires Barracks Level 1' : 'Army'}
          >
            <span className="text-lg">⚔️</span>
            <span className="text-[10px] font-semibold">Army</span>
          </button>
          <button
            onClick={() => setMainTab('missions')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'missions'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">📜</span>
            <span className="text-[10px] font-semibold">Missions</span>
          </button>
          <button
            onClick={() => setMainTab('expeditions')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'expeditions'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">🗺️</span>
            <span className="text-[10px] font-semibold">Expeditions</span>
          </button>
        </div>
        {/* Secondary row for additional tabs */}
        <div className="grid grid-cols-4 gap-1 p-1 border-t border-slate-800">
          <button
            onClick={() => setMainTab('leaderboard')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'leaderboard'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">🏆</span>
            <span className="text-[10px] font-semibold">Leaderboard</span>
          </button>
          <button
            onClick={() => setMainTab('factions')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'factions'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">⚡</span>
            <span className="text-[10px] font-semibold">Factions</span>
          </button>
          <button
            onClick={() => setBlacksmithOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] bg-transparent text-slate-400 active:bg-slate-800"
          >
            <span className="text-lg">🔨</span>
            <span className="text-[10px] font-semibold">Blacksmith</span>
          </button>
          <button
            onClick={() => setTechnologiesOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] bg-transparent text-slate-400 active:bg-slate-800"
          >
            <span className="text-lg">🔬</span>
            <span className="text-[10px] font-semibold">Tech</span>
          </button>
        </div>
      </div>

      {/* Bottom padding for mobile navigation */}
      <div className="md:hidden h-[140px]"></div>

      {/* Touch Overlay (Mobile Only) */}


    </div >
  );
}
