import { describe, it, expect } from 'vitest'
import { calcOutputPerSec, calcStorageCap, calcNextCost, transferAll } from './index'

describe('buildings', () => {
  describe('calcOutputPerSec', () => {
    it('returns 0 for level 0', () => {
      expect(calcOutputPerSec(0)).toBe(0)
    })

    it('calculates output correctly for level 1', () => {
      expect(calcOutputPerSec(1)).toBe(1)
    })

    it('calculates output correctly for higher levels', () => {
      expect(calcOutputPerSec(2)).toBeGreaterThan(1)
    })
  })

  describe('calcStorageCap', () => {
    it('returns 0 for level 0', () => {
      expect(calcStorageCap(0)).toBe(0)
    })

    it('calculates storage correctly', () => {
      expect(calcStorageCap(1)).toBeGreaterThan(0)
    })
  })

  describe('calcNextCost', () => {
    it('calculates cost for next level', () => {
      const cost = calcNextCost(1)
      expect(cost.wood).toBeGreaterThan(0)
      expect(cost.stone).toBeGreaterThan(0)
    })
  })

  describe('transferAll', () => {
    it('transfers resources correctly', () => {
      const buildingStored = { wood: 100, stone: 0, food: 0, iron: 0 }
      const warehouseStored = { wood: 0, stone: 0, food: 0, iron: 0 }
      const warehouseCapacity = 500

      const result = transferAll(buildingStored, warehouseStored, warehouseCapacity)

      expect(result.transferred.wood).toBe(100)
      expect(result.newWarehouseStored.wood).toBe(100)
    })

    it('blocks overflow correctly', () => {
      const buildingStored = { wood: 100, stone: 0, food: 0, iron: 0 }
      const warehouseStored = { wood: 450, stone: 0, food: 0, iron: 0 }
      const warehouseCapacity = 500

      const result = transferAll(buildingStored, warehouseStored, warehouseCapacity)

      expect(result.transferred.wood).toBe(50)
      expect(result.blocked.wood).toBe(50)
    })
  })
})

