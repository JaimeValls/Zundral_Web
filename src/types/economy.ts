import type { Resource, Building } from '../config/gameConfig'

export interface ResourceAmount {
  resource: Resource
  amount: number
}

export interface BuildingProduction {
  building: Building
  level: number
  outputPerSec: number
  stored: number
  capacity: number
  fillRatio: number
  slowdown: number
}

export interface StorageState {
  total: number
  used: number
  available: number
  fillRatio: number
  slowdown: number
}

export interface Cost {
  wood?: number
  stone?: number
  food?: number
  iron?: number
}

export interface ProductionRate {
  resource: Resource
  perSecond: number
}
