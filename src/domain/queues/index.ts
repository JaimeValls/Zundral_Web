import { config } from '../../config/gameConfig'
import { nowSec } from '../../lib/time'
import type { Building } from '../../config/gameConfig'
import type { QueueItem } from '../../types/core'
import type { Cost } from '../../types/economy'

/**
 * Calculate build time for a building upgrade
 */
export function calcBuildTime(level: number): number {
  return config.time.buildBaseSec * Math.pow(config.time.buildMult, level - 1)
}

/**
 * Check if a building queue slot is available
 */
export function isBuildingSlotAvailable(
  queues: Record<Building, QueueItem | null>,
  building: Building
): boolean {
  return queues[building] === null
}

/**
 * Check if research queue slot is available
 */
export function isResearchSlotAvailable(researchQueue: QueueItem | null): boolean {
  return researchQueue === null
}

/**
 * Check if training queue slot is available
 */
export function isTrainingSlotAvailable(trainingQueue: QueueItem | null): boolean {
  return trainingQueue === null
}

/**
 * Start a building upgrade queue
 */
export function startBuildingQueue(
  building: Building,
  level: number,
  cost: Cost,
  currentTimeSec: number = nowSec()
): QueueItem {
  const duration = calcBuildTime(level)
  return {
    type: 'building',
    target: building,
    startTime: currentTimeSec,
    duration,
    cost,
  }
}

/**
 * Start a research queue
 */
export function startResearchQueue(
  researchId: string,
  duration: number,
  cost: Cost,
  currentTimeSec: number = nowSec()
): QueueItem {
  return {
    type: 'research',
    target: researchId,
    startTime: currentTimeSec,
    duration,
    cost,
  }
}

/**
 * Start a training queue
 */
export function startTrainingQueue(
  templateId: string,
  unitCount: number,
  cost: Cost,
  currentTimeSec: number = nowSec()
): QueueItem {
  const duration = unitCount * config.army.trainPerUnitMin * 60 // Convert to seconds
  return {
    type: 'training',
    target: templateId,
    startTime: currentTimeSec,
    duration,
    cost,
  }
}

/**
 * Check if a queue item is complete
 */
export function isQueueComplete(
  item: QueueItem | null,
  currentTimeSec: number = nowSec()
): boolean {
  if (!item) return false
  return currentTimeSec >= item.startTime + item.duration
}

/**
 * Get time remaining for a queue item
 */
export function getQueueTimeRemaining(
  item: QueueItem | null,
  currentTimeSec: number = nowSec()
): number {
  if (!item) return 0
  const elapsed = currentTimeSec - item.startTime
  return Math.max(0, item.duration - elapsed)
}

/**
 * Process all queues and return completed items
 */
export function processQueues(
  queues: {
    buildings: Record<Building, QueueItem | null>
    research: QueueItem | null
    training: QueueItem | null
  },
  currentTimeSec: number = nowSec()
): {
  completedBuildings: Building[]
  completedResearch: boolean
  completedTraining: boolean
} {
  const completedBuildings: Building[] = []
  let completedResearch = false
  let completedTraining = false

  // Check building queues
  for (const building of Object.keys(queues.buildings) as Building[]) {
    const item = queues.buildings[building]
    if (item && isQueueComplete(item, currentTimeSec)) {
      completedBuildings.push(building)
    }
  }

  // Check research queue
  if (queues.research && isQueueComplete(queues.research, currentTimeSec)) {
    completedResearch = true
  }

  // Check training queue
  if (queues.training && isQueueComplete(queues.training, currentTimeSec)) {
    completedTraining = true
  }

  return { completedBuildings, completedResearch, completedTraining }
}
