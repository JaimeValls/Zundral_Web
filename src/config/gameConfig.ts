export const config = {
  production: { baseOutputPerSec: 1, outputMult: 1.25 },
  storage: { base: 300, mult: 1.25, slowdowns: { t33_66: 0.8, t66_100: 0.5 } },
  warehouse: { capL1: 100, mult: 1.25 },
  costs: { base: { wood: 100, stone: 100 }, mult: 1.4 },
  time: { buildBaseSec: 30, buildMult: 1.3 },
  army: { trainPerUnitMin: 5 },
  combat: { rngBand: { min: 0.05, max: 0.1 } },
  sessions: { min: 1, max: 15 },
}

export const RESOURCES = ['wood', 'stone', 'food', 'iron'] as const

export const BUILDINGS = [
  'house',
  'warehouse',
  'lumberMill',
  'quarry',
  'farm',
  'ironMine',
] as const

export type Resource = (typeof RESOURCES)[number]
export type Building = (typeof BUILDINGS)[number]
