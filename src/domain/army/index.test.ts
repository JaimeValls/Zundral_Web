import { describe, it, expect } from 'vitest'
import { calcTrainingCost, calcRefillCost, calcDivisionPower } from './index'
import type { BattalionSlot } from '../../types/core'

describe('army', () => {
  describe('calcTrainingCost', () => {
    it('calculates cost based on unit count', () => {
      const cost = calcTrainingCost(10)
      expect(cost.wood).toBeGreaterThan(0)
      expect(cost.stone).toBeGreaterThan(0)
      expect(cost.food).toBeGreaterThan(0)
      expect(cost.iron).toBeGreaterThan(0)
    })
  })

  describe('calcRefillCost', () => {
    it('calculates refill cost for understrength units', () => {
      const battalions: BattalionSlot[] = [
        { type: 'infantry', count: 10, strength: 50 },
      ]
      const cost = calcRefillCost(battalions)
      expect(cost.wood).toBeGreaterThan(0)
    })
  })

  describe('calcDivisionPower', () => {
    it('calculates power correctly', () => {
      const battalions: BattalionSlot[] = [
        { type: 'infantry', count: 10, strength: 100 },
      ]
      const power = calcDivisionPower(battalions)
      expect(power).toBeGreaterThan(0)
    })

    it('reduces power for understrength units', () => {
      const full: BattalionSlot[] = [{ type: 'infantry', count: 10, strength: 100 }]
      const damaged: BattalionSlot[] = [{ type: 'infantry', count: 10, strength: 50 }]
      expect(calcDivisionPower(damaged)).toBeLessThan(calcDivisionPower(full))
    })
  })
})

