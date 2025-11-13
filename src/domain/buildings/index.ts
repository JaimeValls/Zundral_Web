import { config } from '../../config/gameConfig'
import type { Building, Resource } from '../../config/gameConfig'
import type { Cost } from '../../types/economy'

/**
 * Calculate output per second for a building at given level
 */
export function calcOutputPerSec(level: number): number {
  if (level === 0) return 0
  return config.production.baseOutputPerSec * Math.pow(config.production.outputMult, level - 1)
}

/**
 * Calculate storage capacity for a building at given level
 */
export function calcStorageCap(level: number): number {
  if (level === 0) return 0
  return config.storage.base * Math.pow(config.storage.mult, level - 1)
}

/**
 * Calculate cost to upgrade building to next level
 */
export function calcNextCost(currentLevel: number): Cost {
  const level = currentLevel + 1
  const mult = Math.pow(config.costs.mult, level - 1)
  return {
    wood: Math.floor(config.costs.base.wood * mult),
    stone: Math.floor(config.costs.base.stone * mult),
  }
}

/**
 * Transfer all resources from building to warehouse
 * Returns: { transferred, blocked }
 */
export function transferAll(
  buildingStored: Record<Resource, number>,
  warehouseStored: Record<Resource, number>,
  warehouseCapacity: number
): {
  transferred: Record<Resource, number>
  blocked: Record<Resource, number>
  newWarehouseStored: Record<Resource, number>
} {
  const transferred: Record<Resource, number> = {
    wood: 0,
    stone: 0,
    food: 0,
    iron: 0,
  }
  const blocked: Record<Resource, number> = {
    wood: 0,
    stone: 0,
    food: 0,
    iron: 0,
  }
  const newWarehouseStored = { ...warehouseStored }

  // Calculate current warehouse usage
  const currentUsed = Object.values(warehouseStored).reduce((sum, val) => sum + val, 0)
  const available = Math.max(0, warehouseCapacity - currentUsed)

  // Transfer resources, respecting warehouse capacity
  let remainingCapacity = available
  for (const resource of ['wood', 'stone', 'food', 'iron'] as Resource[]) {
    const amount = buildingStored[resource]
    if (amount > 0) {
      const canTransfer = Math.min(amount, remainingCapacity)
      transferred[resource] = canTransfer
      blocked[resource] = amount - canTransfer
      newWarehouseStored[resource] += canTransfer
      remainingCapacity -= canTransfer
    }
  }

  return { transferred, blocked, newWarehouseStored }
}
