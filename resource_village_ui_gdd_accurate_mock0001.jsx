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
  wood: { wood: 67, stone: 27 },   // Lumber Mill L1→2
  stone: { wood: 75, stone: 60 },  // Quarry L1→2
  food:  { wood: 105, stone: 53 }, // Farm L1→2
};
const BUILDING_COST_FACTOR = 1.5;

// Optional exact per-level cost tables from the spreadsheet for perfect parity.
// Index 0 is cost to go from L1→L2, index 1 is L2→L3, etc.
const BUILDING_COST_TABLE: Partial<Record<"wood"|"stone"|"food", { wood: number[]; stone: number[] }>> = {
  wood: {
    // From screenshot columns F (Step Cost Wood) and G (Step Cost Stone)
    wood: [67, 101, 151, 226, 339, 509, 763, 1145, 1717, 2576],
    stone:[27,  41,  61,  91, 137, 205, 308,  463,  692, 1038],
  },
  // Provide Quarry/Farm arrays to lock exact numbers later.
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

export default function ResourceVillageUI() {
  // === Warehouse (resources + level) ===
  const [warehouse, setWarehouse] = useState<WarehouseState>({ wood: 0, stone: 0, food: 0, iron: 0, gold: 0 });
  const [warehouseLevel, setWarehouseLevel] = useState(1);

  // Derived per-type capacity by level (extend to iron/gold placeholders)
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

  // === Derived rates & caps ===
  const lumberRate = useMemo(() => getProgression("wood", lumberMill.level, "production"), [lumberMill.level]);
  const stoneRate = useMemo(() => getProgression("stone", quarry.level, "production"), [quarry.level]);
  const foodRate = useMemo(() => getProgression("food", farm.level, "production"), [farm.level]);

  const lumberCap = useMemo(() => getProgression("wood", lumberMill.level, "capacity"), [lumberMill.level]);
  const stoneCap = useMemo(() => getProgression("stone", quarry.level, "capacity"), [quarry.level]);
  const foodCap = useMemo(() => getProgression("food", farm.level, "capacity"), [farm.level]);

  // === Ticking production ===
  useEffect(() => {
    const id = setInterval(() => {
      setLumberMill((b) => ({ ...b, stored: Math.min(lumberCap, b.stored + lumberRate) }));
      setQuarry((b) => ({ ...b, stored: Math.min(stoneCap, b.stored + stoneRate) }));
      setFarm((b) => ({ ...b, stored: Math.min(foodCap, b.stored + foodRate) }));
    }, 1000);
    return () => clearInterval(id);
  }, [lumberRate, stoneRate, foodRate, lumberCap, stoneCap, foodCap]);

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
  function ResourcePill({ label, value, cap, rate = 0 }: { label: string; value: number; cap: number; rate?: number }) {
    const p = pct(value, cap);
    return (
      <div className="rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 shadow-sm">
        <div className="text-xl font-bold select-none flex items-baseline gap-2">
          <span>{label} {formatShort(value)}</span>
          <span className="text-emerald-500 text-xs font-semibold">+{formatRate(rate)}/s</span>
        </div>
        <div className="mt-2 h-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 overflow-hidden">
          <div className="h-full bg-sky-500" style={{ width: `${p}%` }} />
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
      // Building production/capacity checks (unchanged)
      console.assert(Math.abs(getProgression("wood", 2, "production") - 1.25) < 1e-6, "Wood L2 prod");
      console.assert(Math.abs(getProgression("wood", 3, "capacity") - 169) < 1e-6, "Wood L3 cap");
      console.assert(Math.abs(getProgression("food", 1, "production") - 2) < 1e-6, "Food base prod");
      console.assert(Math.abs(getProgression("food", 2, "production") - 2.5) < 1e-6, "Food L2 prod");

      // Building cost checks vs doc seeds & tables (aligned to show the *next level* row)
      const qc = getBuildingCost("stone", 2); // Quarry: when at Lv1, show Lv2 row from doc
      console.assert(qc.wood === 75 && qc.stone === 60, "Quarry next row (Lv2)");
      const fc = getBuildingCost("food", 2); // Farm next row (Lv2)
      console.assert(fc.wood === 105 && fc.stone === 53, "Farm next row (Lv2)");
      const lc2 = getBuildingCost("wood", 2); // Lumber: when at Lv1, show Lv2 row from doc
      console.assert(lc2.wood === 101 && lc2.stone === 41, "Lumber next row (Lv2)");
      const lc3 = getBuildingCost("wood", 3); // When at Lv2, show Lv3 row
      console.assert(lc3.wood === 151 && lc3.stone === 61, "Lumber next row (Lv3)");
      const lc4 = getBuildingCost("wood", 4); // When at Lv3, show Lv4 row
      console.assert(lc4.wood === 226 && lc4.stone === 91, "Lumber next row (Lv4)");
      const lc5 = getBuildingCost("wood", 5); // When at Lv4, show Lv5 row
      console.assert(lc5.wood === 339 && lc5.stone === 137, "Lumber next row (Lv5)");

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <ResourcePill label="Wood" value={warehouse.wood} cap={warehouseCap.wood} rate={lumberRate} />
          <ResourcePill label="Stone" value={warehouse.stone} cap={warehouseCap.stone} rate={stoneRate} />
          <ResourcePill label="Food" value={warehouse.food} cap={warehouseCap.food} rate={foodRate} />
          <ResourcePill label="Iron" value={warehouse.iron} cap={warehouseCap.iron} rate={0} />
          <ResourcePill label="Gold" value={warehouse.gold} cap={warehouseCap.gold} rate={0} />
        </div>
      </div>

      <h1 className="text-2xl md:text-3xl font-bold mb-4 mt-2">Village Resources</h1>

      {/* Buildings List (compact vertical) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Buildings List</h2>
        <BuildingRow name="Lumber Mill" res="wood" level={lumberMill.level} rate={lumberRate} stored={lumberMill.stored} cap={lumberCap} onCollect={() => collect("wood")} />
        <BuildingRow name="Quarry" res="stone" level={quarry.level} rate={stoneRate} stored={quarry.stored} cap={stoneCap} onCollect={() => collect("stone")} />
        <BuildingRow name="Farm" res="food" level={farm.level} rate={foodRate} stored={farm.stored} cap={foodCap} onCollect={() => collect("food")} />
        <WarehouseRow />
      </section>

      {/* Confirmation Modal */}
      {pendingUpgrade && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800">
            <h4 className="text-lg font-semibold mb-2">Confirm Upgrade</h4>
            <p className="text-sm mb-4">
              Upgrade {pendingUpgrade.res === "wood" ? "Lumber Mill" : pendingUpgrade.res === "stone" ? "Quarry" : pendingUpgrade.res === "food" ? "Farm" : "Warehouse"}
              {" from "}<strong>Lvl {pendingUpgrade.from}</strong>{" to "}<strong>Lvl {pendingUpgrade.to}</strong>?
            </p>
            {pendingUpgrade.res !== "warehouse" ? (
              <div className="text-sm mb-4 space-y-1">
                <div>Resources consumed:</div>
                <div>Wood: <strong>{formatInt((pendingUpgrade.cost as any).wood)}</strong></div>
                <div>Stone: <strong>{formatInt((pendingUpgrade.cost as any).stone)}</strong></div>
              </div>
            ) : (
              <div className="text-sm mb-4 space-y-1">
                <div>Resources consumed:</div>
                <div>Wood: <strong>{formatInt((pendingUpgrade.cost as any).wood)}</strong></div>
                <div>Stone: <strong>{formatInt((pendingUpgrade.cost as any).stone)}</strong></div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={cancelUpgrade} className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700">Cancel</button>
              <button onClick={confirmUpgrade} className="px-3 py-2 rounded-xl bg-emerald-600 text-white">Confirm</button>
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
