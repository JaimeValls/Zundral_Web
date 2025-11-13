import { z } from 'zod'
import type { GameState } from '../../types/core'

const SAVE_VERSION = 1
const STORAGE_KEY = 'zundral_save'

const GameStateSchema = z.object({
  resources: z.object({
    wood: z.number(),
    stone: z.number(),
    food: z.number(),
    iron: z.number(),
  }),
  buildings: z.object({
    house: z.number(),
    warehouse: z.number(),
    lumberMill: z.number(),
    quarry: z.number(),
    farm: z.number(),
    ironMine: z.number(),
  }),
  warehouse: z.object({
    level: z.number(),
    stored: z.object({
      wood: z.number(),
      stone: z.number(),
      food: z.number(),
      iron: z.number(),
    }),
  }),
  population: z.object({
    total: z.number(),
    assigned: z.record(z.string(), z.number()),
    happiness: z.number(),
    lastRecruitmentTick: z.number(),
  }),
  queues: z.object({
    buildings: z.record(z.string(), z.any().nullable()),
    research: z.any().nullable(),
    training: z.any().nullable(),
  }),
  army: z.object({
    templates: z.array(z.any()),
    active: z.array(z.any()),
  }),
  missions: z.object({
    offered: z.array(z.any()),
    active: z.array(z.any()),
    completed: z.array(z.any()),
  }),
  time: z.object({
    offset: z.number(),
    lastTick: z.number(),
  }),
})

const SaveDataSchema = z.object({
  version: z.number(),
  data: GameStateSchema,
})

type SaveData = z.infer<typeof SaveDataSchema>

function migrate(data: any, fromVersion: number, toVersion: number): any {
  if (fromVersion === toVersion) {
    return data
  }

  // Future migration logic here
  // For now, just return data as-is if version matches
  return data
}

export function saveGame(state: GameState): boolean {
  try {
    const saveData: SaveData = {
      version: SAVE_VERSION,
      data: state,
    }

    const validated = SaveDataSchema.parse(saveData)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated))
    return true
  } catch (error) {
    console.error('Failed to save game:', error)
    return false
  }
}

export function loadGame(): GameState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored)
    const validated = SaveDataSchema.parse(parsed)

    // Apply migrations if needed
    if (validated.version !== SAVE_VERSION) {
      validated.data = migrate(validated.data, validated.version, SAVE_VERSION)
    }

    return validated.data
  } catch (error) {
    console.error('Failed to load game:', error)
    return null
  }
}

export function clearSave(): void {
  localStorage.removeItem(STORAGE_KEY)
}
