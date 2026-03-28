// ============================================================================
// Zundral — Battle Simulator
// Pure, stateless simulation functions used by missions and the combat preview.
// No React imports. Accepts plain data; returns plain data.
// ============================================================================

import type { UnitType, Division, BattleResult, Commander } from './types';
import { unitCategory } from './constants';
import { getCommanderLevelBonusMultiplier } from './gameFormulas';

// ----------------------------------------------------------------------------
// Unit stat types
// ----------------------------------------------------------------------------

/** Per-unit combat statistics used by the simulator. */
export type UnitStat = {
  skirmish_attack: number;
  skirmish_defence: number;
  melee_attack: number;
  melee_defence: number;
  pursuit: number;
  morale_per_100: number;
};

export type UnitStats = Record<UnitType, UnitStat>;

/** Tunable parameters that control battle dynamics. */
export type BattleParams = {
  skirmish_ticks: number;
  pursuit_ticks: number;
  base_casualty_rate: number;
  morale_per_casualty: number;
  advantage_morale_tick: number;
  break_pct: number;
  rng_variance: number;
};

/** Flanking context — how many distinct directions each side attacks from. */
export type FlankingContext = {
  playerFlanking: number;  // 0 = no flank, 1 = from 2 dirs, 2 = from 3 dirs
  enemyFlanking: number;
};

// ----------------------------------------------------------------------------
// Default data — used for state initialisation in the component
// ----------------------------------------------------------------------------

/** Returns the default unit stats table (editable via the combat simulator UI). */
export function getDefaultUnitStats(): UnitStats {
  return {
    warrior: {
      skirmish_attack: 0,
      skirmish_defence: 15,
      melee_attack: 15,
      melee_defence: 12,
      pursuit: 3,
      morale_per_100: 110,
    },
    archer: {
      skirmish_attack: 30,
      skirmish_defence: 6,
      melee_attack: 5,
      melee_defence: 5,
      pursuit: 4,
      morale_per_100: 80,
    },
    skirmisher: {
      skirmish_attack: 18,
      skirmish_defence: 10,
      melee_attack: 10,
      melee_defence: 9,
      pursuit: 5,
      morale_per_100: 100,
    },
    crossbowmen: {
      skirmish_attack: 42,
      skirmish_defence: 10,
      melee_attack: 3,
      melee_defence: 4,
      pursuit: 3,
      morale_per_100: 90,
    },
    militia: {
      skirmish_attack: 0,
      skirmish_defence: 8,
      melee_attack: 8,
      melee_defence: 6,
      pursuit: 2,
      morale_per_100: 70,
    },
    longsword: {
      skirmish_attack: 0,
      skirmish_defence: 10,
      melee_attack: 22,
      melee_defence: 10,
      pursuit: 4,
      morale_per_100: 120,
    },
    pikemen: {
      skirmish_attack: 0,
      skirmish_defence: 12,
      melee_attack: 10,
      melee_defence: 16,
      pursuit: 2,
      morale_per_100: 110,
    },
    light_cavalry: {
      skirmish_attack: 6,
      skirmish_defence: 8,
      melee_attack: 16,
      melee_defence: 10,
      pursuit: 9,
      morale_per_100: 110,
    },
    heavy_cavalry: {
      skirmish_attack: 4,
      skirmish_defence: 10,
      melee_attack: 24,
      melee_defence: 14,
      pursuit: 10,
      morale_per_100: 130,
    },
  };
}

/** Returns the default battle parameters. */
export function getDefaultBattleParams(): BattleParams {
  return {
    skirmish_ticks: 30,
    pursuit_ticks: 20,
    base_casualty_rate: 0.6,
    morale_per_casualty: 0.8,
    advantage_morale_tick: 3,
    break_pct: 35,
    rng_variance: 0.05,
  };
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function per100(x: number): number {
  return x / 100;
}

/** Returns the sum of all troops in a division. */
export function total(div: Division): number {
  let sum = 0;
  for (const unitType in div) {
    sum += div[unitType as UnitType] || 0;
  }
  return Math.max(0, sum);
}

/** Returns combined morale value for a division. */
function morale(div: Division, stats: UnitStats): number {
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

/** Returns effective attack, defence, and pursuit values for a division in a given phase. */
function phaseStats(
  division: Division,
  stats: UnitStats,
  phase: string,
  commander?: Commander | null,
): { EA: number; ED: number; P: number } {
  let EA = 0, ED = 0, P = 0;

  const levelBonusMultiplier = commander
    ? getCommanderLevelBonusMultiplier(commander.level || 1)
    : 1;

  for (const unitType in division) {
    const count = division[unitType as UnitType] || 0;
    const c100 = per100(count);
    const s = stats[unitType as UnitType];
    if (!s) continue;

    let skirmishAttack = s.skirmish_attack;
    let meleeAttack = s.melee_attack;
    let skirmishDefence = s.skirmish_defence;
    let meleeDefence = s.melee_defence;

    if (commander) {
      const category = unitCategory[unitType as UnitType];
      const isRanged = category === 'ranged_infantry';

      if (isRanged) {
        skirmishAttack = s.skirmish_attack * (1 + commander.rangedAttackBonusPercent / 100);
        meleeAttack = s.melee_attack * (1 + commander.meleeAttackBonusPercent / 100);
      } else {
        // infantry or cavalry
        meleeAttack = s.melee_attack * (1 + commander.meleeAttackBonusPercent / 100);
        skirmishAttack = s.skirmish_attack * (1 + commander.rangedAttackBonusPercent / 100);
      }

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

/** Applies proportional troop losses across a division (mutates div). */
function applyCasualties(div: Division, losses: number): void {
  const s = total(div);
  if (s <= 0 || losses <= 0) return;

  for (const unitType in div) {
    const count = div[unitType as UnitType] || 0;
    const share = count / s;
    div[unitType as UnitType] = Math.max(0, count - losses * share);
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Aggregates melee unit count as 'warrior' and ranged unit count as 'archer'
 * for the legacy BattleResult shape.
 */
export function getWarriorArcherTotals(div: Division): { warrior: number; archer: number } {
  return {
    warrior:
      (div.warrior || 0) +
      (div.militia || 0) +
      (div.longsword || 0) +
      (div.pikemen || 0) +
      (div.light_cavalry || 0) +
      (div.heavy_cavalry || 0),
    archer: (div.archer || 0) + (div.skirmisher || 0) + (div.crossbowmen || 0),
  };
}

export type BattleStance = {
  playerDefending?: boolean;  // player side fights to the death (no retreat)
  enemyDefending?: boolean;   // enemy side fights to the death
};

/**
 * Runs a full skirmish → melee → pursuit/last_stand battle simulation.
 *
 * @param playerDiv     Player's starting division (not mutated; deep-copied internally).
 * @param enemyDiv      Enemy's starting division (not mutated; deep-copied internally).
 * @param stats         Per-unit combat stats (from `getDefaultUnitStats()` or saved custom values).
 * @param params        Battle tuning parameters (from `getDefaultBattleParams()` or saved custom values).
 * @param playerCommander  Optional commander whose bonuses apply to the player side.
 * @param flanking      Flanking context (morale penalties for being flanked).
 * @param stance        Defend stance: defending side never routs, fights to last_stand.
 */
export function simulateBattle(
  playerDiv: Division,
  enemyDiv: Division,
  stats: UnitStats,
  params: BattleParams,
  playerCommander?: Commander | null,
  flanking?: FlankingContext,
  stance?: BattleStance,
): BattleResult {
  // Deep copy divisions so originals are not mutated
  const A: Division = {};
  const B: Division = {};
  for (const key in playerDiv) A[key as UnitType] = playerDiv[key as UnitType];
  for (const key in enemyDiv) B[key as UnitType] = enemyDiv[key as UnitType];

  // Capture initial states (warrior/archer totals for BattleResult backward-compat shape)
  const playerInitialWA = getWarriorArcherTotals(A);
  const enemyInitialWA = getWarriorArcherTotals(B);
  const playerInitial = { warrior: playerInitialWA.warrior, archer: playerInitialWA.archer, total: total(A) };
  const enemyInitial = { warrior: enemyInitialWA.warrior, archer: enemyInitialWA.archer, total: total(B) };

  let mA = morale(A, stats);
  let mB = morale(B, stats);
  const mA0 = mA, mB0 = mB;

  // Flanking morale penalty: -20% starting morale per flanking level
  // Break thresholds use ORIGINAL morale, so flanked side reaches break faster
  if (flanking) {
    if (flanking.enemyFlanking > 0) {
      mA *= Math.max(0.4, 1 - 0.20 * flanking.enemyFlanking);
    }
    if (flanking.playerFlanking > 0) {
      mB *= Math.max(0.4, 1 - 0.20 * flanking.playerFlanking);
    }
  }

  const tA = Math.max(0, (params.break_pct || 20) / 100 * mA0);
  const tB = Math.max(0, (params.break_pct || 20) / 100 * mB0);
  let brokeA = false, brokeB = false;

  const tl: BattleResult['timeline'] = [];
  let tick = 0;

  function step(phase: string) {
    const SA = phaseStats(A, stats, phase, playerCommander);
    const SB = phaseStats(B, stats, phase);
    const sA = total(A) / 100;
    const sB = total(B) / 100;
    const rA = SA.EA / SB.ED;
    const rB = SB.EA / SA.ED;
    const nA = 1 + (Math.random() * 2 - 1) * params.rng_variance;
    const nB = 1 + (Math.random() * 2 - 1) * params.rng_variance;
    const lossB = params.base_casualty_rate * sA * rA * nA;
    const lossA = params.base_casualty_rate * sB * rB * nB;
    applyCasualties(A, lossA);
    applyCasualties(B, lossB);
    mB -= params.morale_per_casualty * lossB + params.advantage_morale_tick * Math.max(0, rA - 1);
    mA -= params.morale_per_casualty * lossA + params.advantage_morale_tick * Math.max(0, rB - 1);
    tick++;
    tl.push({
      tick,
      phase,
      A_troops: total(A),
      B_troops: total(B),
      A_morale: mA,
      B_morale: mB,
      AtoB: lossB,
      BtoA: lossA,
    });
  }

  // Skirmish phase
  for (let i = 0; i < params.skirmish_ticks; i++) {
    if (total(A) <= 0 || total(B) <= 0 || mA <= tA || mB <= tB) break;
    step('skirmish');
  }

  // Melee until one side breaks or is destroyed (defend stance = no rout)
  const playerDefends = stance?.playerDefending || false;
  const enemyDefends = stance?.enemyDefending || false;
  let guard = 0;
  while (total(A) > 0 && total(B) > 0) {
    const aBroken = mA <= tA;
    const bBroken = mB <= tB;

    // Normal rout exit — unless the broken side is defending
    if (aBroken && !playerDefends && !bBroken) break;
    if (bBroken && !enemyDefends && !aBroken) break;
    // Both broken: if neither is defending → draw exit; if one defends → they keep fighting
    if (aBroken && bBroken) {
      if (!playerDefends && !enemyDefends) break;
      // One or both defending: continue until troops gone
    }
    // Neither broken yet → normal melee
    if (!aBroken && !bBroken) {
      step('melee');
    } else {
      // At least one side broken but defending → last stand
      step('last_stand');
    }
    if (++guard > 5000) break;
  }

  if (mA <= tA && total(A) > 0) brokeA = true;
  if (mB <= tB && total(B) > 0) brokeB = true;

  // Determine winner — troop elimination always takes priority over morale
  let winner: 'player' | 'enemy' | 'draw' = 'draw';
  if (total(A) <= 0 && total(B) <= 0) winner = 'draw';
  else if (total(A) <= 0) winner = 'enemy';
  else if (total(B) <= 0) winner = 'player';
  else if ((mA <= tA || brokeA) && (mB <= tB || brokeB)) winner = 'draw';
  else if (mA <= tA || brokeA) winner = 'enemy';
  else if (mB <= tB || brokeB) winner = 'player';
  else winner = mA > mB ? 'player' : mB > mA ? 'enemy' : total(A) > total(B) ? 'player' : total(B) > total(A) ? 'enemy' : 'draw';

  // Pursuit phase — only if winner exists AND winner is NOT defending (defenders don't chase)
  const winnerDefends = (winner === 'player' && playerDefends) || (winner === 'enemy' && enemyDefends);
  const loserDefends = (winner === 'player' && enemyDefends) || (winner === 'enemy' && playerDefends);
  if ((winner === 'player' || winner === 'enemy') && params.pursuit_ticks > 0 && !winnerDefends && !loserDefends) {
    for (let i = 0; i < params.pursuit_ticks; i++) {
      const SA = phaseStats(A, stats, 'melee', playerCommander);
      const SB = phaseStats(B, stats, 'melee');
      const base = 0.25;
      if (winner === 'player') {
        const lossB = base * Math.max(0, SA.P) / Math.max(1, total(B) / 100);
        applyCasualties(B, lossB);
        mB -= params.morale_per_casualty * lossB;
        tl.push({ tick: ++tick, phase: 'pursuit', A_troops: total(A), B_troops: total(B), A_morale: mA, B_morale: mB, AtoB: lossB, BtoA: 0 });
      } else {
        const lossA = base * Math.max(0, SB.P) / Math.max(1, total(A) / 100);
        applyCasualties(A, lossA);
        mA -= params.morale_per_casualty * lossA;
        tl.push({ tick: ++tick, phase: 'pursuit', A_troops: total(A), B_troops: total(B), A_morale: mA, B_morale: mB, AtoB: 0, BtoA: lossA });
      }
      if (total(A) <= 0 || total(B) <= 0) break;
    }
  }

  const sA = total(A);
  const sB = total(B);
  const playerFinalWA = getWarriorArcherTotals(A);
  const enemyFinalWA = getWarriorArcherTotals(B);

  // brokeA / brokeB used only internally; suppress unused-variable warning
  void brokeA; void brokeB;

  return {
    winner,
    ticks: tick,
    playerInitial,
    playerFinal: { warrior: playerFinalWA.warrior, archer: playerFinalWA.archer, total: sA, morale: mA },
    enemyInitial,
    enemyFinal: { warrior: enemyFinalWA.warrior, archer: enemyFinalWA.archer, total: sB, morale: mB },
    timeline: tl,
  };
}
