// Persistence and Offline Progression System

import { createPlaceholderLeaderboard } from './leaderboard';

// ============================================================================
// GameState - Single source of truth for all game data
// ============================================================================

export interface GameState {
  // Meta
  version: number;
  lastSaveUtc: number; // UTC timestamp in milliseconds
  totalPlayTime: number; // Total seconds played
  
  // Economy
  warehouse: {
    wood: number;
    stone: number;
    food: number;
    iron: number;
    gold: number;
  };
  warehouseLevel: number;
  skillPoints: number;
  
  // Population
  population: number;
  populationCap: number; // Calculated from house level
  recruitmentMode: 'regular' | 'forced';
  tax: 'very_low' | 'low' | 'normal' | 'high' | 'very_high';
  happiness: number;
  
  // Buildings
  lumberMill: {
    level: number;
    stored: number;
    enabled: boolean;
    workers: number;
  };
  quarry: {
    level: number;
    stored: number;
    enabled: boolean;
    workers: number;
  };
  farm: {
    level: number;
    stored: number;
    enabled: boolean;
    workers: number;
  };
  ironMine: {
    level: number;
    stored: number;
    enabled: boolean;
    workers: number;
  };
  house: number;
  townHall: {
    level: number;
  };
  barracks: {
    level: number;
    trainingSlots: number;
    maxTemplates: number;
    trainingQueue: Array<{
      id: number;
      type: 'mercenary' | 'reinforcement';
      templateId?: string;
      arrivalTime?: number;
      elapsedTime: number;
      status: 'arriving' | 'training';
      bannerId?: number;
      squadId?: number;
      soldiersNeeded: number;
      soldiersTrained: number;
    }>;
  } | null;
  tavern: {
    level: number;
    activeFestival: boolean;
    festivalEndTime: number;
  } | null;
  
  // Military
  banners: Array<{
    id: number;
    name: string;
    units: string[];
    squads: Array<{
      id: number;
      type: 'warrior' | 'archer';
      maxSize: number;
      currentSize: number;
    }>;
    status: 'idle' | 'training' | 'ready' | 'deployed' | 'destroyed';
    reqPop: number;
    recruited: number;
    type: 'regular' | 'mercenary';
    reinforcingSquadId?: number;
    trainingPaused?: boolean;
    customNamed?: boolean;
  }>;
  bannerSeq: number;
  squadSeq: number;
  bannerLossNotices: Array<{
    id: string;
    bannerName: string;
    bannerType: 'regular' | 'mercenary';
    message: string;
  }>;
  
  // Missions
  missions: Array<{
    id: number;
    name: string;
    description?: string;
    duration: number;
    status: 'available' | 'running' | 'completedRewardsPending' | 'completedRewardsClaimed' | 'archived';
    staged: number[];
    deployed: number[];
    elapsed: number;
    enemyComposition?: { warrior: number; archer: number };
    battleResult?: any;
    startTime?: number; // UTC timestamp when mission started
    rewards?: { gold?: number; wood?: number; stone?: number; food?: number; iron?: number };
    rewardTier?: string; // Reward tier name (e.g., "Scout's Cache")
    cooldownEndTime?: number; // UTC timestamp when cooldown ends
    isNew?: boolean; // Flag for NEW! label
  }>;
  
  // Expeditions
  expeditions: Array<{
    expeditionId: string;
    title: string;
    shortSummary: string;
    description: string;
    state: 'available' | 'funding' | 'readyToLaunch' | 'travelling' | 'completed';
    requirements: {
      wood: { required: number; current: number };
      stone: { required: number; current: number };
      food: { required: number; current: number };
      population: { required: number; current: number };
    };
    travelProgress: number;
    fortress?: {
      buildings: Array<{
        id: string;
        name: string;
        level: number;
        maxLevel: number;
        description: string;
        // Functions are not stored - reconstructed on load
      }>;
      stats: {
        fortHP: number;
        archerSlots: number;
        garrisonWarriors: number;
        garrisonArchers: number;
        storedSquads: number;
      };
      garrison: number[];
      lastBattle?: any;
    };
  }>;
  
  // UI State (non-critical, but nice to preserve)
  mainTab: 'production' | 'army' | 'missions' | 'expeditions' | 'leaderboard' | 'factions';
  armyTab: 'banners';
  
  // Leaderboard
  leaderboard: Array<{
    playerId: string;
    playerName: string;
    faction: 'Alsus' | 'Atrox' | 'Neutral';
    totalScore: number;
    totalKills: number;
    totalVictories: number;
    rank: number;
    title: string;
  }>;
  
  // Faction System
  factionState: {
    availableFP: number;
    alsusFP: number;
    atroxFP: number;
    alsusUnspentFP: number;
    atroxUnspentFP: number;
    perks: Record<string, {
      id: string;
      faction: 'Alsus' | 'Atrox';
      branchId: string;
      tier: number;
      costFP: number;
      unlocked: boolean;
      name: string;
      description?: string;
    }>;
  };
  
  // Settings/Flags
  tutorialCompleted: boolean;
  debugFlags: Record<string, boolean>;
}

// ============================================================================
// Default Game State
// ============================================================================

export function createDefaultGameState(): GameState {
  return {
    version: 1,
    lastSaveUtc: Date.now(),
    totalPlayTime: 0,
    
    warehouse: { wood: 0, stone: 0, food: 0, iron: 0, gold: 0 },
    warehouseLevel: 1,
    skillPoints: 0,
    
    population: 5,
    populationCap: 5,
    recruitmentMode: 'regular',
    tax: 'normal',
    happiness: 50,
    
    lumberMill: { level: 1, stored: 0, enabled: true, workers: 1 },
    quarry: { level: 1, stored: 0, enabled: true, workers: 1 },
    farm: { level: 1, stored: 0, enabled: true, workers: 1 },
    ironMine: { level: 1, stored: 0, enabled: true, workers: 1 },
    house: 1,
    townHall: { level: 1 },
    barracks: null,
    tavern: null,
    
    banners: [],
    bannerSeq: 1,
    squadSeq: 1,
    bannerLossNotices: [],
    
    missions: [
      {
        id: 1,
        name: 'Scout the Forest',
        description: 'Your task is to explore the outskirts of the village and chart any nearby landmarks or threats. Expect light resistance. Current estimates suggest you may encounter one hostile squad. Proceed carefully, avoid unnecessary engagement, and return with a clear report of the terrain and enemy presence.',
        duration: 3,
        status: 'available',
        staged: [],
        deployed: [],
        elapsed: 0,
        enemyComposition: { warrior: 10, archer: 0 },
      },
      {
        id: 2,
        name: 'Secure the Quarry Road',
        description: 'Your forces must secure the old road leading to the quarry. Enemy scouts have been sighted nearby, and resistance is expected to be significant. Intelligence indicates three warrior squads supported by one archer squad. Advance with caution, break their formation, and ensure the road is safe for future transport.',
        duration: 3,
        status: 'available',
        staged: [],
        deployed: [],
        elapsed: 0,
        enemyComposition: { warrior: 30, archer: 10 },
      },
      {
        id: 3,
        name: 'Sweep the Northern Ridge',
        description: 'A fortified enemy group has settled along the northern ridge. This will be a demanding operation. Expect to face five warrior squads and one archer squad. Push through their defensive line, neutralise all threats, and reclaim control of the ridge for the village.',
        duration: 3,
        status: 'available',
        staged: [],
        deployed: [],
        elapsed: 0,
        enemyComposition: { warrior: 50, archer: 10 },
      },
    ],
    
    expeditions: [
      {
        expeditionId: "godonis_mountain_expedition",
        title: "Whispers in the Mountains of Godonis",
        shortSummary: "Investigate the disappearances in the mountains of Godonis.",
        description: "During the night, people, and sometimes entire villages, disappear in the mountains of Godonis. The mountain clans are begging for help. We must send an expedition to find out what is happening.",
        state: 'available',
        requirements: {
          wood: { required: 500, current: 0 },
          stone: { required: 250, current: 0 },
          food: { required: 1000, current: 0 },
          population: { required: 5, current: 0 },
        },
        travelProgress: 0,
      },
    ],
    
    mainTab: 'production',
    armyTab: 'banners',
    
    leaderboard: createPlaceholderLeaderboard('REAL PLAYER', 'Alsus'),
    
    factionState: {
      availableFP: 0,
      alsusFP: 0,
      atroxFP: 0,
      alsusUnspentFP: 0,
      atroxUnspentFP: 0,
      perks: {}, // Will be initialized in ResourceVillageUI
    },
    
    tutorialCompleted: false,
    debugFlags: {},
  };
}

// ============================================================================
// Persistence Service
// ============================================================================

const SAVE_KEY = 'rts_agent_save_v1';
const MAX_OFFLINE_HOURS = 12;
const AUTOSAVE_INTERVAL_MS = 30000; // 30 seconds

class PersistenceService {
  private autoSaveTimer: number | null = null;
  
  loadState(): GameState | null {
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      if (!saved) {
        console.log('[PERSISTENCE] No saved state found');
        return null;
      }
      
      const parsed = JSON.parse(saved) as any;
      
      // Remove checksum if present (it's not part of GameState)
      const { _checksum, ...stateWithoutChecksum } = parsed;
      
      // Validate and sanitize loaded state
      const sanitized = this.sanitizeState(stateWithoutChecksum as GameState);
      
      console.log('[PERSISTENCE] State loaded successfully. Last save:', new Date(sanitized.lastSaveUtc).toISOString());
      return sanitized;
    } catch (error) {
      console.error('[PERSISTENCE] Failed to load state:', error);
      // Try to clear corrupted save
      try {
        localStorage.removeItem(SAVE_KEY);
        console.log('[PERSISTENCE] Cleared corrupted save');
      } catch (e) {
        console.error('[PERSISTENCE] Failed to clear corrupted save:', e);
      }
      return null;
    }
  }
  
  saveState(state: GameState): void {
    // Check if localStorage is available
    if (typeof localStorage === 'undefined') {
      console.error('[PERSISTENCE] localStorage is not available, cannot save');
      return;
    }
    
    try {
      // Update metadata
      state.lastSaveUtc = Date.now();
      
      // Sanitize before saving
      const sanitized = this.sanitizeState(state);
      
      // Add checksum for basic tamper detection
      const checksum = this.calculateChecksum(sanitized);
      const stateWithChecksum = { ...sanitized, _checksum: checksum };
      
      localStorage.setItem(SAVE_KEY, JSON.stringify(stateWithChecksum));
      console.log('[PERSISTENCE] State saved at', new Date(state.lastSaveUtc).toISOString());
    } catch (error) {
      console.error('[PERSISTENCE] Failed to save state:', error);
      // Check if it's a quota exceeded error
      if (error instanceof DOMException && error.code === 22) {
        console.error('[PERSISTENCE] localStorage quota exceeded!');
      }
    }
  }
  
  resetState(): GameState {
    const defaultState = createDefaultGameState();
    this.saveState(defaultState);
    return defaultState;
  }
  
  startAutoSave(saveCallback: () => GameState): void {
    // Clear existing timer
    if (this.autoSaveTimer !== null) {
      clearInterval(this.autoSaveTimer);
    }
    
    // Set up new timer
    this.autoSaveTimer = window.setInterval(() => {
      const state = saveCallback();
      this.saveState(state);
    }, AUTOSAVE_INTERVAL_MS);
    
    // Also save on page unload
    window.addEventListener('beforeunload', () => {
      const state = saveCallback();
      this.saveState(state);
    });
  }
  
  stopAutoSave(): void {
    if (this.autoSaveTimer !== null) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
  
  // Sanitize state to prevent cheating and fix invalid values
  private sanitizeState(state: GameState): GameState {
    const sanitized = { ...state };
    
    // Cap resources to storage capacity
    const warehouseCap = this.getWarehouseCapacity(sanitized.warehouseLevel);
    sanitized.warehouse.wood = Math.max(0, Math.min(sanitized.warehouse.wood, warehouseCap));
    sanitized.warehouse.stone = Math.max(0, Math.min(sanitized.warehouse.stone, warehouseCap));
    sanitized.warehouse.food = Math.max(0, Math.min(sanitized.warehouse.food, warehouseCap));
    sanitized.warehouse.iron = Math.max(0, Math.min(sanitized.warehouse.iron, warehouseCap));
    sanitized.warehouse.gold = Math.max(0, Math.min(sanitized.warehouse.gold, warehouseCap));
    
    // Ensure population is valid
    sanitized.population = Math.max(1, Math.min(sanitized.population, sanitized.populationCap || 999999));
    
    // Ensure building levels are valid
    sanitized.lumberMill.level = Math.max(1, Math.min(sanitized.lumberMill.level, 100));
    sanitized.quarry.level = Math.max(1, Math.min(sanitized.quarry.level, 100));
    sanitized.farm.level = Math.max(1, Math.min(sanitized.farm.level, 100));
    if (sanitized.ironMine) {
      sanitized.ironMine.level = Math.max(1, Math.min(sanitized.ironMine.level, 100));
    }
    sanitized.house = Math.max(1, Math.min(sanitized.house, 100));
    sanitized.townHall.level = Math.max(1, Math.min(sanitized.townHall.level, 3));
    
    if (sanitized.barracks) {
      sanitized.barracks.level = Math.max(1, Math.min(sanitized.barracks.level, 100));
    }
    
    if (sanitized.tavern) {
      sanitized.tavern.level = Math.max(1, Math.min(sanitized.tavern.level, 100));
    }
    
    // Ensure skill points are non-negative
    sanitized.skillPoints = Math.max(0, sanitized.skillPoints);
    
    // Ensure happiness is in valid range
    sanitized.happiness = Math.max(0, Math.min(100, sanitized.happiness));
    
    return sanitized;
  }
  
  private getWarehouseCapacity(level: number): number {
    // Match the formula from ResourceVillageUI
    const base = 1000;
    const l0 = Math.max(0, level - 1);
    return base * Math.pow(1.3, l0);
  }
  
  private calculateChecksum(state: GameState): string {
    // Simple checksum for basic tamper detection
    const str = JSON.stringify({
      version: state.version,
      warehouse: state.warehouse,
      population: state.population,
      skillPoints: state.skillPoints,
    });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
}

// ============================================================================
// Offline Simulation
// ============================================================================

export function simulateOfflineProgression(state: GameState, deltaSeconds: number): GameState {
  const updated = { ...state };
  
  // Cap offline time to max hours
  const maxOfflineSeconds = MAX_OFFLINE_HOURS * 3600;
  const simulatedSeconds = Math.min(deltaSeconds, maxOfflineSeconds);
  
  if (simulatedSeconds <= 0) return updated;
  
  console.log(`[OFFLINE] Simulating ${simulatedSeconds.toFixed(1)} seconds of offline progression`);
  
  // Calculate production rates
  const woodRate = getProductionRate('wood', updated.lumberMill.level, updated.lumberMill.enabled, updated.lumberMill.workers);
  const stoneRate = getProductionRate('stone', updated.quarry.level, updated.quarry.enabled, updated.quarry.workers);
  const foodRate = getProductionRate('food', updated.farm.level, updated.farm.enabled, updated.farm.workers);
  const ironRate = updated.ironMine ? getProductionRate('iron', updated.ironMine.level, updated.ironMine.enabled, updated.ironMine.workers) : 0;
  
  // Calculate population growth
  const netPopChange = calculateNetPopulationChange(updated.tax, updated.happiness);
  
  // Calculate gold income from taxes (scales with population)
  const referencePopulation = 50; // Reference population for gold calculation
  const baseGoldPerSecondAtNormalTax = 1.0; // Base gold/sec at Normal tax with 50 population
  
  // Effective population ensures we never use zero (minimum 1)
  const effectivePopulation = Math.max(1, updated.population);
  
  // Population factor: how much the current population scales the base income
  const populationFactor = effectivePopulation / referencePopulation;
  
  // Tax multiplier
  let taxMultiplier = 1.0;
  if (updated.tax === 'very_low') taxMultiplier = 0.6;
  else if (updated.tax === 'low') taxMultiplier = 0.85;
  else if (updated.tax === 'normal') taxMultiplier = 1.0;
  else if (updated.tax === 'high') taxMultiplier = 1.25;
  else if (updated.tax === 'very_high') taxMultiplier = 1.5;
  
  // Final formula: base * populationFactor * taxMultiplier
  const goldIncomePerSecond = baseGoldPerSecondAtNormalTax * populationFactor * taxMultiplier;
  
  // Apply production
  const warehouseCap = getWarehouseCapacity(updated.warehouseLevel);
  updated.warehouse.wood = Math.min(warehouseCap, updated.warehouse.wood + (woodRate * simulatedSeconds));
  updated.warehouse.stone = Math.min(warehouseCap, updated.warehouse.stone + (stoneRate * simulatedSeconds));
  updated.warehouse.food = Math.min(warehouseCap, updated.warehouse.food + (foodRate * simulatedSeconds));
  if (updated.ironMine) {
    updated.warehouse.iron = Math.min(warehouseCap, updated.warehouse.iron + (ironRate * simulatedSeconds));
  }
  updated.warehouse.gold = Math.min(warehouseCap, updated.warehouse.gold + (goldIncomePerSecond * simulatedSeconds));
  
  // Apply population growth
  const newPopulation = Math.min(updated.populationCap, updated.population + (netPopChange * simulatedSeconds));
  updated.population = Math.max(1, newPopulation);
  
  // Progress building stored resources
  const woodCap = getBuildingCapacity('wood', updated.lumberMill.level);
  const stoneCap = getBuildingCapacity('stone', updated.quarry.level);
  const foodCap = getBuildingCapacity('food', updated.farm.level);

  updated.lumberMill.stored = Math.min(woodCap, updated.lumberMill.stored + (woodRate * simulatedSeconds));
  updated.quarry.stored = Math.min(stoneCap, updated.quarry.stored + (stoneRate * simulatedSeconds));
  updated.farm.stored = Math.min(foodCap, updated.farm.stored + (foodRate * simulatedSeconds));
  if (updated.ironMine) {
    const ironCap = getBuildingCapacity('iron', updated.ironMine.level);
    updated.ironMine.stored = Math.min(ironCap, updated.ironMine.stored + (ironRate * simulatedSeconds));
  }
  
  // Progress training queues
  if (updated.barracks) {
    updated.barracks = { ...updated.barracks };
    updated.barracks.trainingQueue = updated.barracks.trainingQueue.map(entry => {
      const newEntry = { ...entry };
      
      if (entry.type === 'mercenary' && entry.status === 'arriving') {
        newEntry.elapsedTime += simulatedSeconds;
        if (entry.arrivalTime && newEntry.elapsedTime >= entry.arrivalTime) {
          newEntry.status = 'training';
        }
      } else if (entry.status === 'training') {
        if (entry.type === 'mercenary') {
          // Mercenary training progresses automatically
          // (Implementation depends on your training system)
        } else if (entry.type === 'reinforcement') {
          // Reinforcement training - check if population is available
          const needed = entry.soldiersNeeded - entry.soldiersTrained;
          if (needed > 0 && updated.population > 1) {
            // Train as much as possible with available population
            const canTrain = Math.min(needed, Math.floor(simulatedSeconds), updated.population - 1);
            newEntry.soldiersTrained += canTrain;
            updated.population = Math.max(1, updated.population - canTrain);
          }
        }
      }
      
      return newEntry;
    });
  }
  
  // Progress banner training
  updated.banners = updated.banners.map(banner => {
    if (banner.status !== 'training' || banner.trainingPaused) return banner;
    
    const newBanner = { ...banner };
    
    // Check recruitment mode and population availability
    const currentWorkers = updated.lumberMill.workers + updated.quarry.workers + updated.farm.workers;
    const freeWorkers = Math.max(0, updated.population - currentWorkers);
    const canRecruit = updated.recruitmentMode === 'regular' 
      ? freeWorkers > 0 
      : updated.population > 1;
    
    if (canRecruit && newBanner.recruited < newBanner.reqPop) {
      const toRecruit = Math.min(simulatedSeconds, newBanner.reqPop - newBanner.recruited);
      newBanner.recruited += toRecruit;
      updated.population = Math.max(1, updated.population - toRecruit);
      
      // Update squad sizes
      if (newBanner.squads && newBanner.squads.length > 0) {
        newBanner.squads = newBanner.squads.map(squad => {
          if (newBanner.reinforcingSquadId === squad.id) {
            // Reinforcing specific squad
            const missing = squad.maxSize - squad.currentSize;
            const canAdd = Math.min(toRecruit, missing);
            return { ...squad, currentSize: Math.min(squad.maxSize, squad.currentSize + canAdd) };
          } else {
            // New training - distribute across squads
            // Simplified: just fill squads in order
            return squad;
          }
        });
      }
      
      if (newBanner.recruited >= newBanner.reqPop) {
        newBanner.status = 'ready';
        newBanner.reinforcingSquadId = undefined;
      }
    }
    
    return newBanner;
  });
  
  // Progress missions
  updated.missions = updated.missions.map(mission => {
    if (mission.status !== 'running') return mission;
    
    const newMission = { ...mission };
    
    if (mission.startTime) {
      const elapsed = (Date.now() - mission.startTime) / 1000;
      newMission.elapsed = elapsed;
      
      if (elapsed >= mission.duration) {
        // Note: Offline simulation doesn't simulate battles, so we can't determine win/loss
        // For offline completion, assume victory (rewards pending)
        // In practice, battles are only simulated in real-time, so this is a fallback
        newMission.status = 'completedRewardsPending';
        newMission.elapsed = mission.duration;
        // Mission completed - banners return to ready
        newMission.deployed.forEach(bannerId => {
          const banner = updated.banners.find(b => b.id === bannerId);
          if (banner) {
            banner.status = 'ready';
          }
        });
        newMission.deployed = [];
      }
    }
    
    return newMission;
  });
  
  // Update total play time
  updated.totalPlayTime += simulatedSeconds;
  
  return updated;
}

// Helper functions for offline simulation
function getProductionRate(resource: 'wood' | 'stone' | 'food' | 'iron', level: number, enabled: boolean, workers: number): number {
  if (!enabled || workers === 0) return 0;
  
  const baseRates = {
    wood: 1,
    stone: 1,
    food: 5,
    iron: 1, // Same as stone
  };
  
  const base = baseRates[resource];
  const l0 = Math.max(0, level - 1);
  const productionPerWorker = base * Math.pow(1.25, l0);
  
  return productionPerWorker * workers;
}

function getBuildingCapacity(resource: 'wood' | 'stone' | 'food' | 'iron', level: number): number {
  const base = 100;
  const l0 = Math.max(0, level - 1);
  return base * Math.pow(1.3, l0);
}

function getWarehouseCapacity(level: number): number {
  const base = 1000;
  const l0 = Math.max(0, level - 1);
  return base * Math.pow(1.3, l0);
}

function calculateNetPopulationChange(tax: 'very_low' | 'low' | 'normal' | 'high' | 'very_high', happiness: number): number {
  // Base population change from tax
  let baseRate = 0;
  if (tax === 'very_low') baseRate = 1.2;
  else if (tax === 'low') baseRate = 0.8;
  else if (tax === 'normal') baseRate = 0.2;
  else if (tax === 'high') baseRate = -0.4;
  else if (tax === 'very_high') baseRate = -1.0;
  
  // Happiness-based modifier
  let happinessModifier = 0;
  if (happiness >= 80) {
    happinessModifier = 0.8;
  } else if (happiness >= 60) {
    happinessModifier = 0.4;
  } else if (happiness >= 40) {
    happinessModifier = 0.0;
  } else if (happiness >= 20) {
    happinessModifier = -0.4;
  } else {
    happinessModifier = -0.8;
  }
  
  return baseRate + happinessModifier;
}

// Export singleton instance
export const persistence = new PersistenceService();

