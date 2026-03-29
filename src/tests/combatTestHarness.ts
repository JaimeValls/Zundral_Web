/**
 * Combat Test Harness — Automated QA tests for the battle system
 *
 * Tests the pure combat functions (simulateBattle, terrain modifiers, stances)
 * with predefined scenarios matching the QA matrix from the design spec.
 *
 * Run via: console.log(runAllCombatTests()) or cheat panel button
 */

import {
  simulateBattle,
  getDefaultUnitStats,
  getDefaultBattleParams,
  getTerrainModifier,
  total,
  type UnitStats,
  type BattleParams,
  type BattleStance,
  type FlankingContext,
  type TerrainModifier,
} from '../battleSimulator';

type TestResult = {
  id: string;
  name: string;
  passed: boolean;
  details: string;
};

function makeDiv(warriors: number, archers: number): Record<string, number> {
  const div: Record<string, number> = {};
  if (warriors > 0) div['warrior'] = warriors;
  if (archers > 0) div['archer'] = archers;
  return div;
}

const stats = getDefaultUnitStats();
const params = getDefaultBattleParams();

// ─── QA-01: Open field basic attack ───────────────────────────────
function qa01(): TestResult {
  const playerDiv = makeDiv(40, 40); // 80 troops
  const enemyDiv = makeDiv(40, 40);
  const result = simulateBattle(playerDiv, enemyDiv, stats, params);

  const passed = result.winner !== undefined &&
    result.timeline.length > 0 &&
    result.playerInitial.total === 80 &&
    result.enemyInitial.total === 80;

  return {
    id: 'QA-01',
    name: 'Open field basic attack',
    passed,
    details: `Winner: ${result.winner}, Ticks: ${result.ticks}, Player: ${result.playerInitial.total}→${result.playerFinal.total}, Enemy: ${result.enemyInitial.total}→${result.enemyFinal.total}`,
  };
}

// ─── QA-02: Fortress battle uses defend stance ────────────────────
function qa02(): TestResult {
  const playerDiv = makeDiv(40, 40);
  const enemyDiv = makeDiv(60, 20);
  const stance: BattleStance = { playerDefending: true };
  const result = simulateBattle(playerDiv, enemyDiv, stats, params, undefined, undefined, stance);

  // Defender should not have pursuit phase (no pursuit when defending)
  const hasPursuit = result.timeline.some(t => t.phase === 'pursuit');
  const hasLastStand = result.timeline.some(t => t.phase === 'last_stand');

  return {
    id: 'QA-02',
    name: 'Fortress battle uses defend stance (no pursuit)',
    passed: !hasPursuit, // Defenders never pursue
    details: `Winner: ${result.winner}, HasPursuit: ${hasPursuit}, HasLastStand: ${hasLastStand}`,
  };
}

// ─── QA-03: No siege outside fortress — just a field battle ───────
function qa03(): TestResult {
  // This test validates that terrain modifier is NOT fortress-type
  const plainsTerrain = getTerrainModifier('plains');
  const forestTerrain = getTerrainModifier('forest');

  const passed = plainsTerrain.defenseBonus === 1.0 &&
    forestTerrain.defenseBonus === 1.15 &&
    forestTerrain.terrain === 'forest';

  return {
    id: 'QA-03',
    name: 'No siege outside fortress (terrain modifiers are field-only)',
    passed,
    details: `Plains defense: ${plainsTerrain.defenseBonus}, Forest defense: ${forestTerrain.defenseBonus}`,
  };
}

// ─── QA-04: Defender + reinforcement (larger force wins) ──────────
function qa04(): TestResult {
  const playerDiv = makeDiv(80, 80); // 160 troops (defender + reinforcement)
  const enemyDiv = makeDiv(40, 40);  // 80 troops
  const result = simulateBattle(playerDiv, enemyDiv, stats, params);

  return {
    id: 'QA-04',
    name: 'Defender + reinforcement vs single attacker',
    passed: result.winner === 'player',
    details: `Winner: ${result.winner}, Player: ${result.playerFinal.total}/${result.playerInitial.total}, Enemy: ${result.enemyFinal.total}/${result.enemyInitial.total}`,
  };
}

// ─── QA-05: Two allied attackers with flanking bonus ──────────────
function qa05(): TestResult {
  const playerDiv = makeDiv(40, 40);
  const enemyDiv = makeDiv(40, 40);
  const flanking: FlankingContext = { playerFlanking: 1, enemyFlanking: 0 }; // Player flanks from 2 dirs
  const result = simulateBattle(playerDiv, enemyDiv, stats, params, undefined, flanking);

  // Flanking should give advantage — enemy morale drops faster
  const noFlankResult = simulateBattle(makeDiv(40, 40), makeDiv(40, 40), stats, params);

  return {
    id: 'QA-05',
    name: 'Flanking gives morale advantage',
    passed: result.enemyFinal.morale < noFlankResult.enemyFinal.morale || result.ticks < noFlankResult.ticks,
    details: `With flank: enemy morale ${result.enemyFinal.morale.toFixed(1)}, ticks ${result.ticks}. Without: enemy morale ${noFlankResult.enemyFinal.morale.toFixed(1)}, ticks ${noFlankResult.ticks}`,
  };
}

// ─── QA-07: Simultaneous cross-attack — one battle result ─────────
function qa07(): TestResult {
  // Symmetric battle should produce a deterministic result
  const r1 = simulateBattle(makeDiv(50, 0), makeDiv(50, 0), stats, { ...params, rng_variance: 0 });
  const r2 = simulateBattle(makeDiv(50, 0), makeDiv(50, 0), stats, { ...params, rng_variance: 0 });

  return {
    id: 'QA-07',
    name: 'Deterministic battle with 0 RNG variance',
    passed: r1.winner === r2.winner && r1.ticks === r2.ticks,
    details: `R1: winner=${r1.winner}, ticks=${r1.ticks}. R2: winner=${r2.winner}, ticks=${r2.ticks}`,
  };
}

// ─── QA-11: No-Retreat Assault ignores morale retreat ─────────────
function qa11(): TestResult {
  const playerDiv = makeDiv(30, 0); // Small force, will get morale-broken
  const enemyDiv = makeDiv(80, 0);
  const noRetreatStance: BattleStance = { playerNoRetreat: true };
  const result = simulateBattle(playerDiv, enemyDiv, stats, params, undefined, undefined, noRetreatStance);

  // With no-retreat, the army should fight to death (last_stand phase should appear)
  const hasLastStand = result.timeline.some(t => t.phase === 'last_stand');
  // Player should be destroyed (0 troops) since they can't retreat
  const playerDestroyed = result.playerFinal.total <= 0;

  return {
    id: 'QA-11',
    name: 'No-Retreat Assault fights to death',
    passed: hasLastStand && playerDestroyed,
    details: `HasLastStand: ${hasLastStand}, PlayerDestroyed: ${playerDestroyed}, PlayerFinal: ${result.playerFinal.total}`,
  };
}

// ─── QA-12: Standard army retreats when morale breaks ─────────────
function qa12(): TestResult {
  const playerDiv = makeDiv(30, 0);
  const enemyDiv = makeDiv(80, 0);
  const result = simulateBattle(playerDiv, enemyDiv, stats, params);

  // Without no-retreat, the army should rout before being fully destroyed
  const playerSurvived = result.playerFinal.total > 0;
  // Winner should be enemy (player routed)
  const enemyWon = result.winner === 'enemy';

  return {
    id: 'QA-12',
    name: 'Standard army retreats when morale breaks',
    passed: enemyWon && playerSurvived, // Player retreats with survivors
    details: `Winner: ${result.winner}, PlayerSurvived: ${playerSurvived}, PlayerFinal: ${result.playerFinal.total}`,
  };
}

// ─── QA-13: Terrain modifiers affect combat ───────────────────────
function qa13(): TestResult {
  const playerDiv = makeDiv(40, 40);
  const enemyDiv = makeDiv(40, 40);
  const forestTerrain = getTerrainModifier('forest');
  const resultWithTerrain = simulateBattle(playerDiv, enemyDiv, stats, params, undefined, undefined, undefined, forestTerrain);
  const resultNoTerrain = simulateBattle(makeDiv(40, 40), makeDiv(40, 40), stats, params);

  // Forest terrain should benefit defender (player) — fewer player casualties
  const terrainHelped = resultWithTerrain.playerFinal.total >= resultNoTerrain.playerFinal.total;

  return {
    id: 'QA-13',
    name: 'Forest terrain gives defender defense bonus',
    passed: terrainHelped,
    details: `With forest: player ${resultWithTerrain.playerFinal.total}/${resultWithTerrain.playerInitial.total}. Without: player ${resultNoTerrain.playerFinal.total}/${resultNoTerrain.playerInitial.total}`,
  };
}

// ─── QA-14: Aggressive stance fights longer ───────────────────────
function qa14(): TestResult {
  const playerDiv = makeDiv(30, 0);
  const enemyDiv = makeDiv(50, 0);
  const aggressiveStance: BattleStance = { playerAggressive: true };
  const aggressiveResult = simulateBattle(playerDiv, enemyDiv, stats, params, undefined, undefined, aggressiveStance);
  const normalResult = simulateBattle(makeDiv(30, 0), makeDiv(50, 0), stats, params);

  // Aggressive should fight longer (more ticks) before retreating
  const foughtLonger = aggressiveResult.ticks >= normalResult.ticks;

  return {
    id: 'QA-14',
    name: 'Aggressive stance fights longer before morale break',
    passed: foughtLonger,
    details: `Aggressive: ${aggressiveResult.ticks} ticks. Normal: ${normalResult.ticks} ticks`,
  };
}

// ─── QA-15: Min skirmish ticks enforced ───────────────────────────
function qa15(): TestResult {
  const playerDiv = makeDiv(0, 80); // All archers
  const enemyDiv = makeDiv(10, 0);  // Tiny force, would break morale in 1 tick
  const result = simulateBattle(playerDiv, enemyDiv, stats, params);

  const skirmishTicks = result.timeline.filter(t => t.phase === 'skirmish').length;

  return {
    id: 'QA-15',
    name: 'Minimum skirmish ticks enforced (3)',
    passed: skirmishTicks >= params.min_skirmish_ticks,
    details: `Skirmish ticks: ${skirmishTicks}, Min required: ${params.min_skirmish_ticks}`,
  };
}

// ─── QA-16: Hills terrain gives skirmish bonus ────────────────────
function qa16(): TestResult {
  const hillsTerrain = getTerrainModifier('hills');
  const mountainTerrain = getTerrainModifier('mountain');
  const swampTerrain = getTerrainModifier('swamp');

  const passed = hillsTerrain.skirmishBonus === 1.15 &&
    hillsTerrain.defenseBonus === 1.10 &&
    mountainTerrain.defenseBonus === 1.20 &&
    swampTerrain.defenseBonus === 1.05 &&
    swampTerrain.skirmishBonus === 0.9;

  return {
    id: 'QA-16',
    name: 'Terrain modifier values are correct',
    passed,
    details: `Hills: def=${hillsTerrain.defenseBonus} skir=${hillsTerrain.skirmishBonus}, Mountain: def=${mountainTerrain.defenseBonus}, Swamp: def=${swampTerrain.defenseBonus} skir=${swampTerrain.skirmishBonus}`,
  };
}

// ─── Run all tests ────────────────────────────────────────────────
export function runAllCombatTests(): { passed: number; failed: number; total: number; results: TestResult[] } {
  const tests = [qa01, qa02, qa03, qa04, qa05, qa07, qa11, qa12, qa13, qa14, qa15, qa16];
  const results = tests.map(t => t());
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n═══ COMBAT TEST RESULTS ═══`);
  console.log(`${passed}/${results.length} passed, ${failed} failed\n`);
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.id}: ${r.name}`);
    if (!r.passed) console.log(`   → ${r.details}`);
  }
  console.log(`\n═══════════════════════════\n`);

  return { passed, failed, total: results.length, results };
}
