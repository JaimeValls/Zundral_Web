import { describe, it, expect } from 'vitest'
import {
  createMissionOffer,
  isMissionExpired,
  isClaimExpired,
  canClaimMission,
} from './index'
import { nowSec } from '../../lib/time'

describe('missions', () => {
  describe('createMissionOffer', () => {
    it('creates a mission with valid structure', () => {
      const mission = createMissionOffer('resource_raid', 1)
      expect(mission.id).toBeDefined()
      expect(mission.type).toBe('resource_raid')
      expect(mission.tier).toBe(1)
      expect(mission.duration).toBeGreaterThan(0)
    })
  })

  describe('isMissionExpired', () => {
    it('returns false for fresh mission', () => {
      const mission = createMissionOffer('resource_raid', 1, 3600)
      expect(isMissionExpired(mission)).toBe(false)
    })

    it('returns true for expired mission', () => {
      const mission = createMissionOffer('resource_raid', 1, 1)
      // Wait a bit (in test, we can manipulate time)
      const futureTime = nowSec() + 10
      expect(isMissionExpired(mission, futureTime)).toBe(true)
    })
  })

  describe('canClaimMission', () => {
    it('returns true for successful mission', () => {
      const mission = createMissionOffer('resource_raid', 1)
      const completed = {
        mission,
        divisionId: 'div1',
        completedAt: nowSec(),
        result: 'success' as const,
        reward: { wood: 100 },
        losses: 5,
      }
      expect(canClaimMission(completed)).toBe(true)
    })

    it('returns false for aborted mission', () => {
      const mission = createMissionOffer('resource_raid', 1)
      const completed = {
        mission,
        divisionId: 'div1',
        completedAt: nowSec(),
        result: 'aborted' as const,
        reward: {},
        losses: 10,
      }
      expect(canClaimMission(completed)).toBe(false)
    })
  })
})

