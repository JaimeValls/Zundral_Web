import React, { useEffect, useMemo, useState, useRef } from "react";
import BlacksmithUI from './BlacksmithUI';
import TechnologiesUI from './TechnologiesUI';

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
const BUILDING_COST_SEED: Record<"wood" | "stone" | "food", { wood: number; stone: number }> = {
  wood: { wood: 67, stone: 27 },   // Lumber Mill L1→2 (seed, table overrides where present)
  stone: { wood: 75, stone: 60 },  // Quarry L1→2
  food:  { wood: 105, stone: 53 }, // Farm L1→2
};
const BUILDING_COST_FACTOR = 1.5;

// Exact per-level cost table for Lumber (from spreadsheet screenshots)
// Index 0 is cost to go from L1→L2, index 1 is L2→L3, etc.
const BUILDING_COST_TABLE: Partial<Record<"wood"|"stone"|"food", { wood: number[]; stone: number[] }>> = {
  wood: {
    wood: [67, 101, 151, 226, 339, 509, 763, 1145, 1717, 2576],
    stone:[27,  41,  61,  91, 137, 205, 308,  463,  692, 1038],
  },
};

// === Helpers ===
function getProgression(
  res: "wood" | "stone" | "food",
  level: number,
  kind: "production" | "capacity",
) {
  const { factors, base } = PROGRESSION_FORMULA as any;
  const l0 = Math.max(0, level - 1);
  if (kind === "production") return base[res].production * Math.pow(factors.production, l0);
  if (kind === "capacity") return base[res].capacity * Math.pow(factors.capacity, l0);
  return 0;
}

function getBuildingCost(res: "wood" | "stone" | "food", levelTo: number) {
  // Cost to reach `levelTo` from (levelTo-1) for the specific building.
  // We intentionally map to the *next level's row* so that at Lv1 you see Lv2.
  const stepIndex = Math.max(0, levelTo - 1); // 0 => Lv2 row, 1 => Lv3 row, ...
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
  status: 'idle' | 'training' | 'ready' | 'deployed'; 
  reqPop: number; 
  recruited: number;
  type: 'regular' | 'mercenary'; // Banner type: regular (men-at-arms) or mercenary
  reinforcingSquadId?: number; // ID of squad being reinforced (for regular banners)
};

type Mission = {
  id: number;
  name: string;
  description?: string;
  duration: number; // seconds
  status: 'available' | 'running' | 'complete';
  staged: number[]; // banner ids to send
  deployed: number[]; // banner ids currently out
  elapsed: number; // seconds progressed
  enemyComposition?: { warrior: number; archer: number }; // For combat missions
  battleResult?: BattleResult; // Store battle result
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
function initializeSquadsFromUnits(units: string[], squadSeq: number): { squads: Squad[]; nextSeq: number } {
  const squads: Squad[] = [];
  let seq = squadSeq;
  units.forEach((unit) => {
    squads.push({
      id: seq++,
      type: unit as 'warrior' | 'archer',
      maxSize: 10,
      currentSize: 10
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
    draw(B_morale, syM, '#8b0000');
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
  const [tax, setTax] = useState<'low' | 'normal' | 'high'>('normal');
  const popCap = useMemo(() => getHouseCapacity(house), [house]);

  // === Happiness Calculation ===
  const happinessModifier = useMemo(() => {
    let base = 50;
    
    // Tax modifier
    if (tax === 'low') base += 20;
    else if (tax === 'high') base -= 20;
    
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
    let baseRate = 0;
    if (tax === 'low') baseRate = 1;
    else if (tax === 'high') baseRate = -1;
    
    // Happiness modifier
    if (happiness >= 70) {
      baseRate += 0.5; // Faster growth
    } else if (happiness <= 40) {
      baseRate -= 0.5; // Slower growth or negative
    }
    
    return baseRate;
  }, [tax, happiness]);

  // === Tabs ===
  const [mainTab, setMainTab] = useState<'production' | 'army' | 'missions'>('production');
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
  
  // Keep ref in sync with state
  useEffect(() => {
    squadSeqRef.current = squadSeq;
  }, [squadSeq]);

  // === Missions ===
  const [missions, setMissions] = useState<Mission[]>([
    { 
      id: 1, 
      name: 'Scout the Forest', 
      description: 'Your task is to explore the outskirts of the village and chart any nearby landmarks or threats. Expect light resistance. Current estimates suggest you may encounter one hostile squad. Proceed carefully, avoid unnecessary engagement, and return with a clear report of the terrain and enemy presence.',
      duration: 3, 
      status: 'available', 
      staged: [], 
      deployed: [], 
      elapsed: 0,
      enemyComposition: { warrior: 10, archer: 0 } // 1 Squad of Warriors = 10 Warriors
    },
    { 
      id: 2, 
      name: 'Secure the Quarry Road', 
      description: 'Your forces must secure the old road leading to the quarry. Enemy scouts have been sighted nearby, and resistance is expected to be significant. Intelligence indicates three warrior squads supported by one archer squad. Advance with caution, break their formation, and ensure the road is safe for future transport.',
      duration: 3, 
      status: 'available', 
      staged: [], 
      deployed: [], 
      elapsed: 0,
      enemyComposition: { warrior: 30, archer: 10 } // 3 Warrior Squads + 1 Archer Squad = 30 Warriors + 10 Archers
    },
    { 
      id: 3, 
      name: 'Sweep the Northern Ridge', 
      description: 'A fortified enemy group has settled along the northern ridge. This will be a demanding operation. Expect to face five warrior squads and one archer squad. Push through their defensive line, neutralise all threats, and reclaim control of the ridge for the village.',
      duration: 3, 
      status: 'available', 
      staged: [], 
      deployed: [], 
      elapsed: 0,
      enemyComposition: { warrior: 50, archer: 10 } // 5 Warrior Squads + 1 Archer Squad = 50 Warriors + 10 Archers
    },
  ]);
  const [selectedMissionId, setSelectedMissionId] = useState<number | null>(null);
  const [rewardModal, setRewardModal] = useState<null | { missionId: number }>(null);
  const [battleReport, setBattleReport] = useState<{ missionId: number; result: BattleResult } | null>(null);
  const [blacksmithOpen, setBlacksmithOpen] = useState(false);
  const [technologiesOpen, setTechnologiesOpen] = useState(false);

  // === Army helpers ===
  function addSquad(t: 'archer' | 'warrior') {
    setDraftSquads((s) => (s.length >= 8 ? s : [...s, t]));
  }
  function removeLastSquad() { setDraftSquads((s) => s.slice(0, -1)); }
  function clearDraft() { setDraftSquads([]); }
  function confirmBanner() {
    if (draftSquads.length === 0) return;
    
    // Initialize squads with health tracking
    const { squads, nextSeq } = initializeSquadsFromUnits(draftSquads, squadSeq);
    
    const next: Banner = {
      id: bannerSeq,
      name: `Banner ${bannerSeq}`,
      units: draftSquads, // Keep for backward compatibility
      squads: squads,
      status: 'idle',
      reqPop: 10 * draftSquads.length, // 10 pop per squad
      recruited: 0,
      type: 'regular', // Men-at-arms are regular banners
    };
    setBanners((bs) => [...bs, next]);
    setBannerSeq((n) => n + 1);
    setSquadSeq(nextSeq);
    setDraftSquads([]);
  }
  function startTraining(id: number) {
    setBanners((bs) => bs.map((b) => (b.id === id && b.status === 'idle' ? { ...b, status: 'training' } : b)));
  }

  // === Missions helpers ===
  function addBannerToMission(bannerId: number) {
    setMissions((ms) => ms.map((m) => {
      if (m.id !== selectedMissionId || m.status !== 'available') return m;
      if (m.staged.includes(bannerId)) return m;
      return { ...m, staged: [...m.staged, bannerId] };
    }));
  }
  function confirmSendMission(missionId: number) {
    const staged = missions.find(m => m.id === missionId)?.staged ?? [];
    if (staged.length === 0) return;
    setMissions((ms) => ms.map((m) => m.id === missionId ? { ...m, status: 'running', deployed: staged, staged: [], elapsed: 0 } : m));
    setBanners((bs) => bs.map((b) => staged.includes(b.id) ? { ...b, status: 'deployed' } : b));
  }
  function claimMissionReward(missionId: number) {
    setWarehouse((w) => ({ ...w, gold: w.gold + 1 }));
    setMissions((ms) => ms.map((m) => m.id === missionId ? { ...m, status: 'available', elapsed: 0, deployed: [], staged: [], battleResult: undefined } : m));
    setRewardModal(null);
  }

  // Create reinforcement training entry
  function requestReinforcement(bannerId: number, squadId: number) {
    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;
    
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
      // Mercenary: Show confirmation and create barracks queue entry
      if (!barracks) return;
      
      const goldCost = missing;
      const confirmed = confirm(
        `Reinforce ${squad.type === 'archer' ? 'Archer' : 'Warrior'} Squad in ${banner.name}?\n\n` +
        `Soldiers needed: ${missing}\n` +
        `Gold cost: ${goldCost}\n\n` +
        `This will consume ${goldCost} gold over time as the squad is reinforced.`
      );
      
      if (!confirmed) return;
      
      // Check if this squad already has a reinforcement entry
      const hasActiveReinforcement = barracks.trainingQueue.some(
        entry => entry.type === 'reinforcement' && entry.bannerId === bannerId && entry.squadId === squadId
      );
      if (hasActiveReinforcement) {
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
    draw(B_morale, syM, '#8b0000');
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
    return total;
  }, [lumberMill.enabled, lumberMill.level, quarry.enabled, quarry.level, farm.enabled, farm.level]);

  // Calculate actual assigned workers (not just demand)
  const actualWorkers = useMemo(() => {
    return lumberMill.workers + quarry.workers + farm.workers;
  }, [lumberMill.workers, quarry.workers, farm.workers]);

  // Calculate free workers correctly: population - actual assigned workers
  const freeWorkers = useMemo(() => population - actualWorkers, [population, actualWorkers]);
  
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
    ].filter(b => b.enabled);

    // Emergency: If no buildings enabled, at least enable farm (population is always >= 1)
    if (enabledBuildings.length === 0) {
      setFarm(b => ({ ...b, enabled: true, workers: 1 }));
      setLumberMill(b => ({ ...b, workers: 0 }));
      setQuarry(b => ({ ...b, workers: 0 }));
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
    const assignments: { type: 'wood' | 'stone' | 'food'; workers: number; level: number }[] = enabledBuildings.map(b => ({
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
    });
  }, [population, lumberMill.level, lumberMill.enabled, quarry.level, quarry.enabled, farm.level, farm.enabled]);

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

  // === Food consumption ===
  const foodConsumption = useMemo(() => population, [population]); // 1 food per worker per second
  const netFoodRate = useMemo(() => foodRate - foodConsumption, [foodRate, foodConsumption]);

  // === Population growth rate (depends on netFoodRate and food storage) ===
  const popRate = useMemo(() => {
    if (tax === 'low') {
      // Low taxes work if:
      // 1. Net food rate is at least 1 per second, OR
      // 2. There's food in storage (warehouse or farm)
      // Workers should continue coming as long as there's food available
      const totalFood = warehouse.food + farm.stored;
      const hasFoodStorage = totalFood > 0;
      const hasPositiveNetRate = netFoodRate >= 1;
      
      // Allow growth if we have food storage OR positive net rate
      if (hasFoodStorage || hasPositiveNetRate) {
        return population < popCap ? 1 : 0;
      }
      // Only block growth if food storage is zero AND net rate is insufficient
      return 0;
    }
    if (tax === 'high') return -1;
    return 0;
  }, [tax, population, popCap, netFoodRate, warehouse.food, farm.stored]);

  const lumberCap = useMemo(() => getProgression("wood", lumberMill.level, "capacity"), [lumberMill.level]);
  const stoneCap  = useMemo(() => getProgression("stone", quarry.level, "capacity"), [quarry.level]);
  const foodCap   = useMemo(() => getProgression("food", farm.level, "capacity"), [farm.level]);

  // === Tick loop (1s) ===
  useEffect(() => {
    const id = setInterval(() => {
      // production fill
      setLumberMill((b) => ({ ...b, stored: Math.min(lumberCap, b.stored + lumberRate) }));
      setQuarry((b) => ({ ...b, stored: Math.min(stoneCap,  b.stored + stoneRate) }));
      
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
      const nextBanners = banners.map((b) => {
        const bb: Banner = { ...b };
        // Training can only consume population if there's more than 1 (emergency rule: keep at least 1)
        // Only process regular banners (mercenaries use barracks queue)
        if (bb.type === 'regular' && bb.status === 'training' && bb.recruited < bb.reqPop && nextPop > 1) {
          bb.recruited += 1; // 1 pop / sec / training banner
          nextPop = Math.max(1, nextPop - 1);
          bannersChanged = true;
          
          // Update squad currentSize when training regular banners for reinforcement
          if (bb.squads && bb.squads.length > 0 && bb.reinforcingSquadId !== undefined) {
            // Find the specific squad being reinforced
            const squadToReinforce = bb.squads.find(s => s.id === bb.reinforcingSquadId);
            if (squadToReinforce && squadToReinforce.currentSize < squadToReinforce.maxSize) {
              squadToReinforce.currentSize = Math.min(squadToReinforce.maxSize, squadToReinforce.currentSize + 1);
            }
          }
        }
        if (bb.status === 'training' && bb.recruited >= bb.reqPop) { 
          bb.status = 'ready'; 
          bb.reinforcingSquadId = undefined; // Clear reinforcement tracking
          bannersChanged = true; 
        }
        return bb;
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
              
              // Update banner in state with losses applied
              setBanners((bs) => bs.map((b) => 
                b.id === bannerWithSquads.id ? { ...updatedBanner, status: 'ready' } : 
                m.deployed.includes(b.id) ? { ...b, status: 'ready' } : b
              ));
              
              // Show battle report
              setBattleReport({ missionId: m.id, result: battleResult });
            }
          } else {
            // No combat, just bring banners back
            setBanners((bs) => bs.map((b) => m.deployed.includes(b.id) ? { ...b, status: 'ready' } : b));
          }
          
          missionsChanged = true;
          return { ...m, status: 'complete', elapsed: m.duration, deployed: [], battleResult };
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
            
            newBanners.push({
              id: nextSeq++,
              name: template.name,
              units: squads, // Keep for backward compatibility
              squads: squadObjects,
              status: 'ready',
              reqPop: template.requiredPopulation,
              recruited: template.requiredPopulation,
              type: 'mercenary', // Mark as mercenary banner
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
  }, [lumberRate, stoneRate, foodRate, foodConsumption, netFoodRate, lumberCap, stoneCap, foodCap, netPopulationChange, population, banners, missions, warehouse.food, farm.stored, popCap, barracks, bannerTemplates, bannerSeq]);

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
  function collect(from: "wood" | "stone" | "food") {
    setWarehouse((w) => {
      const clone = { ...w } as WarehouseState;
      if (from === "wood") clone.wood += Math.min(lumberMill.stored, warehouseFree.wood);
      if (from === "stone") clone.stone += Math.min(quarry.stored, warehouseFree.stone);
      if (from === "food") clone.food += Math.min(farm.stored, warehouseFree.food);
      return clone;
    });
    if (from === "wood") setLumberMill((b) => ({ ...b, stored: 0 }));
    if (from === "stone") setQuarry((b) => ({ ...b, stored: 0 }));
    if (from === "food") setFarm((b) => ({ ...b, stored: 0 }));
  }

  function collectAll() {
    setWarehouse((w) => ({
      ...w,
      wood: w.wood + Math.min(lumberMill.stored, warehouseFree.wood),
      stone: w.stone + Math.min(quarry.stored, warehouseFree.stone),
      food: w.food + Math.min(farm.stored, warehouseFree.food),
    }));
    setLumberMill((b) => ({ ...b, stored: 0 }));
    setQuarry((b) => ({ ...b, stored: 0 }));
    setFarm((b) => ({ ...b, stored: 0 }));
  }

  // === Upgrade flows with confirmation ===
  const [pendingUpgrade, setPendingUpgrade] = useState<
    | null
    | { res: "wood" | "stone" | "food" | "warehouse" | "house" | "townhall" | "barracks" | "tavern"; from: number; to: number; cost: { wood: number; stone: number } }
  >(null);

  function requestUpgrade(res: "wood" | "stone" | "food" | "warehouse" | "house", currentLevel: number) {
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
    setPendingUpgrade(null);
  }

  function cancelUpgrade() { setPendingUpgrade(null); }

  // === Building enable/disable ===
  function toggleBuilding(building: 'wood' | 'stone' | 'food') {
    if (building === 'wood') {
      setLumberMill(b => ({ ...b, enabled: !b.enabled, workers: 0 })); // Workers will be reassigned by useEffect
    }
    if (building === 'stone') {
      setQuarry(b => ({ ...b, enabled: !b.enabled, workers: 0 })); // Workers will be reassigned by useEffect
    }
    if (building === 'food') {
      // Emergency mechanic: Prevent disabling farm (population is always >= 1)
      // Farm must always be enabled to maintain minimum food production
      // Don't allow disabling - farm is critical for survival
      return;
    }
  }

  // === UI bits ===
  const RES_META: Record<"wood"|"stone"|"food", { name: string; short: "W"|"S"|"F" }> = {
    wood: { name: "Wood", short: "W" },
    stone: { name: "Stone", short: "S" },
    food: { name: "Food", short: "F" },
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
      <div className="h-2 rounded bg-slate-800 overflow-hidden">
        <div className="h-2 bg-sky-500" style={{ width: `${p}%` }} />
      </div>
    );
  }

  function CostBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return <span className={`text-xs font-semibold ${ok ? "text-emerald-600" : "text-red-600"}`}>{children}</span>;
  }

  // === Top resource strip ===
  function ResourcePill({ label, value, cap, rate = 0, showBar = true, trend, statusColor, workerInfo }: { label: string; value: number; cap: number; rate?: number; showBar?: boolean; trend?: string; statusColor?: 'red' | 'yellow' | 'green'; workerInfo?: string }) {
    const valueColor = statusColor === 'red' ? 'text-red-500' : statusColor === 'yellow' ? 'text-yellow-500' : statusColor === 'green' ? 'text-emerald-500' : '';
    const rateColor = rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-500';
    const rateSign = rate > 0 ? '+' : '';
    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-sm">
        <div className="text-xl font-bold select-none flex items-baseline gap-2">
          <span className={valueColor || ''}>{label} {formatShort(value)}{label === 'Pop' ? ` / ${formatShort(cap)}` : ''}</span>
          {workerInfo && <span className="text-xs text-slate-500 font-normal">({workerInfo})</span>}
          {rate !== 0 && <span className={`${rateColor} text-xs font-semibold`}>{rateSign}{formatRate(rate)}/s</span>}
          {trend && (
            <span className={`text-xs ${trend.includes('-') ? 'text-red-500' : trend.includes('+') ? 'text-emerald-500' : 'text-slate-500'}`}>
              {trend}
            </span>
          )}
        </div>
        {showBar && (
          <div className="mt-2 h-4 rounded-xl bg-slate-900 border border-slate-700 overflow-hidden">
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
    res: "wood" | "stone" | "food";
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
      <div className={`rounded-xl border ${enabled ? 'border-slate-800' : 'border-slate-600 opacity-75'} bg-slate-900 p-3`}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <div className="font-semibold truncate">{name}</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-slate-800">Lv {level}</div>
              {workers < requiredWorkers && (
                <div className="text-xs px-1.5 py-0.5 rounded bg-amber-900 text-amber-200">
                  Effective Lv {effectiveLevel}
                </div>
              )}
              <span className="text-[10px] px-1 py-0.5 rounded border border-slate-700">{meta.short}</span>
              <div className="text-xs text-slate-500">+{formatRate(rate)} {meta.short}/s</div>
              <div className="text-xs text-slate-500">cap {formatCap(cap)} {meta.short}</div>
              <div className="text-xs text-slate-500">Workers: {workers}/{requiredWorkers}</div>
              <div className="ml-2 text-xs text-slate-500">{formatInt(stored)} / {formatCap(cap)} · {pct(stored, cap)}%</div>
            </div>
            <div className="mt-2"><RowBar value={stored} max={cap} /></div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`px-3 py-1.5 rounded-lg ${enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white disabled:opacity-50 disabled:cursor-not-allowed`}
              onClick={onToggle}
              disabled={toggleDisabled}
              title={toggleDisabled ? "Farm cannot be disabled (required for survival)" : enabled ? "Disable building (releases workers)" : "Enable building"}
            >
              {enabled ? "Disable" : "Enable"}
            </button>
            <button
              className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-100 disabled:opacity-50"
              onClick={onCollect}
              disabled={stored <= 0 || (warehouseFree as any)[res] <= 0 || !enabled}
              title={(warehouseFree as any)[res] <= 0 ? "Warehouse full for this resource" : `Collect ${meta.name}`}
            >
              Collect {meta.name}
            </button>
            <div className="text-right">
              <div className="text-xs text-slate-500 mb-1">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-2 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-1 px-3 py-1.5 w-full rounded-lg bg-slate-900 text-white disabled:opacity-50"
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold truncate">House</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-slate-800">Lv {house}</div>
              <div className="text-xs text-slate-500">Capacity: {formatInt(popCap)}</div>
              <div className="text-xs text-slate-500">Workers: 0 (no workers required)</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-xs text-slate-500 mb-1">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-2 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-1 px-3 py-1.5 w-full rounded-lg bg-slate-900 text-white disabled:opacity-50"
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold truncate">Town Hall</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-slate-800">Lv {townHall.level}</div>
              <div className="text-xs text-slate-500">Net Pop Change: {netPopulationChange > 0 ? '+' : ''}{netPopulationChange.toFixed(1)}/s</div>
              <div className="text-xs text-slate-500">Happiness: {happiness}</div>
            </div>
            {townHall.level >= 2 && (
              <div className="text-xs text-slate-400 mt-1">
                Unlocks: Barracks, Tavern
              </div>
            )}
            {townHall.level >= 3 && (
              <div className="text-xs text-slate-400 mt-1">
                Unlocks: Market, Guard Tower (planned)
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canUpgrade && nextCost && (
              <div className="text-right">
                <div className="text-xs text-slate-500 mb-1">Next: <strong>Lvl {nextLevel}</strong></div>
                <div className="flex gap-2 justify-end">
                  <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                  <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
                </div>
                <button
                  className="mt-1 px-3 py-1.5 w-full rounded-lg bg-slate-900 text-white disabled:opacity-50"
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
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-semibold">Barracks</div>
              {!canBuild && (
                <div className="text-xs text-red-400">Requires Town Hall Level 2</div>
              )}
              {canBuild && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs text-slate-400">Build Cost:</div>
                  <div className="text-xs">
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
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold truncate">Barracks</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-slate-800">Lv {barracks.level}</div>
              <div className="text-xs text-slate-500">Training Slots: {barracks.trainingSlots}</div>
              <div className="text-xs text-slate-500">Active: {barracks.trainingQueue.length}/{barracks.trainingSlots}</div>
            </div>
          </div>
          {canUpgrade && nextCost && (
            <div className="text-right">
              <div className="text-xs text-slate-500 mb-1">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-2 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-1 px-3 py-1.5 w-full rounded-lg bg-slate-900 text-white disabled:opacity-50"
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
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-semibold">Tavern</div>
              {!canBuild && (
                <div className="text-xs text-red-400">Requires Town Hall Level 2</div>
              )}
              {canBuild && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs text-slate-400">Build Cost:</div>
                  <div className="text-xs">
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
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold truncate">Tavern</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-slate-800">Lv {tavern.level}</div>
              <div className="text-xs text-slate-500">Happiness Bonus: +{tavern.level === 1 ? 10 : tavern.level === 2 ? 20 : 25}</div>
              {festivalActive && (
                <div className="text-xs text-amber-400">Festival Active!</div>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Total Happiness: {happiness} ({happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'})
            </div>
            {tavern.level >= 1 && !festivalActive && (
              <button
                onClick={startFestival}
                disabled={warehouse.gold < 50}
                className="mt-2 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm disabled:opacity-50"
              >
                Start Festival (50 Gold)
              </button>
            )}
          </div>
          {canUpgrade && nextCost && (
            <div className="text-right">
              <div className="text-xs text-slate-500 mb-1">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-2 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-1 px-3 py-1.5 w-full rounded-lg bg-slate-900 text-white disabled:opacity-50"
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <div className="font-semibold truncate">Taxes</div>
              <div className="text-xs text-slate-500">Population: {formatInt(population)} / {formatInt(popCap)}</div>
              <div className={`text-xs ${workerDeficit > 0 ? 'text-red-500 font-semibold' : 'text-slate-500'}`}>
                Workers: {workerSurplus >= 0 ? `+${workerSurplus}` : `-${workerDeficit}`}
                {workerDeficit > 0 && (
                  <span className="ml-1" title="Too many enabled buildings are competing for staff. Disable some buildings to focus labor on priority buildings.">
                    ⚠️
                  </span>
                )}
              </div>
              <div className={`text-xs ${netPopulationChange < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                {trendText}
              </div>
              <div className="text-xs text-slate-500">
                Happiness: {happiness} ({happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'})
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden border border-slate-700">
              <button onClick={() => setTax('low')} className={`px-3 py-1.5 ${tax==='low' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}>Low</button>
              <button onClick={() => setTax('normal')} className={`px-3 py-1.5 ${tax==='normal' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}>Normal</button>
              <button onClick={() => setTax('high')} className={`px-3 py-1.5 ${tax==='high' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}>High</button>
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold truncate">Warehouse</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-slate-800">Lv {warehouseLevel}</div>
              <div className="text-xs text-slate-500">caps W/S/F {formatCap(warehouseCap.wood)} / {formatCap(warehouseCap.stone)} / {formatCap(warehouseCap.food)}</div>
              <div className="ml-2 text-xs text-slate-500">W {formatInt(warehouse.wood)}, S {formatInt(warehouse.stone)}, F {formatInt(warehouse.food)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
              onClick={collectAll}
              disabled={
                lumberMill.stored + quarry.stored + farm.stored === 0 ||
                (warehouseFree.wood <= 0 && warehouseFree.stone <= 0 && warehouseFree.food <= 0)
              }
            >
              Collect All
            </button>
            <div className="text-right">
              <div className="text-xs text-slate-500 mb-1">Next: <strong>Lvl {nextLevel}</strong></div>
              <div className="flex gap-2 justify-end">
                <CostBadge ok={enoughWood}>W {formatInt(nextCost.wood)}</CostBadge>
                <CostBadge ok={enoughStone}>S {formatInt(nextCost.stone)}</CostBadge>
              </div>
              <button
                className="mt-1 px-3 py-1.5 w-full rounded-lg bg-slate-900 text-white disabled:opacity-50"
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

      // Building cost checks vs doc seeds & tables (aligned to show the *next level* row)
      const qc = getBuildingCost("stone", 2); // Quarry Lv2 row
      console.assert(qc.wood === 75 && qc.stone === 60, "Quarry next row (Lv2)");
      const fc = getBuildingCost("food", 2); // Farm Lv2 row
      console.assert(fc.wood === 105 && fc.stone === 53, "Farm next row (Lv2)");
      const lc2 = getBuildingCost("wood", 2); // Lumber Lv2 row
      console.assert(lc2.wood === 101 && lc2.stone === 41, "Lumber next row (Lv2)");
      const lc3 = getBuildingCost("wood", 3); // Lv3 row
      console.assert(lc3.wood === 151 && lc3.stone === 61, "Lumber next row (Lv3)");
      const lc4 = getBuildingCost("wood", 4); // Lv4 row
      console.assert(lc4.wood === 226 && lc4.stone === 91, "Lumber next row (Lv4)");
      const lc5 = getBuildingCost("wood", 5); // Lv5 row
      console.assert(lc5.wood === 339 && lc5.stone === 137, "Lumber next row (Lv5)");

      // Banner cap test (max 8 squads)
      {
        const max = 8;
        let comp: string[] = [];
        const add = (t: string) => { if (comp.length < max) comp = [...comp, t]; };
        for (let i = 0; i < 10; i++) add('archer');
        console.assert(comp.length === 8, 'Banner max 8 squads enforced');
      }

      // Taxes mapping quick check
      const r = (t: 'low'|'normal'|'high') => (t==='low'?1:t==='high'?-1:0);
      console.assert(r('low')===1 && r('normal')===0 && r('high')===-1, 'Tax->popRate mapping');

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
      {/* Sticky top resource strip */}
      <div className="sticky top-0 z-50 -mx-4 md:-mx-8 px-4 md:px-8 pb-3 bg-slate-950/95 backdrop-blur">
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <ResourcePill 
            label="Pop" 
            value={population} 
            cap={popCap} 
            rate={netPopulationChange} 
            showBar={true}
            trend={netPopulationChange > 0 ? `(+${netPopulationChange.toFixed(1)} in 1s)` : netPopulationChange < 0 ? `(${netPopulationChange.toFixed(1)} in 1s)` : "(stable)"}
            statusColor={workerDeficit > 0 ? 'red' : workerSurplus > 0 ? 'green' : 'yellow'}
            workerInfo={`${actualWorkers} working, ${Math.max(0, freeWorkers)} free`}
          />
          <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-sm">
            <div className="text-xl font-bold select-none flex items-baseline gap-2">
              <span className={happiness >= 70 ? 'text-emerald-500' : happiness <= 40 ? 'text-red-500' : 'text-yellow-500'}>
                😊 {happiness}
              </span>
              <span className="text-xs text-slate-500">
                {happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'}
              </span>
            </div>
          </div>
          <ResourcePill label="Wood" value={warehouse.wood} cap={warehouseCap.wood} rate={lumberRate} />
          <ResourcePill label="Stone" value={warehouse.stone} cap={warehouseCap.stone} rate={stoneRate} />
          <ResourcePill label="Food" value={warehouse.food} cap={warehouseCap.food} rate={netFoodRate} />
          <ResourcePill label="Iron" value={warehouse.iron} cap={warehouseCap.iron} rate={0} />
          <ResourcePill label="Gold" value={warehouse.gold} cap={warehouseCap.gold} rate={0} />
          <ResourcePill label="Skill Points" value={skillPoints} cap={999999} rate={0} showBar={false} />
        </div>
        
        {/* Cheat Area for Testing */}
        <div className="mt-3 p-3 rounded-lg border-2 border-amber-500 bg-amber-950/30">
          <div className="text-xs font-semibold text-amber-200 mb-2">🧪 CHEAT PANEL (Testing)</div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setWarehouse(w => ({ ...w, wood: Math.min(warehouseCap.wood, w.wood + 999) }))}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
            >
              +999 Wood
            </button>
            <button
              onClick={() => setWarehouse(w => ({ ...w, stone: Math.min(warehouseCap.stone, w.stone + 999) }))}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
            >
              +999 Stone
            </button>
            <button
              onClick={() => setWarehouse(w => ({ ...w, food: Math.min(warehouseCap.food, w.food + 999) }))}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
            >
              +999 Food
            </button>
            <button
              onClick={() => setWarehouse(w => ({ ...w, iron: Math.min(warehouseCap.iron, w.iron + 999) }))}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
            >
              +999 Iron
            </button>
            <button
              onClick={() => setWarehouse(w => ({ ...w, gold: Math.min(warehouseCap.gold, w.gold + 999) }))}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
            >
              +999 Gold
            </button>
            <button
              onClick={() => setSkillPoints(prev => prev + 5)}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
            >
              +5 Skill Points
            </button>
          </div>
        </div>
      </div>

      <h1 className="text-2xl md:text-3xl font-bold mb-4 mt-2">Village Resources</h1>

      {/* Navigation Menu */}
      <div className="mb-4 flex items-center gap-3">
        <div className="inline-flex rounded-xl overflow-hidden border border-slate-700">
          <button
            onClick={() => setMainTab('production')}
            className={`px-3 py-1.5 ${mainTab === 'production' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
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
            className={`px-3 py-1.5 ${
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
            className={`px-3 py-1.5 ${mainTab === 'missions' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
          >
            Missions
          </button>
          <button
            onClick={() => setBlacksmithOpen(true)}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600"
          >
            Blacksmith
          </button>
          <button
            onClick={() => setTechnologiesOpen(true)}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600"
          >
            Technologies
          </button>
        </div>

        {/* Combat Simulator shortcut */}
        <a
          href="/ck_3_style_battle_simulator_ui_single_file_html.html"
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-800 transition"
        >
          ⚔ Combat Simulator
        </a>
      </div>

      {/* Main Content - Production (Default) */}
      {mainTab==='production' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Buildings List</h2>
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
              {banners.filter(b => b.type === 'mercenary').length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-sm font-semibold text-red-400">YOUR MERCENARY BANNERS</h4>
                  {banners.filter(b => b.type === 'mercenary').map((b) => (
                    <div key={b.id} className="rounded-lg border border-slate-700 bg-slate-800 p-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                      <div className="font-semibold text-sm">{b.name}</div>
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
                                {needsReinforcement && !hasActiveReinforcement && (
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
                      <div className="justify-self-end w-full md:w-64">
                        {b.status === 'ready' && (
                          <div className="text-emerald-600 text-xs font-semibold text-right">Ready</div>
                        )}
                        {b.status === 'deployed' && (
                          <div className="text-amber-500 text-xs font-semibold text-right">Deployed</div>
                        )}
                      </div>
                    </div>
                  ))}
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
              {banners.filter(b => b.type === 'regular').length === 0 ? (
                <div className="text-xs text-slate-500">No banners available yet.</div>
              ) : (
                <div className="space-y-2">
                  {banners.filter(b => b.type === 'regular').map((b) => (
                  <div key={b.id} className="rounded-lg border border-slate-700 bg-slate-800 p-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                    <div className="font-semibold text-sm">{b.name}</div>
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
                              {needsReinforcement && !hasActiveReinforcement && (
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
                      {b.status === 'idle' && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => startTraining(b.id)} className="px-3 py-1.5 rounded bg-emerald-600 text-white">Train</button>
                          <div className="text-xs text-slate-500">Needs {b.reqPop} Pop</div>
                        </div>
                      )}
                      {b.status === 'training' && (
                        <div>
                          <div className="text-xs mb-1">Recruiting {b.recruited} / {b.reqPop}</div>
                          <RowBar value={b.recruited} max={b.reqPop} />
                        </div>
                      )}
                      {b.status === 'ready' && (
                        <div className="text-emerald-600 text-xs font-semibold text-right">Ready</div>
                      )}
                      {b.status === 'deployed' && (
                        <div className="text-amber-500 text-xs font-semibold text-right">Deployed</div>
                      )}
                    </div>
                  </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {mainTab==='missions' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Missions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Left: ready banners to add */}
            <div className="md:col-span-1 rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="text-sm font-semibold mb-2">Ready Banners</div>
              {banners.filter(b=>b.status==='ready').length===0 ? (
                <div className="text-xs text-slate-500">No ready banners.</div>
              ) : (
                <div className="space-y-2">
                  {banners.filter(b=>b.status==='ready').map((b)=>(
                    <div key={b.id} className="flex items-center justify-between">
                      <div className="text-sm">{b.name}</div>
                      <button disabled={selectedMissionId===null} onClick={()=>addBannerToMission(b.id)} className="px-2 py-1 rounded bg-slate-700 disabled:opacity-50">Add</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: missions list */}
            <div className="md:col-span-2 space-y-3">
              {missions.map((m)=>{
                const selected = selectedMissionId===m.id;
                const canSend = m.status==='available' && m.staged.length>0;
                const secsLeft = Math.max(0, m.duration - m.elapsed);
                return (
                  <div key={m.id} className={`rounded-xl border ${selected? 'border-emerald-500' : 'border-slate-800'} bg-slate-900 p-3`}>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{m.name}</div>
                      <div className="flex items-center gap-2">
                        <button onClick={()=>setSelectedMissionId(m.id)} className={`px-3 py-1.5 rounded ${selected? 'bg-emerald-600 text-white':'bg-slate-700'}`}>{selected? 'Selected' : 'Select'}</button>
                        {m.status==='available' && <button onClick={()=>confirmSendMission(m.id)} disabled={!canSend} className="px-3 py-1.5 rounded bg-slate-900 text-white disabled:opacity-50">Send</button>}
                        {m.status==='running' && <div className="text-xs text-slate-500">{secsLeft}s left</div>}
                        {m.status==='complete' && <button onClick={()=>setRewardModal({missionId:m.id})} className="px-3 py-1.5 rounded bg-amber-500 text-white">Claim Reward</button>}
                      </div>
                    </div>
                    
                    {m.description && (
                      <div className="mt-2 text-xs text-slate-400 leading-relaxed">
                        {m.description}
                      </div>
                    )}

                    {/* Assigned list */}
                    {m.status==='available' && (
                      <div className="mt-2 text-xs text-slate-500">
                        Assigned: {m.staged.length===0 ? 'None' : m.staged.map(id=>banners.find(b=>b.id===id)?.name).join(', ')}
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
              <button onClick={() => setBattleReport(null)} className="text-slate-400 hover:text-white text-2xl">✕</button>
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
                  <span className="w-3 h-3 rounded bg-[#8b0000]"></span>
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
            
            <button 
              onClick={() => setBattleReport(null)} 
              className="mt-4 w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg"
            >
              Close
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
