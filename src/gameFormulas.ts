// ============================================================================
// Zundral — Pure Game Formula Functions
// All stateless helper / formula functions extracted from the monolith.
// No React imports. No component state. Pure input → output.
// Import from here in components and feature modules.
// ============================================================================

import type {
  UnitType,
  TownHallLevel,
  Squad,
  Banner,
  BattleResult,
  Division,
  Commander,
  CommanderArchetype,
  PlayerFactionState,
} from './types';

import {
  PROGRESSION_FORMULA,
  WAREHOUSE_FORMULA,
  BUILDING_COST_SEED,
  BUILDING_COST_FACTOR,
  BUILDING_COST_TABLE,
  unitCategory,
  ironCostPerSquad,
  squadConfig,
  unitDisplayNames,
  XP_GAIN_PER_ENEMY_KILL,
  XP_GAIN_SURVIVAL_BONUS,
  XP_GAIN_VICTORY_BONUS,
  XP_LEVELS,
  BASE_COMMANDER_XP,
  COMMANDER_FIRST_NAMES,
  COMMANDER_TITLES,
} from './constants';

// Resource icon images (Vite resolves these at build time)
import rWood from '../imgs/resources/r_wood.png';
import rStone from '../imgs/resources/r_stone.png';
import rFood from '../imgs/resources/r_food.png';
import rIron from '../imgs/resources/r_iron.png';
import rGold from '../imgs/resources/r_gold.png';
import rPopulation from '../imgs/resources/r_population.png';
import rTaxes from '../imgs/resources/r_taxes.png';

// ----------------------------------------------------------------------------
// Resource Icons
// ----------------------------------------------------------------------------

/** Returns the resolved URL for a resource's icon image. */
export function getResourceIcon(label: string): string {
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
  return iconMap[label] || rPopulation;
}

// ----------------------------------------------------------------------------
// Building / Warehouse Production Formulas
// ----------------------------------------------------------------------------

/** Returns the production or capacity value for a resource building at a given level. */
export function getProgression(
  res: 'wood' | 'stone' | 'food' | 'iron',
  level: number,
  kind: 'production' | 'capacity',
): number {
  const { factors, base } = PROGRESSION_FORMULA as any;
  const l0 = Math.max(0, level - 1);
  if (kind === 'production') return base[res].production * Math.pow(factors.production, l0);
  if (kind === 'capacity') return base[res].capacity * Math.pow(factors.capacity, l0);
  return 0;
}

/**
 * Returns the wood/stone cost to upgrade a resource building from (levelTo-1) to levelTo.
 * Uses the exact BUILDING_COST_TABLE where available, falling back to the seed × factor formula.
 */
export function getBuildingCost(
  res: 'wood' | 'stone' | 'food' | 'iron',
  levelTo: number,
): { wood: number; stone: number } {
  // stepIndex 0 = L1→L2, stepIndex 1 = L2→L3, etc.
  const stepIndex = Math.max(0, levelTo - 2);
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

/** Returns the per-resource storage capacity of the warehouse at a given level. */
export function getWarehouseCapacity(level: number): number {
  const l0 = Math.max(0, level - 1);
  return WAREHOUSE_FORMULA.base.capacityPerType * Math.pow(WAREHOUSE_FORMULA.factors.capacity, l0);
}

/** Returns the wood/stone cost to upgrade the warehouse from (levelTo-1) to levelTo. */
export function getWarehouseCost(levelTo: number): { wood: number; stone: number } {
  const l0 = Math.max(0, levelTo - 1);
  return {
    wood: Math.round(WAREHOUSE_FORMULA.base.costWood * Math.pow(WAREHOUSE_FORMULA.factors.cost, l0)),
    stone: Math.round(WAREHOUSE_FORMULA.base.costStone * Math.pow(WAREHOUSE_FORMULA.factors.cost, l0)),
  };
}

// ----------------------------------------------------------------------------
// Unit Cost Helpers
// ----------------------------------------------------------------------------

/** Returns the iron cost per individual soldier for a given unit type. */
export function getIronCostPerUnit(unitType: UnitType): number {
  const category = unitCategory[unitType];
  const config = squadConfig[category];
  const squadCost = ironCostPerSquad[unitType];
  return squadCost / config.maxSize;
}

// ----------------------------------------------------------------------------
// Banner XP / Level System
// ----------------------------------------------------------------------------

/** Computes level info from a raw XP value. */
export function calculateLevelFromXP(xp: number): {
  level: number;
  levelName: string;
  xpCurrentLevel: number;
  xpNextLevel: number;
} {
  let level = 0;
  let levelName = 'Green';
  let xpCurrentLevel = 0;
  let xpNextLevel = 100;

  for (let i = XP_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= XP_LEVELS[i].minXP) {
      level = XP_LEVELS[i].level;
      levelName = XP_LEVELS[i].name;
      xpCurrentLevel = XP_LEVELS[i].minXP;
      xpNextLevel = i < XP_LEVELS.length - 1
        ? XP_LEVELS[i + 1].minXP
        : XP_LEVELS[i].minXP + 1000; // cap past max level
      break;
    }
  }

  return { level, levelName, xpCurrentLevel, xpNextLevel };
}

/** Returns the XP-smoothing factor for a given banner level (0–5). */
export function getXpSmoothingForLevel(level: number): number {
  const levelInfo = XP_LEVELS.find(l => l.level === level);
  return levelInfo ? levelInfo.smoothing : 0.0;
}

/** Returns the minimum XP threshold for a given banner level. */
export function getMinXPForLevel(level: number): number {
  const levelInfo = XP_LEVELS.find(l => l.level === level);
  return levelInfo ? levelInfo.minXP : 0;
}

// ----------------------------------------------------------------------------
// Commander XP / Level System
// ----------------------------------------------------------------------------

/** XP required to reach the next level from level N. Formula: BASE * 1.2^(N-1). */
export function calculateCommanderXPToNextLevel(level: number): number {
  if (level < 1) return BASE_COMMANDER_XP;
  if (level >= 99) return Infinity;
  return Math.floor(BASE_COMMANDER_XP * Math.pow(1.2, level - 1));
}

/**
 * Returns an updated Commander after applying xpGained, handling level-ups.
 * Pure: accepts and returns plain objects; no React state.
 */
export function updateCommanderXP(commander: Commander, xpGained: number): Commander {
  let currentLevel = commander.level || 1;
  let currentXP = (commander.currentXP || 0) + xpGained;
  currentXP = Math.max(0, currentXP);

  while (currentLevel < 99) {
    const xpNeeded = calculateCommanderXPToNextLevel(currentLevel);
    if (currentXP >= xpNeeded) {
      currentXP -= xpNeeded;
      currentLevel++;
    } else {
      break;
    }
  }

  if (currentLevel > 99) {
    currentLevel = 99;
    currentXP = 0;
  }

  const xpToNextLevel = currentLevel < 99 ? calculateCommanderXPToNextLevel(currentLevel) : Infinity;

  return {
    ...commander,
    level: currentLevel,
    currentXP: Math.floor(currentXP),
    xpToNextLevel,
  };
}

/**
 * Per-level attack bonus multiplier for commanders.
 * Level 1 = 1.00, Level 2 = 1.01, Level 3 = 1.02, …
 */
export function getCommanderLevelBonusMultiplier(level: number): number {
  return 1 + 0.01 * (level - 1);
}

/** Calculates total banner XP gain (before applying loss) from a battle. */
export function calculateBannerXPGain(
  enemyCasualties: number,
  victory: boolean,
  survived: boolean,
): number {
  let xpGain = enemyCasualties * XP_GAIN_PER_ENEMY_KILL;
  if (survived) xpGain += XP_GAIN_SURVIVAL_BONUS;
  if (victory) xpGain += XP_GAIN_VICTORY_BONUS;
  return xpGain;
}

/**
 * Returns an updated Banner after applying XP changes from a battle.
 * Handles gain, casualty-based loss, level-up/drop protection, and Legendary floor.
 * Pure: no React state.
 */
export function updateBannerXP(
  banner: Banner,
  enemyCasualties: number,
  ownCasualties: number,
  startTroops: number,
  victory: boolean,
  survived: boolean,
): Banner {
  let currentXP = banner.xp || 0;
  const currentLevel = banner.level ?? calculateLevelFromXP(currentXP).level;

  // Step 1: XP Gain
  currentXP += enemyCasualties * XP_GAIN_PER_ENEMY_KILL;
  if (survived) currentXP += XP_GAIN_SURVIVAL_BONUS;
  if (victory) currentXP += XP_GAIN_VICTORY_BONUS;

  // Step 2: XP Loss (based on casualty rate)
  if (startTroops > 0) {
    const casualtyRate = ownCasualties / startTroops;
    const smoothing = getXpSmoothingForLevel(currentLevel);
    const xpLossRatio = casualtyRate * (1 - smoothing);
    currentXP = currentXP * (1 - xpLossRatio);
  }

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

  // Legendary floor
  if (currentLevel === 5 && !isAnnihilated && newLevel < 4) {
    newLevel = 4;
    currentXP = getMinXPForLevel(newLevel);
  }

  const finalCalc = calculateLevelFromXP(currentXP);

  return {
    ...banner,
    xp: currentXP,
    level: finalCalc.level,
    xpCurrentLevel: finalCalc.xpCurrentLevel,
    xpNextLevel: finalCalc.xpNextLevel,
  };
}

// ----------------------------------------------------------------------------
// Building Costs — Non-resource buildings
// ----------------------------------------------------------------------------

/** Cost to upgrade a House from (levelTo-1) to levelTo. */
export function getHouseCost(levelTo: number): { wood: number; stone: number } {
  if (levelTo === 2) return { wood: 130, stone: 110 };
  const base = { wood: 130, stone: 110 };
  const factor = Math.pow(1.3, levelTo - 2);
  return {
    wood: Math.ceil(base.wood * factor),
    stone: Math.ceil(base.stone * factor),
  };
}

/** Returns population capacity provided by a House at `level`. */
export function getHouseCapacity(level: number): number {
  return 5 * level; // +5 capacity per level
}

/** Cost to upgrade the Town Hall from (levelTo-1) to levelTo. */
export function getTownHallCost(levelTo: number): { wood: number; stone: number } {
  if (levelTo === 2) return { wood: 200, stone: 150 };
  if (levelTo === 3) return { wood: 300, stone: 250 };
  return { wood: 0, stone: 0 };
}

/** Cost to upgrade the Barracks from (levelTo-1) to levelTo (30% per level). */
export function getBarracksCost(levelTo: number): { wood: number; stone: number } {
  const base = { wood: 150, stone: 100 };
  const factor = Math.pow(1.3, levelTo - 1);
  return {
    wood: Math.ceil(base.wood * factor),
    stone: Math.ceil(base.stone * factor),
  };
}

/** Initial (L0→L1) build cost for the Barracks. */
export function getBarracksBuildCost(): { wood: number; stone: number } {
  return { wood: 150, stone: 100 };
}

/** Cost to upgrade the Military Academy from (levelTo-1) to levelTo (exactly 2× Barracks cost). */
export function getMilitaryAcademyCost(levelTo: number): { wood: number; stone: number } {
  const barracksCost = getBarracksCost(levelTo);
  return {
    wood: barracksCost.wood * 2,
    stone: barracksCost.stone * 2,
  };
}

/** Initial (L0→L1) build cost for the Military Academy. */
export function getMilitaryAcademyBuildCost(): { wood: number; stone: number } {
  return getMilitaryAcademyCost(1);
}

/** Returns true when the Town Hall is at a level that permits building a Military Academy. */
export function canBuildMilitaryAcademy(townHallLevel: TownHallLevel): boolean {
  return townHallLevel >= 2;
}

/** Cost to upgrade the Tavern from (levelTo-1) to levelTo (30% per level). */
export function getTavernCost(levelTo: number): { wood: number; stone: number } {
  const base = { wood: 120, stone: 80 };
  const factor = Math.pow(1.3, levelTo - 1);
  return {
    wood: Math.ceil(base.wood * factor),
    stone: Math.ceil(base.stone * factor),
  };
}

/** Initial (L0→L1) build cost for the Tavern. */
export function getTavernBuildCost(): { wood: number; stone: number } {
  return { wood: 120, stone: 80 };
}

/** Returns true when the Town Hall is at a level that permits building a Barracks. */
export function canBuildBarracks(townHallLevel: TownHallLevel): boolean {
  return townHallLevel >= 2;
}

/** Returns true when the Town Hall is at a level that permits building a Tavern. */
export function canBuildTavern(townHallLevel: TownHallLevel): boolean {
  return townHallLevel >= 2;
}

/** Returns the maximum number of simultaneous training slots for a given Barracks level. */
export function getMaxTrainingSlots(barracksLevel: number): number {
  return Math.min(barracksLevel, 3);
}

// ----------------------------------------------------------------------------
// Squad Health Visualisation
// ----------------------------------------------------------------------------

export type SquadHealthState = 'healthy' | 'yellow' | 'orange' | 'red' | 'destroyed';

/** Maps a squad's troop count to a colour-coded health tier. */
export function getSquadHealthState(currentSize: number, maxSize: number): SquadHealthState {
  if (currentSize === 0) return 'destroyed';
  if (currentSize === maxSize) return 'healthy';
  const ratio = currentSize / maxSize;
  if (ratio >= 0.7) return 'yellow';  // 7–9 out of 10
  if (ratio >= 0.4) return 'orange';  // 4–6 out of 10
  return 'red';                        // 1–3 out of 10
}

/** Returns the Tailwind class string for a squad's health state. */
export function getSquadColorClass(health: SquadHealthState): string {
  switch (health) {
    case 'healthy':   return 'bg-slate-800 border-slate-700 text-slate-300';
    case 'yellow':    return 'bg-yellow-900/30 border-yellow-600 text-yellow-300';
    case 'orange':    return 'bg-orange-900/30 border-orange-600 text-orange-300';
    case 'red':       return 'bg-red-900/30 border-red-600 text-red-300';
    case 'destroyed': return 'bg-red-950/50 border-red-800 text-red-400 opacity-60';
    default:          return 'bg-slate-800 border-slate-700';
  }
}

// ----------------------------------------------------------------------------
// Squad Initialisation
// ----------------------------------------------------------------------------

/** Converts a legacy `units` string-array into a typed Squad array. */
export function initializeSquadsFromUnits(
  units: string[],
  squadSeq: number,
  startEmpty: boolean = false,
): { squads: Squad[]; nextSeq: number } {
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
      slotIndex: idx,
    });
  });
  return { squads, nextSeq: seq };
}

// ----------------------------------------------------------------------------
// Battle Loss Distribution
// ----------------------------------------------------------------------------

/** Distributes `totalLosses` soldiers evenly across all squads in a banner. Returns updated Banner. */
export function distributeLossesToBanner(banner: Banner, totalLosses: number): Banner {
  if (totalLosses <= 0 || banner.squads.length === 0) return banner;

  const squads = banner.squads.map(s => ({ ...s }));
  let remainingLosses = totalLosses;
  const totalCurrentSize = squads.reduce((sum, s) => sum + s.currentSize, 0);

  if (remainingLosses >= totalCurrentSize) {
    return { ...banner, squads: squads.map(s => ({ ...s, currentSize: 0 })) };
  }

  // Soft cap: 33% of total losses per squad
  const softCap = Math.max(1, Math.floor(totalLosses * 0.33));

  // First pass: 1 loss to each surviving squad
  const availableSquads = squads.filter(s => s.currentSize > 0);
  const firstPassLosses = Math.min(availableSquads.length, remainingLosses);
  for (let i = 0; i < firstPassLosses; i++) {
    if (availableSquads[i].currentSize > 0) {
      availableSquads[i].currentSize = Math.max(0, availableSquads[i].currentSize - 1);
      remainingLosses--;
    }
  }

  // Second pass: distribute remaining losses randomly
  while (remainingLosses > 0) {
    const eligibleSquads = squads.filter(s => {
      const lossesTaken = s.maxSize - s.currentSize;
      return s.currentSize > 0 && lossesTaken < softCap;
    });

    if (eligibleSquads.length === 0) {
      const remainingSquads = squads.filter(s => s.currentSize > 0);
      if (remainingSquads.length === 0) break;
      const randomSquad = remainingSquads[Math.floor(Math.random() * remainingSquads.length)];
      randomSquad.currentSize = Math.max(0, randomSquad.currentSize - 1);
      remainingLosses--;
    } else {
      const randomSquad = eligibleSquads[Math.floor(Math.random() * eligibleSquads.length)];
      randomSquad.currentSize = Math.max(0, randomSquad.currentSize - 1);
      remainingLosses--;
    }
  }

  const newRecruited = squads.reduce((sum, s) => sum + s.currentSize, 0);
  return { ...banner, squads, recruited: newRecruited };
}

/** Returns the total troop losses for a banner from a BattleResult. */
export function calculateBannerLosses(_banner: Banner, battleResult: BattleResult): number {
  const initialTotal = battleResult.playerInitial.total;
  const finalTotal = battleResult.playerFinal.total;
  return Math.max(0, Math.floor(initialTotal - finalTotal));
}

type LossEntry = { bannerId: number; count: number };

/**
 * Proportionally allocates `totalLosses` across banners.
 * Returns a Map<bannerId, lossesTaken>.
 */
export function distributeTypeLossesAcrossBanners(
  entries: LossEntry[],
  totalLosses: number,
): Map<number, number> {
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

/** Applies losses of a specific unit type evenly across matching squads (mutates squads array). */
export function trimSquadsByType(squads: Squad[], type: UnitType, losses: number): void {
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

/** Distributes all losses in a Division object across squads by unit type (mutates squads array). */
export function distributeDivisionLossesToSquads(squads: Squad[], losses: Division): void {
  for (const unitType in losses) {
    const typeLosses = losses[unitType as UnitType] || 0;
    if (typeLosses > 0) {
      trimSquadsByType(squads, unitType as UnitType, typeLosses);
    }
  }
}

// ----------------------------------------------------------------------------
// Display / Formatting Utilities
// ----------------------------------------------------------------------------

/** Returns an ordinal suffix string, e.g. 1 → "1st", 2 → "2nd", 11 → "11th". */
export function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Returns 'Warrior', 'Archer', or 'Mixed' based on the dominant squad type. */
export function getBannerRole(squads: Squad[]): string {
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

/** Returns a human-readable composition string, e.g. "3 Shieldmen, 2 Archers". */
export function getBannerComposition(squads: Squad[]): string {
  if (squads.length === 0) return '';

  const counts: Record<string, number> = {};
  squads.forEach(squad => {
    const typeName = unitDisplayNames[squad.type] || squad.type;
    counts[typeName] = (counts[typeName] || 0) + 1;
  });

  const entries = Object.entries(counts)
    .filter(([_, count]) => count > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });

  return entries.map(([type, count]) => `${count} ${type}`).join(', ');
}

/** Generates a random commander name based on the archetype. */
export function generateCommanderName(_archetype: CommanderArchetype): string {
  const firstName = COMMANDER_FIRST_NAMES[Math.floor(Math.random() * COMMANDER_FIRST_NAMES.length)];
  const title = COMMANDER_TITLES[Math.floor(Math.random() * COMMANDER_TITLES.length)];
  return `${title} ${firstName}`;
}

/** Generates a default banner name from its ID and squad composition. */
export function generateBannerName(bannerId: number, squads: Squad[]): string {
  const ordinal = getOrdinal(bannerId);
  const role = getBannerRole(squads);
  const composition = getBannerComposition(squads);
  return `${ordinal} ${role} Banner${composition ? ` (${composition})` : ''}`;
}

// ----------------------------------------------------------------------------
// Faction Perk Logic
// ----------------------------------------------------------------------------

/**
 * Returns true if the player can unlock the perk identified by nodeId.
 * Pure: accepts plain PlayerFactionState; returns bool.
 */
export function canUnlockPerk(state: PlayerFactionState, nodeId: string): boolean {
  const node = state.perks[nodeId];
  if (!node || node.unlocked) return false;

  const hasEnoughFP = node.faction === 'Alsus'
    ? state.alsusUnspentFP >= node.costFP
    : state.atroxUnspentFP >= node.costFP;

  if (!hasEnoughFP) return false;

  // All lower tiers in the same branch must be unlocked first
  for (let tier = 1; tier < node.tier; tier++) {
    const lowerNodeId = `${node.branchId}_T${tier}`;
    const lowerNode = state.perks[lowerNodeId];
    if (!lowerNode || !lowerNode.unlocked) return false;
  }

  return true;
}
