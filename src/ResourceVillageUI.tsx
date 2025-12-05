import React, { useEffect, useMemo, useState, useRef } from "react";
import BlacksmithUI from './BlacksmithUI';
import TechnologiesUI from './TechnologiesUI';
import LeaderboardUI from './LeaderboardUI';
import { persistence, simulateOfflineProgression, createDefaultGameState, GameState } from './persistence';
import { updateLeaderboardFromBattleResult, recalculateRanksAndTitles, createPlaceholderLeaderboard, type LeaderboardEntry, type BattleResult as LeaderboardBattleResult, type Faction } from './leaderboard';

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
  food:  { wood: 105, stone: 53 }, // Farm L1→2
  iron:  { wood: 27, stone: 67 },  // Iron Mine L1→2 (swapped from Lumber Mill: wood↔stone)
};
const BUILDING_COST_FACTOR = 1.5;

// Exact per-level cost table for Lumber (from spreadsheet screenshots)
// Index 0 is cost to go from L1→L2, index 1 is L2→L3, etc.
const BUILDING_COST_TABLE: Partial<Record<"wood"|"stone"|"food"|"iron", { wood: number[]; stone: number[] }>> = {
  wood: {
    wood: [67, 101, 151, 226, 339, 509, 763, 1145, 1717, 2576],
    stone:[27,  41,  61,  91, 137, 205, 308,  463,  692, 1038],
  },
  iron: {
    // Iron Mine costs: swapped from Lumber Mill (wood↔stone)
    wood: [27,  41,  61,  91, 137, 205, 308,  463,  692, 1038],
    stone:[67, 101, 151, 226, 339, 509, 763, 1145, 1717, 2576],
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

type Squad = {
  id: number;
  type: 'warrior' | 'archer';
  maxSize: number;
  currentSize: number;
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
  enemyComposition?: { warrior: number; archer: number }; // For combat missions
  battleResult?: BattleResult; // Store battle result
  rewards?: { gold?: number; wood?: number; stone?: number; food?: number; iron?: number }; // Stored rewards
  rewardTier?: string; // Reward tier name (e.g., "Scout's Cache")
  cooldownEndTime?: number; // UTC timestamp when cooldown ends
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
  units.forEach((unit) => {
    squads.push({
      id: seq++,
      type: unit as 'warrior' | 'archer',
      maxSize: 10,
      currentSize: startEmpty ? 0 : 10
    });
  });
  return { squads, nextSeq: seq };
}

// Distribute losses across all squads in a banner
function distributeLossesToBanner(banner: Banner, totalLosses: number): Banner {
  if (totalLosses <= 0 || banner.squads.length === 0) return banner;
  
  const squads = banner.squads.map(s => ({ ...s })); // Deep copy
  const numSquads = squads.length;
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
  
  return {
    ...banner,
    squads: squads
  };
}

// Calculate total losses for a banner from battle result
function calculateBannerLosses(
  banner: Banner, 
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

function trimSquadsByType(squads: Squad[], type: 'warrior' | 'archer', losses: number) {
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
  }, [timeline]);

  return (
    <canvas 
      ref={canvasRef}
      className="w-full h-[300px] bg-[#0b0e12] border border-slate-700 rounded-lg"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

// Graph drawing functions (defined outside component for reuse)
function drawSiegeGraph(canvas: HTMLCanvasElement, timeline: SiegeRound[], fortHPmax: number) {
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
}

function drawInnerBattleGraph(canvas: HTMLCanvasElement, timeline: InnerBattleStep[]) {
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
}

// Graph canvas components
function SiegeGraphCanvas({ timeline, fortHPmax }: { timeline: SiegeRound[]; fortHPmax: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && timeline.length > 0) {
      // Small delay to ensure canvas is properly sized
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawSiegeGraph(canvasRef.current, timeline, fortHPmax);
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [timeline, fortHPmax]);

  if (timeline.length === 0) return null;

  return (
    <details className="mt-3 pt-3 border-t border-slate-700">
      <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
        Siege Graph
      </summary>
      <div className="mt-2">
        <canvas 
          ref={canvasRef}
          className="w-full h-[220px] bg-slate-950 border border-slate-700 rounded-lg"
          style={{ imageRendering: 'crisp-edges' }}
        />
        <div className="text-[10px] text-slate-400 mt-1">
          Blue line = Fort HP. Red line = remaining attackers.
        </div>
      </div>
    </details>
  );
}

function InnerBattleGraphCanvas({ timeline }: { timeline: InnerBattleStep[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && timeline.length > 0) {
      // Small delay to ensure canvas is properly sized
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawInnerBattleGraph(canvasRef.current, timeline);
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [timeline]);

  if (timeline.length === 0) return null;

  return (
    <details className="mt-3 pt-3 border-t border-slate-700">
      <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
        Inner Battle Graph
      </summary>
      <div className="mt-2">
        <canvas 
          ref={canvasRef}
          className="w-full h-[220px] bg-slate-950 border border-slate-700 rounded-lg"
          style={{ imageRendering: 'crisp-edges' }}
        />
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
    const typeName = squad.type === 'warrior' ? 'Warrior' : 'Archer';
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
  
  // === Happiness System ===
  const [happiness, setHappiness] = useState(50); // Base 50
  
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
  const [mainTab, setMainTab] = useState<'production' | 'army' | 'missions' | 'expeditions' | 'leaderboard' | 'factions'>('production');
  const [armyTab, setArmyTab] = useState<'banners'>('banners');

  // Ensure army tab is only accessible when barracks is built
  useEffect(() => {
    if (mainTab === 'army' && (!barracks || barracks.level < 1)) {
      setMainTab('production');
    }
  }, [mainTab, barracks]);

  // === Army / Banners builder state ===
  const [draftSquads, setDraftSquads] = useState<string[]>([]); // 'archer' | 'warrior' (each is a squad)
  const [banners, setBanners] = useState<Banner[]>([]);
  const [bannerSeq, setBannerSeq] = useState(1);
  const [squadSeq, setSquadSeq] = useState(1); // Global squad ID counter
  const squadSeqRef = useRef(1); // Ref to track current squadSeq for closures
  const [bannerLossNotices, setBannerLossNotices] = useState<BannerLossNotice[]>([]);
  
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
  const [battleReport, setBattleReport] = useState<{ missionId: number; result: BattleResult } | null>(null);
  const [rewardPopup, setRewardPopup] = useState<{ missionId: number; tier: string; rewards: { gold?: number; wood?: number; stone?: number; food?: number; iron?: number } } | null>(null);
  const [blacksmithOpen, setBlacksmithOpen] = useState(false);
  const [technologiesOpen, setTechnologiesOpen] = useState(false);
  const [deleteBannerModal, setDeleteBannerModal] = useState<number | null>(null); // Banner ID to delete
  const [reinforcementModal, setReinforcementModal] = useState<{ bannerId: number; squadId: number; goldCost: number; soldiersNeeded: number; bannerName: string; squadType: string } | null>(null);
  const [hireAndRefillModal, setHireAndRefillModal] = useState<{ bannerId: number; hireCost: number; refillCost: number; totalCost: number; bannerName: string } | null>(null);
  const [siegeAttackModal, setSiegeAttackModal] = useState<{ expeditionId: string; attackers: number } | null>(null);
  const [editingBannerName, setEditingBannerName] = useState<number | null>(null); // Banner ID being edited
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
      
      banners: banners.map(b => ({
        id: b.id,
        name: b.name,
        units: b.units,
        squads: b.squads,
        status: b.status,
        reqPop: b.reqPop,
        recruited: b.recruited,
        type: b.type,
        reinforcingSquadId: b.reinforcingSquadId,
        trainingPaused: b.trainingPaused,
        customNamed: b.customNamed || false,
      })),
      bannerSeq,
      squadSeq,
      bannerLossNotices,
      
      missions: missions.map(m => ({
        id: m.id,
        name: m.name,
        description: m.description,
        duration: m.duration,
        status: m.status,
        staged: m.staged,
        deployed: m.deployed,
        elapsed: m.elapsed,
        enemyComposition: m.enemyComposition,
        battleResult: m.battleResult,
        startTime: m.startTime,
        rewards: m.rewards,
        rewardTier: m.rewardTier,
        cooldownEndTime: m.cooldownEndTime,
        isNew: m.isNew,
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
    setTownHall(state.townHall);
    setBarracks(state.barracks);
    setTavern(state.tavern);
    
    setBanners(state.banners.map(b => ({
      ...b,
      units: b.units || [],
      squads: b.squads || [],
    })));
    setBannerSeq(state.bannerSeq);
    setSquadSeq(state.squadSeq);
    setBannerLossNotices(state.bannerLossNotices);
    
    // Load missions from save, ensuring we always have exactly 3
    if (state.missions && state.missions.length > 0) {
      const loadedMissions = state.missions.map(m => {
        // Migrate old "complete" status to new statuses
        let status = m.status;
        if (status === 'complete') {
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
      if (!exp.fortress) return exp;
      
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
    
    setMainTab(state.mainTab);
    setArmyTab(state.armyTab);
    
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

  // Set up auto-save
  useEffect(() => {
    persistence.startAutoSave(() => serializeGameState());
    return () => {
      persistence.stopAutoSave();
    };
  }, [
    warehouse, warehouseLevel, skillPoints,
    population, recruitmentMode, tax, happiness,
    lumberMill, quarry, farm, ironMine, house, townHall, barracks, tavern,
    banners, bannerSeq, squadSeq, bannerLossNotices,
    missions, expeditions,
    mainTab, armyTab, leaderboard,
  ]);

  // Save on critical actions (manual save triggers)
  function saveGame() {
    persistence.saveState(serializeGameState());
  }

  // Reset game
  function resetGame() {
    if (confirm('Are you sure you want to reset the game? All progress will be lost.')) {
      const defaultState = persistence.resetState();
      loadGameState(defaultState);
      window.location.reload(); // Reload to ensure clean state
    }
  }

  // === Army helpers ===
  function addSquad(t: 'archer' | 'warrior') {
    setDraftSquads((s) => (s.length >= 8 ? s : [...s, t]));
  }
  function removeLastSquad() { setDraftSquads((s) => s.slice(0, -1)); }
  function clearDraft() { setDraftSquads([]); }
  function confirmBanner() {
    if (draftSquads.length === 0) return;
    
    // Initialize squads with health tracking - start empty (0/10) since banner hasn't been trained yet
    const { squads, nextSeq } = initializeSquadsFromUnits(draftSquads, squadSeq, true);
    
    // Generate auto-name based on composition
    const autoName = generateBannerName(bannerSeq, squads);
    
    const next: Banner = {
      id: bannerSeq,
      name: autoName,
      units: draftSquads, // Keep for backward compatibility
      squads: squads,
      status: 'idle',
      reqPop: 10 * draftSquads.length, // 10 pop per squad
      recruited: 0,
      type: 'regular', // Men-at-arms are regular banners
      customNamed: false, // Auto-generated name
    };
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

  function finishEditingBannerName(bannerId: number) {
    setEditingBannerName(null);
    saveGame();
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
      if (b.id === id && b.status === 'idle') {
        // Reset all squads to 0/10 when training starts
        const resetSquads = b.squads.map(s => ({ ...s, currentSize: 0 }));
        return { ...b, status: 'training', squads: resetSquads, recruited: 0, trainingPaused: false };
      }
      return b;
    }));
  }

  function toggleTrainingPause(id: number) {
    setBanners((bs) => bs.map((b) => {
      if (b.id === id && b.status === 'training') {
        return { ...b, trainingPaused: !b.trainingPaused };
      }
      return b;
    }));
  }

  function confirmDeleteBanner() {
    if (deleteBannerModal === null) return;
    const id = deleteBannerModal;
    
    setBanners((bs) => {
      const banner = bs.find(b => b.id === id);
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
      
      return bs.filter(b => b.id !== id);
    });
    
    setDeleteBannerModal(null);
  }

  function deleteBanner(id: number) {
    setDeleteBannerModal(id);
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
    if (!mission || mission.status !== 'complete') return;
    
    // Calculate rewards if missing (retroactive for missions completed before rewards system)
    let rewards = mission.rewards;
    if (!rewards) {
      const enemyTotal = mission.enemyComposition ? mission.enemyComposition.warrior + mission.enemyComposition.archer : 0;
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
    setExpeditions((exps) => exps.map((exp) => {
      if (exp.expeditionId !== expeditionId || !exp.fortress) return exp;
      
      const building = exp.fortress.buildings.find(b => b.id === buildingId);
      if (!building || building.level >= building.maxLevel) return exp;

      const nextLevel = building.level + 1;
      const cost = building.getUpgradeCost(nextLevel);
      
      // Check if player has enough resources
      if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return exp;

      // Deduct resources
      setWarehouse(w => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));

      // Upgrade building
      const updatedBuildings = exp.fortress.buildings.map(b =>
        b.id === buildingId ? { ...b, level: nextLevel } : b
      );

      // Recalculate stats
      const stats = calculateFortressStats(updatedBuildings);

      return {
        ...exp,
        fortress: {
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

      const updatedBanner: Banner = {
        ...banner,
        squads: banner.squads.map(squad => ({ ...squad })),
      };

      trimSquadsByType(updatedBanner.squads, 'warrior', losses.warriors || 0);
      trimSquadsByType(updatedBanner.squads, 'archer', losses.archers || 0);

      const totalRemaining = updatedBanner.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
      const totalLossesForBanner = (losses.warriors || 0) + (losses.archers || 0);

      if (totalRemaining <= 0) {
        destroyedIds.push(updatedBanner.id);
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

      next.push(updatedBanner);
      return next;
    }, []);

    // Update banners state
    setBanners(updatedBanners);

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
  function requestReinforcement(bannerId: number, squadId: number) {
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
    
    const squad = bannerWithSquads.squads.find(s => s.id === squadId);
    if (!squad) return;
    
    const missing = squad.maxSize - squad.currentSize;
    if (missing <= 0) return;
    
    // Handle mercenary vs regular banners differently
    if (banner.type === 'mercenary') {
      // Mercenary: Show internal confirmation modal
      if (!barracks) return;
      
      const goldCost = missing;
      setReinforcementModal({
        bannerId,
        squadId,
        goldCost,
        soldiersNeeded: missing,
        bannerName: banner.name,
        squadType: squad.type === 'archer' ? 'Archer' : 'Warrior'
      });
      return;
    } else {
      // Regular banner: Use normal training system (status: 'training')
      // Check if banner is already training
      if (banner.status === 'training') {
        // Already training, can't add another reinforcement
        return;
      }
      
      // Set banner to training status and set recruited to current size
      // The game loop will consume population and increase recruited until it reaches maxSize
      setBanners((bs) => bs.map(b => {
        if (b.id !== bannerId) return b;
        
        // Ensure squads are initialized
        let displaySquads = b.squads;
        if (!displaySquads || displaySquads.length === 0) {
          const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
          displaySquads = squads;
        }
        
        // Find the squad being reinforced
        const targetSquad = displaySquads.find(s => s.id === squadId);
        if (!targetSquad) return b;
        
        // Set recruited to current size, reqPop to maxSize
        // The game loop will train until recruited reaches reqPop (which equals maxSize)
        // Store the squadId being reinforced so we can update the correct squad
        return {
          ...b,
          status: 'training',
          recruited: targetSquad.currentSize,
          reqPop: targetSquad.maxSize, // Train until we reach maxSize
          reinforcingSquadId: squadId, // Track which squad is being reinforced
          squads: displaySquads
        };
      }));
    }
  }

  // === Battle Simulation Functions ===
  // Unit stats state (can be updated with tested values from simulator)
  const [unitStats, setUnitStats] = useState(() => {
    // Load from localStorage if available, otherwise use defaults
    const saved = localStorage.getItem('gameUnitStats');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved unit stats, using defaults');
      }
    }
    return {
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
      }
    };
  });

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

  function total(div: { warrior: number; archer: number }) {
    return Math.max(0, (div.warrior || 0) + (div.archer || 0));
  }

  function morale(div: { warrior: number; archer: number }, stats: any) {
    return per100(div.warrior) * stats.warrior.morale_per_100 + per100(div.archer) * stats.archer.morale_per_100;
  }

  function phaseStats(division: { warrior: number; archer: number }, stats: any, phase: string) {
    let EA = 0, ED = 0, P = 0;
    for (const t of ["warrior", "archer"]) {
      const c = division[t as keyof typeof division] || 0;
      const c100 = per100(c);
      const s = stats[t];
      if (phase === 'skirmish') {
        EA += c100 * s.skirmish_attack;
        ED += c100 * s.skirmish_defence;
      } else if (phase === 'melee') {
        EA += c100 * s.melee_attack;
        ED += c100 * s.melee_defence;
      }
      P += c100 * s.pursuit;
    }
    return { EA: Math.max(0.1, EA), ED: Math.max(0.1, ED), P: Math.max(0, P) };
  }

  function applyCasualties(div: { warrior: number; archer: number }, losses: number) {
    const s = total(div);
    if (s <= 0 || losses <= 0) return;
    const warriorShare = (div.warrior || 0) / s;
    const archerShare = (div.archer || 0) / s;
    div.warrior = Math.max(0, (div.warrior || 0) - losses * warriorShare);
    div.archer = Math.max(0, (div.archer || 0) - losses * archerShare);
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

  function simulateBattle(
    playerDiv: { warrior: number; archer: number },
    enemyDiv: { warrior: number; archer: number }
  ): BattleResult {
    const stats = getUnitStats();
    const p = getBattleParams();
    const A = { ...playerDiv };
    const B = { ...enemyDiv };
    
    // Capture initial states before battle
    const playerInitial = {
      warrior: A.warrior,
      archer: A.archer,
      total: total(A)
    };
    const enemyInitial = {
      warrior: B.warrior,
      archer: B.archer,
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
      const SA = phaseStats(A, stats, phase);
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
        const SA = phaseStats(A, stats, 'melee');
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
    
    return {
      winner,
      ticks: tick,
      playerInitial,
      playerFinal: {
        warrior: A.warrior,
        archer: A.archer,
        total: sA,
        morale: mA
      },
      enemyInitial,
      enemyFinal: {
        warrior: B.warrior,
        archer: B.archer,
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
  const stoneCap  = useMemo(() => getProgression("stone", quarry.level, "capacity"), [quarry.level]);
  const foodCap   = useMemo(() => getProgression("food", farm.level, "capacity"), [farm.level]);
  const ironCap   = useMemo(() => getProgression("iron", ironMine.level, "capacity"), [ironMine.level]);

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
      setQuarry((b) => ({ ...b, stored: Math.min(stoneCap,  b.stored + stoneRate) }));
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
      const nextBanners = banners.map((b) => ({ ...b }));
      
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
            nextBanners[bannerIndex].recruited += 1; // 1 pop / sec / training banner
          nextPop = Math.max(1, nextPop - 1);
            bannersChanged = true;
            
            // Update squad currentSize as training progresses
            if (nextBanners[bannerIndex].squads && nextBanners[bannerIndex].squads.length > 0) {
              if (nextBanners[bannerIndex].reinforcingSquadId !== undefined) {
                // Reinforcement: update specific squad
                const squadToReinforce = nextBanners[bannerIndex].squads.find(s => s.id === nextBanners[bannerIndex].reinforcingSquadId);
                if (squadToReinforce && squadToReinforce.currentSize < squadToReinforce.maxSize) {
                  squadToReinforce.currentSize = Math.min(squadToReinforce.maxSize, squadToReinforce.currentSize + 1);
                }
              } else {
                // New training: distribute recruited population across squads (1 per second per squad)
                let remainingToAssign = 1; // We recruited 1 person this second
                for (let i = 0; i < nextBanners[bannerIndex].squads.length && remainingToAssign > 0; i++) {
                  const squad = nextBanners[bannerIndex].squads[i];
                  if (squad.currentSize < squad.maxSize) {
                    const canAdd = Math.min(remainingToAssign, squad.maxSize - squad.currentSize);
                    squad.currentSize += canAdd;
                    remainingToAssign -= canAdd;
                  }
                }
              }
            }
          }
        }
      }
      
      // Check for completed training
      nextBanners.forEach((bb) => {
        if (bb.status === 'training' && bb.recruited >= bb.reqPop) { 
          bb.status = 'ready'; 
          bb.reinforcingSquadId = undefined; // Clear reinforcement tracking
          bannersChanged = true; 
        }
      });
      
      if (bannersChanged) setBanners(nextBanners);

      // missions
      let missionsChanged = false;
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
              const playerDiv = {
                warrior: bannerWithSquads.squads
                  .filter(s => s.type === 'warrior')
                  .reduce((sum, s) => sum + s.currentSize, 0),
                archer: bannerWithSquads.squads
                  .filter(s => s.type === 'archer')
                  .reduce((sum, s) => sum + s.currentSize, 0)
              };
              battleResult = simulateBattle(playerDiv, m.enemyComposition);
              
              // Apply losses to banner
              const losses = calculateBannerLosses(bannerWithSquads, battleResult);
              const updatedBanner = distributeLossesToBanner(bannerWithSquads, losses);
              
              // Check if banner is destroyed (0 troops remaining)
              const totalTroops = updatedBanner.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
              const bannerStatus = totalTroops === 0 ? 'destroyed' : 'ready';
              
              // Update banner in state with losses applied
              setBanners((bs) => bs.map((b) => 
                b.id === bannerWithSquads.id ? { ...updatedBanner, status: bannerStatus } : 
                m.deployed.includes(b.id) ? { ...b, status: 'ready' } : b
              ));
              
              // Show battle report
              setBattleReport({ missionId: m.id, result: battleResult });
              
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
            const enemyTotal = m.enemyComposition ? m.enemyComposition.warrior + m.enemyComposition.archer : 0;
            // For non-combat missions, give a small base reward
            const baseGold = enemyTotal > 0 ? Math.max(1, Math.floor(enemyTotal * 2)) : 1;
            const rewards = {
              gold: baseGold,
              wood: enemyTotal > 0 ? Math.floor(enemyTotal * 0.5) : 0,
              stone: enemyTotal > 0 ? Math.floor(enemyTotal * 0.3) : 0
            };
            
            missionsChanged = true;
            return { ...m, status: 'completedRewardsPending', elapsed: m.duration, deployed: [], battleResult, rewards };
          } else {
            // Player lost - no rewards, mission becomes available for retry
            missionsChanged = true;
            return { ...m, status: 'available', elapsed: m.duration, deployed: [], battleResult, rewards: undefined, rewardTier: undefined };
          }
        }
        missionsChanged = true;
        return { ...m, elapsed };
      });
      if (missionsChanged) setMissions(nextMissions);

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
                  // Regular banner: consume population if available (keep at least 1)
                  if (nextPop > 1 && job.soldiersTrained < job.soldiersNeeded) {
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
                    
                    // Check if complete
                    if (newTrained >= job.soldiersNeeded) {
                      return null; // Remove from queue when complete
                    }
                    
                    return { ...job, soldiersTrained: newTrained };
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
  }, [lumberRate, stoneRate, foodRate, foodConsumption, netFoodRate, lumberCap, stoneCap, foodCap, netPopulationChange, population, banners, missions, warehouse.food, farm.stored, popCap, barracks, bannerTemplates, bannerSeq, recruitmentMode, lumberMill.workers, quarry.workers, farm.workers]);

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
    | { res: "wood" | "stone" | "food" | "iron" | "warehouse" | "house" | "townhall" | "barracks" | "tavern"; from: number; to: number; cost: { wood: number; stone: number } }
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
  const RES_META: Record<"wood"|"stone"|"food"|"iron", { name: string; short: "W"|"S"|"F"|"I" }> = {
    wood: { name: "Wood", short: "W" },
    stone: { name: "Stone", short: "S" },
    food: { name: "Food", short: "F" },
    iron: { name: "Iron", short: "I" },
  };

  function formatInt(n: number) { return Math.floor(n).toLocaleString(); }
  function formatRate(n: number) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
  function formatCap(n: number) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function pct(a: number, b: number) { return Math.max(0, Math.min(100, Math.floor((a / b) * 100))); }
  function formatShort(n: number) {
    const abs = Math.floor(n);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}K`;
    return abs.toLocaleString();
  }

  function RowBar({ value, max }: { value: number; max: number }) {
    const p = pct(value, max);
    return (
      <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
        <div className="h-1.5 bg-sky-500" style={{ width: `${p}%` }} />
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
    statusColor, 
    lockedWorkers, 
    bufferWorkers, 
    freePop 
  }: { 
    value: number; 
    cap: number; 
    rate: number; 
    trend?: string; 
    statusColor?: 'red' | 'yellow' | 'green';
    lockedWorkers: number;
    bufferWorkers: number;
    freePop: number;
  }) {
    const valueColor = statusColor === 'red' ? 'text-red-500' : statusColor === 'yellow' ? 'text-yellow-500' : statusColor === 'green' ? 'text-emerald-500' : '';
    const rateColor = rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-500';
    const rateSign = rate > 0 ? '+' : '';
    
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
    
    // Tooltip text
    const tooltipText = `Total: ${value} / ${cap}
${lockedWorkers === 1 ? '1 locked worker' : `${lockedWorkers} locked workers`} (keep buildings running)
Safe recruits (unassigned people): ${safeRecruits}`;
    
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-1.5 shadow-sm" title={tooltipText}>
        {/* First line: Main value */}
        <div className="text-sm font-bold select-none">
          <span className={valueColor || ''}>Pop {formatShort(value)} / {formatShort(cap)}</span>
        </div>
        {/* Second line: Rate and trend */}
        {(rate !== 0 || trend) && (
          <div className="text-[10px] text-slate-500 font-normal flex items-center gap-1.5 flex-wrap mt-0.5">
            {rate !== 0 && <span className={rateColor}>{rateSign}{formatRate(rate)}/s</span>}
            {trend && (
              <span className={trend.includes('-') ? 'text-red-500' : trend.includes('+') ? 'text-emerald-500' : 'text-slate-500'}>
                {trend}
              </span>
            )}
          </div>
        )}
        {/* Stacked bar visualization */}
        <div className="mt-1 h-2 rounded-lg bg-slate-800 border border-slate-700 overflow-hidden relative">
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
        {/* Breakdown text */}
        <div className="text-[10px] text-slate-500 mt-0.5">
          Lock: {lockedWorkers} | Workers: {bufferWorkers} | Free: {Math.round(freePop * 10) / 10}
        </div>
      </div>
    );
  }

  function ResourcePill({ label, value, cap, rate = 0, showBar = true, trend, statusColor, workerInfo }: { label: string; value: number; cap: number; rate?: number; showBar?: boolean; trend?: string; statusColor?: 'red' | 'yellow' | 'green'; workerInfo?: string }) {
    const valueColor = statusColor === 'red' ? 'text-red-500' : statusColor === 'yellow' ? 'text-yellow-500' : statusColor === 'green' ? 'text-emerald-500' : '';
    const rateColor = rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-500';
    const rateSign = rate > 0 ? '+' : '';
    // Show cap for all warehouse resources (Wood, Stone, Food, Iron, Gold), but not for Skill Points
    const shouldShowCap = ['Wood', 'Stone', 'Food', 'Iron', 'Gold'].includes(label) && cap < 999999;
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-1.5 shadow-sm">
        {/* First line: Main value */}
        <div className="text-sm font-bold select-none">
          <span className={valueColor || ''}>{label} {formatShort(value)}{shouldShowCap ? ` / ${formatShort(cap)}` : ''}</span>
        </div>
        {/* Second line: Extra data */}
        {(workerInfo || rate !== 0 || trend) && (
          <div className="text-[10px] text-slate-500 font-normal flex items-center gap-1.5 flex-wrap mt-0.5">
            {workerInfo && <span>({workerInfo})</span>}
            {rate !== 0 && <span className={rateColor}>{rateSign}{formatRate(rate)}/s</span>}
          {trend && (
              <span className={trend.includes('-') ? 'text-red-500' : trend.includes('+') ? 'text-emerald-500' : 'text-slate-500'}>
              {trend}
            </span>
          )}
        </div>
        )}
        {showBar && (
          <div className="mt-1 h-2 rounded-lg bg-slate-900 border border-slate-700 overflow-hidden">
            <div className="h-full bg-sky-500" style={{ width: `${pct(value, cap)}%` }} />
          </div>
        )}
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
  }) {
    const nextLevel = level + 1;
    const nextCost = getBuildingCost(res, nextLevel);
    const enoughWood = warehouse.wood >= nextCost.wood;
    const enoughStone = warehouse.stone >= nextCost.stone;
    const affordable = enoughWood && enoughStone;
    const meta = RES_META[res];
    const effectiveLevel = Math.min(level, workers);

    return (
      <div className={`rounded-lg border ${enabled ? 'border-slate-800' : 'border-slate-600 opacity-75'} bg-slate-900 p-2`}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <div className="text-sm font-semibold truncate">{name}</div>
              <div className="text-[10px] px-1 py-0.5 rounded bg-slate-800">Lv {level}</div>
              {workers < requiredWorkers && (
                <div className="text-[10px] px-1 py-0.5 rounded bg-amber-900 text-amber-200">
                  Effective Lv {effectiveLevel}
                </div>
              )}
              <span className="text-[9px] px-0.5 py-0.5 rounded border border-slate-700">{meta.short}</span>
              <div className="text-[10px] text-slate-500">+{formatRate(rate)} {meta.short}/s</div>
              <div className="text-[10px] text-slate-500">cap {formatCap(cap)} {meta.short}</div>
              <div className="text-[10px] text-slate-500">Workers: {workers}/{requiredWorkers}</div>
              <div className="ml-1.5 text-[10px] text-slate-500">{formatInt(stored)} / {formatCap(cap)} · {pct(stored, cap)}%</div>
            </div>
            <div className="mt-1"><RowBar value={stored} max={cap} /></div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className={`px-2 py-1 rounded-lg text-xs ${enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white disabled:opacity-50 disabled:cursor-not-allowed`}
              onClick={onToggle}
              disabled={toggleDisabled}
              title={toggleDisabled ? "Farm cannot be disabled (required for survival)" : enabled ? "Disable building (releases workers)" : "Enable building"}
            >
              {enabled ? "Disable" : "Enable"}
            </button>
            <button
              className="px-2 py-1 rounded-lg text-xs bg-slate-700 text-slate-100 disabled:opacity-50"
              onClick={onCollect}
              disabled={stored <= 0 || (warehouseFree as any)[res] <= 0 || !enabled}
              title={(warehouseFree as any)[res] <= 0 ? "Warehouse full for this resource" : `Collect ${meta.name}`}
            >
              Collect {meta.name}
            </button>
            <div className="text-right">
              <div className="text-[10px] text-slate-500 mb-0.5">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-1 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-0.5 px-2 py-1 w-full rounded-lg text-xs bg-slate-900 text-white disabled:opacity-50"
                onClick={() => requestUpgrade(res, level)}
                disabled={!affordable}
                title={!affordable ? `Need more Wood/Stone in warehouse` : `Upgrade to Lvl ${nextLevel}`}
              >
                Upgrade
              </button>
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
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <div className="text-sm font-semibold truncate">House</div>
              <div className="text-[10px] px-1 py-0.5 rounded bg-slate-800">Lv {house}</div>
              <div className="text-[10px] text-slate-500">Capacity: {formatInt(popCap)}</div>
              <div className="text-[10px] text-slate-500">Workers: 0 (no workers required)</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="text-right">
              <div className="text-[10px] text-slate-500 mb-0.5">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-1 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-0.5 px-2 py-1 w-full rounded-lg text-xs bg-slate-900 text-white disabled:opacity-50"
                onClick={() => requestUpgrade("house", house)}
                disabled={!affordable}
                title={!affordable ? "Not enough resources" : `Upgrade to Lvl ${nextLevel} (+5 capacity)`}
              >
                Upgrade
              </button>
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
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <div className="text-sm font-semibold truncate">Town Hall</div>
              <div className="text-[10px] px-1 py-0.5 rounded bg-slate-800">Lv {townHall.level}</div>
              <div className="text-[10px] text-slate-500">Net Pop Change: {netPopulationChange > 0 ? '+' : ''}{netPopulationChange.toFixed(1)}/s</div>
              <div className="text-[10px] text-slate-500">Happiness: {happiness}</div>
            </div>
            {townHall.level >= 2 && (
              <div className="text-[10px] text-slate-400 mt-0.5">
                Unlocks: Barracks, Tavern
              </div>
            )}
            {townHall.level >= 3 && (
              <div className="text-[10px] text-slate-400 mt-0.5">
                Unlocks: Market, Guard Tower (planned)
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {canUpgrade && nextCost && (
              <div className="text-right">
                <div className="text-[10px] text-slate-500 mb-0.5">Next: <strong>Lvl {nextLevel}</strong></div>
                <div className="flex gap-1 justify-end">
                  <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                  <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
                </div>
                <button
                  className="mt-0.5 px-2 py-1 w-full rounded-lg text-xs bg-slate-900 text-white disabled:opacity-50"
                  onClick={() => requestTownHallUpgrade(townHall.level)}
                  disabled={!affordable}
                >
                  Upgrade
                </button>
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
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-semibold">Barracks</div>
              {!canBuild && (
                <div className="text-[10px] text-red-400">Requires Town Hall Level 2</div>
              )}
              {canBuild && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-[10px] text-slate-400">Build Cost:</div>
                  <div className="text-[10px]">
                    <span className={hasEnoughWood ? 'text-emerald-400' : 'text-red-400'}>
                      {formatInt(buildCost.wood)} Wood
                    </span>
                    {' • '}
                    <span className={hasEnoughStone ? 'text-emerald-400' : 'text-red-400'}>
                      {formatInt(buildCost.stone)} Stone
                    </span>
                  </div>
                </div>
              )}
            </div>
            {canBuild && (
              <button
                onClick={buildBarracks}
                disabled={!canAfford}
                className="px-2 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Build ({formatInt(buildCost.wood)}W, {formatInt(buildCost.stone)}S)
              </button>
            )}
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
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <div className="text-sm font-semibold truncate">Barracks</div>
              <div className="text-[10px] px-1 py-0.5 rounded bg-slate-800">Lv {barracks.level}</div>
              <div className="text-[10px] text-slate-500">Training Slots: {barracks.trainingSlots}</div>
              <div className="text-[10px] text-slate-500">Active: {barracks.trainingQueue.length}/{barracks.trainingSlots}</div>
            </div>
          </div>
          {canUpgrade && nextCost && (
            <div className="text-right">
              <div className="text-[10px] text-slate-500 mb-0.5">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-1 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-0.5 px-2 py-1 w-full rounded-lg text-xs bg-slate-900 text-white disabled:opacity-50"
                onClick={() => requestBarracksUpgrade(barracks.level)}
                disabled={!affordable}
              >
                Upgrade
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // === Tavern Row ===
  function TavernRow() {
    if (!tavern) {
      const canBuild = canBuildTavern(townHall.level);
      const buildCost = getTavernBuildCost();
      const hasEnoughWood = warehouse.wood >= buildCost.wood;
      const hasEnoughStone = warehouse.stone >= buildCost.stone;
      const canAfford = hasEnoughWood && hasEnoughStone;
      
      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-semibold">Tavern</div>
              {!canBuild && (
                <div className="text-[10px] text-red-400">Requires Town Hall Level 2</div>
              )}
              {canBuild && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-[10px] text-slate-400">Build Cost:</div>
                  <div className="text-[10px]">
                    <span className={hasEnoughWood ? 'text-emerald-400' : 'text-red-400'}>
                      {formatInt(buildCost.wood)} Wood
                    </span>
                    {' • '}
                    <span className={hasEnoughStone ? 'text-emerald-400' : 'text-red-400'}>
                      {formatInt(buildCost.stone)} Stone
                    </span>
                  </div>
                </div>
              )}
            </div>
            {canBuild && (
              <button
                onClick={buildTavern}
                disabled={!canAfford}
                className="px-2 py-1 rounded-lg text-xs bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Build ({formatInt(buildCost.wood)}W, {formatInt(buildCost.stone)}S)
              </button>
            )}
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
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <div className="text-sm font-semibold truncate">Tavern</div>
              <div className="text-[10px] px-1 py-0.5 rounded bg-slate-800">Lv {tavern.level}</div>
              <div className="text-[10px] text-slate-500">Happiness Bonus: +{tavern.level === 1 ? 10 : tavern.level === 2 ? 20 : 25}</div>
              {festivalActive && (
                <div className="text-[10px] text-amber-400">Festival Active!</div>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Total Happiness: {happiness} ({happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'})
            </div>
            {tavern.level >= 1 && !festivalActive && (
              <button
                onClick={startFestival}
                disabled={warehouse.gold < 50}
                className="mt-1 px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs disabled:opacity-50"
              >
                Start Festival (50 Gold)
              </button>
            )}
          </div>
          {canUpgrade && nextCost && (
            <div className="text-right">
              <div className="text-[10px] text-slate-500 mb-0.5">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-1 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-0.5 px-2 py-1 w-full rounded-lg text-xs bg-slate-900 text-white disabled:opacity-50"
                onClick={() => requestTavernUpgrade(tavern.level)}
                disabled={!affordable}
              >
                Upgrade
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // === Taxes Row ===
  function TaxesRow() {
    const trendText = netPopulationChange > 0 ? `(+${netPopulationChange.toFixed(1)} in 1s)` : netPopulationChange < 0 ? `(${netPopulationChange.toFixed(1)} in 1s)` : "(stable)";
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <div className="text-sm font-semibold truncate">Taxes</div>
              <div className="text-[10px] text-slate-500">Population: {formatInt(population)} / {formatInt(popCap)}</div>
              <div className={`text-[10px] ${workerDeficit > 0 ? 'text-red-500 font-semibold' : 'text-slate-500'}`}>
                Workers: {workerSurplus >= 0 ? `+${workerSurplus}` : `-${workerDeficit}`}
                {workerDeficit > 0 && (
                  <span className="ml-1" title="Too many enabled buildings are competing for staff. Disable some buildings to focus labor on priority buildings.">
                    ⚠️
                  </span>
                )}
              </div>
              <div className={`text-[10px] ${netPopulationChange < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                {trendText}
              </div>
              <div className="text-[10px] text-slate-500">
                Happiness: {happiness} ({happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'})
            </div>
          </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-lg overflow-hidden border border-slate-700">
              <button 
                onClick={() => setTax('very_low')} 
                className={`px-2 py-1 text-xs relative group ${tax==='very_low' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
                title="Very low taxes. Villagers are much happier and population grows fast, but gold income is greatly reduced."
              >
                Very Low
              </button>
              <button 
                onClick={() => setTax('low')} 
                className={`px-2 py-1 text-xs relative group ${tax==='low' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
                title="Low taxes. Villagers are happier and population grows well, with slightly reduced gold income."
              >
                Low
              </button>
              <button 
                onClick={() => setTax('normal')} 
                className={`px-2 py-1 text-xs relative group ${tax==='normal' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
                title="Balanced taxes. Stable happiness, modest population growth and standard gold income."
              >
                Normal
              </button>
              <button 
                onClick={() => setTax('high')} 
                className={`px-2 py-1 text-xs relative group ${tax==='high' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
                title="High taxes. More gold now, but villagers are less happy and population can start to decline."
              >
                High
              </button>
              <button 
                onClick={() => setTax('very_high')} 
                className={`px-2 py-1 text-xs relative group ${tax==='very_high' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
                title="Very high taxes. Maximum gold income, but villagers are very unhappy and population declines quickly."
              >
                Very High
              </button>
            </div>
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

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <div className="text-sm font-semibold truncate">Warehouse</div>
              <div className="text-[10px] px-1 py-0.5 rounded bg-slate-800">Lv {warehouseLevel}</div>
              <div className="text-[10px] text-slate-500">caps W/S/F {formatCap(warehouseCap.wood)} / {formatCap(warehouseCap.stone)} / {formatCap(warehouseCap.food)}</div>
              <div className="ml-1.5 text-[10px] text-slate-500">W {formatInt(warehouse.wood)}, S {formatInt(warehouse.stone)}, F {formatInt(warehouse.food)}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="px-2 py-1 rounded-lg text-xs bg-emerald-600 text-white disabled:opacity-50"
              onClick={collectAll}
              disabled={
                lumberMill.stored + quarry.stored + farm.stored === 0 ||
                (warehouseFree.wood <= 0 && warehouseFree.stone <= 0 && warehouseFree.food <= 0)
              }
            >
              Collect All
            </button>
            <div className="text-right">
              <div className="text-[10px] text-slate-500 mb-0.5">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-1 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-0.5 px-2 py-1 w-full rounded-lg text-xs bg-slate-900 text-white disabled:opacity-50"
                onClick={() => requestUpgrade("warehouse", warehouseLevel)}
                disabled={!affordable}
                title={!affordable ? "Not enough resources" : `Upgrade to Lvl ${nextLevel}`}
              >
                Upgrade
              </button>
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
        const squads = ['archer','warrior','warrior'];
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
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 p-4 md:p-8">
      {/* Fixed Top Menu - Resources, Cheat Panel, and Navigation */}
      <div className="fixed top-0 left-0 right-0 z-50 px-4 md:px-8 py-2 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        {/* Resource Bar */}
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-1.5">
          <PopulationPill 
            value={population} 
            cap={popCap} 
            rate={netPopulationChange} 
            trend={netPopulationChange > 0 ? `(+${netPopulationChange.toFixed(1)} in 1s)` : netPopulationChange < 0 ? `(${netPopulationChange.toFixed(1)} in 1s)` : "(stable)"}
            statusColor={workerDeficit > 0 ? 'red' : workerSurplus > 0 ? 'green' : 'yellow'}
            lockedWorkers={clampedLocked}
            bufferWorkers={clampedBuffer}
            freePop={clampedFree}
          />
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-1.5 shadow-sm">
            <div className="text-sm font-bold select-none flex items-baseline gap-1">
              <span className={happiness >= 70 ? 'text-emerald-500' : happiness <= 40 ? 'text-red-500' : 'text-yellow-500'}>
                😊 {happiness}
              </span>
              <span className="text-[10px] text-slate-500">
                {happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'}
              </span>
            </div>
          </div>
          <ResourcePill label="Wood" value={warehouse.wood} cap={warehouseCap.wood} rate={lumberRate} />
          <ResourcePill label="Stone" value={warehouse.stone} cap={warehouseCap.stone} rate={stoneRate} />
          <ResourcePill label="Food" value={warehouse.food} cap={warehouseCap.food} rate={netFoodRate} />
          <ResourcePill label="Iron" value={warehouse.iron} cap={warehouseCap.iron} rate={0} />
          <ResourcePill label="Gold" value={warehouse.gold} cap={warehouseCap.gold} rate={goldIncomePerSecond} />
          <ResourcePill label="Skill Points" value={skillPoints} cap={999999} rate={0} showBar={false} />
        </div>
        
        {/* Cheat Area for Testing */}
        <div className="mb-1.5 p-2 rounded-lg border-2 border-amber-500 bg-amber-950/30">
          <div className="text-[10px] font-semibold text-amber-200 mb-1">🧪 CHEAT PANEL (Testing)</div>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setWarehouse(w => ({ ...w, wood: Math.min(warehouseCap.wood, w.wood + 999) }))}
              className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              +999 Wood
            </button>
            <button
              onClick={() => setWarehouse(w => ({ ...w, stone: Math.min(warehouseCap.stone, w.stone + 999) }))}
              className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              +999 Stone
            </button>
            <button
              onClick={() => setWarehouse(w => ({ ...w, food: Math.min(warehouseCap.food, w.food + 999) }))}
              className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              +999 Food
            </button>
            <button
              onClick={() => setWarehouse(w => ({ ...w, iron: Math.min(warehouseCap.iron, w.iron + 999) }))}
              className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              +999 Iron
            </button>
            <button
              onClick={() => setWarehouse(w => ({ ...w, gold: Math.min(warehouseCap.gold, w.gold + 999) }))}
              className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              +999 Gold
            </button>
            <button
              onClick={() => setSkillPoints(prev => prev + 5)}
              className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              +5 Skill Points
            </button>
            <button
              onClick={() => {
                addFactionPoints(1);
                saveGame();
              }}
              className="px-2 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
            >
              +1 Faction Point
            </button>
            <button
              onClick={() => {
                addFactionPoints(10);
                saveGame();
              }}
              className="px-2 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
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
              className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
            >
              Shuffle Missions
            </button>
            <button
              onClick={resetGame}
              className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
            >
              Reset Game
            </button>
        </div>
      </div>

        {/* Village Resources Header and Navigation */}
        <div>
          <h1 className="text-lg md:text-xl font-bold mb-1.5">Village Resources</h1>

      {/* Navigation Menu */}
          <div className="mb-1 flex items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden border border-slate-700">
          <button
            onClick={() => setMainTab('production')}
                className={`px-2 py-1 text-xs ${mainTab === 'production' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
          >
            Production
          </button>
          <button
                onClick={() => {
                  if (barracks && barracks.level >= 1) {
                    setMainTab('army');
                  }
                }}
                disabled={!barracks || barracks.level < 1}
                className={`px-2 py-1 text-xs ${
                  !barracks || barracks.level < 1
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

            {/* Simulator shortcuts */}
            <div className="ml-auto flex items-center gap-2">
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800 transition"
              >
                🏰 Fortress Simulator
              </a>
              <a
                href="/ck_3_style_battle_simulator_ui_single_file_html.html"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800 transition"
              >
                ⚔ Combat Simulator
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer to prevent content from going under fixed header */}
      <div className="h-[200px]"></div>

      {/* Main Content - Production (Default) */}
      {mainTab==='production' && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Buildings List</h2>
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
          <TaxesRow />
          <WarehouseRow />
        </section>
      )}

      {mainTab==='army' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Army - Banners</h2>
          
          {/* Mercenaries Section - Distinct from Men at Arms */}
          {barracks && (
            <div className="rounded-xl border border-red-900/50 bg-slate-900/50 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-md font-semibold text-red-400">BARRACKS</h3>
                <h3 className="text-md font-semibold text-red-400">MERCENARIES</h3>
              </div>
              
              <div className="space-y-2">
                {bannerTemplates.slice(0, barracks.maxTemplates).map(template => {
                  const hasEnoughGold = warehouse.gold >= template.cost;
                  const isAlreadyHiring = barracks.trainingQueue.some(job => job.templateId === template.id);
                  const canHire = barracks.trainingQueue.length < barracks.trainingSlots && hasEnoughGold && !isAlreadyHiring;
                  return (
                    <div key={template.id} className="rounded-lg border border-slate-700 bg-slate-800 p-3">
                      <div className="font-semibold">{template.name}</div>
                      <div className="text-xs text-slate-400">
                        {template.squads.map(s => `${s.count} ${s.type} squad${s.count > 1 ? 's' : ''}`).join(', ')}
                      </div>
                      <div className="text-xs">
                        <span className="text-slate-400">Cost: </span>
                        <span className={hasEnoughGold ? 'text-emerald-400' : 'text-red-400'}>
                          {formatInt(template.cost)} Gold
                        </span>
                      </div>
                      {isAlreadyHiring && (
                        <div className="text-xs text-amber-400 mt-1">Already in hiring queue</div>
                      )}
                      <button
                        onClick={() => startBarracksTraining(template.id)}
                        disabled={!canHire}
                        className="mt-2 px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Hire ({formatInt(template.cost)} Gold)
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Hiring Queue */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Hiring Queue</h4>
                {barracks.trainingQueue.length === 0 ? (
                  <div className="text-xs text-slate-500">No mercenaries arriving</div>
                ) : (
                  <div className="space-y-2">
                    {barracks.trainingQueue.map(job => {
                      if (job.type === 'mercenary') {
                        const template = bannerTemplates.find(t => t.id === job.templateId);
                        return (
                          <div key={job.id} className="rounded-lg border border-slate-700 bg-slate-800 p-3">
                            <div className="font-semibold">{template?.name || 'Unknown'}</div>
                            {job.status === 'arriving' && job.arrivalTime && (
                              <div>
                                <div className="text-xs text-slate-400">
                                  Arriving: {job.elapsedTime}s / {job.arrivalTime}s
                                </div>
                                <RowBar value={job.elapsedTime} max={job.arrivalTime} />
                              </div>
                            )}
                            {job.status === 'training' && (
                              <div className="text-xs text-emerald-400">Training...</div>
                            )}
                          </div>
                        );
                      } else if (job.type === 'reinforcement' && job.bannerId !== undefined && job.squadId !== undefined) {
                        const banner = banners.find(b => b.id === job.bannerId);
                        const squad = banner?.squads?.find(s => s.id === job.squadId);
                        return (
                          <div key={job.id} className="rounded-lg border border-slate-700 bg-slate-800 p-3">
                            <div className="font-semibold">
                              Reinforcing {squad?.type === 'archer' ? 'Archer' : 'Warrior'} Squad
                            </div>
                            <div className="text-xs text-slate-400">
                              {banner?.name || 'Unknown Banner'}
                            </div>
                            {job.status === 'training' && (
                              <div>
                                <div className="text-xs text-slate-400 mt-1">
                                  Training: {job.soldiersTrained} / {job.soldiersNeeded}
                                </div>
                                <RowBar value={job.soldiersTrained} max={job.soldiersNeeded} />
                              </div>
                            )}
                            {job.status === 'arriving' && (
                              <div className="text-xs text-amber-400 mt-1">Waiting for training slot...</div>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>

              {/* Mercenary Banners (Ready/Deployed) */}
              {(() => {
                const mercNotices = bannerLossNotices.filter((notice) => notice.bannerType === 'mercenary');
                const mercBanners = banners.filter(b => b.type === 'mercenary');
                console.log('[RENDER] Mercenary section - Total notices:', bannerLossNotices.length, 'Mercenary notices:', mercNotices.length, mercNotices, 'Mercenary banners:', mercBanners.length);
                return mercNotices.length > 0 || mercBanners.length > 0;
              })() && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-sm font-semibold text-red-400">YOUR MERCENARY BANNERS</h4>
                  {/* Always show notifications if they exist */}
                  {bannerLossNotices.filter((notice) => notice.bannerType === 'mercenary').length > 0 && (
                    <div className="mb-2">
                      {bannerLossNotices.filter((notice) => notice.bannerType === 'mercenary').map((notice) => (
                        <div 
                          key={notice.id} 
                          className="rounded-lg border-2 border-red-700 bg-red-950/50 p-3 flex items-start justify-between text-xs text-red-200 mb-2"
                        >
                          <div className="flex-1">
                            <div className="font-semibold text-red-300 text-sm mb-1">{notice.bannerName}</div>
                            <div className="text-red-200">{notice.message}</div>
                          </div>
                          <button
                            onClick={() => dismissBannerLossNotice(notice.id)}
                            className="ml-4 px-2 py-1 text-red-300 hover:text-red-100 hover:bg-red-900/50 rounded text-sm font-bold transition-colors"
                            aria-label="Close notification"
                            title="Close"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Then show banners or empty message */}
                  {banners.filter(b => b.type === 'mercenary').length === 0 ? (
                    <div className="text-xs text-slate-500">No mercenary banners stationed.</div>
                  ) : (
                    <div className="space-y-2">
                      {banners.filter(b => b.type === 'mercenary').map((b) => {
                        const isDestroyed = b.status === 'destroyed';
                        return (
                      <div key={b.id} className={`rounded-lg border p-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-center relative ${
                        isDestroyed ? 'border-red-600 bg-red-900/20 opacity-75' : 'border-slate-700 bg-slate-800'
                      }`}>
                      {isDestroyed ? (
                        <button
                          onClick={() => {
                            setBanners((bs) => bs.filter(banner => banner.id !== b.id));
                            saveGame();
                          }}
                          className="absolute top-2 right-2 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                          title="Dismiss destroyed banner"
                        >
                          Dismiss
                        </button>
                      ) : (
                        <button
                          onClick={() => setDeleteBannerModal(b.id)}
                          className="absolute top-2 right-2 w-5 h-5 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center font-bold"
                          title="Dismiss banner (no population returned)"
                        >
                          ×
                        </button>
                      )}
                      <div className="flex items-center gap-2">
                        {editingBannerName === b.id ? (
                          <div className="flex items-center gap-1 flex-1">
                            <input
                              type="text"
                              value={banners.find(b2 => b2.id === b.id)?.name || b.name}
                              onChange={(e) => updateBannerName(b.id, e.target.value)}
                              onBlur={() => finishEditingBannerName(b.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  finishEditingBannerName(b.id);
                                } else if (e.key === 'Escape') {
                                  setEditingBannerName(null);
                                }
                              }}
                              className="flex-1 px-2 py-1 text-sm bg-slate-700 border border-slate-600 rounded text-white"
                              autoFocus
                            />
                            {banners.find(b2 => b2.id === b.id)?.customNamed && (
                              <button
                                onClick={() => {
                                  resetBannerName(b.id);
                                  setEditingBannerName(null);
                                }}
                                className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded"
                                title="Reset to auto-generated name"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 flex-1">
                            <span className={`font-semibold text-sm ${isDestroyed ? 'text-red-300' : ''}`}>{b.name}</span>
                            {isDestroyed && (
                              <span className="px-2 py-0.5 bg-red-900 text-red-200 text-xs font-semibold rounded">
                                Banner destroyed in last battle
                              </span>
                            )}
                            {!isDestroyed && (
                              <>
                                <button
                                  onClick={() => setEditingBannerName(b.id)}
                                  className="text-slate-400 hover:text-slate-300 text-xs"
                                  title="Edit banner name"
                                >
                                  ✏️
                                </button>
                                {b.customNamed && (
                                  <button
                                    onClick={() => resetBannerName(b.id)}
                                    className="px-1.5 py-0.5 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded"
                                    title="Reset to auto-generated name"
                                  >
                                    Reset
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {(() => {
                          // Ensure squads are initialized
                          let displaySquads = b.squads;
                          if (!displaySquads || displaySquads.length === 0) {
                            const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
                            displaySquads = squads;
                          }
                          
                          return displaySquads.map((squad) => {
                            const health = getSquadHealthState(squad.currentSize, squad.maxSize);
                            const colorClass = getSquadColorClass(health);
                            const needsReinforcement = squad.currentSize < squad.maxSize;
                            
                            // Check if this squad has an active reinforcement entry
                            const hasActiveReinforcement = barracks && barracks.trainingQueue.some(
                              entry => entry.type === 'reinforcement' && entry.bannerId === b.id && entry.squadId === squad.id
                            );
                            const reinforcementEntry = barracks?.trainingQueue.find(
                              entry => entry.type === 'reinforcement' && entry.bannerId === b.id && entry.squadId === squad.id
                            );
                            
                            return (
                              <span 
                                key={squad.id} 
                                className={`px-2 py-0.5 rounded text-xs border ${colorClass} flex items-center gap-1`}
                              >
                                {squad.type === 'archer' ? 'Archer Squad' : 'Warrior Squad'}
                                <span className="text-xs opacity-75">({squad.currentSize}/{squad.maxSize})</span>
                                {hasActiveReinforcement && reinforcementEntry && (
                                  <span className="text-xs text-amber-400" title={`Training: ${reinforcementEntry.soldiersTrained}/${reinforcementEntry.soldiersNeeded}`}>
                                    ⏳
                                  </span>
                                )}
                                {needsReinforcement && !hasActiveReinforcement && !isDestroyed && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      requestReinforcement(b.id, squad.id);
                                    }}
                                    className="ml-1 px-1 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-xs"
                                    title={`Request reinforcement (needs ${squad.maxSize - squad.currentSize} soldiers, costs ${squad.maxSize - squad.currentSize} gold)`}
                                  >
                                    ⚡
                                  </button>
                                )}
                              </span>
                            );
                          });
                        })()}
                      </div>
                      <div className="justify-self-end w-full md:w-64 flex flex-col items-end gap-2">
                        {isDestroyed ? (
                          <div className="text-red-400 text-xs font-semibold opacity-50">Destroyed</div>
                        ) : (
                          <>
                            {(() => {
                              // Guard: Don't allow reinforcing destroyed banners
                              if (isDestroyed) {
                                return (
                                  <button
                                    disabled
                                    className="px-3 py-1.5 rounded text-xs bg-slate-600 text-slate-400 cursor-not-allowed opacity-50"
                                    title="Banner destroyed - cannot reinforce"
                                  >
                                    Reinforce
                                  </button>
                                );
                              }
                              
                              // Calculate button state
                              let displaySquads = b.squads;
                              if (!displaySquads || displaySquads.length === 0) {
                                const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
                                displaySquads = squads;
                              }
                              
                              // Calculate refill cost (1 gold per missing soldier)
                              const refillCost = displaySquads.reduce((sum, squad) => {
                                return sum + (squad.maxSize - squad.currentSize);
                              }, 0);
                              
                              // Determine button state (only refill, no hiring)
                              const hasLosses = refillCost > 0;
                              const hasEnoughGold = warehouse.gold >= refillCost;
                              
                              // State A: No losses (all squads full)
                              if (!hasLosses) {
                                return (
                                  <button
                                    disabled
                                    className="px-3 py-1.5 rounded text-xs bg-slate-600 text-slate-400 cursor-not-allowed"
                                    title="Banner at full strength"
                                  >
                                    Reinforce
                                  </button>
                                );
                              }
                              
                              // State B: Losses present and enough gold
                              if (hasLosses && hasEnoughGold) {
                                return (
                                  <button
                                    onClick={() => {
                                      if (!barracks || isDestroyed) return;
                                      setHireAndRefillModal({
                                        bannerId: b.id,
                                        hireCost: 0,
                                        refillCost,
                                        totalCost: refillCost,
                                        bannerName: b.name
                                      });
                                    }}
                                    className="px-3 py-1.5 rounded text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                    title="Reinforce this banner"
                                  >
                                    Reinforce
                                  </button>
                                );
                              }
                              
                              // State C: Losses present but NOT enough gold
                              return (
                                <button
                                  onClick={() => {
                                    if (!barracks || isDestroyed) return;
                                    setHireAndRefillModal({
                                      bannerId: b.id,
                                      hireCost: 0,
                                      refillCost,
                                      totalCost: refillCost,
                                      bannerName: b.name
                                    });
                                  }}
                                  className="px-3 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white"
                                  title="Not enough gold to fully reinforce"
                                >
                                  Reinforce
                                </button>
                              );
                            })()}
                            {b.status === 'ready' && !isDestroyed && (
                              <div className="text-emerald-600 text-xs font-semibold">Ready</div>
                            )}
                            {b.status === 'deployed' && !isDestroyed && (
                              <div className="text-amber-500 text-xs font-semibold">Deployed</div>
                            )}
                          </>
                        )}
                        </div>
                      </div>
                      );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {!barracks && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-slate-500">Build Barracks from Production tab (requires Town Hall Level 2)</div>
            </div>
          )}

          {/* Men at Arms Section - Separate and distinct */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
            <h3 className="text-md font-semibold text-red-400">MEN AT ARMS <span className="text-slate-400 text-sm font-normal">(Regular army)</span></h3>
            
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Left: add squads */}
            <div className="md:col-span-1 space-y-2">
                <button onClick={() => addSquad('archer')} disabled={draftSquads.length>=8} className="w-full px-3 py-2 rounded-lg bg-slate-700 disabled:opacity-50">+ Archer Squad</button>
                <button onClick={() => addSquad('warrior')} disabled={draftSquads.length>=8} className="w-full px-3 py-2 rounded-lg bg-slate-700 disabled:opacity-50">+ Warrior Squad</button>
                <div className="text-xs text-slate-500">Squads: {draftSquads.length} / 8</div>
              <div className="flex gap-2">
                  <button onClick={removeLastSquad} disabled={draftSquads.length===0} className="px-3 py-1.5 rounded bg-slate-700 disabled:opacity-50">Undo</button>
                  <button onClick={clearDraft} disabled={draftSquads.length===0} className="px-3 py-1.5 rounded bg-slate-700 disabled:opacity-50">Clear</button>
                  <button onClick={confirmBanner} disabled={draftSquads.length===0} className="ml-auto px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-50">Confirm</button>
              </div>
            </div>
            {/* Right: composition grid */}
            <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
                <div className="text-sm text-slate-500 mb-2">Banner layout</div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({length:8}).map((_,i)=> (
                  <div key={i} className="h-12 rounded-lg border border-slate-700 flex items-center justify-center text-xs">
                      {draftSquads[i] ? (draftSquads[i]==='archer' ? 'Archer Squad' : 'Warrior Squad') : 'Empty'}
                  </div>
                ))}
              </div>
            </div>
          </div>

            {/* Your Banners Section - Inside Men at Arms */}
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-semibold text-red-400">YOUR REGULAR BANNERS</h4>
              
              {/* Recruitment Mode Selection - Moved down near training area */}
              <div className="flex gap-2 items-center flex-wrap mb-3 pb-3 border-b border-slate-700">
                <span className="text-xs text-slate-400">Recruitment Mode:</span>
                <button
                  onClick={() => setRecruitmentMode('regular')}
                  className={`px-3 py-1.5 rounded text-sm ${
                    recruitmentMode === 'regular'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  Regular Recruitment
                </button>
                <button
                  onClick={() => setRecruitmentMode('forced')}
                  className={`px-3 py-1.5 rounded text-sm ${
                    recruitmentMode === 'forced'
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  Forced Recruitment
                </button>
                <span className="text-xs text-slate-500">
                  {recruitmentMode === 'regular' 
                    ? '(Consuming only free workers)' 
                    : '(Consuming working workers)'}
                </span>
              </div>
              {bannerLossNotices.filter((notice) => notice.bannerType === 'regular').map((notice) => (
                <div 
                  key={notice.id} 
                  className="rounded-lg border-2 border-red-700 bg-red-950/50 p-3 flex items-start justify-between text-xs text-red-200 mb-2"
                >
                  <div className="flex-1">
                    <div className="font-semibold text-red-300 text-sm mb-1">{notice.bannerName}</div>
                    <div className="text-red-200">{notice.message}</div>
                  </div>
                  <button
                    onClick={() => dismissBannerLossNotice(notice.id)}
                    className="ml-4 px-2 py-1 text-red-300 hover:text-red-100 hover:bg-red-900/50 rounded text-sm font-bold transition-colors"
                    aria-label="Close notification"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {banners.filter(b => b.type === 'regular').length === 0 ? (
                <div className="text-xs text-slate-500">No banners available yet.</div>
            ) : (
              <div className="space-y-2">
                  {banners.filter(b => b.type === 'regular').map((b) => {
                    const isDestroyed = b.status === 'destroyed';
                    return (
                  <div key={b.id} className={`rounded-lg border p-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-center relative ${
                    isDestroyed ? 'border-red-600 bg-red-900/20 opacity-75' : 'border-slate-700 bg-slate-800'
                  }`}>
                    {isDestroyed ? (
                      <button
                        onClick={() => {
                          setBanners((bs) => bs.filter(banner => banner.id !== b.id));
                          saveGame();
                        }}
                        className="absolute top-2 right-2 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                        title="Dismiss destroyed banner"
                      >
                        Dismiss
                      </button>
                    ) : (
                      <button
                        onClick={() => deleteBanner(b.id)}
                        className="absolute top-2 right-2 w-5 h-5 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center font-bold"
                        title="Delete banner (returns recruited population)"
                      >
                        ×
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      {editingBannerName === b.id ? (
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            type="text"
                            value={banners.find(b2 => b2.id === b.id)?.name || b.name}
                            onChange={(e) => updateBannerName(b.id, e.target.value)}
                            onBlur={() => finishEditingBannerName(b.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                finishEditingBannerName(b.id);
                              } else if (e.key === 'Escape') {
                                setEditingBannerName(null);
                              }
                            }}
                            className="flex-1 px-2 py-1 text-sm bg-slate-700 border border-slate-600 rounded text-white"
                            autoFocus
                          />
                          {banners.find(b2 => b2.id === b.id)?.customNamed && (
                            <button
                              onClick={() => {
                                resetBannerName(b.id);
                                setEditingBannerName(null);
                              }}
                              className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded"
                              title="Reset to auto-generated name"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 flex-1">
                          <span className={`font-semibold text-sm ${isDestroyed ? 'text-red-300' : ''}`}>{b.name}</span>
                          {isDestroyed && (
                            <span className="px-2 py-0.5 bg-red-900 text-red-200 text-xs font-semibold rounded">
                              Banner destroyed in last battle
                            </span>
                          )}
                          {!isDestroyed && (
                            <>
                              <button
                                onClick={() => setEditingBannerName(b.id)}
                                className="text-slate-400 hover:text-slate-300 text-xs"
                                title="Edit banner name"
                              >
                                ✏️
                              </button>
                              {b.customNamed && (
                                <button
                                  onClick={() => resetBannerName(b.id)}
                                  className="px-1.5 py-0.5 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded"
                                  title="Reset to auto-generated name"
                                >
                                  Reset
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {(() => {
                        // Ensure squads are initialized
                        let displaySquads = b.squads;
                        if (!displaySquads || displaySquads.length === 0) {
                          const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
                          displaySquads = squads;
                        }
                        
                        return displaySquads.map((squad) => {
                          const health = getSquadHealthState(squad.currentSize, squad.maxSize);
                          const colorClass = getSquadColorClass(health);
                          const needsReinforcement = squad.currentSize < squad.maxSize;
                          
                          // Check if this squad has an active reinforcement entry
                          const hasActiveReinforcement = barracks && barracks.trainingQueue.some(
                            entry => entry.type === 'reinforcement' && entry.bannerId === b.id && entry.squadId === squad.id
                          );
                          const reinforcementEntry = barracks?.trainingQueue.find(
                            entry => entry.type === 'reinforcement' && entry.bannerId === b.id && entry.squadId === squad.id
                          );
                          
                          return (
                            <span 
                              key={squad.id} 
                              className={`px-2 py-0.5 rounded text-xs border ${colorClass} flex items-center gap-1`}
                            >
                              {squad.type === 'archer' ? 'Archer Squad' : 'Warrior Squad'}
                              <span className="text-xs opacity-75">({squad.currentSize}/{squad.maxSize})</span>
                              {hasActiveReinforcement && reinforcementEntry && (
                                <span className="text-xs text-amber-400" title={`Training: ${reinforcementEntry.soldiersTrained}/${reinforcementEntry.soldiersNeeded}`}>
                                  ⏳
                                </span>
                              )}
                              {needsReinforcement && !hasActiveReinforcement && !isDestroyed && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestReinforcement(b.id, squad.id);
                                  }}
                                  className="ml-1 px-1 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-xs"
                                  title={`Request reinforcement (needs ${squad.maxSize - squad.currentSize} soldiers)`}
                                >
                                  ⚡
                                </button>
                              )}
                            </span>
                          );
                        });
                      })()}
                    </div>
                    <div className="justify-self-end w-full md:w-64">
                      {isDestroyed ? (
                        <div className="text-red-400 text-xs font-semibold opacity-50">Destroyed</div>
                      ) : b.status === 'idle' && (
                        <div className="flex items-center gap-2 flex-wrap">
                          {(() => {
                            const maxSlots = barracks ? getMaxTrainingSlots(barracks.level) : 0;
                            const currentlyTraining = banners.filter(b => b.type === 'regular' && b.status === 'training').length;
                            const canTrain = barracks && barracks.level >= 1 && currentlyTraining < maxSlots;
                            
                            return (
                              <>
                                <button 
                                  onClick={() => startTraining(b.id)} 
                                  disabled={!canTrain}
                                  className={`px-3 py-1.5 rounded ${canTrain ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-600 opacity-50 cursor-not-allowed'} text-white`}
                                  title={!barracks || barracks.level < 1 ? 'Requires Barracks' : currentlyTraining >= maxSlots ? `Training slots full (${currentlyTraining}/${maxSlots})` : 'Start training'}
                                >
                                  Train
                                </button>
                                <div className="text-xs text-slate-500">Needs {b.reqPop} Pop</div>
                                {!canTrain && (
                                  <div className="text-xs text-amber-400 w-full">
                                    {!barracks || barracks.level < 1 ? 'Requires Barracks' : `Slots: ${currentlyTraining}/${maxSlots}`}
                        </div>
                      )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                      {b.status === 'training' && (
                        <div>
                          <div className="text-xs mb-1">Recruiting {b.recruited} / {b.reqPop}</div>
                          <RowBar value={b.recruited} max={b.reqPop} />
                          <button
                            onClick={() => toggleTrainingPause(b.id)}
                            className="mt-1 px-2 py-1 rounded text-xs bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            {b.trainingPaused ? '▶ Resume' : '⏸ Pause'}
                          </button>
                        </div>
                      )}
                      {b.status === 'ready' && (
                        <div className="text-emerald-600 text-xs font-semibold">Ready</div>
                      )}
                      {b.status === 'deployed' && (
                        <div className="text-amber-500 text-xs font-semibold text-right">Deployed</div>
                      )}
                    </div>
                  </div>
                  );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {mainTab==='leaderboard' && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Kill Score Leaderboard</h2>
          <LeaderboardUI leaderboard={leaderboard} realPlayerId={REAL_PLAYER_ID} />
        </section>
      )}

      {mainTab==='factions' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Factions</h2>
          
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
                className={`px-3 py-1.5 rounded text-sm ${
                  factionState.availableFP < 1
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                Assign 1 FP to Alsus
              </button>
              <button
                onClick={() => assignFPToFaction('Atrox', 1)}
                disabled={factionState.availableFP < 1}
                className={`px-3 py-1.5 rounded text-sm ${
                  factionState.availableFP < 1
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
              className={`px-4 py-2 rounded-lg font-semibold ${
                selectedFaction === 'Alsus'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Alsus
            </button>
            <button
              onClick={() => setSelectedFaction('Atrox')}
              className={`px-4 py-2 rounded-lg font-semibold ${
                selectedFaction === 'Atrox'
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
                            className={`rounded-lg border p-2 ${
                              perk.unlocked
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
      )}

      {mainTab==='missions' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Missions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Left: ready banners info panel */}
            <div className="md:col-span-1 rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="text-sm font-semibold mb-2">Ready Banners</div>
              {banners.filter(b=>b.status==='ready' && b.status!=='destroyed').length===0 ? (
                <div className="text-xs text-slate-500">No ready banners.</div>
              ) : (
                <div className="space-y-2">
                  {banners.filter(b=>b.status==='ready' && b.status!=='destroyed').map((b)=>{
                    // Check if this banner is assigned to any mission
                    const assignedMission = missions.find(m => m.status === 'available' && m.staged.includes(b.id));
                    const isAssigned = assignedMission !== undefined;
                    const totalTroops = b.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;
                    
                    return (
                      <div 
                        key={b.id} 
                        className={`rounded-lg border p-2 transition-colors ${
                          isAssigned 
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
              {missions.map((m)=>{
                const readyBanners = banners.filter(b => b.status === 'ready' && b.status !== 'destroyed');
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
                                className={`px-3 py-1.5 rounded text-sm ${
                                  !hasReadyBanners 
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
                                  className={`px-3 py-1.5 rounded text-sm ${
                                    isLoading 
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
                                  className={`px-3 py-1.5 rounded text-sm ${
                                    isLoading 
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
                        {m.status==='running' && (
                          <div className="text-xs text-slate-500">{secsLeft}s left</div>
                        )}
                        {isCompletedRewardPending && hasReport && m.battleResult && (
                          <button 
                            onClick={() => {
                              setBattleReport({ missionId: m.id, result: m.battleResult! });
                            }}
                            className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                          >
                            View report
                          </button>
                        )}
                        {isFailed && hasReport && m.battleResult && (
                          <button 
                            onClick={() => {
                              setBattleReport({ missionId: m.id, result: m.battleResult! });
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
                                  setBattleReport({ missionId: m.id, result: m.battleResult! });
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
                    {m.enemyComposition && (
                      <div className="mt-2 text-xs font-semibold text-slate-300">
                        Enemies: {m.enemyComposition.warrior + m.enemyComposition.archer} troops ({m.enemyComposition.warrior} Warriors, {m.enemyComposition.archer} Archers)
                      </div>
                    )}

                    {/* Banner selector dropdown */}
                    {m.status==='available' && isSelectorOpen && (
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
                                className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${
                                  isCurrentlyAssigned
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
                    {m.status==='available' && assignedBanner && (
                      <div className="mt-2 text-xs text-slate-300">
                        Assigned: <span className="text-emerald-400 font-semibold">{assignedBanner.name}</span>
                      </div>
                    )}

                    {/* Progress */}
                    {m.status!=='available' && (
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
      )}

      {mainTab==='expeditions' && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Expeditions</h2>
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
                                className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                                  canSend 
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
                                  const firstRound = result.siegeTimeline[0];
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
                                  className={`w-full px-3 py-2 rounded-lg text-white text-sm font-semibold transition-colors ${
                                    isLoading 
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
      )}

      {/* Confirmation Modal */}
      {pendingUpgrade && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
            <h4 className="text-lg font-semibold mb-2">Confirm Upgrade</h4>
            <p className="text-sm mb-4">
              Upgrade {pendingUpgrade.res === "wood" ? "Lumber Mill" : pendingUpgrade.res === "stone" ? "Quarry" : pendingUpgrade.res === "food" ? "Farm" : pendingUpgrade.res === "house" ? "House" : pendingUpgrade.res === "townhall" ? "Town Hall" : pendingUpgrade.res === "barracks" ? "Barracks" : pendingUpgrade.res === "tavern" ? "Tavern" : "Warehouse"}
              {" from "}<strong>Lvl {pendingUpgrade.from}</strong>{" to "}<strong>Lvl {pendingUpgrade.to}</strong>?
            </p>
            <div className="text-sm mb-4 space-y-1">
              <div>Resources consumed:</div>
              <div>Wood: <strong>{formatInt((pendingUpgrade.cost as any).wood)}</strong></div>
              <div>Stone: <strong>{formatInt((pendingUpgrade.cost as any).stone)}</strong></div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={cancelUpgrade} className="px-3 py-2 rounded-xl bg-slate-700">Cancel</button>
              <button onClick={confirmUpgrade} className="px-3 py-2 rounded-xl bg-emerald-600 text-white">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Banner Confirmation Modal */}
      {deleteBannerModal !== null && (() => {
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
      })()}

      {/* Siege Attack Modal */}
      {siegeAttackModal && (() => {
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
      })()}

      {/* Mercenary Reinforcement Confirmation Modal */}
      {reinforcementModal && (
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
      )}

      {/* Reinforce Modal */}
      {hireAndRefillModal && (
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
      )}

      {/* Reward Modal */}
      {rewardModal && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-4 border border-slate-800 text-center">
            <h4 className="text-lg font-semibold mb-2">Mission Complete</h4>
            <p className="text-sm mb-4">You received <strong>1 Gold</strong>.</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => claimMissionReward(rewardModal.missionId)} className="px-3 py-2 rounded-xl bg-amber-500 text-white">Collect</button>
            </div>
          </div>
        </div>
      )}

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
      {battleReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">Battle Report - {missions.find(m => m.id === battleReport.missionId)?.name}</h2>
              <button onClick={() => {
                const mission = missions.find(m => m.id === battleReport.missionId);
                // Only show reward popup if player won and rewards haven't been claimed yet
                const isVictory = battleReport.result.winner === 'player';
                if (isVictory && mission && mission.status === 'completedRewardsPending' && mission.enemyComposition) {
                  const enemyTotal = mission.enemyComposition.warrior + mission.enemyComposition.archer;
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
                      const enemyTotal = mission.enemyComposition.warrior + mission.enemyComposition.archer;
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
      )}

      {/* Reward Popup Modal */}
      {rewardPopup && (
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
                {rewardPopup.rewards.gold > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-yellow-400">💰</span>
                      <span className="text-slate-300">Gold</span>
                    </div>
                    <span className="text-yellow-400 font-semibold">{formatInt(rewardPopup.rewards.gold)}</span>
                  </div>
                )}
                {rewardPopup.rewards.wood > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-600">🪵</span>
                      <span className="text-slate-300">Wood</span>
                    </div>
                    <span className="text-amber-400 font-semibold">{formatInt(rewardPopup.rewards.wood)}</span>
                  </div>
                )}
                {rewardPopup.rewards.stone > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">🪨</span>
                      <span className="text-slate-300">Stone</span>
                    </div>
                    <span className="text-slate-300 font-semibold">{formatInt(rewardPopup.rewards.stone)}</span>
                  </div>
                )}
                {rewardPopup.rewards.food > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">🌾</span>
                      <span className="text-slate-300">Food</span>
                    </div>
                    <span className="text-green-400 font-semibold">{formatInt(rewardPopup.rewards.food)}</span>
                  </div>
                )}
                {rewardPopup.rewards.iron > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">⚙️</span>
                      <span className="text-slate-300">Iron</span>
                    </div>
                    <span className="text-gray-300 font-semibold">{formatInt(rewardPopup.rewards.iron)}</span>
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
      )}

      <footer className="mt-8 text-xs text-slate-500">
        Upgrade costs show the next level and use dual-resource seeds from the sheet, with exact tables where provided.
      </footer>
    </div>
  );
}
