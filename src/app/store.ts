import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { GameState, Building, Resource, QueueItem, ArmyTemplate, ArmyDivision, Mission, ActiveMission, CompletedMission } from '../types/core'
import { nowSec, accrueSince } from '../lib/time'
import { Logger } from '../lib/logger'
import { saveGame, loadGame } from '../lib/persist'
import seedDataJson from '../data/seed.json'
const seedData = seedDataJson as GameState
import { calcOutputPerSec, calcStorageCap, calcNextCost, transferAll } from '../domain/buildings'
import { calcWarehouseCapacity, getStorageState, addResources } from '../domain/warehouse'
import { calcPopulationCapacity, calcTotalRequiredWorkers, autoAssignWorkers, processRecruitmentTick, calcFoodUpkeepPerSec, calcOutputMultiplier } from '../domain/population'
import { processQueues, startBuildingQueue, startTrainingQueue, isQueueComplete } from '../domain/queues'
import { createDivisionFromTemplate, calcTrainingCost, calcRefillCost, refillDivision, applyDamage } from '../domain/army'
import { createMissionOffer, startMission, isMissionComplete, completeMission, abortMission, isClaimExpired, canClaimMission } from '../domain/missions'
import { calculateCombat } from '../domain/combat'
import { RESOURCES, BUILDINGS } from '../config/gameConfig'

interface GameStore extends GameState {
  // Actions
  tick: () => void
  collectBuilding: (building: Building) => void
  upgradeBuilding: (building: Building) => void
  trainArmy: (templateId: string, unitCount: number) => void
  refillArmy: (divisionId: string) => void
  sendMission: (missionId: string, divisionId: string) => void
  abortMission: (activeMissionId: string) => void
  claimMission: (completedId: string) => void
  addResources: (resources: Partial<Record<Resource, number>>) => void
  setTimeOffset: (offset: number) => void
  setHappiness: (happiness: number) => void
  finishQueues: () => void
  spawnMission: (type: Mission['type'], tier: number) => void
  save: () => void
  load: () => void
  reset: () => void
}

const getInitialState = (): GameState => {
  const loaded = loadGame()
  if (loaded) {
    return loaded
  }
  return {
    ...seedData,
    time: {
      offset: 0,
      lastTick: nowSec(),
    },
  } as GameState
}

export const useGameStore = create<GameStore>()(
  subscribeWithSelector((set, get) => ({
    ...getInitialState(),

    tick: () => {
      const state = get()
      const currentTime = nowSec(state.time.offset)

      // Process resource production
      const newResources = { ...state.resources }
      const newWarehouseStored = { ...state.warehouse.stored }
      const buildingStored: Record<Building, Record<Resource, number>> = {
        house: { wood: 0, stone: 0, food: 0, iron: 0 },
        warehouse: { wood: 0, stone: 0, food: 0, iron: 0 },
        lumberMill: { wood: 0, stone: 0, food: 0, iron: 0 },
        quarry: { wood: 0, stone: 0, food: 0, iron: 0 },
        farm: { wood: 0, stone: 0, food: 0, iron: 0 },
        ironMine: { wood: 0, stone: 0, food: 0, iron: 0 },
      }

      // Calculate production for each building
      for (const building of BUILDINGS) {
        const level = state.buildings[building]
        if (level > 0) {
          const outputPerSec = calcOutputPerSec(level)
          const storageCap = calcStorageCap(level)
          const assigned = state.population.assigned[building] || 0
          const required = level
          const outputMult = calcOutputMultiplier(assigned, required)
          const effectiveOutput = outputPerSec * outputMult

          // Get building's stored resources (simplified - each building produces one resource type)
          let resourceType: Resource = 'wood'
          if (building === 'quarry') resourceType = 'stone'
          else if (building === 'farm') resourceType = 'food'
          else if (building === 'ironMine') resourceType = 'iron'

          const lastUpdate = state.time.lastTick
          const result = accrueSince(
            lastUpdate,
            effectiveOutput,
            storageCap,
            buildingStored[building][resourceType] || 0,
            currentTime
          )

          buildingStored[building][resourceType] = result.newStore
        }
      }

      // Process population recruitment
      const totalRequired = calcTotalRequiredWorkers(state.buildings)
      const capacity = calcPopulationCapacity(totalRequired)
      const recruitmentResult = processRecruitmentTick(
        state.population.total,
        state.population.happiness,
        capacity,
        state.population.lastRecruitmentTick,
        currentTime
      )

      // Auto-assign workers
      const assigned = autoAssignWorkers(recruitmentResult.newPopulation, state.buildings)

      // Process food upkeep
      const foodUpkeepPerSec = calcFoodUpkeepPerSec(recruitmentResult.newPopulation)
      const foodConsumed = (currentTime - state.time.lastTick) * foodUpkeepPerSec
      newResources.food = Math.max(0, newResources.food - foodConsumed)

      // Process queues
      const queueResults = processQueues(state.queues, currentTime)
      const newBuildings = { ...state.buildings }
      for (const building of queueResults.completedBuildings) {
        newBuildings[building] = (newBuildings[building] || 0) + 1
        Logger.add('building_complete', { building, level: newBuildings[building] })
      }

      const newQueues = { ...state.queues }
      if (queueResults.completedResearch) {
        newQueues.research = null
        Logger.add('research_complete')
      }
      if (queueResults.completedTraining) {
        newQueues.training = null
        // Create division from template (simplified)
        Logger.add('training_complete')
      }

      // Process active missions
      const newActiveMissions: ActiveMission[] = []
      const newCompletedMissions: CompletedMission[] = [...state.missions.completed]
      for (const active of state.missions.active) {
        if (isMissionComplete(active, currentTime)) {
          const combatResult = calculateCombat(1000, 800) // Simplified
          const losses = combatResult.losses
          const completed = completeMission(active, losses, currentTime)
          newCompletedMissions.push(completed)
          Logger.add('mission_complete', { missionId: active.mission.id, result: 'success' })
        } else {
          newActiveMissions.push(active)
        }
      }

      set({
        resources: newResources,
        warehouse: {
          ...state.warehouse,
          stored: newWarehouseStored,
        },
        population: {
          ...state.population,
          total: recruitmentResult.newPopulation,
          assigned,
          lastRecruitmentTick: recruitmentResult.newLastTick,
        },
        buildings: newBuildings,
        queues: newQueues,
        missions: {
          ...state.missions,
          active: newActiveMissions,
          completed: newCompletedMissions,
        },
        time: {
          ...state.time,
          lastTick: currentTime,
        },
      })
    },

    collectBuilding: (building: Building) => {
      const state = get()
      const level = state.buildings[building]
      if (level === 0) return

      const storageCap = calcStorageCap(level)
      const buildingStored: Record<Resource, number> = {
        wood: 0,
        stone: 0,
        food: 0,
        iron: 0,
      }

      // Get building's resource type
      let resourceType: Resource = 'wood'
      if (building === 'quarry') resourceType = 'stone'
      else if (building === 'farm') resourceType = 'food'
      else if (building === 'ironMine') resourceType = 'iron'

      buildingStored[resourceType] = storageCap // Simplified - assume full

      const warehouseCap = calcWarehouseCapacity(state.warehouse.level)
      const transferResult = transferAll(
        buildingStored,
        state.warehouse.stored,
        warehouseCap
      )

      Logger.add('collect', { building, transferred: transferResult.transferred })

      set({
        warehouse: {
          ...state.warehouse,
          stored: transferResult.newWarehouseStored,
        },
      })
    },

    upgradeBuilding: (building: Building) => {
      const state = get()
      const level = state.buildings[building]
      const cost = calcNextCost(level)

      // Check if can afford
      if (state.resources.wood < (cost.wood || 0) || state.resources.stone < (cost.stone || 0)) {
        return
      }

      // Check if queue slot available
      if (state.queues.buildings[building] !== null) {
        return
      }

      const newQueue = startBuildingQueue(building, level + 1, cost)
      const newResources = {
        ...state.resources,
        wood: state.resources.wood - (cost.wood || 0),
        stone: state.resources.stone - (cost.stone || 0),
      }

      Logger.add('upgrade_started', { building, level: level + 1, cost })

      set({
        resources: newResources,
        queues: {
          ...state.queues,
          buildings: {
            ...state.queues.buildings,
            [building]: newQueue,
          },
        },
      })
    },

    trainArmy: (templateId: string, unitCount: number) => {
      const state = get()
      if (state.queues.training !== null) return

      const cost = calcTrainingCost(unitCount)
      if (
        state.resources.wood < (cost.wood || 0) ||
        state.resources.stone < (cost.stone || 0) ||
        state.resources.food < (cost.food || 0) ||
        state.resources.iron < (cost.iron || 0)
      ) {
        return
      }

      const newQueue = startTrainingQueue(templateId, unitCount, cost)
      const newResources = {
        wood: state.resources.wood - (cost.wood || 0),
        stone: state.resources.stone - (cost.stone || 0),
        food: state.resources.food - (cost.food || 0),
        iron: state.resources.iron - (cost.iron || 0),
      }

      Logger.add('training_started', { templateId, unitCount, cost })

      set({
        resources: newResources,
        queues: {
          ...state.queues,
          training: newQueue,
        },
      })
    },

    refillArmy: (divisionId: string) => {
      const state = get()
      const division = state.army.active.find((d) => d.id === divisionId)
      if (!division) return

      const cost = calcRefillCost(division.battalions)
      if (
        state.resources.wood < (cost.wood || 0) ||
        state.resources.stone < (cost.stone || 0) ||
        state.resources.food < (cost.food || 0) ||
        state.resources.iron < (cost.iron || 0)
      ) {
        return
      }

      const refilled = refillDivision(division)
      const newResources = {
        wood: state.resources.wood - (cost.wood || 0),
        stone: state.resources.stone - (cost.stone || 0),
        food: state.resources.food - (cost.food || 0),
        iron: state.resources.iron - (cost.iron || 0),
      }

      Logger.add('army_refilled', { divisionId, cost })

      set({
        resources: newResources,
        army: {
          ...state.army,
          active: state.army.active.map((d) => (d.id === divisionId ? refilled : d)),
        },
      })
    },

    sendMission: (missionId: string, divisionId: string) => {
      const state = get()
      const mission = state.missions.offered.find((m) => m.id === missionId)
      const division = state.army.active.find((d) => d.id === divisionId)
      if (!mission || !division) return

      if (division.power < mission.requirements.power) return

      const active = startMission(mission, divisionId)
      Logger.add('mission_sent', { missionId, divisionId })

      set({
        missions: {
          ...state.missions,
          offered: state.missions.offered.filter((m) => m.id !== missionId),
          active: [...state.missions.active, active],
        },
      })
    },

    abortMission: (activeMissionId: string) => {
      const state = get()
      const active = state.missions.active.find((m) => m.mission.id === activeMissionId)
      if (!active) return

      const completed = abortMission(active, 10) // 10% losses on abort
      const division = state.army.active.find((d) => d.id === active.divisionId)
      const damagedDivision = division ? applyDamage(division, 10) : null

      Logger.add('mission_aborted', { missionId: activeMissionId })

      set({
        missions: {
          ...state.missions,
          active: state.missions.active.filter((m) => m.mission.id !== activeMissionId),
          completed: [...state.missions.completed, completed],
        },
        army: {
          ...state.army,
          active: damagedDivision
            ? state.army.active.map((d) => (d.id === active.divisionId ? damagedDivision : d))
            : state.army.active,
        },
      })
    },

    claimMission: (completedId: string) => {
      const state = get()
      const completed = state.missions.completed.find((c) => c.mission.id === completedId)
      if (!completed || !canClaimMission(completed)) return

      const warehouseCap = calcWarehouseCapacity(state.warehouse.level)
      const addResult = addResources(state.warehouse.stored, warehouseCap, completed.reward)

      Logger.add('mission_claimed', { missionId: completedId, reward: completed.reward })

      set({
        warehouse: {
          ...state.warehouse,
          stored: addResult.newStored,
        },
        missions: {
          ...state.missions,
          completed: state.missions.completed.filter((c) => c.mission.id !== completedId),
        },
      })
    },

    addResources: (resources: Partial<Record<Resource, number>>) => {
      const state = get()
      const newResources = { ...state.resources }
      for (const [resource, amount] of Object.entries(resources)) {
        if (amount) {
          newResources[resource as Resource] = (newResources[resource as Resource] || 0) + amount
        }
      }
      Logger.add('resources_added', resources)
      set({ resources: newResources })
    },

    setTimeOffset: (offset: number) => {
      Logger.add('time_offset_set', { offset })
      set((state) => ({
        time: { ...state.time, offset },
      }))
    },

    setHappiness: (happiness: number) => {
      Logger.add('happiness_set', { happiness })
      set((state) => ({
        population: { ...state.population, happiness: Math.max(0, Math.min(100, happiness)) },
      }))
    },

    finishQueues: () => {
      const state = get()
      const currentTime = nowSec(state.time.offset)
      const newQueues = { ...state.queues }

      // Finish building queues
      for (const building of BUILDINGS) {
        const queue = newQueues.buildings[building]
        if (queue && !isQueueComplete(queue, currentTime)) {
          newQueues.buildings[building] = {
            ...queue,
            startTime: currentTime - queue.duration,
          }
        }
      }

      // Finish research queue
      if (newQueues.research && !isQueueComplete(newQueues.research, currentTime)) {
        newQueues.research = {
          ...newQueues.research,
          startTime: currentTime - newQueues.research.duration,
        }
      }

      // Finish training queue
      if (newQueues.training && !isQueueComplete(newQueues.training, currentTime)) {
        newQueues.training = {
          ...newQueues.training,
          startTime: currentTime - newQueues.training.duration,
        }
      }

      Logger.add('queues_finished')
      set({ queues: newQueues })
    },

    spawnMission: (type: Mission['type'], tier: number) => {
      const mission = createMissionOffer(type, tier)
      Logger.add('mission_spawned', { type, tier, missionId: mission.id })
      set((state) => ({
        missions: {
          ...state.missions,
          offered: [...state.missions.offered, mission],
        },
      }))
    },

    save: () => {
      const state = get()
      saveGame(state)
      Logger.add('game_saved')
    },

    load: () => {
      const loaded = loadGame()
      if (loaded) {
        set(loaded)
        Logger.add('game_loaded')
      }
    },

    reset: () => {
      const initialState = getInitialState()
      set(initialState)
      Logger.add('game_reset')
    },
  }))
)

// Auto-save on state changes (throttled)
let saveTimeout: NodeJS.Timeout | null = null
useGameStore.subscribe(
  (state) => state,
  () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      useGameStore.getState().save()
    }, 2000) // Save 2 seconds after last change
  }
)

// Auto-tick every second
setInterval(() => {
  useGameStore.getState().tick()
}, 1000)
