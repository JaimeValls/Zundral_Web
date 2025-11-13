import { config } from '../../config/gameConfig'
import { clampSlowdownByFill } from '../../lib/time'
import type { Resource } from '../../config/gameConfig'
import type { StorageState } from '../../types/economy'

/**
 * Calculate warehouse storage capacity at given level
 */
export function calcWarehouseCapacity(level: number): number {
  if (level === 0) return 0
  return config.warehouse.capL1 * Math.pow(config.warehouse.mult, level - 1)
}

/**
 * Get current storage state
 */
export function getStorageState(
  stored: Record<Resource, number>,
  capacity: number
): StorageState {
  const used = Object.values(stored).reduce((sum, val) => sum + val, 0)
  const available = Math.max(0, capacity - used)
  const fillRatio = capacity > 0 ? used / capacity : 0
  const slowdown = clampSlowdownByFill(fillRatio)

  return {
    total: capacity,
    used,
    available,
    fillRatio,
    slowdown,
  }
}

/**
 * Check if warehouse can accept resources
 */
export function canAcceptResources(
  stored: Record<Resource, number>,
  capacity: number,
  resources: Partial<Record<Resource, number>>
): boolean {
  const currentUsed = Object.values(stored).reduce((sum, val) => sum + val, 0)
  const additional = Object.values(resources).reduce((sum, val) => sum + (val || 0), 0)
  return currentUsed + additional <= capacity
}

/**
 * Add resources to warehouse, respecting capacity
 * Returns: { added, blocked }
 */
export function addResources(
  stored: Record<Resource, number>,
  capacity: number,
  resources: Partial<Record<Resource, number>>
): {
  added: Record<Resource, number>
  blocked: Record<Resource, number>
  newStored: Record<Resource, number>
} {
  const currentUsed = Object.values(stored).reduce((sum, val) => sum + val, 0)
  const available = Math.max(0, capacity - currentUsed)

  const added: Record<Resource, number> = {
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
  const newStored = { ...stored }

  let remainingCapacity = available
  for (const resource of ['wood', 'stone', 'food', 'iron'] as Resource[]) {
    const amount = resources[resource] || 0
    if (amount > 0) {
      const canAdd = Math.min(amount, remainingCapacity)
      added[resource] = canAdd
      blocked[resource] = amount - canAdd
      newStored[resource] += canAdd
      remainingCapacity -= canAdd
    }
  }

  return { added, blocked, newStored }
}
