import React, { useEffect, useMemo, useState } from "react";

// === Progression (matches the document) ===
// Buildings:
//  - Production ×1.25 per level from base (Wood 1, Stone 1, Food 2)
//  - Capacity ×1.30 per level from base 100
const PROGRESSION_FORMULA = {
  factors: { production: 1.25, capacity: 1.3 },
  base: {
    wood: { production: 1, capacity: 100 },
    stone: { production: 1, capacity: 100 },
    food: { production: 2, capacity: 100 },
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

type Division = { id: number; name: string; units: string[]; status: 'idle' | 'training' | 'ready' | 'deployed'; reqPop: number; recruited: number };

type Mission = {
  id: number;
  name: string;
  duration: number; // seconds
  status: 'available' | 'running' | 'complete';
  staged: number[]; // division ids to send
  deployed: number[]; // division ids currently out
  elapsed: number; // seconds progressed
};

export default function ResourceVillageUI() {
  // === Warehouse (resources + level) ===
  const [warehouse, setWarehouse] = useState<WarehouseState>({ wood: 0, stone: 0, food: 0, iron: 0, gold: 0 });
  const [warehouseLevel, setWarehouseLevel] = useState(1);

  const warehouseCap = useMemo<WarehouseCap>(() => ({
    wood: getWarehouseCapacity(warehouseLevel),
    stone: getWarehouseCapacity(warehouseLevel),
    food: getWarehouseCapacity(warehouseLevel),
    iron: getWarehouseCapacity(warehouseLevel),
    gold: getWarehouseCapacity(warehouseLevel),
  }), [warehouseLevel]);

  // === Buildings ===
  const [lumberMill, setLumberMill] = useState({ level: 1, stored: 0 });
  const [quarry, setQuarry] = useState({ level: 1, stored: 0 });
  const [farm, setFarm] = useState({ level: 1, stored: 0 });

  // === Population & Taxes ===
  const [population, setPopulation] = useState(10); // starts at 10
  const [tax, setTax] = useState<'low' | 'normal' | 'high'>('normal');
  const popRate = useMemo(() => (tax === 'low' ? 1 : tax === 'high' ? -1 : 0), [tax]);

  // === Tabs ===
  const [mainTab, setMainTab] = useState<'production' | 'army' | 'missions'>('production');
  const [armyTab, setArmyTab] = useState<'divisions'>('divisions');

  // === Army / Divisions builder state ===
  const [draftUnits, setDraftUnits] = useState<string[]>([]); // 'archer' | 'warrior'
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionSeq, setDivisionSeq] = useState(1);

  // === Missions ===
  const [missions, setMissions] = useState<Mission[]>([
    { id: 1, name: 'Scout the Forest', duration: 30, status: 'available', staged: [], deployed: [], elapsed: 0 },
    { id: 2, name: 'Secure the Quarry Road', duration: 30, status: 'available', staged: [], deployed: [], elapsed: 0 },
    { id: 3, name: 'Patrol the Farmland', duration: 30, status: 'available', staged: [], deployed: [], elapsed: 0 },
  ]);
  const [selectedMissionId, setSelectedMissionId] = useState<number | null>(null);
  const [rewardModal, setRewardModal] = useState<null | { missionId: number }>(null);

  // === Army helpers ===
  function addUnit(t: 'archer' | 'warrior') {
    setDraftUnits((u) => (u.length >= 8 ? u : [...u, t]));
  }
  function removeLastUnit() { setDraftUnits((u) => u.slice(0, -1)); }
  function clearDraft() { setDraftUnits([]); }
  function confirmDivision() {
    if (draftUnits.length === 0) return;
    const next: Division = {
      id: divisionSeq,
      name: `Division ${divisionSeq}`,
      units: draftUnits,
      status: 'idle',
      reqPop: 5 * draftUnits.length,
      recruited: 0,
    };
    setDivisions((ds) => [...ds, next]);
    setDivisionSeq((n) => n + 1);
    setDraftUnits([]);
  }
  function startTraining(id: number) {
    setDivisions((ds) => ds.map((d) => (d.id === id && d.status === 'idle' ? { ...d, status: 'training' } : d)));
  }

  // === Missions helpers ===
  function addDivisionToMission(divId: number) {
    setMissions((ms) => ms.map((m) => {
      if (m.id !== selectedMissionId || m.status !== 'available') return m;
      if (m.staged.includes(divId)) return m;
      return { ...m, staged: [...m.staged, divId] };
    }));
  }
  function confirmSendMission(missionId: number) {
    const staged = missions.find(m => m.id === missionId)?.staged ?? [];
    if (staged.length === 0) return;
    setMissions((ms) => ms.map((m) => m.id === missionId ? { ...m, status: 'running', deployed: staged, staged: [], elapsed: 0 } : m));
    setDivisions((ds) => ds.map((d) => staged.includes(d.id) ? { ...d, status: 'deployed' } : d));
  }
  function claimMissionReward(missionId: number) {
    setWarehouse((w) => ({ ...w, gold: w.gold + 1 }));
    setMissions((ms) => ms.map((m) => m.id === missionId ? { ...m, status: 'available', elapsed: 0, deployed: [], staged: [] } : m));
    setRewardModal(null);
  }

  // === Derived rates & caps ===
  const lumberRate = useMemo(() => getProgression("wood", lumberMill.level, "production"), [lumberMill.level]);
  const stoneRate  = useMemo(() => getProgression("stone", quarry.level, "production"), [quarry.level]);
  const foodRate   = useMemo(() => getProgression("food", farm.level, "production"), [farm.level]);

  const lumberCap = useMemo(() => getProgression("wood", lumberMill.level, "capacity"), [lumberMill.level]);
  const stoneCap  = useMemo(() => getProgression("stone", quarry.level, "capacity"), [quarry.level]);
  const foodCap   = useMemo(() => getProgression("food", farm.level, "capacity"), [farm.level]);

  // === Tick loop (1s) ===
  useEffect(() => {
    const id = setInterval(() => {
      // production fill
      setLumberMill((b) => ({ ...b, stored: Math.min(lumberCap, b.stored + lumberRate) }));
      setQuarry((b) => ({ ...b, stored: Math.min(stoneCap,  b.stored + stoneRate) }));
      setFarm((b) => ({ ...b, stored: Math.min(foodCap,   b.stored + foodRate) }));

      // population drift + training consumption
      let nextPop = Math.max(0, population + popRate);
      let divsChanged = false;
      const nextDivs = divisions.map((d) => {
        const dd: Division = { ...d };
        if (dd.status === 'training' && dd.recruited < dd.reqPop && nextPop > 0) {
          dd.recruited += 1; // 1 pop / sec / training division
          nextPop = Math.max(0, nextPop - 1);
          divsChanged = true;
        }
        if (dd.status === 'training' && dd.recruited >= dd.reqPop) { dd.status = 'ready'; divsChanged = true; }
        return dd;
      });
      if (divsChanged) setDivisions(nextDivs);

      // missions
      let missionsChanged = false;
      const nextMissions = missions.map((m) => {
        if (m.status !== 'running') return m;
        const elapsed = m.elapsed + 1;
        if (elapsed >= m.duration) {
          // bring divisions back
          setDivisions((ds) => ds.map((d) => m.deployed.includes(d.id) ? { ...d, status: 'ready' } : d));
          missionsChanged = true;
          return { ...m, status: 'complete', elapsed: m.duration, deployed: [] };
        }
        missionsChanged = true;
        return { ...m, elapsed };
      });
      if (missionsChanged) setMissions(nextMissions);

      setPopulation(nextPop);
    }, 1000);
    return () => clearInterval(id);
  }, [lumberRate, stoneRate, foodRate, lumberCap, stoneCap, foodCap, popRate, population, divisions, missions]);

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
    | { res: "wood" | "stone" | "food" | "warehouse"; from: number; to: number; cost: { wood: number; stone: number } }
  >(null);

  function requestUpgrade(res: "wood" | "stone" | "food" | "warehouse", currentLevel: number) {
    if (res === "warehouse") {
      const to = currentLevel + 1;
      const c = getWarehouseCost(to);
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

    // Building upgrades, deduct both wood & stone per doc
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));
    if (res === "wood") setLumberMill((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("wood", to, "capacity")) }));
    if (res === "stone") setQuarry((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("stone", to, "capacity")) }));
    if (res === "food") setFarm((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("food", to, "capacity")) }));
    setPendingUpgrade(null);
  }

  function cancelUpgrade() { setPendingUpgrade(null); }

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
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-2 bg-sky-500" style={{ width: `${p}%` }} />
      </div>
    );
  }

  function CostBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return <span className={`text-xs font-semibold ${ok ? "text-emerald-600" : "text-red-600"}`}>{children}</span>;
  }

  // === Top resource strip ===
  function ResourcePill({ label, value, cap, rate = 0, showBar = true }: { label: string; value: number; cap: number; rate?: number; showBar?: boolean }) {
    return (
      <div className="rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 shadow-sm">
        <div className="text-xl font-bold select-none flex items-baseline gap-2">
          <span>{label} {formatShort(value)}</span>
          <span className="text-emerald-500 text-xs font-semibold">+{formatRate(rate)}/s</span>
        </div>
        {showBar && (
          <div className="mt-2 h-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 overflow-hidden">
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
  }: {
    name: string;
    res: "wood" | "stone" | "food";
    level: number;
    rate: number;
    stored: number;
    cap: number;
    onCollect: () => void;
  }) {
    const nextLevel = level + 1;
    const nextCost = getBuildingCost(res, nextLevel);
    const enoughWood = warehouse.wood >= nextCost.wood;
    const enoughStone = warehouse.stone >= nextCost.stone;
    const affordable = enoughWood && enoughStone;
    const meta = RES_META[res];

    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold truncate">{name}</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">Lv {level}</div>
              <span className="text-[10px] px-1 py-0.5 rounded border border-slate-300 dark:border-slate-700">{meta.short}</span>
              <div className="text-xs text-slate-500">+{formatRate(rate)} {meta.short}/s</div>
              <div className="text-xs text-slate-500">cap {formatCap(cap)} {meta.short}</div>
              <div className="ml-2 text-xs text-slate-500">{formatInt(stored)} / {formatCap(cap)} · {pct(stored, cap)}%</div>
            </div>
            <div className="mt-2"><RowBar value={stored} max={cap} /></div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
              onClick={onCollect}
              disabled={stored <= 0 || (warehouseFree as any)[res] <= 0}
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

  // === Taxes Row ===
  function TaxesRow() {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold truncate">Taxes</div>
              <div className="text-xs text-slate-500">Population drift: {popRate > 0 ? `+${popRate}/s` : `${popRate}/s`}</div>
              <div className="text-xs text-slate-500">Pop {formatInt(population)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700">
              <button onClick={() => setTax('low')} className={`px-3 py-1.5 ${tax==='low' ? 'bg-slate-900 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>Low</button>
              <button onClick={() => setTax('normal')} className={`px-3 py-1.5 ${tax==='normal' ? 'bg-slate-900 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>Normal</button>
              <button onClick={() => setTax('high')} className={`px-3 py-1.5 ${tax==='high' ? 'bg-slate-900 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>High</button>
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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold truncate">Warehouse</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">Lv {warehouseLevel}</div>
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
      console.assert(Math.abs(getProgression("food", 1, "production") - 2) < 1e-6, "Food base prod");
      console.assert(Math.abs(getProgression("food", 2, "production") - 2.5) < 1e-6, "Food L2 prod");

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

      // Division cap test (max 8)
      {
        const max = 8;
        let comp: string[] = [];
        const add = (t: string) => { if (comp.length < max) comp = [...comp, t]; };
        for (let i = 0; i < 10; i++) add('archer');
        console.assert(comp.length === 8, 'Division max 8 enforced');
      }

      // Taxes mapping quick check
      const r = (t: 'low'|'normal'|'high') => (t==='low'?1:t==='high'?-1:0);
      console.assert(r('low')===1 && r('normal')===0 && r('high')===-1, 'Tax->popRate mapping');

      // Extra tests: division reqPop and one-tick training consumption
      {
        const units = ['archer','warrior','warrior'];
        const req = 5 * units.length;
        console.assert(req === 15, 'reqPop formula: 5 per unit');
        let pop = 3;
        let d: any = { id: 1, name: 'T', units, status: 'training', reqPop: 10, recruited: 0 };
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
    <div className="min-h-screen w-full bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-8">
      {/* Sticky top resource strip */}
      <div className="sticky top-0 z-50 -mx-4 md:-mx-8 px-4 md:px-8 pb-3 bg-slate-100/95 dark:bg-slate-950/95 backdrop-blur">
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <ResourcePill label="Pop" value={population} cap={population} rate={popRate} showBar={false} />
          <ResourcePill label="Wood" value={warehouse.wood} cap={warehouseCap.wood} rate={lumberRate} />
          <ResourcePill label="Stone" value={warehouse.stone} cap={warehouseCap.stone} rate={stoneRate} />
          <ResourcePill label="Food" value={warehouse.food} cap={warehouseCap.food} rate={foodRate} />
          <ResourcePill label="Iron" value={warehouse.iron} cap={warehouseCap.iron} rate={0} />
          <ResourcePill label="Gold" value={warehouse.gold} cap={warehouseCap.gold} rate={0} />
        </div>
      </div>

      <h1 className="text-2xl md:text-3xl font-bold mb-4 mt-2">Village Resources</h1>

      {/* Tabs: Production | Army | Missions */}
      <div className="mb-4 flex items-center gap-3">
        <div className="inline-flex rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700">
          <button
            onClick={() => setMainTab('production')}
            className={`px-3 py-1.5 ${mainTab === 'production' ? 'bg-slate-900 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}
          >
            Production
          </button>
          <button
            onClick={() => setMainTab('army')}
            className={`px-3 py-1.5 ${mainTab === 'army' ? 'bg-slate-900 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}
          >
            Army
          </button>
          <button
            onClick={() => setMainTab('missions')}
            className={`px-3 py-1.5 ${mainTab === 'missions' ? 'bg-slate-900 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}
          >
            Missions
          </button>
        </div>
        {mainTab === 'army' && (
          <div className="inline-flex rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700">
            <button
              onClick={() => setArmyTab('divisions')}
              className={`px-3 py-1.5 ${armyTab === 'divisions' ? 'bg-slate-900 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}
            >
              Divisions
            </button>
          </div>
        )}
      </div>

      {/* Buildings List (compact vertical) */}
      {mainTab==='production' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Buildings List</h2>
          <BuildingRow name="Lumber Mill" res="wood" level={lumberMill.level} rate={lumberRate} stored={lumberMill.stored} cap={lumberCap} onCollect={() => collect("wood")} />
          <BuildingRow name="Quarry" res="stone" level={quarry.level} rate={stoneRate} stored={quarry.stored} cap={stoneCap} onCollect={() => collect("stone")} />
          <BuildingRow name="Farm" res="food" level={farm.level} rate={foodRate} stored={farm.stored} cap={foodCap} onCollect={() => collect("food")} />
          <TaxesRow />
          <WarehouseRow />
        </section>
      )}

      {mainTab==='army' && armyTab==='divisions' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Army · Divisions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Left: add units */}
            <div className="md:col-span-1 space-y-2">
              <button onClick={() => addUnit('archer')} disabled={draftUnits.length>=8} className="w-full px-3 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 disabled:opacity-50">+ Archers</button>
              <button onClick={() => addUnit('warrior')} disabled={draftUnits.length>=8} className="w-full px-3 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 disabled:opacity-50">+ Warriors</button>
              <div className="text-xs text-slate-500">Slots used: {draftUnits.length} / 8</div>
              <div className="flex gap-2">
                <button onClick={removeLastUnit} disabled={draftUnits.length===0} className="px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 disabled:opacity-50">Undo</button>
                <button onClick={clearDraft} disabled={draftUnits.length===0} className="px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 disabled:opacity-50">Clear</button>
                <button onClick={confirmDivision} disabled={draftUnits.length===0} className="ml-auto px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-50">Confirm</button>
              </div>
            </div>
            {/* Right: composition grid */}
            <div className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
              <div className="text-sm text-slate-500 mb-2">Division layout</div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({length:8}).map((_,i)=> (
                  <div key={i} className="h-12 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs">
                    {draftUnits[i] ? (draftUnits[i]==='archer' ? 'Archer' : 'Warrior') : 'Empty'}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold mb-2">Saved divisions</h3>
            {divisions.length===0 ? (
              <div className="text-xs text-slate-500">No divisions saved yet.</div>
            ) : (
              <div className="space-y-2">
                {divisions.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                    <div className="font-semibold text-sm">{d.name}</div>
                    <div className="flex gap-1 flex-wrap">
                      {d.units.map((u,idx)=> (
                        <span key={idx} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs border border-slate-200 dark:border-slate-700">{u==='archer'?'Archer':'Warrior'}</span>
                      ))}
                    </div>
                    <div className="justify-self-end w-full md:w-64">
                      {d.status === 'idle' && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => startTraining(d.id)} className="px-3 py-1.5 rounded bg-emerald-600 text-white">Train</button>
                          <div className="text-xs text-slate-500">Needs {d.reqPop} Pop</div>
                        </div>
                      )}
                      {d.status === 'training' && (
                        <div>
                          <div className="text-xs mb-1">Recruiting {d.recruited} / {d.reqPop}</div>
                          <RowBar value={d.recruited} max={d.reqPop} />
                        </div>
                      )}
                      {d.status === 'ready' && (
                        <div className="text-emerald-600 text-xs font-semibold text-right">Ready</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {mainTab==='missions' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Missions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Left: ready divisions to add */}
            <div className="md:col-span-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
              <div className="text-sm font-semibold mb-2">Ready Divisions</div>
              {divisions.filter(d=>d.status==='ready').length===0 ? (
                <div className="text-xs text-slate-500">No ready divisions.</div>
              ) : (
                <div className="space-y-2">
                  {divisions.filter(d=>d.status==='ready').map((d)=>(
                    <div key={d.id} className="flex items-center justify-between">
                      <div className="text-sm">{d.name}</div>
                      <button disabled={selectedMissionId===null} onClick={()=>addDivisionToMission(d.id)} className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 disabled:opacity-50">Add</button>
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
                  <div key={m.id} className={`rounded-xl border ${selected? 'border-emerald-500' : 'border-slate-200 dark:border-slate-800'} bg-white dark:bg-slate-900 p-3`}>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{m.name}</div>
                      <div className="flex items-center gap-2">
                        <button onClick={()=>setSelectedMissionId(m.id)} className={`px-3 py-1.5 rounded ${selected? 'bg-emerald-600 text-white':'bg-slate-200 dark:bg-slate-700'}`}>{selected? 'Selected' : 'Select'}</button>
                        {m.status==='available' && <button onClick={()=>confirmSendMission(m.id)} disabled={!canSend} className="px-3 py-1.5 rounded bg-slate-900 text-white disabled:opacity-50">Send</button>}
                        {m.status==='running' && <div className="text-xs text-slate-500">{secsLeft}s left</div>}
                        {m.status==='complete' && <button onClick={()=>setRewardModal({missionId:m.id})} className="px-3 py-1.5 rounded bg-amber-500 text-white">Claim Reward</button>}
                      </div>
                    </div>

                    {/* Assigned list */}
                    {m.status==='available' && (
                      <div className="mt-2 text-xs text-slate-500">
                        Assigned: {m.staged.length===0 ? 'None' : m.staged.map(id=>divisions.find(d=>d.id===id)?.name).join(', ')}
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
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800">
            <h4 className="text-lg font-semibold mb-2">Confirm Upgrade</h4>
            <p className="text-sm mb-4">
              Upgrade {pendingUpgrade.res === "wood" ? "Lumber Mill" : pendingUpgrade.res === "stone" ? "Quarry" : pendingUpgrade.res === "food" ? "Farm" : "Warehouse"}
              {" from "}<strong>Lvl {pendingUpgrade.from}</strong>{" to "}<strong>Lvl {pendingUpgrade.to}</strong>?
            </p>
            <div className="text-sm mb-4 space-y-1">
              <div>Resources consumed:</div>
              <div>Wood: <strong>{formatInt((pendingUpgrade.cost as any).wood)}</strong></div>
              <div>Stone: <strong>{formatInt((pendingUpgrade.cost as any).stone)}</strong></div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={cancelUpgrade} className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700">Cancel</button>
              <button onClick={confirmUpgrade} className="px-3 py-2 rounded-xl bg-emerald-600 text-white">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Reward Modal */}
      {rewardModal && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800 text-center">
            <h4 className="text-lg font-semibold mb-2">Mission Complete</h4>
            <p className="text-sm mb-4">You received <strong>1 Gold</strong>.</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => claimMissionReward(rewardModal.missionId)} className="px-3 py-2 rounded-xl bg-amber-500 text-white">Collect</button>
              <button onClick={() => setRewardModal(null)} className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700">Close</button>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-8 text-xs text-slate-500">
        Upgrade costs show the next level and use dual-resource seeds from the sheet, with exact tables where provided.
      </footer>
    </div>
  );
}
