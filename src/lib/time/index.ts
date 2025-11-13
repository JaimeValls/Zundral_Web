import { config } from '../../config/gameConfig'

/**
 * Get current time in seconds
 */
export function nowSec(offset: number = 0): number {
  return Math.floor(Date.now() / 1000) + offset
}

/**
 * Calculate resource accrual since last timestamp
 * Returns: { accrued, newStore, overflow }
 */
export function accrueSince(
  lastTs: number,
  rate: number,
  maxStore: number,
  currentStore: number,
  currentTimeSec: number = nowSec()
): { accrued: number; newStore: number; overflow: number } {
  const elapsed = currentTimeSec - lastTs
  if (elapsed <= 0) {
    return { accrued: 0, newStore: currentStore, overflow: 0 }
  }

  const rawAccrued = rate * elapsed
  const newStore = Math.min(currentStore + rawAccrued, maxStore)
  const overflow = Math.max(0, currentStore + rawAccrued - maxStore)

  return {
    accrued: newStore - currentStore,
    newStore,
    overflow,
  }
}

/**
 * Apply storage slowdown based on fill ratio
 * Returns multiplier (1.0 = no slowdown, 0.5 = 50% speed)
 */
export function clampSlowdownByFill(ratio: number): number {
  if (ratio < 0.33) {
    return 1.0
  } else if (ratio < 0.66) {
    return config.storage.slowdowns.t33_66
  } else {
    return config.storage.slowdowns.t66_100
  }
}
