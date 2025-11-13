import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nowSec, accrueSince, clampSlowdownByFill } from './index'

describe('time utilities', () => {
  describe('nowSec', () => {
    it('returns current time in seconds', () => {
      const now = Math.floor(Date.now() / 1000)
      const result = nowSec()
      expect(result).toBeGreaterThanOrEqual(now)
      expect(result).toBeLessThan(now + 2)
    })

    it('applies offset correctly', () => {
      const offset = 3600
      const result = nowSec(offset)
      const expected = Math.floor(Date.now() / 1000) + offset
      expect(result).toBe(expected)
    })
  })

  describe('accrueSince', () => {
    it('calculates accrual correctly', () => {
      const lastTs = 1000
      const rate = 1 // 1 per second
      const maxStore = 100
      const currentStore = 50
      const currentTime = 1010 // 10 seconds later

      const result = accrueSince(lastTs, rate, maxStore, currentStore, currentTime)

      expect(result.accrued).toBe(10)
      expect(result.newStore).toBe(60)
      expect(result.overflow).toBe(0)
    })

    it('handles overflow correctly', () => {
      const lastTs = 1000
      const rate = 1
      const maxStore = 100
      const currentStore = 95
      const currentTime = 1010

      const result = accrueSince(lastTs, rate, maxStore, currentStore, currentTime)

      expect(result.newStore).toBe(100)
      expect(result.overflow).toBe(5)
    })

    it('handles negative elapsed time', () => {
      const lastTs = 1010
      const rate = 1
      const maxStore = 100
      const currentStore = 50
      const currentTime = 1000

      const result = accrueSince(lastTs, rate, maxStore, currentStore, currentTime)

      expect(result.accrued).toBe(0)
      expect(result.newStore).toBe(50)
      expect(result.overflow).toBe(0)
    })
  })

  describe('clampSlowdownByFill', () => {
    it('returns 1.0 for ratio < 0.33', () => {
      expect(clampSlowdownByFill(0)).toBe(1.0)
      expect(clampSlowdownByFill(0.32)).toBe(1.0)
    })

    it('returns 0.8 for ratio 0.33-0.66', () => {
      expect(clampSlowdownByFill(0.33)).toBe(0.8)
      expect(clampSlowdownByFill(0.5)).toBe(0.8)
      expect(clampSlowdownByFill(0.65)).toBe(0.8)
    })

    it('returns 0.5 for ratio >= 0.66', () => {
      expect(clampSlowdownByFill(0.66)).toBe(0.5)
      expect(clampSlowdownByFill(0.8)).toBe(0.5)
      expect(clampSlowdownByFill(1.0)).toBe(0.5)
    })
  })
})

