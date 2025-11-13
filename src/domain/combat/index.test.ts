import { describe, it, expect } from 'vitest'
import { calculateCombat, forecastCombat } from './index'

describe('combat', () => {
  describe('calculateCombat', () => {
    it('returns valid combat result', () => {
      const result = calculateCombat(1000, 800)
      expect(result).toHaveProperty('victory')
      expect(result).toHaveProperty('duration')
      expect(result).toHaveProperty('losses')
      expect(result).toHaveProperty('forecast')
      expect(result.duration).toBeGreaterThan(0)
      expect(result.losses).toBeGreaterThan(0)
      expect(result.losses).toBeLessThanOrEqual(30)
    })

    it('respects RNG band', () => {
      const results = Array.from({ length: 100 }, () => calculateCombat(1000, 1000))
      // Should have some variation due to RNG
      const victories = results.filter((r) => r.victory).length
      expect(victories).toBeGreaterThan(0)
      expect(victories).toBeLessThan(100)
    })
  })

  describe('forecastCombat', () => {
    it('generates forecast string', () => {
      const forecast = forecastCombat(1000, 800)
      expect(typeof forecast).toBe('string')
      expect(forecast.length).toBeGreaterThan(0)
    })
  })
})

