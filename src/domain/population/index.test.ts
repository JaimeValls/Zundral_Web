import { describe, it, expect } from 'vitest'
import {
  calcPopulationCapacity,
  calcRecruitmentChange,
  calcFoodUpkeepPerSec,
  calcOutputMultiplier,
} from './index'

describe('population', () => {
  describe('calcPopulationCapacity', () => {
    it('calculates capacity as 110% of required workers', () => {
      expect(calcPopulationCapacity(10)).toBe(11)
      expect(calcPopulationCapacity(20)).toBe(22)
    })
  })

  describe('calcRecruitmentChange', () => {
    it('returns +1 at happiness 100', () => {
      expect(calcRecruitmentChange(100)).toBe(1)
    })

    it('returns 0 at happiness 50', () => {
      expect(calcRecruitmentChange(50)).toBe(0)
    })

    it('returns -1 at happiness 0', () => {
      expect(calcRecruitmentChange(0)).toBe(-1)
    })
  })

  describe('calcFoodUpkeepPerSec', () => {
    it('calculates upkeep correctly', () => {
      const upkeep = calcFoodUpkeepPerSec(10)
      expect(upkeep).toBeGreaterThan(0)
    })
  })

  describe('calcOutputMultiplier', () => {
    it('returns 1.0 when assigned equals required', () => {
      expect(calcOutputMultiplier(10, 10)).toBe(1.0)
    })

    it('returns less than 1.0 when understaffed', () => {
      expect(calcOutputMultiplier(5, 10)).toBe(0.5)
    })

    it('caps at 1.0 when overstaffed', () => {
      expect(calcOutputMultiplier(15, 10)).toBe(1.0)
    })
  })
})

