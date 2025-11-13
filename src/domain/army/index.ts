import type { ArmyTemplate, ArmyDivision, BattalionSlot } from '../../types/core'
import type { Cost } from '../../types/economy'

/**
 * Calculate total unit count in a division
 */
export function calcTotalUnits(battalions: BattalionSlot[]): number {
  return battalions.reduce((sum, b) => sum + b.count, 0)
}

/**
 * Calculate division power based on battalions and strength
 */
export function calcDivisionPower(battalions: BattalionSlot[]): number {
  return battalions.reduce((power, b) => {
    const effectiveCount = b.count * (b.strength / 100)
    return power + effectiveCount * 10 // Base power per unit
  }, 0)
}

/**
 * Create a new army division from template
 */
export function createDivisionFromTemplate(
  template: ArmyTemplate,
  id: string
): ArmyDivision {
  const battalions = template.battalions.map((b) => ({
    ...b,
    strength: 100, // Start at full strength
  }))
  const power = calcDivisionPower(battalions)

  return {
    id,
    templateId: template.id,
    battalions,
    power,
  }
}

/**
 * Calculate training cost for units
 */
export function calcTrainingCost(unitCount: number): Cost {
  return {
    wood: unitCount * 10,
    stone: unitCount * 5,
    food: unitCount * 20,
    iron: unitCount * 15,
  }
}

/**
 * Calculate refill cost for understrength units
 */
export function calcRefillCost(battalions: BattalionSlot[]): Cost {
  let totalMissing = 0
  for (const b of battalions) {
    const missing = b.count * (1 - b.strength / 100)
    totalMissing += missing
  }

  return {
    wood: Math.ceil(totalMissing * 10),
    stone: Math.ceil(totalMissing * 5),
    food: Math.ceil(totalMissing * 20),
    iron: Math.ceil(totalMissing * 15),
  }
}

/**
 * Refill division to full strength
 */
export function refillDivision(division: ArmyDivision): ArmyDivision {
  const battalions = division.battalions.map((b) => ({
    ...b,
    strength: 100,
  }))
  const power = calcDivisionPower(battalions)

  return {
    ...division,
    battalions,
    power,
  }
}

/**
 * Apply damage to division (reduce strength)
 */
export function applyDamage(division: ArmyDivision, damagePercent: number): ArmyDivision {
  const battalions = division.battalions.map((b) => ({
    ...b,
    strength: Math.max(0, b.strength - damagePercent),
  }))
  const power = calcDivisionPower(battalions)

  return {
    ...division,
    battalions,
    power,
  }
}

/**
 * Check if division is understrength
 */
export function isUnderstrength(division: ArmyDivision): boolean {
  return division.battalions.some((b) => b.strength < 100)
}
