import { config } from '../../config/gameConfig'
import { nowSec } from '../../lib/time'
import type { Building } from '../../config/gameConfig'

const RECRUITMENT_TICK_INTERVAL = 300 // 5 minutes in seconds
const FOOD_UPKEEP_PER_MIN = 1

/**
 * Calculate population capacity based on total required workers
 */
export function calcPopulationCapacity(totalRequiredWorkers: number): number {
  return Math.ceil(totalRequiredWorkers * 1.1)
}

/**
 * Calculate total required workers from building levels
 */
export function calcTotalRequiredWorkers(buildings: Record<Building, number>): number {
  return Object.values(buildings).reduce((sum, level) => sum + level, 0)
}

/**
 * Auto-assign workers to buildings
 * Returns assignment map
 */
export function autoAssignWorkers(
  totalWorkers: number,
  buildings: Record<Building, number>
): Record<Building, number> {
  const assignment: Record<Building, number> = {
    house: 0,
    warehouse: 0,
    lumberMill: 0,
    quarry: 0,
    farm: 0,
    ironMine: 0,
  }

  let remaining = totalWorkers

  // Assign workers to each building based on required (1 per level)
  for (const building of Object.keys(buildings) as Building[]) {
    const required = buildings[building]
    const assigned = Math.min(required, remaining)
    assignment[building] = assigned
    remaining -= assigned
    if (remaining <= 0) break
  }

  return assignment
}

/**
 * Calculate recruitment change based on happiness
 * Returns: -1, 0, or +1 per recruitment tick
 */
export function calcRecruitmentChange(happiness: number): number {
  if (happiness >= 100) return 1
  if (happiness <= 0) return -1
  if (happiness === 50) return 0

  // Linear interpolation between 0 and 100
  // At 50: 0, at 100: +1, at 0: -1
  if (happiness > 50) {
    return (happiness - 50) / 50 // 0 to 1
  } else {
    return (happiness - 50) / 50 // -1 to 0
  }
}

/**
 * Process recruitment tick
 * Returns new population count
 */
export function processRecruitmentTick(
  currentPopulation: number,
  happiness: number,
  capacity: number,
  lastRecruitmentTick: number,
  currentTimeSec: number = nowSec()
): { newPopulation: number; newLastTick: number } {
  const elapsed = currentTimeSec - lastRecruitmentTick
  const ticks = Math.floor(elapsed / RECRUITMENT_TICK_INTERVAL)

  if (ticks === 0) {
    return { newPopulation: currentPopulation, newLastTick: lastRecruitmentTick }
  }

  const changePerTick = calcRecruitmentChange(happiness)
  const totalChange = Math.round(changePerTick * ticks)
  const newPopulation = Math.max(0, Math.min(capacity, currentPopulation + totalChange))
  const newLastTick = lastRecruitmentTick + ticks * RECRUITMENT_TICK_INTERVAL

  return { newPopulation, newLastTick }
}

/**
 * Calculate food upkeep per second
 */
export function calcFoodUpkeepPerSec(workers: number): number {
  return (workers * FOOD_UPKEEP_PER_MIN) / 60
}

/**
 * Calculate output multiplier based on assigned/required ratio
 */
export function calcOutputMultiplier(assigned: number, required: number): number {
  if (required === 0) return 1.0
  return Math.min(1.0, assigned / required)
}
