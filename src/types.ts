// ============================================================================
// Zundral — Runtime Type Definitions
// All TypeScript types, interfaces, and type aliases for the game.
// Import from here rather than relying on definitions scattered in components.
//
// Note: GameState (the save-format type) intentionally stays in persistence.ts
// because it is the canonical save-format document for that module.
// ============================================================================

// Re-export GameState so callers only need one import source.
export type { GameState } from './persistence';

// ----------------------------------------------------------------------------
// Economy
// ----------------------------------------------------------------------------

export interface WarehouseState {
  wood: number;
  stone: number;
  food: number;
  iron: number;
  gold: number;
}

export interface WarehouseCap {
  wood: number;
  stone: number;
  food: number;
  iron: number;
  gold: number;
}

// ----------------------------------------------------------------------------
// Units
// ----------------------------------------------------------------------------

export type UnitType =
  | 'warrior'       // displayed as "Shieldmen" in the UI
  | 'militia'
  | 'longsword'
  | 'pikemen'
  | 'light_cavalry'
  | 'heavy_cavalry'
  | 'archer'
  | 'skirmisher'
  | 'crossbowmen';

/** Broad category that determines squad size and population requirements. */
export type UnitCategory = 'infantry' | 'cavalry' | 'ranged_infantry';

/** Map of UnitType → count; all keys are optional. */
export type Division = Partial<Record<UnitType, number>>;

// ----------------------------------------------------------------------------
// XP / Leveling
// ----------------------------------------------------------------------------

export type XPLevelInfo = {
  level: number;
  name: string;
  minXP: number;
  smoothing: number;
};

// ----------------------------------------------------------------------------
// Military entities
// ----------------------------------------------------------------------------

export type Squad = {
  id: number;
  type: UnitType;
  maxSize: number;
  currentSize: number;
  slotIndex?: number;
};

export type Banner = {
  id: number;
  name: string;
  units: string[]; // Legacy: kept for backward compatibility; use squads instead
  squads: Squad[];
  status: 'idle' | 'training' | 'ready' | 'deployed' | 'destroyed';
  reqPop: number;
  recruited: number;
  type: 'regular' | 'mercenary';
  reinforcingSquadId?: number;  // ID of squad being reinforced (regular banners)
  trainingPaused?: boolean;
  customNamed?: boolean;        // Whether the player has manually edited the name
  // XP system
  xp?: number;
  level?: number;
  xpCurrentLevel?: number;
  xpNextLevel?: number;
  // Commander system
  commanderId?: number | null;
  // Field battle destruction context
  destroyedTurn?: number;
  destroyedInProvince?: string;
  destroyedByEnemy?: string;
  fieldBattleId?: string;
};

export type BannerLossNotice = {
  id: string;
  bannerName: string;
  bannerType: Banner['type'];
  message: string;
};

export interface BannerTemplate {
  id: string;
  name: string;
  squads: Array<{ type: 'archer' | 'warrior'; count: number }>;
  upkeepPerSecond: number;
  requiredPopulation: number;
  cost: number; // Gold cost
}

export type CommanderArchetype = 'ranged_specialist' | 'melee_specialist' | 'balanced_leader';

export interface Commander {
  id: number;
  name: string;
  archetype: CommanderArchetype;
  rangedAttackBonusPercent: number;
  meleeAttackBonusPercent: number;
  assignedBannerId: number | null;
  // Leveling system
  level: number; // 1–99
  currentXP: number;
  xpToNextLevel: number;
}

// ----------------------------------------------------------------------------
// Buildings
// ----------------------------------------------------------------------------

export type BuildingCategory = 'always_available' | 'town_hall_gated';
export type TownHallLevel = 1 | 2 | 3;

export interface TownHallState {
  level: TownHallLevel;
}

export type TrainingEntryType = 'mercenary' | 'reinforcement';

export interface TrainingEntry {
  id: number;
  type: TrainingEntryType;
  // For mercenary entries
  templateId?: string;
  arrivalTime?: number;   // Seconds until arrival
  elapsedTime: number;
  status: 'arriving' | 'training';
  // For reinforcement entries
  bannerId?: number;
  squadId?: number;
  soldiersNeeded: number;
  soldiersTrained: number;
}

export interface BarracksState {
  level: number;
  trainingSlots: number;
  maxTemplates: number;
  trainingQueue: TrainingEntry[];
}

export interface TavernState {
  level: number;
  activeFestival: boolean;
  festivalEndTime: number;
}

export interface MilitaryAcademyState {
  level: number;
}

// ----------------------------------------------------------------------------
// Missions & Battles
// ----------------------------------------------------------------------------

export type Mission = {
  id: number;
  name: string;
  description?: string;
  terrain?: 'forest' | 'hills' | 'plains' | 'river' | 'building';
  missionType?: 'list' | 'expedition'; // list = mission tab, expedition = map auto-complete
  duration: number; // seconds
  status: 'available' | 'running' | 'completedRewardsPending' | 'completedRewardsClaimed' | 'archived';
  staged: number[];    // Banner IDs queued for deployment
  deployed: number[];  // Banner IDs currently deployed
  elapsed: number;     // Seconds progressed
  enemyComposition?: Division | { warrior?: number; archer?: number };
  battleResult?: BattleResult;
  bannerXP?: {
    bannerId: number;
    bannerName: string;
    xpGained: number;
    oldXP: number;
    newXP: number;
    oldLevel: number;
    newLevel: number;
    oldLevelName: string;
    newLevelName: string;
    xpCurrentLevel: number;
    xpNextLevel: number;
  };
  rewards?: { gold?: number; wood?: number; stone?: number; food?: number; iron?: number };
  rewardTier?: string;
  cooldownEndTime?: number; // UTC ms timestamp
  startTime?: number;       // UTC ms timestamp
  isNew?: boolean;
};

export type BattleResult = {
  winner: 'player' | 'enemy' | 'draw';
  ticks: number;
  playerInitial: { warrior: number; archer: number; total: number };
  playerFinal: { warrior: number; archer: number; total: number; morale: number };
  enemyInitial: { warrior: number; archer: number; total: number };
  enemyFinal: { warrior: number; archer: number; total: number; morale: number };
  timeline: Array<{
    tick: number;
    phase: string;
    A_troops: number;
    B_troops: number;
    A_morale: number;
    B_morale: number;
    AtoB: number;
    BtoA: number;
  }>;
};

// ----------------------------------------------------------------------------
// Factions
// ----------------------------------------------------------------------------

export type FactionId = 'Alsus' | 'Atrox';

export type FactionBranchId =
  | 'Alsus_Tactics'   // Magnus War Council
  | 'Alsus_Lux'       // Lux Guardians
  | 'Alsus_Crowns'    // Pact of Crowns
  | 'Atrox_Blood'     // Blood Legions
  | 'Atrox_Fortress'  // Iron Bastions of Roctium
  | 'Atrox_Spoils';   // Spoils of War

export interface FactionPerkNode {
  id: string;
  faction: FactionId;
  branchId: FactionBranchId;
  tier: number;         // 1–5
  costFP: number;
  unlocked: boolean;
  name: string;
  description?: string;
}

export interface PlayerFactionState {
  availableFP: number;
  alsusFP: number;
  atroxFP: number;
  alsusUnspentFP: number;
  atroxUnspentFP: number;
  perks: Record<string, FactionPerkNode>;
}

// ----------------------------------------------------------------------------
// Fortress / Expeditions
// ----------------------------------------------------------------------------

export type ExpeditionState = 'available' | 'funding' | 'readyToLaunch' | 'travelling' | 'completed' | 'failed';

export type FortressBuilding = {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  description: string;
  getEffect: (level: number) => {
    fortHP?: number;
    archerSlots?: number;
    garrisonCapacity?: number;
    storedSquads?: number;
  };
  getUpgradeCost: (level: number) => { wood: number; stone: number };
};

export type FortressStats = {
  fortHP: number;
  archerSlots: number;
  garrisonCapacity: number;
  storedSquads: number;
};

export type SiegeRound = {
  round: number;
  fortHP: number;
  attackers: number;
  archers: number;
  killed: number;
  dmgToFort: number;
};

export type InnerBattleStep = {
  step: number;
  phase: 'skirmish' | 'melee' | 'pursuit';
  defWarriors: number;
  defArchers: number;
  defenders: number;
  attackers: number;
  killedAttackers: number;
  killedDefenders: number;
};

export type BattleSquadEntry = {
  type: string;          // unit type key (e.g. 'longsword', 'crossbowmen')
  displayName: string;   // human-readable (e.g. 'Longswords', 'Crossbowmen')
  role: 'melee' | 'ranged';
  initial: number;       // starting count
  final: number;         // surviving count
  lost: number;          // initial - final
};

export type SiegeBattleResult = {
  outcome: 'fortress_holds_walls' | 'fortress_holds_inner' | 'fortress_falls' | 'stalemate';
  siegeRounds: number;
  finalFortHP: number;
  finalAttackers: number;
  finalDefenders: number;
  siegeTimeline: SiegeRound[];
  innerTimeline: InnerBattleStep[];
  initialFortHP: number;
  initialAttackers: number;
  initialGarrison: { warriors: number; archers: number };
  finalGarrison: { warriors: number; archers: number };
  attackerComposition?: BattleSquadEntry[];
  defenderComposition?: BattleSquadEntry[];
  battleTakeaway?: string;
};

export type FieldBattlePlayerArmy = {
  bannerId: number;
  bannerName: string;
  initialTroops: number;
  finalTroops: number;
  composition: BattleSquadEntry[];
};

export type FieldBattleEnemyArmy = {
  enemyId: number;
  enemyName: string;
  initialTroops: number;
  finalTroops: number;
  composition: BattleSquadEntry[];
};

export type FieldBattleResult = {
  id: string;                       // "fb_{turn}_{index}"
  turn: number;
  provinceId: string;
  outcome: 'player_wins' | 'enemy_wins' | 'draw';
  // Primary army (backward compat + largest contributor)
  playerArmy: FieldBattlePlayerArmy;
  enemyArmy: FieldBattleEnemyArmy;
  // All participating armies (multi-army battles)
  playerArmies?: FieldBattlePlayerArmy[];
  enemyArmies?: FieldBattleEnemyArmy[];
  timeline: InnerBattleStep[];
  battleTakeaway: string;
};

export type Expedition = {
  expeditionId: string;
  title: string;
  shortSummary: string;
  description: string;
  state: ExpeditionState;
  requirements: {
    wood: { required: number; current: number };
    stone: { required: number; current: number };
    food: { required: number; current: number };
    population: { required: number; current: number };
  };
  travelProgress: number; // 0–100 during travelling state
  fortress?: {
    buildings: FortressBuilding[];
    stats: FortressStats;
    garrison: number[];             // Banner IDs stationed in the fortress
    lastBattle?: SiegeBattleResult;
  };
  mapState?: ExpeditionMapState;
};

// ----------------------------------------------------------------------------
// Expedition Map
// ----------------------------------------------------------------------------

export type TerrainType = 'plains' | 'forest' | 'mountain' | 'hills' | 'volcanic' | 'swamp' | 'coast' | 'building' | 'river';

export interface ProvinceData {
  id: string;
  color: [number, number, number];
  center: [number, number];
  bbox: { x: number; y: number; w: number; h: number };
  terrain: TerrainType;
  elevation: number;
  isLand: boolean;
  adjacentProvinces: string[];
  pixelCount: number;
}

export interface MapData {
  mapWidth: number;
  mapHeight: number;
  quantizationStep: number;
  provinces: ProvinceData[];
  colorToProvinceId: Record<string, string>;
}

// Turn-based order system
export type ArmyOrderType = 'hold' | 'move';

export interface ArmyOrder {
  bannerId: number;
  type: ArmyOrderType;
  targetProvinceId?: string; // required when type === 'move'
}

// NPC enemy army that marches toward the fortress
export interface EnemyArmy {
  id: number;
  templateId: string;       // 'spearmen' | 'archers' | 'mixed'
  name: string;             // from mercenary template
  squads: Array<{ type: string; count: number }>;
  provinceId: string;       // current location on map
  totalTroops: number;      // sum of count * 10 per squad (e.g. 80)
  spawnTurn: number;        // turn when spawned
  status: 'marching' | 'destroyed';
  // Field battle destruction context
  destroyedTurn?: number;
  destroyedByBannerId?: number;
  destroyedByBannerName?: string;
  fieldBattleId?: string;
}

export type ExpeditionLogEntry = {
  id: string;                    // unique key (e.g. "log_{turn}_{index}")
  turn: number;
  type: 'hostile_detected' | 'battle_resolved' | 'army_destroyed'
      | 'mission_completed' | 'fortress_attacked' | 'fortress_damaged';
  text: string;                  // short readable message
  provinceId?: string;           // for camera focus
  battleResultId?: string;       // links to FieldBattleResult.id for "open report"
};

export interface ExpeditionMapState {
  fortressProvinceId: string;
  armyPositions: Record<number, string>;   // bannerId → provinceId
  missionPositions: Record<number, string>; // missionId → provinceId
  revealedProvinces: string[];
  provinceControl: Record<string, string>; // provinceId → faction/player
  turnNumber: number;                       // starts at 1
  pendingOrders: Record<number, ArmyOrder>; // bannerId → order for next turn
  enemyArmies?: EnemyArmy[];               // NPC hostile forces on the map
  nextEnemyId?: number;                     // incrementing ID counter for enemies
  expeditionFailed?: boolean;               // true when fortress falls to enemy attack
  fieldBattleResults?: FieldBattleResult[]; // history of field battles
  battleProvinces?: string[];               // provinces with battles THIS turn (visual highlight)
  expeditionMissions?: Mission[];           // expedition-type missions placed on the map
  completedExpeditionMissionIds?: number[];  // IDs completed THIS turn (for reward popup)
  expeditionLog?: ExpeditionLogEntry[];     // event log entries (newest first)
  battleAftermath?: Record<string, number>; // provinceId → turnsRemaining (3,2,1) for VFX decay
}
