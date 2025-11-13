import type { Resource, Building } from '../config/gameConfig'

export interface GameState {
  resources: Record<Resource, number>
  buildings: Record<Building, number>
  warehouse: {
    level: number
    stored: Record<Resource, number>
  }
  population: {
    total: number
    assigned: Record<Building, number>
    happiness: number
    lastRecruitmentTick: number
  }
  queues: {
    buildings: Record<Building, QueueItem | null>
    research: QueueItem | null
    training: QueueItem | null
  }
  army: {
    templates: ArmyTemplate[]
    active: ArmyDivision[]
  }
  missions: {
    offered: Mission[]
    active: ActiveMission[]
    completed: CompletedMission[]
  }
  time: {
    offset: number
    lastTick: number
  }
}

export interface QueueItem {
  type: 'building' | 'research' | 'training'
  target: string
  startTime: number
  duration: number
  cost: Partial<Record<Resource, number>>
}

export interface ArmyTemplate {
  id: string
  name: string
  battalions: BattalionSlot[]
}

export interface BattalionSlot {
  type: string
  count: number
  strength: number
}

export interface ArmyDivision {
  id: string
  templateId: string
  battalions: BattalionSlot[]
  power: number
}

export interface Mission {
  id: string
  type: 'resource_raid' | 'tech_salvage' | 'boss_hunt' | 'escort_defense' | 'scouting'
  tier: number
  duration: number
  reward: Partial<Record<Resource, number>>
  requirements: {
    power: number
    units: number
  }
  offeredAt: number
  expiresAt: number
}

export interface ActiveMission {
  mission: Mission
  divisionId: string
  startedAt: number
  completesAt: number
}

export interface CompletedMission {
  mission: Mission
  divisionId: string
  completedAt: number
  result: 'success' | 'aborted'
  reward: Partial<Record<Resource, number>>
  losses: number
}
