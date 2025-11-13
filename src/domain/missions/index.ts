import { nowSec } from '../../lib/time'
import type { Mission, ActiveMission, CompletedMission } from '../../types/core'
import type { Resource } from '../../config/gameConfig'

const MISSION_CLAIM_EXPIRY_DAYS = 30
const MISSION_CLAIM_EXPIRY_SEC = MISSION_CLAIM_EXPIRY_DAYS * 24 * 60 * 60

/**
 * Generate mission duration based on type and tier
 */
export function generateMissionDuration(
  type: Mission['type'],
  tier: number
): number {
  const baseDurations: Record<Mission['type'], { min: number; max: number }> = {
    resource_raid: { min: 180, max: 300 }, // 3-5 minutes
    tech_salvage: { min: 900, max: 1800 }, // 15-30 minutes
    boss_hunt: { min: 3600, max: 28800 }, // 1-8 hours
    escort_defense: { min: 600, max: 1200 }, // 10-20 minutes
    scouting: { min: 180, max: 300 }, // 3-5 minutes
  }

  const range = baseDurations[type]
  const duration = range.min + (range.max - range.min) * (tier / 10)
  return Math.floor(duration)
}

/**
 * Generate mission reward based on type and tier
 */
export function generateMissionReward(
  type: Mission['type'],
  tier: number
): Partial<Record<Resource, number>> {
  const baseReward = tier * 100
  const rewards: Partial<Record<Resource, number>> = {}

  switch (type) {
    case 'resource_raid':
      rewards.wood = Math.floor(baseReward * 1.5)
      rewards.stone = Math.floor(baseReward * 1.2)
      rewards.food = Math.floor(baseReward * 0.8)
      break
    case 'tech_salvage':
      rewards.iron = Math.floor(baseReward * 2)
      break
    case 'boss_hunt':
      rewards.wood = Math.floor(baseReward * 2)
      rewards.stone = Math.floor(baseReward * 2)
      rewards.food = Math.floor(baseReward * 1.5)
      rewards.iron = Math.floor(baseReward * 1.5)
      break
    case 'escort_defense':
      rewards.food = Math.floor(baseReward * 1.8)
      rewards.wood = Math.floor(baseReward * 1.0)
      break
    case 'scouting':
      rewards.food = Math.floor(baseReward * 0.5)
      break
  }

  return rewards
}

/**
 * Generate mission requirements based on tier
 */
export function generateMissionRequirements(tier: number): {
  power: number
  units: number
} {
  return {
    power: tier * 100,
    units: Math.max(1, Math.floor(tier / 2)),
  }
}

/**
 * Create a new mission offer
 */
export function createMissionOffer(
  type: Mission['type'],
  tier: number,
  offerDuration: number = 3600 // 1 hour default
): Mission {
  const now = nowSec()
  return {
    id: `mission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    tier,
    duration: generateMissionDuration(type, tier),
    reward: generateMissionReward(type, tier),
    requirements: generateMissionRequirements(tier),
    offeredAt: now,
    expiresAt: now + offerDuration,
  }
}

/**
 * Check if mission offer is expired
 */
export function isMissionExpired(mission: Mission, currentTimeSec: number = nowSec()): boolean {
  return currentTimeSec > mission.expiresAt
}

/**
 * Start a mission (move from offered to active)
 */
export function startMission(
  mission: Mission,
  divisionId: string,
  currentTimeSec: number = nowSec()
): ActiveMission {
  return {
    mission,
    divisionId,
    startedAt: currentTimeSec,
    completesAt: currentTimeSec + mission.duration,
  }
}

/**
 * Check if active mission is complete
 */
export function isMissionComplete(
  active: ActiveMission,
  currentTimeSec: number = nowSec()
): boolean {
  return currentTimeSec >= active.completesAt
}

/**
 * Complete a mission (success)
 */
export function completeMission(
  active: ActiveMission,
  losses: number,
  currentTimeSec: number = nowSec()
): CompletedMission {
  return {
    mission: active.mission,
    divisionId: active.divisionId,
    completedAt: currentTimeSec,
    result: 'success',
    reward: active.mission.reward,
    losses,
  }
}

/**
 * Abort a mission (returns damaged, no reward)
 */
export function abortMission(
  active: ActiveMission,
  losses: number,
  currentTimeSec: number = nowSec()
): CompletedMission {
  return {
    mission: active.mission,
    divisionId: active.divisionId,
    completedAt: currentTimeSec,
    result: 'aborted',
    reward: {},
    losses,
  }
}

/**
 * Check if completed mission claim is expired
 */
export function isClaimExpired(
  completed: CompletedMission,
  currentTimeSec: number = nowSec()
): boolean {
  return currentTimeSec > completed.completedAt + MISSION_CLAIM_EXPIRY_SEC
}

/**
 * Check if completed mission can be claimed
 */
export function canClaimMission(completed: CompletedMission): boolean {
  return completed.result === 'success' && Object.keys(completed.reward).length > 0
}
