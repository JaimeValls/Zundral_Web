import React, { useEffect, useMemo, useState, useRef } from "react";
import BlacksmithUI from './BlacksmithUI';
import TechnologiesUI from './TechnologiesUI';
import LeaderboardUI from './LeaderboardUI';
import { persistence, simulateOfflineProgression, GameState } from './persistence';
import { updateLeaderboardFromBattleResult, recalculateRanksAndTitles, createPlaceholderLeaderboard, type LeaderboardEntry, type BattleResult as LeaderboardBattleResult, type Faction } from './leaderboard';
import { useMobileDetection } from './hooks/useMobileDetection';
import type {
  WarehouseState, WarehouseCap,
  UnitType, Division,
  Squad, Banner, BannerLossNotice, BannerTemplate,
  CommanderArchetype, Commander,
  Mission, BattleResult,
  FactionId, FactionBranchId, FactionPerkNode, PlayerFactionState,
  FortressBuilding, FortressStats, SiegeRound, InnerBattleStep, SiegeBattleResult, BattleSquadEntry, FieldBattleResult, Expedition, EnemyArmy,
  TownHallLevel, TownHallState,
  TrainingEntry, BarracksState, TavernState, MilitaryAcademyState,
  ArmyOrder,
} from './types';
import type { ProvinceData } from './types';
import { findPath } from './features/map/mapUtils';
import {
  unitCategory, ironCostPerSquad, squadConfig, unitDisplayNames,
  XP_LEVELS,
  COMMANDER_ARCHETYPES,
} from './constants';
import {
  getResourceIcon,
  getProgression, getBuildingCost, getWarehouseCapacity, getWarehouseCost,
  getIronCostPerUnit,
  calculateLevelFromXP,
  calculateCommanderXPToNextLevel, updateCommanderXP,
  calculateBannerXPGain, updateBannerXP,
  getHouseCost, getHouseCapacity, getTownHallCost, getBarracksCost,
  getMilitaryAcademyCost, getMilitaryAcademyBuildCost, canBuildMilitaryAcademy,
  getTavernCost, getBarracksBuildCost, getTavernBuildCost,
  canBuildBarracks, canBuildTavern, getMaxTrainingSlots,
  initializeSquadsFromUnits, distributeLossesToBanner, calculateBannerLosses,
  distributeTypeLossesAcrossBanners, trimSquadsByType,
  generateCommanderName, generateBannerName,
} from './gameFormulas';
import {
  simulateBattle,
  getDefaultUnitStats, getDefaultBattleParams,
  type UnitStats, type BattleParams,
} from './battleSimulator';
import { BattleChart } from './components/BattleChart';
import FactionsUI from './features/FactionsUI';
import CouncilUI from './features/CouncilUI';
import MissionsUI from './features/MissionsUI';
import ArmyTab from './features/ArmyTab';
import ExpeditionsUI from './features/ExpeditionsUI';
// === Debug logging (silent in production builds) ===
const __DEV__ = import.meta.env.DEV;
const dbg = {
  log: (...args: unknown[]) => { if (__DEV__) console.log(...args); },
  warn: (...args: unknown[]) => { if (__DEV__) console.warn(...args); },
  error: (...args: unknown[]) => { if (__DEV__) console.error(...args); },
};

import lumberjackImg from '../imgs/buildings/lumbjerjack.png';
import backgroundImg from '../imgs/background/background01.png';
import rPopulation from '../imgs/resources/r_population.png';
import rTaxes from '../imgs/resources/r_taxes.png';


export default function ResourceVillageUI() {
  // === Province data (cached for fortress placement) ===
  const provinceDataRef = useRef<any>(null);
  const [provinceDataReady, setProvinceDataReady] = useState(false);
  useEffect(() => {
    fetch('/godonis/v2/province_data.json')
      .then(r => r.json())
      .then(data => { provinceDataRef.current = data; setProvinceDataReady(true); })
      .catch(() => { /* Non-critical — only needed for map */ });
  }, []);

  // === Warehouse (resources + level) ===
  const [warehouse, setWarehouse] = useState<WarehouseState>({ wood: 0, stone: 0, food: 0, iron: 0, gold: 0 });
  const [warehouseLevel, setWarehouseLevel] = useState(1);
  const [skillPoints, setSkillPoints] = useState(0);

  const warehouseCap = useMemo<WarehouseCap>(() => ({
    wood: getWarehouseCapacity(warehouseLevel),
    stone: getWarehouseCapacity(warehouseLevel),
    food: getWarehouseCapacity(warehouseLevel),
    iron: getWarehouseCapacity(warehouseLevel),
    gold: getWarehouseCapacity(warehouseLevel),
  }), [warehouseLevel]);

  // === Buildings ===
  const [lumberMill, setLumberMill] = useState({ level: 1, stored: 0, enabled: true, workers: 1 });
  const [quarry, setQuarry] = useState({ level: 1, stored: 0, enabled: true, workers: 1 });
  const [farm, setFarm] = useState({ level: 1, stored: 0, enabled: true, workers: 1 });
  const [ironMine, setIronMine] = useState({ level: 1, stored: 0, enabled: true, workers: 1 });
  const [house, setHouse] = useState(1); // House level (0 workers required, +5 cap per level)

  // === New Buildings ===
  const [townHall, setTownHall] = useState<TownHallState>({ level: 1 });
  const [barracks, setBarracks] = useState<BarracksState | null>(null);
  const [tavern, setTavern] = useState<TavernState | null>(null);
  const [militaryAcademy, setMilitaryAcademy] = useState<MilitaryAcademyState | null>(null);
  const [commanders, setCommanders] = useState<Commander[]>([]);

  // === Happiness System ===
  const [happiness, setHappiness] = useState(50); // Base 50

  // === Iron Consumption Feedback ===
  const [ironConsumptionFeedback, setIronConsumptionFeedback] = useState<{ message: string; timestamp: number } | null>(null);

  // === Banner Templates ===
  const [bannerTemplates, setBannerTemplates] = useState<BannerTemplate[]>([
    { id: 'spearmen', name: 'Bloody Warriors', squads: [{ type: 'warrior', count: 8 }], upkeepPerSecond: 0, requiredPopulation: 80, cost: 50 }, // 8 squads * 10 pop = 80
    { id: 'archers', name: 'Archers', squads: [{ type: 'archer', count: 8 }], upkeepPerSecond: 0, requiredPopulation: 80, cost: 50 }, // 8 squads * 10 pop = 80
    { id: 'mixed', name: 'Mixed Skirmish', squads: [{ type: 'warrior', count: 4 }, { type: 'archer', count: 4 }], upkeepPerSecond: 0, requiredPopulation: 80, cost: 50 }, // 8 squads * 10 pop = 80
  ]);

  // === Population & Taxes ===
  // EMERGENCY RULE: Population minimum is 1 (never zero)
  const [population, setPopulation] = useState(5); // starts at 5
  const [recruitmentMode, setRecruitmentMode] = useState<'regular' | 'forced'>('regular'); // Recruitment mode: regular (free workers only) or forced (can use working workers)
  const [tax, setTax] = useState<'very_low' | 'low' | 'normal' | 'high' | 'very_high'>('normal');

  // === Cheat Menu Visibility ===
  const [showCheatMenu, setShowCheatMenu] = useState(false);

  // === Fullscreen State ===
  const [isFullscreen, setIsFullscreen] = useState(false);

  // === Mobile Resource Rate Display State ===
  const [showingRateFor, setShowingRateFor] = useState<string | null>(null);
  const rateDisplayTimeoutRef = useRef<any>(null);

  // === Toast Notification State ===
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-clear toast after 2.3 s (2 s visible + 0.3 s fade-out)
  useEffect(() => {
    if (toastMessage === null) return;
    if (toastTimeoutRef.current !== null) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2300);
    return () => {
      if (toastTimeoutRef.current !== null) clearTimeout(toastTimeoutRef.current);
    };
  }, [toastMessage]);

  // Helper: show "Not enough X, Y" toast for missing resources
  const showMissingResourceToast = (checks: { wood?: boolean; stone?: boolean; gold?: boolean; iron?: boolean; food?: boolean }) => {
    const missing: string[] = [];
    if (checks.wood === false) missing.push('Wood');
    if (checks.stone === false) missing.push('Stone');
    if (checks.gold === false) missing.push('Gold');
    if (checks.iron === false) missing.push('Iron');
    if (checks.food === false) missing.push('Food');
    if (missing.length > 0) setToastMessage(`Not enough ${missing.join(', ')}`);
  };

  // Clear rate display after 3 seconds or when clicking elsewhere
  useEffect(() => {
    if (showingRateFor) {
      if (rateDisplayTimeoutRef.current) {
        clearTimeout(rateDisplayTimeoutRef.current);
      }
      rateDisplayTimeoutRef.current = setTimeout(() => {
        setShowingRateFor(null);
      }, 3000);
    }
    return () => {
      if (rateDisplayTimeoutRef.current) {
        clearTimeout(rateDisplayTimeoutRef.current);
      }
    };
  }, [showingRateFor]);

  // Close rate display when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (showingRateFor && !(e.target as Element).closest('.mobile-resource-cell')) {
        setShowingRateFor(null);
      }
    };

    if (showingRateFor) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showingRateFor]);

  const handleResourceTap = (label: string, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (showingRateFor === label) {
      setShowingRateFor(null);
    } else {
      setShowingRateFor(label);
    }
  };

  // Check if fullscreen is supported and get the correct API
  const getFullscreenElement = () => {
    return document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement ||
      null;
  };

  const requestFullscreen = (): Promise<void> => {
    const element = document.documentElement;
    if (element.requestFullscreen) {
      return element.requestFullscreen() as Promise<void>;
    } else if ((element as any).webkitRequestFullscreen) {
      return (element as any).webkitRequestFullscreen() as Promise<void>;
    } else if ((element as any).mozRequestFullScreen) {
      return (element as any).mozRequestFullScreen() as Promise<void>;
    } else if ((element as any).msRequestFullscreen) {
      return (element as any).msRequestFullscreen() as Promise<void>;
    }
    return Promise.reject(new Error('Fullscreen not supported'));
  };

  const exitFullscreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    } else if ((document as any).mozCancelFullScreen) {
      (document as any).mozCancelFullScreen();
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen();
    }
  };

  const toggleFullscreen = () => {
    if (getFullscreenElement()) {
      exitFullscreen();
    } else {
      requestFullscreen();
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!getFullscreenElement());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Check initial state
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Attempt fullscreen on first user interaction
  useEffect(() => {
    // Try to enter fullscreen on first click/touch (browsers require user interaction)
    let hasAttemptedFullscreen = false;

    const attemptFullscreenOnInteraction = () => {
      if (!hasAttemptedFullscreen && !getFullscreenElement()) {
        hasAttemptedFullscreen = true;
        requestFullscreen().catch(() => {
          // Silently fail if fullscreen is not allowed
          // User can still use the button to enter fullscreen
        });
      }
    };

    // Try on first click
    document.addEventListener('click', attemptFullscreenOnInteraction, { once: true });
    // Try on first touch (for mobile)
    document.addEventListener('touchstart', attemptFullscreenOnInteraction, { once: true });

    return () => {
      document.removeEventListener('click', attemptFullscreenOnInteraction);
      document.removeEventListener('touchstart', attemptFullscreenOnInteraction);
    };
  }, []);

  const popCap = useMemo(() => getHouseCapacity(house), [house]);

  // === Happiness Calculation ===
  const happinessModifier = useMemo(() => {
    let base = 50;

    // Tax modifier
    if (tax === 'very_low') base += 30;
    else if (tax === 'low') base += 15;
    else if (tax === 'high') base -= 15;
    else if (tax === 'very_high') base -= 30;
    // normal tax: +0 (no change)

    // Tavern modifier
    if (tavern) {
      if (tavern.level === 1) base += 10;
      else if (tavern.level === 2) base += 20;
      else if (tavern.level === 3) base += 25;
    }

    // Festival modifier
    if (tavern?.activeFestival && Date.now() < tavern.festivalEndTime) {
      base += 15;
    }

    return Math.max(0, Math.min(100, base));
  }, [tax, tavern]);

  // Update happiness state
  useEffect(() => {
    setHappiness(happinessModifier);
  }, [happinessModifier]);

  // Check for expired festivals
  useEffect(() => {
    if (!tavern || !tavern.activeFestival) return;

    const checkFestival = setInterval(() => {
      if (tavern && tavern.activeFestival && Date.now() >= tavern.festivalEndTime) {
        setTavern(prev => prev ? { ...prev, activeFestival: false, festivalEndTime: 0 } : null);
      }
    }, 1000);

    return () => clearInterval(checkFestival);
  }, [tavern]);

  // === Net Population Change ===
  const netPopulationChange = useMemo(() => {
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
  }, [tax, happiness]);

  // === Tabs ===
  const [mainTab, setMainTab] = useState<'production' | 'army' | 'missions' | 'expeditions' | 'leaderboard' | 'factions' | 'council'>('production');

  // Ensure army tab is only accessible when barracks is built
  useEffect(() => {
    if (mainTab === 'army' && (!barracks || barracks.level < 1)) {
      setMainTab('production');
    }

    // Clear army recruitment drafts when leaving the army tab
    if (mainTab !== 'army') {
      // bannersDraft removed - no need to clear
    }
  }, [mainTab, barracks]);

  // === Army / Banners builder state ===
  const [draftSquads, setDraftSquads] = useState<UnitType[]>([]); // Array of unit types for the draft banner
  const [banners, setBanners] = useState<Banner[]>([]);
  const [editingBannerId, setEditingBannerId] = useState<number | string | null>(null);
  const [bannersDraft, setBannersDraft] = useState<Banner | null>(null); // Singular draft for the edited banner

  // === Edit Mode Helpers ===
  const startEditingBanner = (bannerId: number | string) => {
    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;

    // Create deep copy for draft
    setBannersDraft(JSON.parse(JSON.stringify(banner)));
    setEditingBannerId(bannerId);
  };

  const cancelEditingBanner = () => {
    setBannersDraft(null);
    setEditingBannerId(null);
  };

  const updateBannerNameDraft = (name: string) => {
    if (!bannersDraft) return;
    setBannersDraft({ ...bannersDraft, name });
  };

  const confirmEditingBanner = () => {
    if (!bannersDraft || editingBannerId === null) return;

    setBanners(prev => prev.map(b =>
      b.id === editingBannerId ? bannersDraft : b
    ));

    setBannersDraft(null);
    setEditingBannerId(null);
    saveGame();
  };
  const [bannerHint, setBannerHint] = useState<{ id: number | string, message: string } | null>(null);

  useEffect(() => {
    if (bannerHint) {
      const timer = setTimeout(() => setBannerHint(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [bannerHint]);
  const [bannerSeq, setBannerSeq] = useState(1);
  const [commanderSeq, setCommanderSeq] = useState(1);
  const [squadSeq, setSquadSeq] = useState(1); // Global squad ID counter
  const squadSeqRef = useRef(1); // Ref to track current squadSeq for closures
  const [bannerLossNotices, setBannerLossNotices] = useState<BannerLossNotice[]>([]);
  const [armyTab, setArmyTab] = useState<'overview' | 'mercenaries' | 'regular'>('overview'); // New tab state for split views

  // Debug: Log notification state changes
  useEffect(() => {
    dbg.log('[STATE] bannerLossNotices changed. Count:', bannerLossNotices.length, 'Notices:', bannerLossNotices);
  }, [bannerLossNotices]);

  // Keep ref in sync with state
  useEffect(() => {
    squadSeqRef.current = squadSeq;
  }, [squadSeq]);

  // === Faction System ===
  const [factionState, setFactionState] = useState<PlayerFactionState>(() => ({
    availableFP: 0,
    alsusFP: 0,
    atroxFP: 0,
    alsusUnspentFP: 0,
    atroxUnspentFP: 0,
    perks: createPerkTree(),
  }));

  const [selectedFaction, setSelectedFaction] = useState<FactionId>('Alsus');

  // Faction functions
  function addFactionPoints(amount: number): void {
    setFactionState(prev => ({
      ...prev,
      availableFP: prev.availableFP + amount,
    }));
  }

  function assignFPToFaction(faction: FactionId, amount: number): void {
    setFactionState(prev => {
      if (prev.availableFP < amount) return prev;

      if (faction === 'Alsus') {
        return {
          ...prev,
          availableFP: prev.availableFP - amount,
          alsusFP: prev.alsusFP + amount,
          alsusUnspentFP: prev.alsusUnspentFP + amount,
        };
      } else {
        return {
          ...prev,
          availableFP: prev.availableFP - amount,
          atroxFP: prev.atroxFP + amount,
          atroxUnspentFP: prev.atroxUnspentFP + amount,
        };
      }
    });
  }

  function canUnlockPerk(nodeId: string): boolean {
    const node = factionState.perks[nodeId];
    if (!node || node.unlocked) return false;

    // Check faction FP
    const hasEnoughFP = node.faction === 'Alsus'
      ? factionState.alsusUnspentFP >= node.costFP
      : factionState.atroxUnspentFP >= node.costFP;

    if (!hasEnoughFP) return false;

    // Check if all lower tiers in the same branch are unlocked
    for (let tier = 1; tier < node.tier; tier++) {
      const lowerNodeId = `${node.branchId}_T${tier}`;
      const lowerNode = factionState.perks[lowerNodeId];
      if (!lowerNode || !lowerNode.unlocked) {
        return false;
      }
    }

    return true;
  }

  function unlockPerk(nodeId: string): boolean {
    if (!canUnlockPerk(nodeId)) return false;

    const node = factionState.perks[nodeId];
    setFactionState(prev => {
      const updatedPerks = { ...prev.perks };
      updatedPerks[nodeId] = { ...node, unlocked: true };

      if (node.faction === 'Alsus') {
        return {
          ...prev,
          perks: updatedPerks,
          alsusUnspentFP: prev.alsusUnspentFP - node.costFP,
        };
      } else {
        return {
          ...prev,
          perks: updatedPerks,
          atroxUnspentFP: prev.atroxUnspentFP - node.costFP,
        };
      }
    });

    return true;
  }

  // === Expeditions ===
  // === Leaderboard ===
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const REAL_PLAYER_ID = 'real_player';
  const REAL_PLAYER_NAME = 'REAL PLAYER';
  const REAL_PLAYER_FACTION: Faction = 'Alsus'; // TODO: Make this configurable

  const [expeditions, setExpeditions] = useState<Expedition[]>([
    {
      expeditionId: "godonis_mountain_expedition",
      title: "Whispers in the Mountains of Godonis",
      shortSummary: "Investigate the disappearances in the mountains of Godonis.",
      description: `During the night, people, and sometimes entire villages, disappear in the mountains of Godonis. The mountain clans are begging for help. We must send an expedition to find out what is happening.`,
      state: 'available',
      requirements: {
        wood: { required: 500, current: 0 },
        stone: { required: 250, current: 0 },
        food: { required: 1000, current: 0 },
        population: { required: 5, current: 0 },
      },
      travelProgress: 0,
    },
  ]);

  // === Reward Tier System ===
  type RewardTier = 'very_easy' | 'easy' | 'medium' | 'hard' | 'very_hard' | 'extreme';

  const REWARD_TIERS: Record<RewardTier, { name: string; flavor: string; icon: string; rewards: { gold: number; wood: number; stone: number; food: number; iron: number } }> = {
    very_easy: {
      name: "Scout's Cache",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "📦",
      rewards: { gold: 10, wood: 15, stone: 10, food: 20, iron: 5 }
    },
    easy: {
      name: "Raider's Loot",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "🎒",
      rewards: { gold: 25, wood: 40, stone: 30, food: 50, iron: 15 }
    },
    medium: {
      name: "War Chest",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "💼",
      rewards: { gold: 60, wood: 100, stone: 80, food: 120, iron: 40 }
    },
    hard: {
      name: "Commander's Supply Crate",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "📦",
      rewards: { gold: 150, wood: 250, stone: 200, food: 300, iron: 100 }
    },
    very_hard: {
      name: "Warlord's Hoard",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "🏆",
      rewards: { gold: 400, wood: 600, stone: 500, food: 800, iron: 250 }
    },
    extreme: {
      name: "Legendary Tribute",
      flavor: "Your troops return with spoils from the battlefield.",
      icon: "👑",
      rewards: { gold: 1000, wood: 1500, stone: 1200, food: 2000, iron: 600 }
    }
  };

  function getDifficultyTier(enemyTotal: number): RewardTier {
    if (enemyTotal <= 30) return 'very_easy';
    if (enemyTotal <= 100) return 'easy';
    if (enemyTotal <= 300) return 'medium';
    if (enemyTotal <= 600) return 'hard';
    if (enemyTotal <= 2500) return 'very_hard';
    return 'extreme';
  }

  function generateMissionRewards(enemyTotal: number): { tier: RewardTier; rewards: { gold: number; wood: number; stone: number; food: number; iron: number } } {
    const tier = getDifficultyTier(enemyTotal);
    const baseRewards = REWARD_TIERS[tier].rewards;

    // Scale rewards slightly based on enemy total for variety within same tier
    const scaleFactor = 1 + (enemyTotal % 100) / 1000; // Small variation (0-10%)

    return {
      tier,
      rewards: {
        gold: Math.floor(baseRewards.gold * scaleFactor),
        wood: Math.floor(baseRewards.wood * scaleFactor),
        stone: Math.floor(baseRewards.stone * scaleFactor),
        food: Math.floor(baseRewards.food * scaleFactor),
        iron: Math.floor(baseRewards.iron * scaleFactor),
      }
    };
  }

  // === Faction Perk Tree Definitions ===
  function createPerkTree(): Record<string, FactionPerkNode> {
    const perks: Record<string, FactionPerkNode> = {};

    // Alsus branches
    const alsusBranches: Array<{ id: FactionBranchId; name: string }> = [
      { id: 'Alsus_Tactics', name: 'Magnus War Council' },
      { id: 'Alsus_Lux', name: 'Lux Guardians' },
      { id: 'Alsus_Crowns', name: 'Pact of Crowns' },
    ];

    // Atrox branches
    const atroxBranches: Array<{ id: FactionBranchId; name: string }> = [
      { id: 'Atrox_Blood', name: 'Blood Legions' },
      { id: 'Atrox_Fortress', name: 'Iron Bastions of Roctium' },
      { id: 'Atrox_Spoils', name: 'Spoils of War' },
    ];

    // Create perks for Alsus (5 tiers per branch)
    alsusBranches.forEach(branch => {
      for (let tier = 1; tier <= 5; tier++) {
        const nodeId = `${branch.id}_T${tier}`;
        perks[nodeId] = {
          id: nodeId,
          faction: 'Alsus',
          branchId: branch.id,
          tier,
          costFP: tier,
          unlocked: false,
          name: `${branch.name} Tier ${tier}`,
          description: `Placeholder perk description for ${branch.name} tier ${tier}`,
        };
      }
    });

    // Create perks for Atrox (5 tiers per branch)
    atroxBranches.forEach(branch => {
      for (let tier = 1; tier <= 5; tier++) {
        const nodeId = `${branch.id}_T${tier}`;
        perks[nodeId] = {
          id: nodeId,
          faction: 'Atrox',
          branchId: branch.id,
          tier,
          costFP: tier,
          unlocked: false,
          name: `${branch.name} Tier ${tier}`,
          description: `Placeholder perk description for ${branch.name} tier ${tier}`,
        };
      }
    });

    return perks;
  }

  // === Mission Pools — separated by gameplay context ===
  // Each pool is self-contained. Future expeditions get their own pool.

  type MissionTemplate = Omit<Mission, 'status' | 'staged' | 'deployed' | 'elapsed' | 'battleResult' | 'rewards' | 'rewardTier' | 'cooldownEndTime' | 'isNew'>;

  // ── Base Mission Pool (completed from mission tab) ──
  const BASE_MISSION_POOL: MissionTemplate[] = [
    {
      id: 1, missionType: 'list',
      name: 'Scout the Forest',
      terrain: 'forest',
      description: 'Your task is to explore the outskirts of the village and chart any nearby landmarks or threats. Expect light resistance. Current estimates suggest you may encounter one hostile squad. Proceed carefully, avoid unnecessary engagement, and return with a clear report of the terrain and enemy presence.',
      duration: 3,
      enemyComposition: { warrior: 15, archer: 5 }
    },
    {
      id: 2, missionType: 'list',
      name: 'Secure the Quarry Road',
      terrain: 'hills',
      description: 'Your forces must secure the old road leading to the quarry. Enemy scouts have been sighted nearby, and resistance is expected to be significant. Intelligence indicates three warrior squads supported by one archer squad. Advance with caution, break their formation, and ensure the road is safe for future transport.',
      duration: 3,
      enemyComposition: { warrior: 90, archer: 30 }
    },
    {
      id: 3, missionType: 'list',
      name: 'Sweep the Northern Ridge',
      terrain: 'hills',
      description: 'A fortified enemy group has settled along the northern ridge. This will be a demanding operation. Expect to face five warrior squads and one archer squad. Push through their defensive line, neutralise all threats, and reclaim control of the ridge for the village.',
      duration: 3,
      enemyComposition: { warrior: 300, archer: 50 }
    },
    {
      id: 4, missionType: 'list',
      name: 'Ambush the River Raiders',
      terrain: 'forest',
      description: 'Your task is to clear the raiders operating along the riverbank. Scouts report small, fast-moving bands conducting ambushes on travellers. Expect light resistance composed of one warrior squad and a small archer detachment. Engage swiftly and secure the water route for the village.',
      duration: 3,
      enemyComposition: { warrior: 20, archer: 10 }
    },
    {
      id: 5, missionType: 'list',
      name: 'Purge the Old Mine',
      terrain: 'hills',
      description: 'You must investigate the abandoned mine and eliminate any hostile presence within. Recent reports mention strange movements underground, likely from lurking creatures or desperate bandits. Expect two loosely organised squads with limited coordination. Push through the tunnels and restore safety to the area.',
      duration: 3,
      enemyComposition: { warrior: 35, archer: 15 }
    },
    {
      id: 8, missionType: 'list',
      name: 'Hunt the Plains Marauders',
      terrain: 'plains',
      description: 'Marauders have been raiding farms across the plains, striking quickly before retreating. Scouts estimate one fast-moving warrior squad with two small archer groups in support. Expect unpredictable movement. Track them down, break their momentum, and restore security to the farmlands.',
      duration: 3,
      enemyComposition: { warrior: 50, archer: 30 }
    },
    {
      id: 9, missionType: 'list',
      name: 'Crush the Hilltop Outpost',
      terrain: 'hills',
      description: 'A fortified outpost atop the northern hill is coordinating enemy patrols. Reports suggest two warrior squads and one archer squad defending the structure. Expect elevated positions and defensive tactics. Overwhelm their lines and reclaim the high ground.',
      duration: 3,
      enemyComposition: { warrior: 150, archer: 50 }
    },
    {
      id: 12, missionType: 'list',
      name: 'Retake the Fallen Watchtower',
      terrain: 'building',
      description: 'The old watchtower to the east has fallen to enemy hands. Reports indicate one warrior squad and one archer squad occupying the structure. Expect defenders to use elevation. Retake the tower and restore control of the eastern perimeter.',
      duration: 3,
      enemyComposition: { warrior: 60, archer: 40 }
    },
    {
      id: 14, missionType: 'list',
      name: 'Clean the Marsh Ruins',
      terrain: 'building',
      description: 'Ancient ruins in the marshlands have become infested with hostile creatures. Scouts confirm two creature packs behaving like irregular squads with unpredictable patterns. Expect sudden engagements in difficult terrain. Purge the ruins and secure the wetlands.',
      duration: 3,
      enemyComposition: { warrior: 50, archer: 20 }
    },
    {
      id: 20, missionType: 'list',
      name: 'Final Push: The Army of Ten Thousand',
      terrain: 'plains',
      description: 'A massive enemy host is advancing toward the region. Scouts report an overwhelming formation comprising dozens of warrior squads, numerous archer regiments, and elite detachments. Expect extreme resistance. Strike decisively and prevent the enemy from overrunning the land.',
      duration: 3,
      enemyComposition: { warrior: 7500, archer: 2500 }
    },
  ];

  // ── Expedition 1 Mission Pool (auto-complete on expedition map) ──
  const EXPEDITION_1_MISSION_POOL: MissionTemplate[] = [
    {
      id: 6, missionType: 'expedition',
      name: 'Break the Southern Blockade',
      terrain: 'plains',
      description: 'Enemy forces have erected a blockade on the southern path, disrupting trade and movement. Scouts confirm two warrior squads supported by one shielded unit holding the chokepoint. Expect a firm defensive stance. Break their line, dismantle the barricades, and reopen the route.',
      duration: 3,
      enemyComposition: { warrior: 130, archer: 30 }
    },
    {
      id: 7, missionType: 'expedition',
      name: 'Destroy the War Camp at Red Valley',
      terrain: 'plains',
      description: 'A medium-sized war camp has been established in Red Valley, preparing forces for future assaults. Intelligence indicates three warrior squads, one archer squad, and an elite champion overseeing training. Expect organised resistance. Disrupt their preparations and cripple their ability to expand.',
      duration: 3,
      enemyComposition: { warrior: 360, archer: 90 }
    },
    {
      id: 10, missionType: 'expedition',
      name: 'Cleanse the Bandit Warrens',
      terrain: 'hills',
      description: 'A network of caves has become the base of a growing bandit force. Intelligence confirms three disorganised squads with mixed weaponry. Expect cramped fighting conditions and opportunistic strikes. Push through the warrens and eliminate their leadership.',
      duration: 3,
      enemyComposition: { warrior: 240, archer: 60 }
    },
    {
      id: 11, missionType: 'expedition',
      name: 'Eliminate the Elite Vanguard',
      terrain: 'plains',
      description: 'Enemy commanders have deployed an elite vanguard to probe your defences. Scouts report one elite squad accompanied by two disciplined warrior units. Expect coordinated attacks and higher combat proficiency. Disrupt their advance and send a clear message.',
      duration: 3,
      enemyComposition: { warrior: 380, archer: 120 }
    },
    {
      id: 13, missionType: 'expedition',
      name: 'Assault the Siege Workshop',
      terrain: 'building',
      description: 'A hidden workshop is producing siege equipment for future assaults. Intelligence estimates two warrior squads, one engineer squad, and a small archer detachment guarding the site. Expect traps and defensive constructs. Destroy the facility before production escalates.',
      duration: 3,
      enemyComposition: { warrior: 480, archer: 120 }
    },
    {
      id: 15, missionType: 'expedition',
      name: 'Intercept the Supply Caravan',
      terrain: 'plains',
      description: 'A heavily guarded caravan is transporting weapons and armour to frontline forces. Intelligence indicates two warrior squads escorting multiple supply wagons. Expect disciplined defence and a mobile formation. Halt the caravan and seize the supplies.',
      duration: 3,
      enemyComposition: { warrior: 160, archer: 60 }
    },
    {
      id: 16, missionType: 'expedition',
      name: 'Break the Ironclad Phalanx',
      terrain: 'hills',
      description: 'A highly trained phalanx is blocking a strategic mountain pass. Scouts report one phalanx unit supported by two elite warriors. Expect a strong frontal defence. Flank their formation, break their discipline, and reopen the pass.',
      duration: 3,
      enemyComposition: { warrior: 700, archer: 200 }
    },
    {
      id: 17, missionType: 'expedition',
      name: 'Storm the Fortress of Grey Ridge',
      terrain: 'hills',
      description: 'A reinforced enemy fortress dominates Grey Ridge and controls several valleys. Intelligence confirms four warrior squads, two archer squads, and a veteran commander. Expect prolonged resistance. Breach their defences and reclaim the stronghold.',
      duration: 3,
      enemyComposition: { warrior: 2000, archer: 500 }
    },
    {
      id: 18, missionType: 'expedition',
      name: 'Defeat the Beastlord\'s Horde',
      terrain: 'forest',
      description: 'A monstrous warlord has assembled a large horde of beasts and fanatics. Scouts estimate three beast packs supported by two frenzied warrior squads. Expect erratic and aggressive assaults. Hold formation and cut through the enemy swarm.',
      duration: 3,
      enemyComposition: { warrior: 2400, archer: 800 }
    },
    {
      id: 19, missionType: 'expedition',
      name: 'Burn the Great Encampment',
      terrain: 'plains',
      description: 'A sprawling encampment is hosting large numbers of enemy troops and resources. Intelligence identifies five warrior squads, two archer units, and multiple auxiliary detachments. Expect widespread resistance across several positions. Torch the encampment and disrupt their supply network.',
      duration: 3,
      enemyComposition: { warrior: 4000, archer: 1000 }
    },
    {
      id: 21, missionType: 'expedition',
      name: 'Clear the Ruined Barracks',
      terrain: 'building',
      description: 'An abandoned barracks complex has been reoccupied by hostile troops and is now being used as a forward staging point. Scouts report two warrior squads supported by one ranged detachment holding the inner yard. Expect layered resistance through narrow approaches. Clear the complex and deny the enemy a foothold.',
      duration: 3,
      enemyComposition: { warrior: 280, archer: 70 }
    },
    {
      id: 22, missionType: 'expedition',
      name: 'Seize the Broken Gatehouse',
      terrain: 'building',
      description: 'A shattered gatehouse on the old frontier road has been fortified again to control local movement. Intelligence confirms three warrior squads and one archer unit entrenched across the upper levels and entry choke points. Expect a disciplined defence from protected positions. Seize the gatehouse and reopen the route.',
      duration: 3,
      enemyComposition: { warrior: 420, archer: 80 }
    },
    {
      id: 23, missionType: 'expedition',
      name: 'Purge the Desecrated Chapel',
      terrain: 'building',
      description: 'A once-sacred chapel has been converted into an enemy strongpoint and rally site. Scouts identify three warrior squads, one archer detachment, and a veteran guard unit holding the main hall. Expect stubborn resistance in confined spaces. Purge the chapel and break the enemy hold over the area.',
      duration: 3,
      enemyComposition: { warrior: 520, archer: 130 }
    },
    {
      id: 24, missionType: 'expedition',
      name: 'Break the Hall of Chains',
      terrain: 'building',
      description: 'A fortified prison hall is being used to hold captives and stockpile weapons for enemy operations. Intelligence reports four warrior squads supported by one archer unit guarding the central corridors and cell blocks. Expect heavy resistance across multiple interior positions. Break their control and secure the structure.',
      duration: 3,
      enemyComposition: { warrior: 760, archer: 140 }
    },
  ];

  // Helper: randomly select N missions from a specific pool, excluding given IDs
  // The missionType is inherited from the template (already set in each pool)
  function selectRandomMissions(count: number, pool: MissionTemplate[], excludeIds: number[] = []): Mission[] {
    const available = pool.filter(m => !excludeIds.includes(m.id));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(count, available.length));

    return selected.map(template => ({
      ...template,
      status: 'available' as const,
      staged: [],
      deployed: [],
      elapsed: 0,
      battleResult: undefined,
      rewards: undefined,
      rewardTier: undefined,
      cooldownEndTime: undefined,
      isNew: true
    }));
  }

  // Initialize with 3 random base missions
  const [missions, setMissions] = useState<Mission[]>(() => selectRandomMissions(3, BASE_MISSION_POOL));

  // Stable key that changes when expedition missions exist (triggers sync without infinite loop)
  const expMissionKey = expeditions.map(e =>
    (e.mapState?.expeditionMissions || []).map(m => m.id).join(',')
  ).join('|');

  // Sync mission positions on the map: assign provinces for available/running missions,
  // remove positions for completed/gone list missions.
  // Expedition missions keep their positions even when completed (visible as cleared markers).
  useEffect(() => {
    const pd = provinceDataRef.current;
    setExpeditions(exps => exps.map(exp => {
      if (!exp.mapState || !pd?.provinces) return exp;
      const pos = { ...(exp.mapState.missionPositions || {}) };
      let changed = false;

      // Expedition missions only: assign positions once, keep them forever (even completed)
      const fortressId = exp.mapState.fortressProvinceId;
      for (const m of (exp.mapState.expeditionMissions || [])) {
        if (!pos[m.id]) {
          const terrain = m.terrain || 'plains';
          const usedProvIds = new Set(Object.values(pos));
          const matching = pd.provinces.filter((p: any) => p.terrain === terrain && p.isLand && p.id !== fortressId && !usedProvIds.has(p.id));
          if (matching.length > 0) {
            const chosen = matching[Math.floor(Math.random() * matching.length)];
            pos[m.id] = chosen.id;
            changed = true;
            if (import.meta.env.DEV) {
              console.log(`[MissionSync] Expedition mission ${m.id} "${m.name}" → ${chosen.id} (${terrain})`);
            }
          }
        }
      }

      if (!changed) return exp;
      return { ...exp, mapState: { ...exp.mapState, missionPositions: pos } };
    }));
  }, [provinceDataReady, expMissionKey]);

  const [missionBannerSelector, setMissionBannerSelector] = useState<number | null>(null); // Mission ID showing banner selector
  const [missionLoading, setMissionLoading] = useState<number | null>(null); // Mission ID currently loading
  const [rewardModal, setRewardModal] = useState<null | { missionId: number }>(null);
  const [battleReport, setBattleReport] = useState<{
    missionId: number;
    result: BattleResult;
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
    commanderXP?: {
      commanderId: number;
      commanderName: string;
      xpGained: number;
      oldLevel: number;
      newLevel: number;
      oldXP: number;
      newXP: number;
      xpToNextLevel: number;
    };
  } | null>(null);
  const [rewardPopup, setRewardPopup] = useState<{ missionId: number; tier: string; rewards: { gold?: number; wood?: number; stone?: number; food?: number; iron?: number } } | null>(null);
  const [blacksmithOpen, setBlacksmithOpen] = useState(false);
  const [technologiesOpen, setTechnologiesOpen] = useState(false);
  const [deleteBannerModal, setDeleteBannerModal] = useState<number | null>(null); // Banner ID to delete
  const [reinforcementModal, setReinforcementModal] = useState<{ bannerId: number; squadId: number; goldCost: number; soldiersNeeded: number; bannerName: string; squadType: string } | null>(null);
  const [disableBuildingModal, setDisableBuildingModal] = useState<{ resource: "wood" | "stone" | "food" | "iron"; buildingName: string } | null>(null);
  const [hireAndRefillModal, setHireAndRefillModal] = useState<{ bannerId: number; hireCost: number; refillCost: number; totalCost: number; bannerName: string } | null>(null);
  const [siegeAttackModal, setSiegeAttackModal] = useState<{ expeditionId: string; attackers: number } | null>(null);
  const [editingBannerName, setEditingBannerName] = useState<number | null>(null); // Banner ID being edited
  const [deleteSquadModal, setDeleteSquadModal] = useState<{ bannerId: number; squadId: number } | null>(null); // Modal for confirming single squad deletion

  // Anchored Unit Picker State (Redesign)
  const [anchoredPickerState, setAnchoredPickerState] = useState<{
    isOpen: boolean;
    bannerId: number;
    slotIndex: number;
    anchorRect: DOMRect | null;
  }>({
    isOpen: false,
    bannerId: 0,
    slotIndex: 0,
    anchorRect: null
  });
  const isMobile = useMobileDetection(); // Detect mobile/touch devices
  const [showRecruitmentInfo, setShowRecruitmentInfo] = useState(false);

  // === Persistence ===
  // Serialize current component state to GameState
  function serializeGameState(): GameState {
    return {
      version: 1,
      lastSaveUtc: Date.now(),
      totalPlayTime: 0, // NOTE: Not currently tracked, kept for save compatibility

      warehouse,
      warehouseLevel,
      skillPoints,

      population,
      populationCap: popCap,
      recruitmentMode,
      tax,
      happiness,

      lumberMill,
      quarry,
      farm,
      ironMine,
      house,
      townHall,
      barracks,
      tavern: tavern ? {
        level: tavern.level,
        activeFestival: tavern.activeFestival || false,
        festivalEndTime: tavern.festivalEndTime || 0,
      } : null,
      militaryAcademy: militaryAcademy ? {
        level: militaryAcademy.level,
      } : null,
      commanders: commanders.map(c => ({
        id: c.id,
        name: c.name,
        archetype: c.archetype,
        rangedAttackBonusPercent: c.rangedAttackBonusPercent,
        meleeAttackBonusPercent: c.meleeAttackBonusPercent,
        assignedBannerId: c.assignedBannerId,
        level: c.level || 1,
        currentXP: c.currentXP || 0,
        xpToNextLevel: c.xpToNextLevel || calculateCommanderXPToNextLevel(c.level || 1),
      })),
      commanderSeq,

      banners: banners.map(b => ({
        ...b,
        customNamed: b.customNamed || false,
        commanderId: b.commanderId || null,
      })),
      bannerSeq,
      squadSeq,
      bannerLossNotices,

      missions: missions.map(m => ({
        ...m,
      })),

      expeditions: expeditions.map(exp => ({
        expeditionId: exp.expeditionId,
        title: exp.title,
        shortSummary: exp.shortSummary,
        description: exp.description,
        state: exp.state,
        requirements: exp.requirements,
        travelProgress: exp.travelProgress,
        mapState: exp.mapState,
        fortress: exp.fortress ? {
          buildings: exp.fortress.buildings.map(b => ({
            id: b.id,
            name: b.name,
            level: b.level,
            maxLevel: b.maxLevel,
            description: b.description,
            // Functions are not serialized - will be reconstructed on load
          })),
          stats: exp.fortress.stats,
          garrison: exp.fortress.garrison || [],
          lastBattle: exp.fortress.lastBattle,
        } : undefined,
      })),

      mainTab,
      armyTab,
      leaderboard,

      factionState: {
        availableFP: factionState.availableFP,
        alsusFP: factionState.alsusFP,
        atroxFP: factionState.atroxFP,
        alsusUnspentFP: factionState.alsusUnspentFP,
        atroxUnspentFP: factionState.atroxUnspentFP,
        perks: Object.fromEntries(
          Object.entries(factionState.perks).map(([id, perk]) => [
            id,
            {
              id: perk.id,
              faction: perk.faction,
              branchId: perk.branchId,
              tier: perk.tier,
              costFP: perk.costFP,
              unlocked: perk.unlocked,
              name: perk.name,
              description: perk.description,
            }
          ])
        ),
      },

      tutorialCompleted: false,
      debugFlags: {},
    };
  }

  // Load GameState into component state
  function loadGameState(state: GameState) {
    setWarehouse(state.warehouse);
    setWarehouseLevel(state.warehouseLevel);
    setSkillPoints(state.skillPoints);

    setPopulation(state.population);
    setRecruitmentMode(state.recruitmentMode);
    setTax(state.tax);
    setHappiness(state.happiness);

    setLumberMill(state.lumberMill);
    setQuarry(state.quarry);
    setFarm(state.farm);
    setIronMine(state.ironMine || { level: 1, stored: 0, enabled: true, workers: 1 }); // Fallback for old saves
    setHouse(state.house);
    setTownHall(state.townHall as any);
    setBarracks(state.barracks);
    setTavern(state.tavern);
    setMilitaryAcademy(state.militaryAcademy);

    // Load commanders with backward compatibility for level fields
    setCommanders((state.commanders || []).map(c => ({
      ...c,
      level: c.level || 1,
      currentXP: c.currentXP || 0,
      xpToNextLevel: c.xpToNextLevel || calculateCommanderXPToNextLevel(c.level || 1),
    })));
    setCommanderSeq(state.commanderSeq || 1);

    setBanners(state.banners.map(b => {
      // Recalculate XP level info if XP is present
      const xp = b.xp || 0;
      const levelInfo = calculateLevelFromXP(xp);

      return {
        ...b,
        units: b.units || [],
        squads: b.squads || [],
        // Ensure XP fields are set (recalculate if missing)
        xp: xp,
        level: b.level !== undefined ? b.level : levelInfo.level,
        xpCurrentLevel: b.xpCurrentLevel !== undefined ? b.xpCurrentLevel : levelInfo.xpCurrentLevel,
        xpNextLevel: b.xpNextLevel !== undefined ? b.xpNextLevel : levelInfo.xpNextLevel,
        commanderId: b.commanderId || null,
      };
    }));
    setBannerSeq(state.bannerSeq);
    setSquadSeq(state.squadSeq);
    setBannerLossNotices(state.bannerLossNotices);

    // Load missions from save, ensuring we always have exactly 3
    if (state.missions && state.missions.length > 0) {
      const loadedMissions = state.missions.map(m => {
        // Migrate old "complete" status to new statuses
        let status = m.status;
        if ((status as any) === 'complete') {
          // If rewards exist and rewardTier exists, it was claimed; otherwise pending
          status = (m.rewards && m.rewardTier) ? 'completedRewardsClaimed' : 'completedRewardsPending';
        }
        return {
          ...m,
          terrain: m.terrain as Mission['terrain'],
          missionType: (m.missionType || 'list') as Mission['missionType'],
          status: status as Mission['status'],
          description: m.description || '',
          enemyComposition: m.enemyComposition || { warrior: 0, archer: 0 },
          rewardTier: m.rewardTier,
          isNew: m.isNew || false,
        };
      });

      // If we have fewer than 3 missions, fill up to 3 with random ones
      if (loadedMissions.length < 3) {
        const currentIds = loadedMissions.map(m => m.id);
        const additionalMissions = selectRandomMissions(3 - loadedMissions.length, BASE_MISSION_POOL, currentIds);
        setMissions([...loadedMissions, ...additionalMissions]);
      } else if (loadedMissions.length > 3) {
        // If we have more than 3, keep only the first 3
        setMissions(loadedMissions.slice(0, 3));
      } else {
        setMissions(loadedMissions);
      }
    } else {
      // No saved missions, initialize with 3 random list missions
      setMissions(selectRandomMissions(3, BASE_MISSION_POOL));
    }

    setExpeditions(state.expeditions.map(exp => {
      if (!exp.fortress) return exp as unknown as Expedition;

      // Reconstruct fortress buildings with proper functions
      const buildingTemplates = createInitialFortressBuildings();
      const reconstructedBuildings = exp.fortress.buildings.map(savedBuilding => {
        const template = buildingTemplates.find(t => t.id === savedBuilding.id);
        if (template) {
          return {
            ...template,
            level: savedBuilding.level,
          };
        }
        // Fallback if template not found
        return {
          id: savedBuilding.id,
          name: savedBuilding.name,
          level: savedBuilding.level,
          maxLevel: savedBuilding.maxLevel,
          description: savedBuilding.description,
          getEffect: (level: number) => {
            // Reconstruct effect based on building type
            if (savedBuilding.id === 'palisade_wall') return { fortHP: 400 * level };
            if (savedBuilding.id === 'watch_post') return { archerSlots: WATCH_POST_ARCHERS_PER_LEVEL * level };
            if (savedBuilding.id === 'garrison_hut') return { garrisonCapacity: level };
            return {};
          },
          getUpgradeCost: (level: number) => {
            if (savedBuilding.id === 'palisade_wall') return { wood: 150 * level, stone: 75 * level };
            if (savedBuilding.id === 'watch_post') return { wood: 100 * level, stone: 50 * level };
            if (savedBuilding.id === 'garrison_hut') return { wood: 120 * level, stone: 60 * level };
            return { wood: 0, stone: 0 };
          },
        };
      });

      // Migrate mapState: add turnNumber/pendingOrders/expeditionMissions for old saves
      const rawMapState = (exp as any).mapState;
      const migratedMapState = rawMapState ? {
        ...rawMapState,
        turnNumber: rawMapState.turnNumber ?? 1,
        pendingOrders: rawMapState.pendingOrders ?? {},
        expeditionMissions: rawMapState.expeditionMissions ?? [],
        completedExpeditionMissionIds: rawMapState.completedExpeditionMissionIds ?? [],
      } : rawMapState;

      // Recalculate stats from reconstructed buildings (handles migrations like garrisonCapacity)
      const recalculatedStats = calculateFortressStats(reconstructedBuildings);

      // Migrate: if mapState.expeditionFailed is true but state still says 'completed', fix it
      const migratedExpState = (migratedMapState?.expeditionFailed && exp.state === 'completed')
        ? 'failed' as const
        : exp.state;

      return {
        ...exp,
        state: migratedExpState,
        fortress: {
          ...exp.fortress,
          buildings: reconstructedBuildings,
          stats: recalculatedStats,
          garrison: exp.fortress.garrison || [],
        },
        mapState: migratedMapState,
      };
    }));

    setMainTab(state.mainTab as any);
    const loadedArmyTab = state.armyTab === 'banners' ? 'regular' : state.armyTab;
    setArmyTab(['overview', 'mercenaries', 'regular'].includes(loadedArmyTab) ? loadedArmyTab as 'overview' | 'mercenaries' | 'regular' : 'overview');

    // Load leaderboard, ensuring real player entry exists
    if (state.leaderboard && state.leaderboard.length > 0) {
      const hasRealPlayer = state.leaderboard.some(e => e.playerId === REAL_PLAYER_ID);
      if (!hasRealPlayer) {
        // Add real player if missing
        const updated = [...state.leaderboard, {
          playerId: REAL_PLAYER_ID,
          playerName: REAL_PLAYER_NAME,
          faction: REAL_PLAYER_FACTION,
          totalScore: 0,
          totalKills: 0,
          totalVictories: 0,
          rank: 0,
          title: 'Recruit',
        }];
        setLeaderboard(recalculateRanksAndTitles(updated));
      } else {
        setLeaderboard(state.leaderboard);
      }
    } else {
      // Initialize with placeholder data
      setLeaderboard(createPlaceholderLeaderboard(REAL_PLAYER_NAME, REAL_PLAYER_FACTION));
    }

    // Load faction state
    if (state.factionState) {
      const basePerks = createPerkTree();
      // Merge saved perks with base tree (in case new perks were added)
      const mergedPerks = { ...basePerks };
      Object.entries(state.factionState.perks).forEach(([id, savedPerk]) => {
        if (mergedPerks[id]) {
          mergedPerks[id] = {
            ...mergedPerks[id],
            unlocked: savedPerk.unlocked,
          };
        }
      });

      setFactionState({
        availableFP: state.factionState.availableFP || 0,
        alsusFP: state.factionState.alsusFP || 0,
        atroxFP: state.factionState.atroxFP || 0,
        alsusUnspentFP: state.factionState.alsusUnspentFP || 0,
        atroxUnspentFP: state.factionState.atroxUnspentFP || 0,
        perks: mergedPerks,
      });
    } else {
      // Initialize with default state
      setFactionState({
        availableFP: 0,
        alsusFP: 0,
        atroxFP: 0,
        alsusUnspentFP: 0,
        atroxUnspentFP: 0,
        perks: createPerkTree(),
      });
    }
  }

  // Load state on mount
  useEffect(() => {
    const saved = persistence.loadState();
    if (saved) {
      // Calculate offline time
      const now = Date.now();
      const deltaSeconds = Math.max(0, (now - saved.lastSaveUtc) / 1000);

      dbg.log(`[PERSISTENCE] Loading save. Offline time: ${deltaSeconds.toFixed(1)} seconds`);

      // Run offline simulation
      const simulated = simulateOfflineProgression(saved, deltaSeconds);

      // Load into component
      loadGameState(simulated);

      // NOTE: removed stale-closure 200ms re-save — serializeGameState captured here
      // references the pre-setState closure, overwriting loaded state with defaults.
      // The regular autosave interval handles persistence once React state has settled.

      dbg.log(`[PERSISTENCE] Loaded save, simulated ${deltaSeconds.toFixed(1)} seconds offline`);
    } else {
      dbg.log('[PERSISTENCE] No save found, starting fresh');
      // Initialize leaderboard with placeholder data on first load
      setLeaderboard(createPlaceholderLeaderboard(REAL_PLAYER_NAME, REAL_PLAYER_FACTION));
    }
  }, []); // Only run on mount

  // Fix stale closure issue: Use a ref to access the latest state serializer
  const stateSerializerRef = useRef(serializeGameState);
  stateSerializerRef.current = serializeGameState;

  // Set up auto-save (only once on mount)
  useEffect(() => {
    persistence.startAutoSave(() => {
      const state = stateSerializerRef.current();
      // Console log for debugging/confirmation (optional, but requested by plan)
      dbg.log('[PERSISTENCE] Auto-saving game state...');
      return state;
    });
    return () => {
      persistence.stopAutoSave();
    };
  }, []); // Empty dependency array is now safe because we use the ref

  // Save on critical actions (manual save triggers)
  function saveGame() {
    persistence.saveState(serializeGameState());
  }

  // Reset game
  function resetGame() {
    const confirmation = confirm(
      "⚠️ WARNING: RESET GAME PROGRESS ⚠️\n\n" +
      "You are about to completely WIPE your save file.\n\n" +
      "This will:\n" +
      "• Delete all resources, buildings, and units\n" +
      "• Reset your Commander and XP\n" +
      "• Delete all expeditions, fortress, and armies\n" +
      "• Restart the game from the tutorial\n\n" +
      "This action CANNOT be undone.\n\n" +
      "Are you absolutely sure?"
    );

    if (confirmation) {
      // Stop auto-save and remove beforeunload handler to prevent
      // stale in-memory state from being re-saved before/during reload
      persistence.stopAutoSave();

      // Clear localStorage and save fresh default state
      persistence.resetState();

      // Reload immediately — localStorage writes are synchronous,
      // no delay needed. A delay here causes a race condition where
      // the mount-time resave timeout can overwrite the clean state.
      window.location.reload();
    }
  }

  // === Army helpers ===
  // List of all regular recruitable unit types
  const regularUnitTypes: UnitType[] = [
    'militia',
    'warrior',
    'longsword',
    'pikemen',
    'light_cavalry',
    'heavy_cavalry',
    'archer',
    'skirmisher',
    'crossbowmen'
  ];

  function addSquad(t: UnitType) {
    setDraftSquads((s) => (s.length >= 8 ? s : [...s, t]));
  }

  // Legacy functions for backward compatibility (if needed elsewhere)
  function addWarriorSquad() {
    addSquad('warrior');
  }
  function addArcherSquad() {
    addSquad('archer');
  }
  function removeLastSquad() { setDraftSquads((s) => s.slice(0, -1)); }
  function clearDraft() { setDraftSquads([]); }

  // Calculate iron cost for a draft banner (array of unit types)
  function getIronCostForBanner(draftSquads: UnitType[]): number {
    return draftSquads.reduce((total, unitType) => {
      const costPerSquad = ironCostPerSquad[unitType] ?? 0;
      return total + costPerSquad;
    }, 0);
  }


  function confirmBanner() {
    if (draftSquads.length === 0) return;

    // Calculate and check iron cost
    const ironCost = getIronCostForBanner(draftSquads);
    const availableIron = warehouse.iron;

    if (availableIron < ironCost) {
      // Show error message - you can use alert for now or integrate with notification system
      alert(`Not enough Iron. Required: ${ironCost}, available: ${availableIron}.`);
      return;
    }

    // Initialize squads with health tracking - start empty (0/10) since banner hasn't been trained yet
    const { squads, nextSeq } = initializeSquadsFromUnits(draftSquads, squadSeq, true);

    // Generate auto-name based on composition
    const autoName = generateBannerName(bannerSeq, squads);

    // Calculate reqPop based on squad categories
    const totalReqPop = squads.reduce((sum, squad) => {
      const category = unitCategory[squad.type] || 'infantry';
      return sum + squadConfig[category].reqPop;
    }, 0);

    // Initialize XP for new banner
    const initialXP = 0;
    const initialLevelInfo = calculateLevelFromXP(initialXP);

    const next: Banner = {
      id: bannerSeq,
      name: autoName,
      units: draftSquads, // Keep for backward compatibility
      squads: squads,
      status: 'idle',
      reqPop: totalReqPop,
      recruited: 0,
      type: 'regular', // Men-at-arms are regular banners
      customNamed: false, // Auto-generated name
      xp: initialXP,
      level: initialLevelInfo.level,
      xpCurrentLevel: initialLevelInfo.xpCurrentLevel,
      xpNextLevel: initialLevelInfo.xpNextLevel,
    };
    // Deduct iron cost
    setWarehouse((w) => ({ ...w, iron: Math.max(0, w.iron - ironCost) }));

    setBanners((bs) => [...bs, next]);
    setBannerSeq((n) => n + 1);
    setSquadSeq(nextSeq);
    setDraftSquads([]);
  }

  // Banner name editing functions
  function updateBannerName(bannerId: number, newName: string) {
    setBanners((bs) => bs.map((b) => {
      if (b.id === bannerId) {
        const originalName = b.name;
        const nameChanged = newName.trim() !== originalName.trim();
        // Mark as custom if name actually changed from original
        const shouldBeCustom = nameChanged && newName.trim().length > 0;
        return {
          ...b,
          name: newName.trim() || originalName, // Don't allow empty names
          customNamed: shouldBeCustom ? true : (b.customNamed || false),
        };
      }
      return b;
    }));
  }

  function finishEditingBannerName() {
    setEditingBannerName(null);
    saveGame();
  }

  function cleanupBanner(bannerId: number): void {
    setBanners(prev => prev.filter(b => b.id !== bannerId));
    setBannerLossNotices(prev => prev.filter(notice => !notice.id.includes(`banner-${bannerId}`)));
  }



  function resetBannerName(bannerId: number) {
    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;

    const autoName = generateBannerName(bannerId, banner.squads);
    setBanners((bs) => bs.map((b) =>
      b.id === bannerId
        ? { ...b, name: autoName, customNamed: false }
        : b
    ));
    setEditingBannerName(null);
    saveGame();
  }

  // Regenerate auto-names when composition changes (if not custom)
  function regenerateBannerNameIfNeeded(bannerId: number, newSquads: Squad[]) {
    const banner = banners.find(b => b.id === bannerId);
    if (!banner || banner.customNamed) return; // Don't regenerate if custom

    const autoName = generateBannerName(bannerId, newSquads);
    if (autoName !== banner.name) {
      setBanners((bs) => bs.map((b) =>
        b.id === bannerId ? { ...b, name: autoName } : b
      ));
    }
  }

  function startTraining(id: number) {
    if (editingBannerId === id) return; // Hard lock: Cannot train while editing

    // Check if barracks exists and get max training slots
    if (!barracks || barracks.level < 1) {
      dbg.warn('[TRAINING] Barracks required to train banners');
      return;
    }

    const maxSlots = getMaxTrainingSlots(barracks.level);

    if (trainingBannerCount >= maxSlots) {
      dbg.warn(`[TRAINING] Training slots full: ${trainingBannerCount}/${maxSlots}`);
      return;
    }

    setBanners((bs) => bs.map((b) => {
      if (b.id === id && (b.status === 'idle' || b.status === 'ready' || b.status === 'deployed')) {
        // Ensure squads are initialized
        let displaySquads = b.squads;
        if (!displaySquads || displaySquads.length === 0) {
          const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
          displaySquads = squads;
        }

        // Check if banner has incomplete squads
        const hasIncompleteSquads = displaySquads.some(s => s.currentSize < s.maxSize);

        if (!hasIncompleteSquads) {
          dbg.warn('[TRAINING] All squads are at full strength');
          return b;
        }

        // Calculate how much population is still needed
        const totalNeeded = displaySquads.reduce((sum, squad) => sum + (squad.maxSize - squad.currentSize), 0);

        if (b.status === 'idle') {
          // New training: reset all squads to 0 and start fresh
          const resetSquads = displaySquads.map(s => ({ ...s, currentSize: 0 }));
          return { ...b, status: 'training', squads: resetSquads, recruited: 0, reqPop: totalNeeded, trainingPaused: false };
        } else {
          // Continuing training on a 'ready' or 'deployed' banner: keep current squad sizes, train only what's missing
          return { ...b, status: 'training', squads: displaySquads, recruited: 0, reqPop: totalNeeded, trainingPaused: false };
        }
      }
      return b;
    }));
  }

  function toggleTrainingPause(id: number) {
    if (editingBannerId === id) return; // Hard lock: Cannot pause/resume while editing

    setBanners((bs) => bs.map((b) => {
      if (b.id === id && b.status === 'training') {
        return { ...b, trainingPaused: !b.trainingPaused };
      }
      return b;
    }));
    saveGame();
  }

  function stopTrainingBanner(id: number) {
    if (editingBannerId === id) return;
    setBanners((bs) => bs.map((b) => {
      if (b.id === id && b.status === 'training') {
        return { ...b, status: 'ready', trainingPaused: false };
      }
      return b;
    }));
    saveGame();
  }

  function confirmDeleteBanner() {
    if (deleteBannerModal === null) return;
    const id = deleteBannerModal;

    // @ts-ignore
    setBanners((bs: Banner[] | null) => {
      const actualBs = bs || [];
      const banner = actualBs.find(b => b.id === id);
      if (!banner) return bs;

      // Return population to the village (only for regular banners, not mercenaries)
      if (banner.type === 'regular' && banner.recruited > 0) {
        setPopulation(p => p + banner.recruited);
      }

      // Remove banner from missions if deployed
      if (banner.status === 'deployed') {
        setMissions((ms) => ms.map((m) => ({
          ...m,
          staged: m.staged.filter(bid => bid !== id),
          deployed: m.deployed.filter(bid => bid !== id),
        })));
      }

      return actualBs.filter(b => b.id !== id);
    });

    setDeleteBannerModal(null);
    saveGame();
  }

  function deleteBanner(id: number) {
    if (editingBannerId === id) return; // Hard lock: Cannot delete while editing
    setDeleteBannerModal(id);
  }

  function addSquadToBanner(bannerId: number, unitType: UnitType) {
    setBanners(bs => bs.map((b: Banner) => {
      if (b.id !== bannerId) return b;

      // Ensure squads are initialized
      let bannerSquads = b.squads;
      if (!bannerSquads || bannerSquads.length === 0) {
        const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
        bannerSquads = squads;
      }

      // Check if banner already has 8 squads
      if (bannerSquads.length >= 8) {
        return b;
      }

      // Check iron cost
      const ironCost = ironCostPerSquad[unitType];
      if (ironCost > 0 && warehouse.iron < ironCost) {
        alert(`Not enough Iron. Required: ${ironCost}, available: ${warehouse.iron}.`);
        return b;
      }

      // Deduct iron if needed
      if (ironCost > 0) {
        setWarehouse(w => ({ ...w, iron: Math.max(0, w.iron - ironCost) }));
      }

      // Create new squad
      const category = unitCategory[unitType];
      const config = squadConfig[category];
      const newSquad: Squad = {
        id: squadSeqRef.current++,
        type: unitType,
        maxSize: config.maxSize,
        currentSize: 0 // Start empty, needs training
      };

      const updatedSquads = [...bannerSquads, newSquad];
      const updatedUnits = updatedSquads.map(s => s.type);

      // Update squad sequence
      setSquadSeq(squadSeqRef.current);

      // Regenerate banner name if not custom named
      const newName = b.customNamed ? b.name : generateBannerName(b.id, updatedSquads);

      return {
        ...b,
        squads: updatedSquads,
        units: updatedUnits,
        name: newName,
        // Recalculate required population
        reqPop: updatedSquads.reduce((sum, s) => {
          const cat = unitCategory[s.type];
          return sum + squadConfig[cat].reqPop;
        }, 0)
      };
    }));

    saveGame();
  }

  // Update a specific slot with a unit type (or remove if unitType is null)
  function updateSlotInBanner(bannerId: number, slotIndex: number, unitType: UnitType | null) {
    // HARD LOCK check: Must be editing this specific banner
    if (bannerId !== editingBannerId || !bannersDraft) {
      // Just return silently as UI should be locked, or log warning
      dbg.warn("Attempted to modify banner without Edit Mode active");
      return;
    }

    const b = bannersDraft;

    // Ensure squads are initialized
    let bannerSquads = b.squads || [];
    let updatedSquads = [...bannerSquads];

    // If removing unit
    if (unitType === null) {
      updatedSquads = updatedSquads.filter(s => s.slotIndex !== slotIndex);
    } else {
      // Check iron cost if adding
      const ironCost = ironCostPerSquad[unitType];
      if (ironCost > 0 && warehouse.iron < ironCost) {
        alert(`Not enough Iron. Required: ${ironCost}, available: ${warehouse.iron}.`);
        return;
      }

      // Deduct iron if needed
      if (ironCost > 0) {
        setWarehouse(w => ({ ...w, iron: Math.max(0, w.iron - ironCost) }));
      }

      // Create new squad or update existing
      const category = unitCategory[unitType];
      const config = squadConfig[category];
      const existingSquadIndex = updatedSquads.findIndex(s => s.slotIndex === slotIndex);

      if (existingSquadIndex !== -1) {
        // Replace existing squad
        updatedSquads[existingSquadIndex] = {
          ...updatedSquads[existingSquadIndex],
          type: unitType,
          maxSize: config.maxSize,
          currentSize: 0 // Reset to 0 when changing unit type
        };
      } else {
        // Create new squad
        updatedSquads.push({
          id: squadSeqRef.current++,
          type: unitType,
          maxSize: config.maxSize,
          currentSize: 0,
          slotIndex: slotIndex
        });
        setSquadSeq(squadSeqRef.current);
      }
    }

    const updatedUnits = updatedSquads.map(s => s.type);

    // Regenerate banner name if not custom named
    const newName = b.customNamed ? b.name : generateBannerName(b.id, updatedSquads);

    // Update the draft
    setBannersDraft({
      ...b,
      squads: updatedSquads,
      units: updatedUnits,
      name: newName,
      // Recalculate required population
      reqPop: updatedSquads.reduce((sum, s) => {
        const cat = unitCategory[s.type];
        return sum + squadConfig[cat].reqPop;
      }, 0)
    });

    // NOTE: We do NOT saveGame() here. We wait for Confirm.
  }

  function createNewBanner() {
    const isRegularArmyTab = armyTab === 'regular';

    // Create a new empty banner
    const initialXP = 0;
    const initialLevelInfo = calculateLevelFromXP(initialXP);

    const newBanner: Banner = {
      id: bannerSeq,
      name: `Army ${bannerSeq}`,
      units: [],
      squads: [],
      status: 'idle',
      reqPop: 0,
      recruited: 0,
      type: 'regular',
      customNamed: false,
      xp: initialXP,
      level: initialLevelInfo.level,
      xpCurrentLevel: initialLevelInfo.xpCurrentLevel,
      xpNextLevel: initialLevelInfo.xpNextLevel,
    };

    setBanners(bs => [...bs, newBanner]);
    if (isRegularArmyTab) {
      // Enter edit mode immediately
      // We manually set draft because 'banners' state update is async and startEditingBanner wouldn't find it yet
      setBannersDraft(JSON.parse(JSON.stringify(newBanner)));
      setEditingBannerId(newBanner.id);
    }

    setBannerSeq(n => n + 1);
    saveGame();
  }

  function confirmDeleteSquad() {
    if (!deleteSquadModal) return;

    const { bannerId, squadId } = deleteSquadModal;
    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;

    // Ensure squads are initialized
    let displaySquads = banner.squads;
    if (!displaySquads || displaySquads.length === 0) {
      const { squads } = initializeSquadsFromUnits(banner.units, squadSeqRef.current);
      displaySquads = squads;
    }

    const squad = displaySquads.find(s => s.id === squadId);
    if (!squad) return;

    // Calculate refunds (only for trained units)
    const category = unitCategory[squad.type];
    const config = squadConfig[category];
    const perUnitPop = config.reqPop / config.maxSize;
    const perUnitIron = (ironCostPerSquad[squad.type] || 0) / config.maxSize;
    const populationRefund = Math.floor(perUnitPop * squad.currentSize); // proportional to trained soldiers
    const ironRefund = Math.floor(perUnitIron * squad.currentSize * 0.5); // 50% of trained soldiers' iron cost

    // Apply refunds
    if (populationRefund > 0) {
      setPopulation(p => p + populationRefund);
    }
    setWarehouse(w => ({
      ...w,
      iron: Math.min(warehouseCap.iron, w.iron + ironRefund)
    }));

    // Remove squad from banner
    setBanners(bs => bs.map(b => {
      if (b.id !== bannerId) return b;

      // Ensure squads are initialized
      let bannerSquads = b.squads;
      if (!bannerSquads || bannerSquads.length === 0) {
        const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
        bannerSquads = squads;
      }

      // Remove the squad
      const remainingSquads = bannerSquads.filter(s => s.id !== squadId);

      // Update units array for backward compatibility
      const remainingUnits = remainingSquads.map(s => s.type);

      return {
        ...b,
        squads: remainingSquads,
        units: remainingUnits,
        // Recalculate required population
        reqPop: remainingSquads.reduce((sum, s) => {
          const cat = unitCategory[s.type];
          return sum + squadConfig[cat].reqPop;
        }, 0)
      };
    }));

    // Close modal
    setDeleteSquadModal(null);

    // Save game
    saveGame();
  }

  // === Missions helpers ===
  function assignBannerToMission(missionId: number, bannerId: number) {
    setMissions((ms) => ms.map((m) => {
      if (m.id !== missionId || m.status !== 'available') return m;
      // Replace staged with single banner (one banner per mission)
      return { ...m, staged: [bannerId] };
    }));
    // Close the selector after assignment
    setMissionBannerSelector(null);
  }

  function confirmSendMission(missionId: number) {
    const mission = missions.find(m => m.id === missionId);
    if (!mission || mission.status !== 'available') return;
    const staged = mission.staged;
    if (staged.length === 0) return;

    // Set loading state
    setMissionLoading(missionId);

    // Simulate mission processing (immediate for now, but can add delay if needed)
    setTimeout(() => {
      setMissions((ms) => ms.map((m) => m.id === missionId ? { ...m, status: 'running', deployed: staged, staged: [], elapsed: 0, startTime: Date.now() } : m));
      setBanners((bs) => bs.map((b) => staged.includes(b.id) ? { ...b, status: 'deployed' } : b));

      // Remove banners from fortress garrisons if they're being deployed on a mission
      setExpeditions((exps) => exps.map((exp) => {
        if (!exp.fortress) return exp;
        const garrison = exp.fortress.garrison || [];
        const updatedGarrison = garrison.filter(id => !staged.includes(id));
        if (updatedGarrison.length === garrison.length) return exp;
        return {
          ...exp,
          fortress: {
            ...exp.fortress,
            garrison: updatedGarrison
          }
        };
      }));

      setMissionLoading(null);
      saveGame(); // Save when mission starts
    }, 500); // Short delay for UX
  }
  function claimMissionReward(missionId: number) {
    const mission = missions.find(m => m.id === missionId);
    if (!mission || (mission.status as any) !== 'complete') return;

    // Calculate rewards if missing (retroactive for missions completed before rewards system)
    let rewards = mission.rewards;
    if (!rewards) {
      const enemyTotal = getEnemyTotal(mission.enemyComposition);
      const baseGold = enemyTotal > 0 ? Math.max(1, Math.floor(enemyTotal * 2)) : 1;
      rewards = {
        gold: baseGold,
        wood: enemyTotal > 0 ? Math.floor(enemyTotal * 0.5) : 0,
        stone: enemyTotal > 0 ? Math.floor(enemyTotal * 0.3) : 0
      };
    }

    // Grant rewards
    setWarehouse((w) => ({
      ...w,
      gold: w.gold + (rewards.gold || 0),
      wood: w.wood + (rewards.wood || 0),
      stone: w.stone + (rewards.stone || 0),
      food: w.food + (rewards.food || 0),
      iron: w.iron + (rewards.iron || 0)
    }));

    // Start cooldown and clear report/rewards
    const cooldownEndTime = Date.now() + (MISSION_COOLDOWN_SECONDS * 1000);
    setMissions((ms) => ms.map((m) =>
      m.id === missionId
        ? { ...m, status: 'available', elapsed: 0, deployed: [], staged: [], battleResult: undefined, rewards: undefined, cooldownEndTime }
        : m
    ));
    setRewardModal(null);
    saveGame(); // Save when mission reward is claimed
  }

  // === Fortress Building Config ===
  const WATCH_POST_ARCHERS_PER_LEVEL = 5; // Config: archers per Watch Post level

  // === Mission Config ===
  const MISSION_COOLDOWN_SECONDS = 10; // Config: cooldown duration after claiming reward

  // === Fortress Building Definitions ===
  function createInitialFortressBuildings(): FortressBuilding[] {
    return [
      {
        id: 'palisade_wall',
        name: 'Palisade Wall',
        level: 1,
        maxLevel: 5,
        description: '+400 Fort HP',
        getEffect: (level) => ({ fortHP: 400 * level }),
        getUpgradeCost: (level) => ({ wood: 150 * level, stone: 75 * level }),
      },
      {
        id: 'watch_post',
        name: 'Watch Post',
        level: 1,
        maxLevel: 5,
        description: `+${WATCH_POST_ARCHERS_PER_LEVEL} Archer slots (max ${WATCH_POST_ARCHERS_PER_LEVEL} archers shooting from walls)`,
        getEffect: (level) => ({ archerSlots: WATCH_POST_ARCHERS_PER_LEVEL * level }),
        getUpgradeCost: (level) => ({ wood: 100 * level, stone: 50 * level }),
      },
      {
        id: 'garrison_hut',
        name: 'Garrison Hut',
        level: 1,
        maxLevel: 5,
        description: 'Army garrison capacity',
        getEffect: (level) => ({ garrisonCapacity: level }),
        getUpgradeCost: (level) => ({ wood: 120 * level, stone: 60 * level }),
      },
    ];
  }

  function calculateFortressStats(buildings: FortressBuilding[]): FortressStats {
    const stats: FortressStats = {
      fortHP: 0,
      archerSlots: 0,
      garrisonCapacity: 0,
      storedSquads: 1, // Base value
    };

    buildings.forEach(building => {
      const effect = building.getEffect(building.level);
      if (effect.fortHP) stats.fortHP += effect.fortHP;
      if (effect.archerSlots) stats.archerSlots += effect.archerSlots;
      if (effect.garrisonCapacity) stats.garrisonCapacity += effect.garrisonCapacity;
      if (effect.storedSquads) stats.storedSquads += effect.storedSquads;
    });

    return stats;
  }

  // === Expeditions helpers ===
  function acceptExpedition(expeditionId: string) {
    setExpeditions((exps) => exps.map((exp) =>
      exp.expeditionId === expeditionId ? { ...exp, state: 'funding' } : exp
    ));
  }

  function sendResourceToExpedition(expeditionId: string, resourceType: 'wood' | 'stone' | 'food' | 'population') {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition || expedition.state !== 'funding') return;

    const req = expedition.requirements[resourceType];
    const remaining = req.required - req.current;
    if (remaining <= 0) return;

    let amountToSend = 0;
    let newWarehouse = { ...warehouse };
    let newPopulation = population;

    if (resourceType === 'population') {
      amountToSend = Math.min(remaining, newPopulation);
      newPopulation = Math.max(0, newPopulation - amountToSend);
      setPopulation(newPopulation);
    } else {
      const currentStock = warehouse[resourceType];
      amountToSend = Math.min(remaining, currentStock);
      newWarehouse = { ...newWarehouse, [resourceType]: Math.max(0, currentStock - amountToSend) };
      setWarehouse(newWarehouse);
    }

    if (amountToSend > 0) {
      setExpeditions((exps) => exps.map((exp) => {
        if (exp.expeditionId !== expeditionId) return exp;
        const newReq = { ...exp.requirements };
        newReq[resourceType] = { ...newReq[resourceType], current: newReq[resourceType].current + amountToSend };

        // Check if all requirements are met
        const allComplete =
          newReq.wood.current >= newReq.wood.required &&
          newReq.stone.current >= newReq.stone.required &&
          newReq.food.current >= newReq.food.required &&
          newReq.population.current >= newReq.population.required;

        return {
          ...exp,
          requirements: newReq,
          state: allComplete ? 'readyToLaunch' : 'funding',
        };
      }));
    }
  }

  function launchExpedition(expeditionId: string) {
    setExpeditions((exps) => exps.map((exp) =>
      exp.expeditionId === expeditionId ? { ...exp, state: 'travelling', travelProgress: 0 } : exp
    ));

    // Start 3-second timer
    let progress = 0;
    const interval = setInterval(() => {
      progress += 100 / 30; // 30 updates over 3 seconds (100ms each)
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        // Initialize fortress when expedition completes
        setExpeditions((exps) => exps.map((exp) => {
          if (exp.expeditionId !== expeditionId) return exp;
          const buildings = createInitialFortressBuildings();
          const stats = calculateFortressStats(buildings);

          // Pick a random plains province for fortress placement
          let mapState: any = undefined;
          const pd = provinceDataRef.current;
          if (pd?.provinces) {
            const plainsProvs = pd.provinces.filter(
              (p: any) => p.terrain === 'plains' && p.isLand
            );
            if (plainsProvs.length > 0) {
              const chosen = plainsProvs[Math.floor(Math.random() * plainsProvs.length)];
              // Fog disabled for testing — reveal all provinces
              const revealed = pd.provinces.map((p: any) => p.id);
              // Seed expedition missions for the map and pre-assign province positions
              const expMissions = selectRandomMissions(3, EXPEDITION_1_MISSION_POOL);
              const missionPositions: Record<string, string> = {};
              for (const m of expMissions) {
                const terrain = m.terrain || 'plains';
                const usedProvIds = new Set(Object.values(missionPositions));
                const matching = pd.provinces.filter(
                  (p: any) => p.terrain === terrain && p.isLand && p.id !== chosen.id && !usedProvIds.has(p.id)
                );
                if (matching.length > 0) {
                  const pick = matching[Math.floor(Math.random() * matching.length)];
                  missionPositions[m.id] = pick.id;
                  if (import.meta.env.DEV) {
                    console.log(`[Expedition] Mission ${m.id} "${m.name}" placed at ${pick.id} (${terrain})`);
                  }
                }
              }
              mapState = {
                fortressProvinceId: chosen.id,
                armyPositions: {},
                missionPositions,
                revealedProvinces: revealed,
                provinceControl: {},
                turnNumber: 1,
                pendingOrders: {},
                expeditionMissions: expMissions,
              };
              if (import.meta.env.DEV) {
                console.log(`[Expedition] Fortress placed at ${chosen.id} (${chosen.terrain}), center: ${chosen.center}, revealed: ${revealed.length} provinces`);
              }
            }
          }

          return {
            ...exp,
            state: 'completed',
            travelProgress: 100,
            fortress: { buildings, stats, garrison: [] },
            mapState,
          };
        }));
      } else {
        setExpeditions((exps) => exps.map((exp) =>
          exp.expeditionId === expeditionId ? { ...exp, travelProgress: progress } : exp
        ));
      }
    }, 100);
  }

  function restartExpedition(expeditionId: string) {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition || expedition.state !== 'failed') return;

    // Collect all banner IDs involved in this expedition
    const garrisonIds = expedition.fortress?.garrison || [];
    const mapIds = expedition.mapState
      ? Object.keys(expedition.mapState.armyPositions).map(Number)
      : [];
    const allIds = new Set([...garrisonIds, ...mapIds]);

    // Return surviving banners to 'ready' status
    setBanners(bs => bs.map(b => {
      if (!allIds.has(b.id)) return b;
      if (b.status === 'destroyed') return b; // dead banners stay dead
      return { ...b, status: 'ready' as const };
    }));

    // Reset expedition to 'available' — fresh start
    setExpeditions(exps => exps.map(exp => {
      if (exp.expeditionId !== expeditionId) return exp;
      return {
        ...exp,
        state: 'available' as const,
        requirements: {
          wood: { required: 500, current: 0 },
          stone: { required: 250, current: 0 },
          food: { required: 1000, current: 0 },
          population: { required: 5, current: 0 },
        },
        travelProgress: 0,
        fortress: undefined,
        mapState: undefined,
      };
    }));
  }

  function upgradeFortressBuilding(expeditionId: string, buildingId: string) {
    const exp = expeditions.find(e => e.expeditionId === expeditionId);
    if (!exp || !exp.fortress) return;

    const building = exp.fortress.buildings.find(b => b.id === buildingId);
    if (!building || building.level >= building.maxLevel) return;

    const nextLevel = building.level + 1;
    const cost = building.getUpgradeCost(nextLevel);

    // Check if player has enough resources
    if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return;

    // Deduct resources
    setWarehouse(w => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));

    // Upgrade building
    setExpeditions((exps) => exps.map((e) => {
      if (e.expeditionId !== expeditionId || !e.fortress) return e;

      const updatedBuildings = e.fortress.buildings.map(b =>
        b.id === buildingId ? { ...b, level: nextLevel } : b
      );

      // Recalculate stats
      const stats = calculateFortressStats(updatedBuildings);

      return {
        ...e,
        fortress: {
          ...e.fortress,
          buildings: updatedBuildings,
          stats,
        },
      };
    }));
  }

  function assignBannerToFortress(expeditionId: string, bannerId: number) {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress) return;

    const banner = banners.find(b => b.id === bannerId);
    if (!banner || banner.status !== 'ready') return;

    // Check if banner is already in garrison
    if ((expedition.fortress.garrison || []).includes(bannerId)) return;

    // Enforce garrison capacity (Level N = N armies max)
    const currentCount = (expedition.fortress.garrison || []).length;
    const maxCapacity = expedition.fortress.stats?.garrisonCapacity || 1;
    if (currentCount >= maxCapacity) return;

    // Add banner to garrison
    setExpeditions((exps) => exps.map((exp) => {
      if (exp.expeditionId !== expeditionId || !exp.fortress) return exp;
      return {
        ...exp,
        fortress: {
          ...exp.fortress,
          garrison: [...(exp.fortress.garrison || []), bannerId]
        }
      };
    }));

    // Update banner status to deployed
    setBanners((bs) => bs.map((b) =>
      b.id === bannerId ? { ...b, status: 'deployed' } : b
    ));
  }

  function calculateGarrisonFromBanners(garrisonBannerIds: number[]): {
    warriors: number;
    archers: number;
    squads: Array<{ type: string; count: number }>;
  } {
    let warriors = 0;
    let archers = 0;
    const squadMap = new Map<string, number>();

    garrisonBannerIds.forEach(bannerId => {
      const banner = banners.find(b => b.id === bannerId);
      if (!banner || !banner.squads) return;

      banner.squads.forEach(squad => {
        const category = unitCategory[squad.type] || 'infantry';
        if (category === 'ranged_infantry') {
          archers += squad.currentSize;
        } else {
          // infantry + cavalry all count as melee defenders
          warriors += squad.currentSize;
        }
        squadMap.set(squad.type, (squadMap.get(squad.type) || 0) + squad.currentSize);
      });
    });

    return {
      warriors,
      archers,
      squads: Array.from(squadMap.entries()).map(([type, count]) => ({ type, count }))
    };
  }

  // Calculate active wall archers (limited by Watch Post capacity)
  // Watch Post only affects Phase 1 (walls up) - it's a capacity limit, not extra units
  function calculateActiveWallArchers(expeditionId: string): { available: number; capacity: number; active: number } {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress) {
      return { available: 0, capacity: 0, active: 0 };
    }

    // Get Watch Post level to calculate wall archer capacity
    const watchPost = expedition.fortress.buildings.find(b => b.id === 'watch_post');
    const watchPostLevel = watchPost?.level || 0;
    const wallArcherCapacity = watchPostLevel * WATCH_POST_ARCHERS_PER_LEVEL;

    // Calculate available archers from garrison banners (real units only)
    const garrisonBannerIds = expedition.fortress.garrison || [];
    const garrison = calculateGarrisonFromBanners(garrisonBannerIds);
    const availableArchers = garrison.archers || 0;

    // Active wall archers = min(available archers, wall capacity)
    // Watch Post never creates units, only limits how many can shoot
    const activeWallArchers = Math.min(availableArchers, wallArcherCapacity);

    return {
      available: availableArchers,
      capacity: wallArcherCapacity,
      active: activeWallArchers
    };
  }

  function applyFortressBattleCasualties(expeditionId: string, result: SiegeBattleResult): number[] {
    dbg.log('[BATTLE] applyFortressBattleCasualties called', { expeditionId, result });
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress || !expedition.fortress.garrison || expedition.fortress.garrison.length === 0) {
      dbg.log('[BATTLE] No fortress or garrison found');
      return [];
    }

    const garrisonIds = expedition.fortress.garrison;
    dbg.log('[BATTLE] Garrison IDs:', garrisonIds);
    const garrisonBanners = banners.filter(b => garrisonIds.includes(b.id));
    dbg.log('[BATTLE] Garrison banners found:', garrisonBanners.length, garrisonBanners.map(b => ({ id: b.id, name: b.name, type: b.type })));
    if (garrisonBanners.length === 0) {
      dbg.log('[BATTLE] No garrison banners found');
      return [];
    }

    const bannerInfos = garrisonBanners.map(banner => {
      const warriorCount = banner.squads
        ? banner.squads.filter(s => s.type === 'warrior').reduce((sum, squad) => sum + squad.currentSize, 0)
        : 0;
      const archerCount = banner.squads
        ? banner.squads.filter(s => s.type === 'archer').reduce((sum, squad) => sum + squad.currentSize, 0)
        : 0;
      return {
        id: banner.id,
        name: banner.name,
        type: banner.type,
        warriorCount,
        archerCount,
      };
    });

    const totalWarriors = bannerInfos.reduce((sum, info) => sum + info.warriorCount, 0);
    const totalArchers = bannerInfos.reduce((sum, info) => sum + info.archerCount, 0);
    if (totalWarriors === 0 && totalArchers === 0) return [];

    // Calculate final garrison counts
    let finalWarriors: number;
    let finalArchers: number;

    const totalInitial = totalWarriors + totalArchers;

    if (result.finalGarrison) {
      // Use explicit finalGarrison if available
      finalWarriors = Math.max(0, Math.round(result.finalGarrison.warriors));
      finalArchers = Math.max(0, Math.round(result.finalGarrison.archers));
    } else if (result.finalDefenders === 0 || (result.outcome === 'fortress_falls' && result.innerTimeline.length === 0)) {
      // All defenders were killed (either explicitly 0, or fortress fell without inner battle tracking)
      finalWarriors = 0;
      finalArchers = 0;
    } else {
      // finalGarrison not set but defenders remain - distribute proportionally
      if (totalInitial > 0) {
        const warriorRatio = totalWarriors / totalInitial;
        const archerRatio = totalArchers / totalInitial;
        finalWarriors = Math.max(0, Math.round(result.finalDefenders * warriorRatio));
        finalArchers = Math.max(0, Math.round(result.finalDefenders * archerRatio));
      } else {
        finalWarriors = totalWarriors;
        finalArchers = totalArchers;
      }
    }

    const warriorLosses = Math.max(0, totalWarriors - finalWarriors);
    const archerLosses = Math.max(0, totalArchers - finalArchers);

    dbg.log('[BATTLE] Loss calculation:', {
      totalWarriors,
      totalArchers,
      finalWarriors,
      finalArchers,
      warriorLosses,
      archerLosses,
      finalDefenders: result.finalDefenders,
      outcome: result.outcome
    });

    if (warriorLosses === 0 && archerLosses === 0) {
      dbg.log('[BATTLE] No losses detected, returning early');
      return [];
    }

    const warriorAllocation = distributeTypeLossesAcrossBanners(
      bannerInfos.map(info => ({ bannerId: info.id, count: info.warriorCount })),
      warriorLosses
    );
    const archerAllocation = distributeTypeLossesAcrossBanners(
      bannerInfos.map(info => ({ bannerId: info.id, count: info.archerCount })),
      archerLosses
    );

    const lossPerBanner = new Map<number, { warriors: number; archers: number }>();
    warriorAllocation.forEach((loss, bannerId) => {
      if (loss <= 0) return;
      const existing = lossPerBanner.get(bannerId) || { warriors: 0, archers: 0 };
      existing.warriors = loss;
      lossPerBanner.set(bannerId, existing);
    });
    archerAllocation.forEach((loss, bannerId) => {
      if (loss <= 0) return;
      const existing = lossPerBanner.get(bannerId) || { warriors: 0, archers: 0 };
      existing.archers = loss;
      lossPerBanner.set(bannerId, existing);
    });

    const destroyedIds: number[] = [];
    const noticesToAdd: BannerLossNotice[] = [];
    const commandersToUpdate: Commander[] = [];
    const timestamp = Date.now();

    // Process banners and collect notices
    const updatedBanners = banners.reduce<Banner[]>((next, banner) => {
      if (!garrisonIds.includes(banner.id)) {
        next.push(banner);
        return next;
      }

      const losses = lossPerBanner.get(banner.id);
      dbg.log('[BATTLE] Processing banner:', { id: banner.id, name: banner.name, type: banner.type, losses });
      if (!losses || (!losses.warriors && !losses.archers)) {
        dbg.log('[BATTLE] No losses for banner', banner.name);
        next.push(banner);
        return next;
      }

      if (!banner.squads || banner.squads.length === 0) {
        dbg.log('[BATTLE] Banner has no squads', banner.name);
        next.push(banner);
        return next;
      }

      // Calculate battle stats for XP
      const startTroops = banner.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
      const enemyCasualties = result.initialAttackers - result.finalAttackers;
      // Distribute enemy casualties proportionally across all garrison banners
      const totalGarrisonStart = garrisonBanners.reduce((sum, b) =>
        sum + b.squads.reduce((s, sq) => s + sq.currentSize, 0), 0);
      const bannerShare = totalGarrisonStart > 0 ? startTroops / totalGarrisonStart : 0;
      const bannerEnemyCasualties = Math.floor(enemyCasualties * bannerShare);

      const isVictory = result.outcome === 'fortress_holds_walls' || result.outcome === 'fortress_holds_inner';

      const updatedBanner: Banner = {
        ...banner,
        squads: banner.squads.map(squad => ({ ...squad })),
      };

      trimSquadsByType(updatedBanner.squads, 'warrior', losses.warriors || 0);
      trimSquadsByType(updatedBanner.squads, 'archer', losses.archers || 0);

      const totalRemaining = updatedBanner.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
      const totalLossesForBanner = (losses.warriors || 0) + (losses.archers || 0);
      const survived = totalRemaining > 0;
      const ownCasualties = startTroops - totalRemaining;

      // Calculate banner XP gain (for commander)
      const bannerXPGain = calculateBannerXPGain(bannerEnemyCasualties, isVictory, survived);

      // Update banner XP
      const bannerWithXP = updateBannerXP(
        updatedBanner,
        bannerEnemyCasualties,
        ownCasualties,
        startTroops,
        isVictory,
        survived
      );

      // Update commander XP if banner has a commander (store for later update)
      const bannerCommander = banner.commanderId
        ? commanders.find(c => c.id === banner.commanderId)
        : null;
      if (bannerCommander) {
        const updatedCommander = updateCommanderXP(bannerCommander, bannerXPGain);
        commandersToUpdate.push(updatedCommander);
      }

      if (totalRemaining <= 0) {
        destroyedIds.push(bannerWithXP.id);
        // Capture banner info from original banner before it's removed
        const bannerType = banner.type || 'regular';
        const bannerName = banner.name;
        const notice = {
          id: `${banner.id}-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          bannerName: bannerName,
          bannerType: bannerType,
          message: `${bannerName} was decimated in the battle.`,
        };
        dbg.log('[BATTLE] Banner destroyed, creating notice:', notice);
        noticesToAdd.push(notice);
        return next;
      }

      if (totalLossesForBanner > 0) {
        // Capture banner info from original banner
        const bannerType = banner.type || 'regular';
        const bannerName = banner.name;
        const notice = {
          id: `${banner.id}-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          bannerName: bannerName,
          bannerType: bannerType,
          message: `${bannerName} suffered ${totalLossesForBanner} losses defending the fortress.`,
        };
        noticesToAdd.push(notice);
      }

      next.push(bannerWithXP);
      return next;
    }, []);

    // Update banners state
    setBanners(updatedBanners);

    // Update commanders state
    if (commandersToUpdate.length > 0) {
      setCommanders((cs) => cs.map(c => {
        const updated = commandersToUpdate.find(u => u.id === c.id);
        return updated || c;
      }));
    }

    // Update notifications state
    dbg.log('[BATTLE] Finished processing banners. noticesToAdd.length:', noticesToAdd.length, 'noticesToAdd:', noticesToAdd);

    if (noticesToAdd.length > 0) {
      dbg.log('[BATTLE] Creating notifications:', noticesToAdd);
      setBannerLossNotices((prev) => {
        const updated = [...prev, ...noticesToAdd];
        dbg.log('[BATTLE] Updated notification state. Previous count:', prev.length, 'New count:', updated.length, 'All notices:', updated);
        return updated;
      });
    } else {
      dbg.log('[BATTLE] WARNING: No notifications to add (noticesToAdd is empty)');
    }

    return destroyedIds;
  }

  // ── Shared battle helper ───────────────────────────────────────

  function buildSquadEntry(type: string, count: number): BattleSquadEntry {
    const cat = unitCategory[type as UnitType] || 'infantry';
    return {
      type,
      displayName: unitDisplayNames[type as UnitType] || type,
      role: cat === 'ranged_infantry' ? 'ranged' : 'melee',
      initial: count,
      final: count,
      lost: 0,
    };
  }

  // ── Field Battle helpers ──────────────────────────────────────

  type ProvinceConflict = {
    provinceId: string;
    playerBannerIds: number[];   // ALL player armies arriving here
    enemyIds: number[];          // ALL enemy armies arriving here
  };

  function computeEnemyDestinations(
    enemies: EnemyArmy[],
    fortressId: string,
    provinceData: { provinces: ProvinceData[] }
  ): Map<number, string> {
    const provinceById = new Map<string, ProvinceData>();
    for (const p of provinceData.provinces) provinceById.set(p.id, p);
    const destinations = new Map<number, string>();
    for (const enemy of enemies) {
      if (enemy.status !== 'marching') continue;
      if (enemy.provinceId === fortressId) {
        destinations.set(enemy.id, fortressId);
        continue;
      }
      const pathResult = findPath(enemy.provinceId, fortressId, provinceById);
      if (pathResult && pathResult.path.length > 1) {
        destinations.set(enemy.id, pathResult.path[1]);
      } else {
        destinations.set(enemy.id, enemy.provinceId);
      }
    }
    return destinations;
  }

  function computePlayerDestinations(
    positions: Record<number, string>,
    orders: Record<number, ArmyOrder>
  ): Record<number, string> {
    const dests: Record<number, string> = {};
    for (const [bidStr, pos] of Object.entries(positions)) {
      const bid = Number(bidStr);
      const order = orders[bid];
      if (order?.type === 'move' && order.targetProvinceId) {
        dests[bid] = order.targetProvinceId;
      } else {
        dests[bid] = pos;
      }
    }
    return dests;
  }

  function detectProvinceConflicts(
    playerPositions: Record<number, string>,
    playerDests: Record<number, string>,
    enemies: EnemyArmy[],
    enemyDests: Map<number, string>
  ): ProvinceConflict[] {
    // Build province → armies map from destinations (co-location)
    const provinceMap = new Map<string, { players: Set<number>; enemies: Set<number> }>();

    for (const [bidStr, dest] of Object.entries(playerDests)) {
      const entry = provinceMap.get(dest) || { players: new Set(), enemies: new Set() };
      entry.players.add(Number(bidStr));
      provinceMap.set(dest, entry);
    }

    for (const enemy of enemies) {
      if (enemy.status !== 'marching') continue;
      const dest = enemyDests.get(enemy.id);
      if (!dest) continue;
      const entry = provinceMap.get(dest) || { players: new Set(), enemies: new Set() };
      entry.enemies.add(enemy.id);
      provinceMap.set(dest, entry);
    }

    // Also check swap: player A→B while enemy B→A → battle at B
    for (const [bidStr, pDest] of Object.entries(playerDests)) {
      const bid = Number(bidStr);
      const pCurrent = playerPositions[bid];
      if (!pCurrent || pDest === pCurrent) continue; // not moving

      for (const enemy of enemies) {
        if (enemy.status !== 'marching') continue;
        const eDest = enemyDests.get(enemy.id);
        // Player going to enemy's position, enemy going to player's position
        if (pDest === enemy.provinceId && eDest === pCurrent) {
          const entry = provinceMap.get(pDest) || { players: new Set(), enemies: new Set() };
          entry.players.add(bid);
          entry.enemies.add(enemy.id);
          provinceMap.set(pDest, entry);
        }
      }
    }

    // Return only provinces where BOTH sides are present
    return Array.from(provinceMap.entries())
      .filter(([_, v]) => v.players.size > 0 && v.enemies.size > 0)
      .map(([provinceId, v]) => ({
        provinceId,
        playerBannerIds: Array.from(v.players),
        enemyIds: Array.from(v.enemies),
      }));
  }

  function runFieldBattle(
    banner: Banner,
    enemy: EnemyArmy,
    provinceId: string,
    turnNumber: number,
    battleIndex: number
  ): FieldBattleResult {
    const stats = unitStats;
    const p = battleParams;
    const baseCas = p.base_casualty_rate || 0.7;

    // Classify player troops
    let playerWarriors = 0;
    let playerArchers = 0;
    const playerComp: BattleSquadEntry[] = [];
    for (const sq of banner.squads || []) {
      const entry = buildSquadEntry(sq.type, sq.currentSize);
      playerComp.push(entry);
      const cat = unitCategory[sq.type as UnitType] || 'infantry';
      if (cat === 'ranged_infantry') {
        playerArchers += sq.currentSize;
      } else {
        playerWarriors += sq.currentSize;
      }
    }

    // Classify enemy troops
    let enemyWarriors = 0;
    let enemyArchers = 0;
    const enemyComp: BattleSquadEntry[] = [];
    for (const sq of enemy.squads || []) {
      const troopCount = sq.count * 10;
      const entry = buildSquadEntry(sq.type, troopCount);
      enemyComp.push(entry);
      const cat = unitCategory[sq.type as UnitType] || 'infantry';
      if (cat === 'ranged_infantry') {
        enemyArchers += troopCount;
      } else {
        enemyWarriors += troopCount;
      }
    }

    const playerTotal = playerWarriors + playerArchers;
    const enemyTotal = enemyWarriors + enemyArchers;

    // Battle stats
    const battleStats = {
      warrior: {
        skirmish: stats.warrior?.skirmish_attack || 0,
        melee: stats.warrior?.melee_attack || 15,
      },
      archer: {
        skirmish: stats.archer?.skirmish_attack || 15,
        melee: stats.archer?.melee_attack || 0,
      },
    };

    // Run the battle — player is "defender" (warriors/archers split), enemy is "attacker"
    const timeline = runInnerBattle(playerWarriors, playerArchers, enemyTotal, battleStats, baseCas);

    // Read final state
    const lastStep = timeline.length > 0 ? timeline[timeline.length - 1] : null;
    const finalPlayerTroops = lastStep ? lastStep.defenders : playerTotal;
    const finalEnemyTroops = lastStep ? lastStep.attackers : enemyTotal;

    // Determine outcome
    let outcome: FieldBattleResult['outcome'];
    if (finalPlayerTroops > 0 && finalEnemyTroops <= 0) {
      outcome = 'player_wins';
    } else if (finalPlayerTroops <= 0 && finalEnemyTroops > 0) {
      outcome = 'enemy_wins';
    } else {
      outcome = 'draw';
    }

    // Distribute casualties proportionally across squads of the same role
    function distributeCasualties(
      comp: BattleSquadEntry[],
      totalLost: number,
      warriors: number,
      archers: number,
      total: number
    ) {
      const meleeLost = warriors > 0 ? Math.round(totalLost * (warriors / total)) : 0;
      const rangedLost = totalLost - meleeLost;
      for (const entry of comp) {
        const roleLost = entry.role === 'melee' ? meleeLost : rangedLost;
        const roleTotal = entry.role === 'melee' ? warriors : archers;
        if (roleLost <= 0 || roleTotal <= 0) continue;
        const proportion = entry.initial / roleTotal;
        const loss = Math.min(entry.initial, Math.round(roleLost * proportion));
        entry.lost = loss;
        entry.final = entry.initial - loss;
      }
    }

    const playerLost = playerTotal - Math.max(0, finalPlayerTroops);
    distributeCasualties(playerComp, playerLost, playerWarriors, playerArchers, playerTotal);

    const enemyLost = enemyTotal - Math.max(0, finalEnemyTroops);
    distributeCasualties(enemyComp, enemyLost, enemyWarriors, enemyArchers, enemyTotal);

    // Generate takeaway
    let battleTakeaway = '';
    if (outcome === 'player_wins') {
      if (playerLost === 0) battleTakeaway = `${banner.name} crushed the enemy without losses.`;
      else battleTakeaway = `${banner.name} defeated ${enemy.name}, losing ${Math.round(playerLost)} troops in the process.`;
    } else if (outcome === 'enemy_wins') {
      battleTakeaway = `${enemy.name} overwhelmed ${banner.name}. The army was destroyed.`;
    } else {
      battleTakeaway = `Both armies fought to a standstill. Neither side could gain a decisive advantage.`;
    }

    return {
      id: `fb_${turnNumber}_${battleIndex}`,
      turn: turnNumber,
      provinceId,
      outcome,
      playerArmy: {
        bannerId: banner.id,
        bannerName: banner.name,
        initialTroops: playerTotal,
        finalTroops: Math.round(Math.max(0, finalPlayerTroops)),
        composition: playerComp,
      },
      enemyArmy: {
        enemyId: enemy.id,
        enemyName: enemy.name,
        initialTroops: enemyTotal,
        finalTroops: Math.round(Math.max(0, finalEnemyTroops)),
        composition: enemyComp,
      },
      timeline,
      battleTakeaway,
    };
  }

  /**
   * runMergedBattle — Resolves a battle where multiple armies (player and/or enemy) meet in one province.
   * All player squads pool into one "defender" side, all enemy squads into one "attacker" side.
   * After the battle, casualties are distributed back proportionally to each original army.
   */
  function runMergedBattle(
    playerBanners: Banner[],
    enemyForces: EnemyArmy[],
    provinceId: string,
    turnNumber: number,
    battleIndex: number
  ): FieldBattleResult {
    const stats = unitStats;
    const p = battleParams;
    const baseCas = p.base_casualty_rate || 0.7;

    // Pool all player squads
    let totalPlayerWarriors = 0;
    let totalPlayerArchers = 0;
    const perBanner: Array<{ banner: Banner; warriors: number; archers: number; total: number; comp: BattleSquadEntry[] }> = [];

    for (const banner of playerBanners) {
      let bWarr = 0, bArch = 0;
      const bComp: BattleSquadEntry[] = [];
      for (const sq of banner.squads || []) {
        const entry = buildSquadEntry(sq.type, sq.currentSize);
        bComp.push(entry);
        if ((unitCategory[sq.type as UnitType] || 'infantry') === 'ranged_infantry') {
          bArch += sq.currentSize;
        } else {
          bWarr += sq.currentSize;
        }
      }
      totalPlayerWarriors += bWarr;
      totalPlayerArchers += bArch;
      perBanner.push({ banner, warriors: bWarr, archers: bArch, total: bWarr + bArch, comp: bComp });
    }

    // Pool all enemy squads
    let totalEnemyWarriors = 0;
    let totalEnemyArchers = 0;
    const perEnemy: Array<{ enemy: EnemyArmy; warriors: number; archers: number; total: number; comp: BattleSquadEntry[] }> = [];

    for (const enemy of enemyForces) {
      let eWarr = 0, eArch = 0;
      const eComp: BattleSquadEntry[] = [];
      for (const sq of enemy.squads || []) {
        const troopCount = sq.count * 10;
        const entry = buildSquadEntry(sq.type, troopCount);
        eComp.push(entry);
        if ((unitCategory[sq.type as UnitType] || 'infantry') === 'ranged_infantry') {
          eArch += troopCount;
        } else {
          eWarr += troopCount;
        }
      }
      totalEnemyWarriors += eWarr;
      totalEnemyArchers += eArch;
      perEnemy.push({ enemy, warriors: eWarr, archers: eArch, total: eWarr + eArch, comp: eComp });
    }

    const totalPlayer = totalPlayerWarriors + totalPlayerArchers;
    const totalEnemy = totalEnemyWarriors + totalEnemyArchers;

    const battleStats = {
      warrior: { skirmish: stats.warrior?.skirmish_attack || 0, melee: stats.warrior?.melee_attack || 15 },
      archer: { skirmish: stats.archer?.skirmish_attack || 15, melee: stats.archer?.melee_attack || 0 },
    };

    // Run combined battle
    const timeline = runInnerBattle(totalPlayerWarriors, totalPlayerArchers, totalEnemy, battleStats, baseCas);

    const lastStep = timeline.length > 0 ? timeline[timeline.length - 1] : null;
    const finalPlayerTroops = lastStep ? lastStep.defenders : totalPlayer;
    const finalEnemyTroops = lastStep ? lastStep.attackers : totalEnemy;

    let outcome: FieldBattleResult['outcome'];
    if (finalPlayerTroops > 0 && finalEnemyTroops <= 0) outcome = 'player_wins';
    else if (finalPlayerTroops <= 0 && finalEnemyTroops > 0) outcome = 'enemy_wins';
    else outcome = 'draw';

    // Distribute casualties proportionally within a composition
    function distributeCasualties(comp: BattleSquadEntry[], totalLost: number, warriors: number, archers: number, total: number) {
      if (totalLost <= 0 || total <= 0) return;
      const meleeLost = warriors > 0 ? Math.round(totalLost * (warriors / total)) : 0;
      const rangedLost = totalLost - meleeLost;
      for (const entry of comp) {
        const roleLost = entry.role === 'melee' ? meleeLost : rangedLost;
        const roleTotal = entry.role === 'melee' ? warriors : archers;
        if (roleLost <= 0 || roleTotal <= 0) continue;
        const proportion = entry.initial / roleTotal;
        const loss = Math.min(entry.initial, Math.round(roleLost * proportion));
        entry.lost = loss;
        entry.final = entry.initial - loss;
      }
    }

    // Distribute player losses back to each banner proportionally
    const totalPlayerLost = totalPlayer - Math.max(0, finalPlayerTroops);
    const playerArmies: FieldBattleResult['playerArmies'] = [];
    for (const pb of perBanner) {
      const share = totalPlayer > 0 ? pb.total / totalPlayer : 0;
      const bannerLost = Math.round(totalPlayerLost * share);
      distributeCasualties(pb.comp, bannerLost, pb.warriors, pb.archers, pb.total);
      const bannerFinal = Math.max(0, pb.total - bannerLost);
      playerArmies.push({
        bannerId: pb.banner.id,
        bannerName: pb.banner.name,
        initialTroops: pb.total,
        finalTroops: Math.round(bannerFinal),
        composition: pb.comp,
      });
    }

    // Distribute enemy losses back to each enemy proportionally
    const totalEnemyLost = totalEnemy - Math.max(0, finalEnemyTroops);
    const enemyArmies: FieldBattleResult['enemyArmies'] = [];
    for (const pe of perEnemy) {
      const share = totalEnemy > 0 ? pe.total / totalEnemy : 0;
      const eLost = Math.round(totalEnemyLost * share);
      distributeCasualties(pe.comp, eLost, pe.warriors, pe.archers, pe.total);
      const eFinal = Math.max(0, pe.total - eLost);
      enemyArmies.push({
        enemyId: pe.enemy.id,
        enemyName: pe.enemy.name,
        initialTroops: pe.total,
        finalTroops: Math.round(eFinal),
        composition: pe.comp,
      });
    }

    // Primary army = largest player banner
    const primaryPlayer = playerArmies.reduce((a, b) => a.initialTroops >= b.initialTroops ? a : b, playerArmies[0]);
    const primaryEnemy = enemyArmies.reduce((a, b) => a.initialTroops >= b.initialTroops ? a : b, enemyArmies[0]);

    // Takeaway
    const playerNames = playerBanners.map(b => b.name).join(' + ');
    const enemyNames = enemyForces.map(e => e.name).join(' + ');
    let battleTakeaway = '';
    if (outcome === 'player_wins') {
      if (totalPlayerLost === 0) battleTakeaway = `${playerNames} crushed the enemy without losses.`;
      else battleTakeaway = `${playerNames} defeated ${enemyNames}, losing ${Math.round(totalPlayerLost)} troops in the process.`;
    } else if (outcome === 'enemy_wins') {
      battleTakeaway = `${enemyNames} overwhelmed ${playerNames}. The defenders were destroyed.`;
    } else {
      battleTakeaway = `Both sides fought to a standstill at ${provinceId.replace('prov_', 'Province ')}.`;
    }

    return {
      id: `fb_${turnNumber}_${battleIndex}`,
      turn: turnNumber,
      provinceId,
      outcome,
      playerArmy: primaryPlayer,
      enemyArmy: primaryEnemy,
      playerArmies,
      enemyArmies,
      timeline,
      battleTakeaway,
    };
  }

  function applyFieldBattleCasualties(
    result: FieldBattleResult,
    turnNumber: number,
    provinceId: string
  ): { destroyedBannerIds: number[]; destroyedEnemyIds: number[] } {
    const destroyedBannerIds: number[] = [];
    const destroyedEnemyIds: number[] = [];

    // Apply player losses — loop through all participating armies
    const armies = result.playerArmies && result.playerArmies.length > 0
      ? result.playerArmies
      : [result.playerArmy];

    for (const army of armies) {
      const armyLost = army.initialTroops - army.finalTroops;
      if (armyLost <= 0) continue;
      setBanners(prev => prev.map(b => {
        if (b.id !== army.bannerId) return b;
        const updatedSquads = b.squads.map((sq, idx) => {
          const compEntry = idx < army.composition.length ? army.composition[idx] : null;
          if (!compEntry || compEntry.lost <= 0) return sq;
          const thisLoss = Math.min(sq.currentSize, Math.round(compEntry.lost));
          return { ...sq, currentSize: Math.max(0, sq.currentSize - thisLoss) };
        });
        const remaining = updatedSquads.reduce((s, sq) => s + sq.currentSize, 0);
        const isDestroyed = remaining <= 0;
        if (isDestroyed) destroyedBannerIds.push(b.id);
        const enemyNames = (result.enemyArmies || [result.enemyArmy]).map(e => e.enemyName).join(' + ');
        return {
          ...b,
          squads: updatedSquads,
          status: isDestroyed ? 'destroyed' as const : b.status,
          destroyedTurn: isDestroyed ? turnNumber : b.destroyedTurn,
          destroyedInProvince: isDestroyed ? provinceId : b.destroyedInProvince,
          destroyedByEnemy: isDestroyed ? enemyNames : b.destroyedByEnemy,
          fieldBattleId: isDestroyed ? result.id : b.fieldBattleId,
        };
      }));
    }

    // Check enemy destruction — loop through all participating enemies
    const enemyResults = result.enemyArmies && result.enemyArmies.length > 0
      ? result.enemyArmies
      : [result.enemyArmy];

    for (const ea of enemyResults) {
      if (ea.finalTroops <= 0) {
        destroyedEnemyIds.push(ea.enemyId);
      }
    }

    return { destroyedBannerIds, destroyedEnemyIds };
  }

  // ── NPC Enemy Army helpers ──────────────────────────────────────

  function spawnEnemyArmy(
    mapState: NonNullable<Expedition['mapState']>,
    provinceData: { provinces: ProvinceData[] }
  ): EnemyArmy | null {
    const fortId = mapState.fortressProvinceId;
    const provinceById = new Map<string, ProvinceData>();
    for (const p of provinceData.provinces) provinceById.set(p.id, p);

    // Find all land provinces with BFS distance >= 6 from fortress
    const occupiedProvinces = new Set<string>([
      fortId,
      ...Object.values(mapState.armyPositions),
      ...(mapState.enemyArmies || []).filter(e => e.status === 'marching').map(e => e.provinceId),
    ]);

    const candidates: string[] = [];
    for (const p of provinceData.provinces) {
      if (!p.isLand || occupiedProvinces.has(p.id)) continue;
      const pathResult = findPath(p.id, fortId, provinceById);
      if (pathResult && pathResult.distance >= 4) {
        candidates.push(p.id);
      }
    }

    if (candidates.length === 0) return null;

    // Pick random spawn province
    const spawnProvId = candidates[Math.floor(Math.random() * candidates.length)];

    // Pick random mercenary template
    const templates = bannerTemplates;
    const template = templates[Math.floor(Math.random() * templates.length)];

    const totalTroops = template.squads.reduce((sum, sq) => sum + sq.count * 10, 0);
    const nextId = (mapState.nextEnemyId ?? 1);

    return {
      id: nextId,
      templateId: template.id,
      name: `${template.name} Warband`,
      squads: template.squads.map(s => ({ type: s.type, count: s.count })),
      provinceId: spawnProvId,
      totalTroops,
      spawnTurn: mapState.turnNumber,
      status: 'marching',
    };
  }

  function moveEnemyArmies(
    enemies: EnemyArmy[],
    fortressId: string,
    provinceData: { provinces: ProvinceData[] }
  ): EnemyArmy[] {
    const provinceById = new Map<string, ProvinceData>();
    for (const p of provinceData.provinces) provinceById.set(p.id, p);

    return enemies.map(enemy => {
      if (enemy.status !== 'marching') return enemy;
      if (enemy.provinceId === fortressId) return enemy; // already at fortress

      const pathResult = findPath(enemy.provinceId, fortressId, provinceById);
      if (!pathResult || pathResult.path.length <= 1) return enemy; // no path or already there

      return {
        ...enemy,
        provinceId: pathResult.path[1], // move one step closer
      };
    });
  }

  function runSiegeBattle(
    expeditionId: string,
    attackers: number,
    attackerSquads?: Array<{ type: string; count: number }>
  ): SiegeBattleResult {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress) {
      throw new Error('Fortress not found');
    }

    const stats = unitStats;
    const p = battleParams;
    const baseCas = p.base_casualty_rate || 0.7;
    const maxRounds = 30;

    const fortHPmax = expedition.fortress.stats.fortHP;

    // Calculate actual garrison from stationed banners (real units only)
    // IMPORTANT: Garrison stats are army-count capacity only — always use calculateGarrisonFromBanners for actual troops
    const garrisonBannerIds = expedition.fortress.garrison || [];
    const actualGarrison = calculateGarrisonFromBanners(garrisonBannerIds);

    // Use ONLY actual units from banners - if no banners assigned, defenders = 0
    const garrisonArchers = actualGarrison.archers || 0;
    const garrisonWarriors = actualGarrison.warriors || 0;

    // Build composition arrays for the report (uses shared buildSquadEntry helper)

    const defenderComp: BattleSquadEntry[] = actualGarrison.squads.map(s => buildSquadEntry(s.type, s.count));
    const attackerComp: BattleSquadEntry[] = attackerSquads
      ? attackerSquads.map(s => buildSquadEntry(s.type, s.count))
      : [buildSquadEntry('warrior', attackers)];

    // Calculate active wall archers (limited by Watch Post capacity) for Phase 1 only
    const wallArchers = calculateActiveWallArchers(expeditionId);
    const activeArchers = wallArchers.active; // Only archers that can shoot from walls in phase 1

    // Debug logging
    dbg.log('[SIEGE] Defenders from banners:', { garrisonArchers, garrisonWarriors });
    dbg.log('[SIEGE] Watch Post capacity:', wallArchers.capacity, 'Active wall archers:', activeArchers);

    // Unit stats for siege
    const wSkirmish = stats.warrior?.skirmish_attack || 0;
    const wMelee = stats.warrior?.melee_attack || 15;
    const aSkirmish = stats.archer?.skirmish_attack || 15;

    let fortHP = fortHPmax;
    let remainingAttackers = attackers;
    const siegeTimeline: SiegeRound[] = [];
    let finalGarrison = { warriors: garrisonWarriors, archers: garrisonArchers };

    // Siege phase
    let rounds = 0;
    while (fortHP > 0 && remainingAttackers > 0 && rounds < maxRounds) {
      rounds++;

      const dmgFromArchers = (activeArchers / 100) * aSkirmish * baseCas;
      const killed = Math.min(remainingAttackers, dmgFromArchers);
      remainingAttackers -= killed;

      const fortDamagePerWarrior = wMelee * 0.2;
      const dmgToFort = remainingAttackers * fortDamagePerWarrior * baseCas;
      fortHP = Math.max(0, fortHP - dmgToFort);

      siegeTimeline.push({
        round: rounds,
        fortHP,
        attackers: remainingAttackers,
        archers: activeArchers,
        killed,
        dmgToFort
      });
    }

    // Inner battle phase (if walls fall)
    // IMPORTANT: Inner battle uses ONLY actual units from banners, NOT Watch Post capacity
    // Watch Post slots do NOT apply in inner battle - they only limit Phase 1 wall archers
    let innerTimeline: InnerBattleStep[] = [];
    if (fortHP <= 0 && remainingAttackers > 0 && (garrisonWarriors + garrisonArchers) > 0) {
      const battleStats = {
        warrior: { skirmish: wSkirmish, melee: wMelee },
        archer: { skirmish: aSkirmish, melee: aSkirmish * 0.3 }
      };
      dbg.log('[SIEGE] Starting inner battle with defenders:', { garrisonWarriors, garrisonArchers });
      innerTimeline = runInnerBattle(garrisonWarriors, garrisonArchers, remainingAttackers, battleStats, baseCas);
    } else if (fortHP <= 0 && remainingAttackers > 0) {
      dbg.log('[SIEGE] No inner battle - no defenders from banners');
    }

    // Determine outcome
    if (siegeTimeline.length === 0) {
      // No rounds executed — fortress HP or attackers was 0
      return {
        outcome: 'stalemate' as const,
        siegeRounds: 0,
        finalFortHP: fortHPmax,
        finalAttackers: attackers,
        finalDefenders: garrisonWarriors + garrisonArchers,
        siegeTimeline: [],
        innerTimeline: [],
        initialFortHP: fortHPmax,
        initialAttackers: attackers,
        initialGarrison: { warriors: garrisonWarriors, archers: garrisonArchers },
        finalGarrison: { warriors: garrisonWarriors, archers: garrisonArchers },
        attackerComposition: attackerComp,
        defenderComposition: defenderComp,
        battleTakeaway: 'No battle occurred.',
      };
    }
    const lastSiege = siegeTimeline[siegeTimeline.length - 1];
    let outcome: SiegeBattleResult['outcome'];
    let finalAttackers = lastSiege.attackers;
    let finalDefenders = garrisonWarriors + garrisonArchers;

    if (lastSiege.attackers <= 0 && lastSiege.fortHP > 0) {
      outcome = 'fortress_holds_walls';
    } else if (lastSiege.fortHP <= 0 && lastSiege.attackers > 0) {
      if (innerTimeline.length > 0) {
        const lastInner = innerTimeline[innerTimeline.length - 1];
        finalAttackers = lastInner.attackers;
        finalDefenders = lastInner.defenders;
        finalGarrison = { warriors: lastInner.defWarriors, archers: lastInner.defArchers };
        if (finalDefenders > 0 && finalAttackers <= 0) {
          outcome = 'fortress_holds_inner';
        } else if (finalAttackers > 0 && finalDefenders <= 0) {
          outcome = 'fortress_falls';
        } else {
          outcome = 'stalemate';
        }
      } else {
        outcome = 'fortress_falls';
      }
    } else {
      outcome = 'stalemate';
    }

    // Distribute casualties proportionally across squads
    const totalDefLost = (garrisonWarriors + garrisonArchers) - finalDefenders;
    const totalAtkLost = attackers - finalAttackers;

    // Defender casualties: split by melee/ranged losses from finalGarrison
    const meleeLost = garrisonWarriors - finalGarrison.warriors;
    const rangedLost = garrisonArchers - finalGarrison.archers;
    const defMeleeSquads = defenderComp.filter(s => s.role === 'melee');
    const defRangedSquads = defenderComp.filter(s => s.role === 'ranged');
    const totalDefMelee = defMeleeSquads.reduce((sum, s) => sum + s.initial, 0);
    const totalDefRanged = defRangedSquads.reduce((sum, s) => sum + s.initial, 0);

    defMeleeSquads.forEach(s => {
      const proportion = totalDefMelee > 0 ? s.initial / totalDefMelee : 0;
      s.lost = Math.round(meleeLost * proportion);
      s.final = Math.max(0, s.initial - s.lost);
    });
    defRangedSquads.forEach(s => {
      const proportion = totalDefRanged > 0 ? s.initial / totalDefRanged : 0;
      s.lost = Math.round(rangedLost * proportion);
      s.final = Math.max(0, s.initial - s.lost);
    });

    // Attacker casualties: distribute proportionally across all squads
    const totalAtkInitial = attackerComp.reduce((sum, s) => sum + s.initial, 0);
    attackerComp.forEach(s => {
      const proportion = totalAtkInitial > 0 ? s.initial / totalAtkInitial : 0;
      s.lost = Math.round(totalAtkLost * proportion);
      s.final = Math.max(0, s.initial - s.lost);
    });

    // Generate battle takeaway
    let battleTakeaway: string;
    if (outcome === 'fortress_holds_walls') {
      battleTakeaway = 'Strong wall defenses repelled the attackers before they could breach.';
    } else if (outcome === 'fortress_holds_inner') {
      battleTakeaway = 'Though the walls fell, the garrison fought off the remaining attackers inside the fortress.';
    } else if (outcome === 'fortress_falls') {
      if (totalDefLost === 0 && finalDefenders === 0 && (garrisonWarriors + garrisonArchers) === 0) {
        battleTakeaway = 'With no garrison stationed, the fortress was taken without resistance after the walls fell.';
      } else if (attackers > (garrisonWarriors + garrisonArchers) * 2) {
        battleTakeaway = 'The garrison fought bravely but was overwhelmed by superior numbers.';
      } else {
        battleTakeaway = 'The fortress defenses crumbled and the garrison could not hold the inner keep.';
      }
    } else {
      battleTakeaway = 'Both sides exhausted themselves without a decisive outcome.';
    }

    return {
      outcome,
      siegeRounds: rounds,
      finalFortHP: lastSiege.fortHP,
      finalAttackers,
      finalDefenders,
      siegeTimeline,
      innerTimeline,
      initialFortHP: fortHPmax,
      initialAttackers: attackers,
      initialGarrison: { warriors: garrisonWarriors, archers: garrisonArchers },
      finalGarrison,
      attackerComposition: attackerComp,
      defenderComposition: defenderComp,
      battleTakeaway,
    };
  }

  function runInnerBattle(
    defWarriorsStart: number,
    defArchersStart: number,
    attackersStart: number,
    stats: { warrior: { skirmish: number; melee: number }; archer: { skirmish: number; melee: number } },
    baseCas: number
  ): InnerBattleStep[] {
    let defWarriors = defWarriorsStart;
    let defArchers = defArchersStart;
    let attackers = attackersStart;
    const tl: InnerBattleStep[] = [];
    let step = 0;
    const maxSteps = 50;

    while (attackers > 0 && (defWarriors + defArchers) > 0 && step < maxSteps) {
      step++;
      const defTotal = defWarriors + defArchers;

      let phase: 'skirmish' | 'melee' | 'pursuit';
      if (step <= 3) {
        phase = 'skirmish';
      } else if (step <= 13) {
        phase = 'melee';
      } else {
        phase = 'pursuit';
      }

      let killedAtk = 0;
      let killedDef = 0;

      if (phase === 'skirmish') {
        const defDmg = ((defArchers / 100) * stats.archer.skirmish + (defWarriors / 100) * stats.warrior.skirmish * 0.3) * baseCas;
        killedAtk = Math.min(attackers, defDmg);
        const atkDmg = (attackers / 100) * stats.warrior.skirmish * baseCas * 0.4;
        killedDef = Math.min(defTotal, atkDmg);
      } else if (phase === 'melee') {
        // Calculate weighted average melee stat for defenders (warriors + archers)
        const warriorShare = defTotal > 0 ? defWarriors / defTotal : 0;
        const archerShare = defTotal > 0 ? defArchers / defTotal : 0;
        const avgDefMelee = (warriorShare * stats.warrior.melee) + (archerShare * stats.archer.melee);

        const defDmg = (defTotal / 100) * avgDefMelee * baseCas;
        const atkDmg = (attackers / 100) * stats.warrior.melee * baseCas;
        killedAtk = Math.min(attackers, defDmg);
        killedDef = Math.min(defTotal, atkDmg);
      } else if (phase === 'pursuit') {
        // Calculate weighted average melee stat for defenders in pursuit
        const warriorShare = defTotal > 0 ? defWarriors / defTotal : 0;
        const archerShare = defTotal > 0 ? defArchers / defTotal : 0;
        const avgDefMelee = (warriorShare * stats.warrior.melee) + (archerShare * stats.archer.melee);

        if (attackers > defTotal) {
          const atkDmg = (attackers / 100) * stats.warrior.melee * baseCas * 1.2;
          killedDef = Math.min(defTotal, atkDmg);
        } else {
          const defDmg = (defTotal / 100) * avgDefMelee * baseCas * 1.2;
          killedAtk = Math.min(attackers, defDmg);
        }
      }

      if (defTotal > 0 && killedDef > 0) {
        const wShare = defWarriors / defTotal;
        const aShare = defArchers / defTotal;
        const kW = Math.min(defWarriors, killedDef * wShare);
        const kA = Math.min(defArchers, killedDef * aShare);
        defWarriors -= kW;
        defArchers -= kA;
      }

      attackers = Math.max(0, attackers - killedAtk);

      tl.push({
        step,
        phase,
        defWarriors,
        defArchers,
        defenders: defWarriors + defArchers,
        attackers,
        killedAttackers: killedAtk,
        killedDefenders: killedDef
      });
    }

    return tl;
  }

  function removeBannerFromFortress(expeditionId: string, bannerId: number) {
    const expedition = expeditions.find(exp => exp.expeditionId === expeditionId);
    if (!expedition?.fortress) return;

    // Remove banner from garrison
    setExpeditions((exps) => exps.map((exp) => {
      if (exp.expeditionId !== expeditionId || !exp.fortress) return exp;
      return {
        ...exp,
        fortress: {
          ...exp.fortress,
          garrison: (exp.fortress.garrison || []).filter(id => id !== bannerId)
        }
      };
    }));

    // Update banner status back to ready
    setBanners((bs) => bs.map((b) =>
      b.id === bannerId ? { ...b, status: 'ready' } : b
    ));
  }

  function dismissBannerLossNotice(noticeId: string) {
    setBannerLossNotices((notices) => notices.filter((notice) => notice.id !== noticeId));
  }

  // Create reinforcement training entry
  function requestReinforcement(bannerId: number, squadId?: number) {
    if (editingBannerId === bannerId) return; // Hard lock: Cannot reinforce while editing

    const banner = banners.find(b => b.id === bannerId);
    if (!banner) return;

    // Guard: Don't allow reinforcing destroyed banners
    if (banner.status === 'destroyed') return;

    // Ensure banner has squads initialized
    let bannerWithSquads = banner;
    if (!bannerWithSquads.squads || bannerWithSquads.squads.length === 0) {
      const { squads, nextSeq } = initializeSquadsFromUnits(bannerWithSquads.units, squadSeq);
      bannerWithSquads = { ...bannerWithSquads, squads };
      setSquadSeq(nextSeq);
      squadSeqRef.current = nextSeq;
    }

    const isFullReinforcement = squadId === undefined;
    const squad = isFullReinforcement ? null : bannerWithSquads.squads.find(s => s.id === squadId);
    if (!isFullReinforcement && !squad) return;

    if (!isFullReinforcement && squad) {
      const missing = squad.maxSize - squad.currentSize;
      if (missing <= 0) return;

      // Handle mercenary vs regular banners differently
      if (banner.type === 'mercenary') {
        const goldCost = missing;
        setReinforcementModal({
          bannerId,
          squadId: squad.id,
          goldCost,
          soldiersNeeded: missing,
          bannerName: banner.name,
          squadType: unitDisplayNames[squad.type] || squad.type
        });
        return;
      }
    } else {
      // Full reinforcement: check if any squad is damaged
      const damagedSquads = bannerWithSquads.squads.filter(s => s.currentSize < s.maxSize);
      if (damagedSquads.length === 0) return;

      if (banner.type === 'mercenary') {
        const totalMissing = damagedSquads.reduce((sum, s) => sum + (s.maxSize - s.currentSize), 0);
        setHireAndRefillModal({
          bannerId,
          hireCost: 0,
          refillCost: totalMissing, // In this game, mercenary refill cost == missing population
          totalCost: totalMissing,
          bannerName: banner.name
        });
        return;
      }
    }

    if (banner.type === 'regular') {
      // Regular banner: Use normal training system (status: 'training')
      if (banner.status === 'training') return;

      setBanners((bs) => bs.map(b => {
        if (b.id !== bannerId) return b;

        const currentRecruited = b.squads.reduce((sum, s) => sum + s.currentSize, 0);
        const targetReqPop = b.squads.reduce((sum, s) => {
          const cat = unitCategory[s.type];
          return sum + (squadConfig[cat]?.reqPop || 10);
        }, 0);

        return {
          ...b,
          status: 'training',
          recruited: currentRecruited,
          reqPop: targetReqPop,
          reinforcingSquadId: squadId, // Track which squad is being reinforced, or undefined for all
        };
      }));
    }
  }

  // === Battle Simulation Functions ===
  // Unit stats state (can be updated with tested values from simulator)
  const [unitStats, setUnitStats] = useState<UnitStats>(() => {
    const saved = localStorage.getItem('gameUnitStats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...getDefaultUnitStats(), ...parsed };
      } catch (_e) {
        dbg.warn('Failed to parse saved unit stats, using defaults');
      }
    }
    return getDefaultUnitStats();
  });

  // Battle parameters state (can be updated from simulator) - MUST be before useEffect that uses setBattleParams
  const [battleParams, setBattleParams] = useState<BattleParams>(() => {
    const saved = localStorage.getItem('gameBattleParams');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (_e) {
        dbg.warn('Failed to parse saved battle params, using defaults');
      }
    }
    return getDefaultBattleParams();
  });

  // Listen for unit stats, battle params, and divisions updates from the combat simulator
  useEffect(() => {
    const handleStatsUpdate = (event: CustomEvent) => {
      const { stats, battleParams: newParams, divisions } = event.detail;
      if (stats) {
        setUnitStats(stats);
        localStorage.setItem('gameUnitStats', JSON.stringify(stats));
      }
      if (newParams) {
        setBattleParams(newParams);
        localStorage.setItem('gameBattleParams', JSON.stringify(newParams));
      }
      if (divisions) {
        localStorage.setItem('gameDivisions', JSON.stringify(divisions));
      }
    };

    window.addEventListener('unitStatsUpdated', handleStatsUpdate as EventListener);
    return () => {
      window.removeEventListener('unitStatsUpdated', handleStatsUpdate as EventListener);
    };
  }, []);

  // Helper to compute total from enemyComposition (works with both old {warrior, archer} and new Division format)
  function getEnemyTotal(comp: Division | { warrior?: number; archer?: number } | undefined): number {
    if (!comp) return 0;
    let sum = 0;
    for (const key in comp) {
      sum += (comp as any)[key] || 0;
    }
    return sum;
  }

  function handleBlacksmithUpgrade(_itemId: string, cost: { iron: number; gold: number }) {
    setWarehouse((w) => ({
      ...w,
      iron: Math.max(0, w.iron - cost.iron),
      gold: Math.max(0, w.gold - cost.gold),
    }));
    // TODO: Update actual gear levels in your game state
  }
  function handleStartResearch(_techId: string, cost: number) {
    setSkillPoints(prev => Math.max(0, prev - cost));
    // TODO: Track research state if needed
  }
  function handleCompleteResearch(_techId: string) {
    // TODO: Apply technology effects when implemented
  }
  function requestTownHallUpgrade(currentLevel: number) {
    const to = currentLevel + 1;
    if (to > 3) return;
    const c = getTownHallCost(to);
    setPendingUpgrade({ res: "townhall", from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }
  function requestBarracksUpgrade(currentLevel: number) {
    if (!barracks) return;
    const to = currentLevel + 1;
    if (to > 3) return;
    const c = getBarracksCost(to);
    setPendingUpgrade({ res: "barracks", from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }
  function requestTavernUpgrade(currentLevel: number) {
    if (!tavern) return;
    const to = currentLevel + 1;
    if (to > 3) return;
    const c = getTavernCost(to);
    setPendingUpgrade({ res: "tavern", from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }
  function requestMilitaryAcademyUpgrade(currentLevel: number) {
    if (!militaryAcademy) return;
    const to = currentLevel + 1;
    if (to > 3) return;
    const c = getMilitaryAcademyCost(to);
    setPendingUpgrade({ res: "militaryAcademy", from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }
  function buildMilitaryAcademy() {
    if (!canBuildMilitaryAcademy(townHall.level)) return;
    if (militaryAcademy) return; // Already built
    const cost = getMilitaryAcademyBuildCost();
    if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return;

    // Pay the cost
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));

    // Build the military academy
    setMilitaryAcademy({
      level: 1,
    });
  }
  function buildBarracks() {
    if (!canBuildBarracks(townHall.level)) return;
    if (barracks) return; // Already built
    const cost = getBarracksBuildCost();
    if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return;

    // Pay the cost
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));

    // Build the barracks
    setBarracks({
      level: 1,
      trainingSlots: getMaxTrainingSlots(1),
      maxTemplates: 3,
      trainingQueue: [],
    });
  }
  function buildTavern() {
    if (!canBuildTavern(townHall.level)) return;
    if (tavern) return; // Already built
    const cost = getTavernBuildCost();
    if (warehouse.wood < cost.wood || warehouse.stone < cost.stone) return;

    // Pay the cost
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));

    // Build the tavern
    setTavern({
      level: 1,
      activeFestival: false,
      festivalEndTime: 0,
    });
  }

  // Commander recruitment and assignment
  const [commanderRecruitModal, setCommanderRecruitModal] = useState<boolean>(false);
  const [commanderAssignModal, setCommanderAssignModal] = useState<{ commanderId: number | null; bannerId?: number } | null>(null);
  const [candidateNames, setCandidateNames] = useState<Record<CommanderArchetype, string>>({
    ranged_specialist: '',
    melee_specialist: '',
    balanced_leader: ''
  });

  // Generate candidate names when modal opens
  useEffect(() => {
    if (commanderRecruitModal) {
      setCandidateNames({
        ranged_specialist: generateCommanderName('ranged_specialist'),
        melee_specialist: generateCommanderName('melee_specialist'),
        balanced_leader: generateCommanderName('balanced_leader')
      });
    }
  }, [commanderRecruitModal]);

  function recruitCommander(archetype: CommanderArchetype) {
    const maxCommanders = militaryAcademy?.level || 0;
    const currentCommanders = commanders.length;

    if (currentCommanders >= maxCommanders) {
      dbg.warn('[COMMANDER] Cannot recruit: max commanders reached');
      return;
    }

    const config = COMMANDER_ARCHETYPES[archetype];
    const initialLevel = 1;
    const newCommander: Commander = {
      id: commanderSeq,
      name: generateCommanderName(archetype),
      archetype,
      rangedAttackBonusPercent: config.rangedBonus,
      meleeAttackBonusPercent: config.meleeBonus,
      assignedBannerId: null,
      level: initialLevel,
      currentXP: 0,
      xpToNextLevel: calculateCommanderXPToNextLevel(initialLevel),
    };

    setCommanders([...commanders, newCommander]);
    setCommanderSeq(commanderSeq + 1);
    setCommanderRecruitModal(false);
  }

  function assignCommanderToBanner(commanderId: number, bannerId: number) {
    setCommanders(prevCommanders => prevCommanders.map(c =>
      c.id === commanderId ? { ...c, assignedBannerId: bannerId } : c
    ));
    setBanners(prevBanners => prevBanners.map(b =>
      b.id === bannerId ? { ...b, commanderId } : b
    ));
    // Ensure the draft reflects the change if we are currently editing this banner
    setBannersDraft(prevDraft => {
      if (prevDraft && prevDraft.id === bannerId) {
        return { ...prevDraft, commanderId };
      }
      return prevDraft;
    });
    setCommanderAssignModal(null);
    saveGame();
  }

  function unassignCommander(commanderId: number) {
    setCommanders(prevCommanders => {
      const commander = prevCommanders.find(c => c.id === commanderId);
      if (!commander || !commander.assignedBannerId) return prevCommanders;

      return prevCommanders.map(c =>
        c.id === commanderId ? { ...c, assignedBannerId: null } : c
      );
    });
    setBanners(prevBanners => prevBanners.map(b =>
      b.commanderId === commanderId ? { ...b, commanderId: null } : b
    ));
  }
  function startFestival() {
    if (!tavern || tavern.activeFestival) return;
    const cost = 50; // Gold cost
    if (warehouse.gold < cost) return;

    setWarehouse(w => ({ ...w, gold: w.gold - cost }));
    setTavern(prev => prev ? {
      ...prev,
      activeFestival: true,
      festivalEndTime: Date.now() + 300000, // 5 minutes
    } : null);
  }
  function startBarracksTraining(templateId: string) {
    dbg.log('[HIRE DEBUG] Starting hire for template:', templateId);
    const template = bannerTemplates.find(t => t.id === templateId);
    if (!template) {
      dbg.error('[HIRE DEBUG] Template not found:', templateId);
      return;
    }

    // Use functional updates to prevent stale state and race conditions
    setBarracks(prev => {
      if (!prev) {
        dbg.warn('[HIRE DEBUG] Barracks is null');
        return prev;
      }
      if (prev.trainingQueue.length >= prev.trainingSlots) {
        dbg.warn('[HIRE DEBUG] Training slots full:', prev.trainingQueue.length, '/', prev.trainingSlots);
        return prev;
      }

      // Check if this template is already in the queue (prevent duplicates)
      if (prev.trainingQueue.some(job => job.templateId === templateId)) {
        dbg.warn('[HIRE DEBUG] Already hiring this template');
        return prev; // Already hiring this template
      }

      // Check if player has enough gold
      if (warehouse.gold < template.cost) {
        dbg.warn('[HIRE DEBUG] Not enough gold. Have:', warehouse.gold, 'Need:', template.cost);
        return prev;
      }

      // Pay the cost immediately
      setWarehouse(w => ({ ...w, gold: Math.max(0, w.gold - template.cost) }));

      const newHiring: TrainingEntry = {
        id: Date.now(),
        type: 'mercenary',
        templateId,
        arrivalTime: 5, // 5 seconds arrival time
        elapsedTime: 0,
        status: 'arriving',
        soldiersNeeded: 0,
        soldiersTrained: 0,
      };

      dbg.log('[HIRE DEBUG] Job created:', newHiring);
      return {
        ...prev,
        trainingQueue: [...prev.trainingQueue, newHiring],
      };
    });
  }

  // === Worker demand and assignment ===
  const workerDemand = useMemo(() => {
    let total = 0;
    if (lumberMill.enabled) total += lumberMill.level;
    if (quarry.enabled) total += quarry.level;
    if (farm.enabled) total += farm.level;
    if (ironMine.enabled) total += ironMine.level;
    return total;
  }, [lumberMill.enabled, lumberMill.level, quarry.enabled, quarry.level, farm.enabled, farm.level, ironMine.enabled, ironMine.level]);

  // Calculate actual assigned workers across all resource buildings
  const totalAssignedWorkers = useMemo(() => {
    return lumberMill.workers + quarry.workers + farm.workers + ironMine.workers;
  }, [lumberMill.workers, quarry.workers, farm.workers, ironMine.workers]);

  // Count of banners currently in training (for slot limit checks)
  const trainingBannerCount = useMemo(() =>
    banners.filter(b => b.type === 'regular' && b.status === 'training').length,
    [banners]
  );

  // === Population Breakdown (for visualization) ===
  // Locked workers: only 1 total (from the farm - minimum to keep it running)
  const lockedWorkers = useMemo(() => {
    // Only count 1 locked worker total (from farm)
    return farm.enabled && farm.workers > 0 ? 1 : 0;
  }, [farm.enabled, farm.workers]);

  // Buffer workers: all other workers assigned to buildings (beyond the 1 locked)
  const bufferWorkers = useMemo(() => {
    return Math.max(0, totalAssignedWorkers - 1); // Subtract the 1 locked worker
  }, [totalAssignedWorkers]);

  // Free population: unassigned people
  const freePop = useMemo(() => {
    return Math.max(0, population - lockedWorkers - bufferWorkers);
  }, [population, lockedWorkers, bufferWorkers]);

  // Ensure breakdown doesn't exceed capacity (safety clamp) - memoized
  const clampedLocked = useMemo(() => Math.min(lockedWorkers, popCap), [lockedWorkers, popCap]);
  const clampedBuffer = useMemo(() => Math.min(bufferWorkers, Math.max(0, popCap - clampedLocked)), [bufferWorkers, popCap, clampedLocked]);
  const clampedFree = useMemo(() => Math.min(freePop, Math.max(0, popCap - clampedLocked - clampedBuffer)), [freePop, popCap, clampedLocked, clampedBuffer]);

  const workerSurplus = useMemo(() => population - workerDemand, [population, workerDemand]);
  const workerDeficit = workerSurplus < 0 ? -workerSurplus : 0;

  // Emergency mechanic: Ensure farm is always enabled (population is always >= 1)
  useEffect(() => {
    if (population >= 1 && !farm.enabled) {
      setFarm(b => ({ ...b, enabled: true }));
    }
  }, [population, farm.enabled]);

  // Assign workers evenly across enabled buildings
  // Emergency mechanic: Farm ALWAYS gets exactly 1 worker if population >= 1, and this worker cannot be reassigned
  useEffect(() => {
    // Emergency: Farm must always be enabled (population is always >= 1)
    if (population >= 1 && !farm.enabled) {
      setFarm(b => ({ ...b, enabled: true }));
      return; // Will re-run after farm is enabled
    }

    const enabledBuildings = [
      { type: 'wood' as const, level: lumberMill.level, enabled: lumberMill.enabled },
      { type: 'stone' as const, level: quarry.level, enabled: quarry.enabled },
      { type: 'food' as const, level: farm.level, enabled: farm.enabled },
      { type: 'iron' as const, level: ironMine.level, enabled: ironMine.enabled },
    ].filter(b => b.enabled);

    // Emergency: If no buildings enabled, at least enable farm (population is always >= 1)
    if (enabledBuildings.length === 0) {
      setFarm(b => ({ ...b, enabled: true, workers: 1 }));
      setLumberMill(b => ({ ...b, workers: 0 }));
      setQuarry(b => ({ ...b, workers: 0 }));
      setIronMine(b => ({ ...b, workers: 0 }));
      return;
    }

    let availableWorkers = Math.max(0, population);

    // EMERGENCY MECHANIC: Farm ALWAYS gets at least 1 worker if population >= 1
    // This worker is reserved and cannot be reassigned to other buildings
    let farmWorkers = 0;
    if (population >= 1 && farm.enabled) {
      farmWorkers = 1;
      availableWorkers = Math.max(0, availableWorkers - 1);
    }

    // Create assignments for ALL enabled buildings
    // Farm starts at 1 (emergency), others start at 0
    const assignments: { type: 'wood' | 'stone' | 'food' | 'iron'; workers: number; level: number }[] = enabledBuildings.map(b => ({
      type: b.type,
      workers: b.type === 'food' ? farmWorkers : 0, // Farm starts with its emergency worker
      level: b.level,
    }));

    // Distribute remaining workers to ALL buildings (round-robin, including farm)
    // Farm can get additional workers up to its level
    let remaining = availableWorkers;
    let buildingIndex = 0;
    while (remaining > 0 && buildingIndex < assignments.length * 10) { // safety limit
      const assignment = assignments[buildingIndex % assignments.length];
      if (assignment.workers < assignment.level) {
        assignment.workers += 1;
        remaining -= 1;
      }
      buildingIndex += 1;
      // If all buildings are at max, break
      if (assignments.every(a => a.workers >= a.level)) break;
    }

    // Apply assignments - all buildings get their assigned workers
    assignments.forEach(a => {
      if (a.type === 'wood') setLumberMill(b => ({ ...b, workers: a.workers }));
      if (a.type === 'stone') setQuarry(b => ({ ...b, workers: a.workers }));
      if (a.type === 'food') setFarm(b => ({ ...b, workers: a.workers }));
      if (a.type === 'iron') setIronMine(b => ({ ...b, workers: a.workers }));
    });
  }, [population, lumberMill.level, lumberMill.enabled, quarry.level, quarry.enabled, farm.level, farm.enabled, ironMine.level, ironMine.enabled]);

  // === Production Bonuses ===
  const happinessProductionBonus = useMemo(() => {
    if (happiness >= 70) return 1.05; // +5% to all production
    if (tavern?.level === 3) return 1.05; // Tavern L3 bonus
    return 1.0;
  }, [happiness, tavern?.level]);

  // === Derived rates & caps (scaled by workers) ===
  const lumberRate = useMemo(() => {
    if (!lumberMill.enabled || lumberMill.workers === 0) return 0;
    const effectiveLevel = Math.min(lumberMill.level, lumberMill.workers);
    const baseRate = getProgression("wood", effectiveLevel, "production");
    return baseRate * happinessProductionBonus;
  }, [lumberMill.level, lumberMill.workers, lumberMill.enabled, happinessProductionBonus]);

  const stoneRate = useMemo(() => {
    if (!quarry.enabled || quarry.workers === 0) return 0;
    const effectiveLevel = Math.min(quarry.level, quarry.workers);
    const baseRate = getProgression("stone", effectiveLevel, "production");
    return baseRate * happinessProductionBonus;
  }, [quarry.level, quarry.workers, quarry.enabled, happinessProductionBonus]);

  const foodRate = useMemo(() => {
    if (!farm.enabled || farm.workers === 0) return 0;
    const effectiveLevel = Math.min(farm.level, farm.workers);
    const baseRate = getProgression("food", effectiveLevel, "production");
    return baseRate * happinessProductionBonus;
  }, [farm.level, farm.workers, farm.enabled, happinessProductionBonus]);

  const ironRate = useMemo(() => {
    if (!ironMine.enabled || ironMine.workers === 0) return 0;
    const effectiveLevel = Math.min(ironMine.level, ironMine.workers);
    const baseRate = getProgression("iron", effectiveLevel, "production");
    return baseRate * happinessProductionBonus;
  }, [ironMine.level, ironMine.workers, ironMine.enabled, happinessProductionBonus]);

  // === Food consumption ===
  const foodConsumption = useMemo(() => population, [population]); // 1 food per worker per second
  const netFoodRate = useMemo(() => foodRate - foodConsumption, [foodRate, foodConsumption]);

  const lumberCap = useMemo(() => getProgression("wood", lumberMill.level, "capacity"), [lumberMill.level]);
  const stoneCap = useMemo(() => getProgression("stone", quarry.level, "capacity"), [quarry.level]);
  const foodCap = useMemo(() => getProgression("food", farm.level, "capacity"), [farm.level]);
  const ironCap = useMemo(() => getProgression("iron", ironMine.level, "capacity"), [ironMine.level]);

  // === Gold Income Calculation ===
  // Gold income scales with population, with 50 population as the reference point
  const goldIncomePerSecond = useMemo(() => {
    const referencePopulation = 50; // Reference population for gold calculation
    const baseGoldPerSecondAtNormalTax = 1.0; // Base gold/sec at Normal tax with 50 population

    // Effective population ensures we never use zero (minimum 1)
    const effectivePopulation = Math.max(1, population);

    // Population factor: how much the current population scales the base income
    const populationFactor = effectivePopulation / referencePopulation;

    // Tax multiplier (same as before)
    let taxMultiplier = 1.0;
    if (tax === 'very_low') taxMultiplier = 0.6;
    else if (tax === 'low') taxMultiplier = 0.85;
    else if (tax === 'normal') taxMultiplier = 1.0;
    else if (tax === 'high') taxMultiplier = 1.25;
    else if (tax === 'very_high') taxMultiplier = 1.5;

    // Final formula: base * populationFactor * taxMultiplier
    return baseGoldPerSecondAtNormalTax * populationFactor * taxMultiplier;
  }, [tax, population]);

  // === Tick loop (1s) ===
  useEffect(() => {
    const id = setInterval(() => {
      // Gold income from taxes
      setWarehouse((w) => ({
        ...w,
        gold: Math.min(warehouseCap.gold, w.gold + goldIncomePerSecond)
      }));

      // production fill
      setLumberMill((b) => ({ ...b, stored: Math.min(lumberCap, b.stored + lumberRate) }));
      setQuarry((b) => ({ ...b, stored: Math.min(stoneCap, b.stored + stoneRate) }));
      setIronMine((b) => ({ ...b, stored: Math.min(ironCap, b.stored + ironRate) }));

      // Food production and consumption
      setFarm((b) => {
        // First, add production
        const afterProduction = Math.min(foodCap, b.stored + foodRate);
        // Then, consume from farm storage first
        const consumedFromFarm = Math.min(afterProduction, foodConsumption);
        const remainingConsumption = foodConsumption - consumedFromFarm;
        const newFarmStored = Math.max(0, afterProduction - consumedFromFarm);

        // Consume remaining from warehouse
        setWarehouse((w) => {
          const consumedFromWarehouse = Math.min(w.food, remainingConsumption);
          return { ...w, food: Math.max(0, w.food - consumedFromWarehouse) };
        });

        return { ...b, stored: newFarmStored };
      });

      // population drift + training consumption + starvation
      // EMERGENCY RULE: Population can never be zero, minimum is 1
      let nextPop = Math.max(1, Math.min(popCap, population + netPopulationChange));

      // If food reaches zero and net food rate is negative, decrease population by 1/sec
      // But never below 1 (emergency rule)
      const totalFood = warehouse.food + farm.stored;
      if (totalFood <= 0 && netFoodRate < 0) {
        nextPop = Math.max(1, nextPop - 1);
      }

      let bannersChanged = false;
      const nextBanners = banners.map((b) => ({
        ...b,
        squads: b.squads ? b.squads.map(s => ({ ...s })) : []
      }));

      // Track available iron (updated as we consume it)
      let availableIron = warehouse.iron;

      // Get max training slots for regular banners
      const maxTrainingSlots = barracks ? getMaxTrainingSlots(barracks.level) : 0;

      // Get all regular banners that are training, sorted by ID (first come, first served)
      const trainingBanners = nextBanners
        .filter(b => b.type === 'regular' && b.status === 'training' && !b.trainingPaused && b.recruited < b.reqPop)
        .sort((a, b) => a.id - b.id); // Process in order of creation

      // Only process the first N banners (up to max slots)
      const bannersToProcess = trainingBanners.slice(0, maxTrainingSlots);

      // Process each banner sequentially (only the first ones get population)
      for (const banner of bannersToProcess) {
        if (nextPop <= 1) break; // Emergency rule: keep at least 1 population

        // Check recruitment mode
        const currentActualWorkers = lumberMill.workers + quarry.workers + farm.workers;
        const currentFreeWorkers = Math.max(0, nextPop - currentActualWorkers);

        const canRecruit = recruitmentMode === 'regular'
          ? currentFreeWorkers > 0  // Regular: only use free workers (keep at least 1 free)
          : true;  // Forced: can use working workers too (but still keep at least 1 total pop)

        if (canRecruit) {
          const bannerIndex = nextBanners.findIndex(b => b.id === banner.id);
          if (bannerIndex !== -1) {
            // Ensure squads are initialized
            if (!nextBanners[bannerIndex].squads || nextBanners[bannerIndex].squads.length === 0) {
              const { squads } = initializeSquadsFromUnits(nextBanners[bannerIndex].units, squadSeqRef.current);
              nextBanners[bannerIndex].squads = squads.map(s => ({ ...s }));
              bannersChanged = true;
            }

            // Update squad currentSize as training progresses
            if (nextBanners[bannerIndex].squads && nextBanners[bannerIndex].squads.length > 0) {
              let totalIronCost = 0;
              let unitsTrained = 0;
              let unitsToTrain: Array<{ squadId: number; count: number }> = [];

              if (nextBanners[bannerIndex].reinforcingSquadId !== undefined) {
                // Reinforcement: update specific squad
                const squadToReinforce = nextBanners[bannerIndex].squads.find(s => s.id === nextBanners[bannerIndex].reinforcingSquadId);
                if (squadToReinforce && squadToReinforce.currentSize < squadToReinforce.maxSize) {
                  const ironCostPerUnit = getIronCostPerUnit(squadToReinforce.type);
                  if (availableIron >= ironCostPerUnit) {
                    totalIronCost = ironCostPerUnit;
                    unitsTrained = 1;
                    unitsToTrain.push({ squadId: squadToReinforce.id, count: 1 });
                  }
                }
              } else {
                // New training: distribute recruited population across squads (1 per second per squad)
                let remainingToAssign = 1; // We recruited 1 person this second
                for (let i = 0; i < nextBanners[bannerIndex].squads.length && remainingToAssign > 0; i++) {
                  const squad = nextBanners[bannerIndex].squads[i];
                  if (squad.currentSize < squad.maxSize) {
                    const canAdd = Math.min(remainingToAssign, squad.maxSize - squad.currentSize);
                    const ironCostPerUnit = getIronCostPerUnit(squad.type);
                    const totalCostForSquad = ironCostPerUnit * canAdd;

                    if (availableIron >= totalIronCost + totalCostForSquad) {
                      totalIronCost += totalCostForSquad;
                      unitsTrained += canAdd;
                      unitsToTrain.push({ squadId: squad.id, count: canAdd });
                      remainingToAssign -= canAdd;
                    } else {
                      // Not enough iron - can't train this unit
                      break;
                    }
                  }
                }
              }

              // Only proceed if we have enough iron and can train at least one unit
              // Note: totalIronCost can be 0 for militia (free units), so we check unitsTrained > 0
              if (unitsTrained > 0 && availableIron >= totalIronCost) {
                // Consume iron (update local tracker and state)
                availableIron -= totalIronCost;
                setWarehouse(w => ({ ...w, iron: Math.max(0, w.iron - totalIronCost) }));

                // Consume population and update squads
                nextBanners[bannerIndex].recruited += 1; // 1 pop / sec / training banner
                nextPop = Math.max(1, nextPop - 1);
                bannersChanged = true;

                // Update squad sizes (create new squad objects for React)
                nextBanners[bannerIndex].squads = nextBanners[bannerIndex].squads.map(squad => {
                  const toTrain = unitsToTrain.find(ut => ut.squadId === squad.id);
                  if (toTrain) {
                    return { ...squad, currentSize: Math.min(squad.maxSize, squad.currentSize + toTrain.count) };
                  }
                  return squad;
                });

                // Show feedback if iron was consumed
                setIronConsumptionFeedback({
                  message: `-${totalIronCost.toFixed(1)} Iron (retraining ${unitsTrained} unit${unitsTrained > 1 ? 's' : ''})`,
                  timestamp: Date.now()
                });
                // Clear feedback after 2 seconds
                setTimeout(() => {
                  setIronConsumptionFeedback(prev => {
                    // Only clear if it's the same feedback (prevent race conditions)
                    if (prev && Date.now() - prev.timestamp >= 2000) {
                      return null;
                    }
                    return prev;
                  });
                }, 2000);
              }
            } else {
              // No squads initialized yet, just consume population (shouldn't happen, but handle gracefully)
              nextBanners[bannerIndex].recruited += 1;
              nextPop = Math.max(1, nextPop - 1);
              bannersChanged = true;
            }
          }
        }
      }

      // Check for completed training
      nextBanners.forEach((bb) => {
        if (bb.status === 'training' && bb.recruited >= bb.reqPop) {
          // Ensure squads are initialized
          if (!bb.squads || bb.squads.length === 0) {
            const { squads } = initializeSquadsFromUnits(bb.units, squadSeqRef.current);
            bb.squads = squads.map(s => ({ ...s }));
            bannersChanged = true;
          }

          // Also verify all squads are at full strength
          if (bb.squads && bb.squads.length > 0) {
            const allSquadsFull = bb.squads.every(squad => squad.currentSize >= squad.maxSize);
            if (allSquadsFull) {
              bb.status = 'ready';
              bb.reinforcingSquadId = undefined; // Clear reinforcement tracking
              bannersChanged = true;
            }
          }
        }
      });

      if (bannersChanged) setBanners(nextBanners);

      // Update population after training consumption
      setPopulation(nextPop);

      // missions
      let missionsChanged = false;
      let capturedBannerXP: Mission['bannerXP'] = undefined;
      const nextMissions = missions.map((m) => {
        if (m.status !== 'running') return m;
        const elapsed = m.elapsed + 1;
        if (elapsed >= m.duration) {
          // Run combat for missions with enemy composition
          let battleResult: BattleResult | undefined = undefined;
          if (m.enemyComposition && m.deployed.length > 0) {
            const playerBanner = banners.find(b => b.id === m.deployed[0]);
            if (playerBanner) {
              // Ensure banner has squads initialized (use ref for closure access)
              let bannerWithSquads = playerBanner;
              if (!bannerWithSquads.squads || bannerWithSquads.squads.length === 0) {
                const { squads, nextSeq } = initializeSquadsFromUnits(bannerWithSquads.units, squadSeqRef.current);
                bannerWithSquads = { ...bannerWithSquads, squads };
                setSquadSeq(nextSeq);
                squadSeqRef.current = nextSeq;
              }

              // Convert banner squads to division format (use currentSize, not maxSize)
              const playerDiv: Division = {};
              bannerWithSquads.squads.forEach(squad => {
                const unitType = squad.type;
                playerDiv[unitType] = (playerDiv[unitType] || 0) + squad.currentSize;
              });
              // Get commander for this banner if assigned
              const bannerCommander = bannerWithSquads.commanderId
                ? commanders.find(c => c.id === bannerWithSquads.commanderId)
                : null;
              battleResult = simulateBattle(playerDiv, m.enemyComposition || {}, unitStats, battleParams, bannerCommander);

              // Calculate battle stats for XP
              const startTroops = bannerWithSquads.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
              const enemyCasualties = battleResult.enemyInitial.total - battleResult.enemyFinal.total;
              const isVictory = battleResult.winner === 'player';

              // Store old XP and level for battle report
              const oldXP = bannerWithSquads.xp || 0;
              const oldLevelInfo = bannerWithSquads.level !== undefined && bannerWithSquads.xpCurrentLevel !== undefined && bannerWithSquads.xpNextLevel !== undefined
                ? {
                  level: bannerWithSquads.level,
                  levelName: XP_LEVELS.find(l => l.level === bannerWithSquads.level)?.name || 'Green',
                  xpCurrentLevel: bannerWithSquads.xpCurrentLevel,
                  xpNextLevel: bannerWithSquads.xpNextLevel
                }
                : calculateLevelFromXP(oldXP);

              // Apply losses to banner
              const losses = calculateBannerLosses(bannerWithSquads, battleResult);
              let updatedBanner = distributeLossesToBanner(bannerWithSquads, losses);

              // Check if banner is destroyed (0 troops remaining)
              const totalTroops = updatedBanner.squads.reduce((sum, squad) => sum + squad.currentSize, 0);
              const bannerStatus = totalTroops === 0 ? 'destroyed' : 'ready';
              const survived = totalTroops > 0;
              const ownCasualties = startTroops - totalTroops;

              // Calculate banner XP gain (for commander)
              const bannerXPGain = calculateBannerXPGain(enemyCasualties, isVictory, survived);

              // Update banner XP
              updatedBanner = updateBannerXP(
                updatedBanner,
                enemyCasualties,
                ownCasualties,
                startTroops,
                isVictory,
                survived
              );

              // Store commander XP info for battle report (before update)
              let commanderXPInfo: { commanderId: number; commanderName: string; xpGained: number; oldLevel: number; newLevel: number; oldXP: number; newXP: number; xpToNextLevel: number } | undefined = undefined;
              if (bannerCommander) {
                const oldCommanderLevel = bannerCommander.level || 1;
                const oldCommanderXP = bannerCommander.currentXP || 0;
                const updatedCommander = updateCommanderXP(bannerCommander, bannerXPGain);
                const newCommanderLevel = updatedCommander.level;
                const newCommanderXP = updatedCommander.currentXP;
                const commanderXPGained = bannerXPGain; // Commanders get the same XP as banner gains

                commanderXPInfo = {
                  commanderId: bannerCommander.id,
                  commanderName: bannerCommander.name,
                  xpGained: commanderXPGained,
                  oldLevel: oldCommanderLevel,
                  newLevel: newCommanderLevel,
                  oldXP: oldCommanderXP,
                  newXP: newCommanderXP,
                  xpToNextLevel: updatedCommander.xpToNextLevel,
                };

                setCommanders((cs) => cs.map(c => c.id === bannerCommander.id ? updatedCommander : c));
              }

              // Calculate XP gained and new level info
              const newXP = updatedBanner.xp || 0;
              const xpGained = newXP - oldXP;
              const newLevelInfo = updatedBanner.level !== undefined && updatedBanner.xpCurrentLevel !== undefined && updatedBanner.xpNextLevel !== undefined
                ? {
                  level: updatedBanner.level,
                  levelName: XP_LEVELS.find(l => l.level === updatedBanner.level)?.name || 'Green',
                  xpCurrentLevel: updatedBanner.xpCurrentLevel,
                  xpNextLevel: updatedBanner.xpNextLevel
                }
                : calculateLevelFromXP(newXP);

              // Store XP info for battle report
              const bannerXPInfo = {
                bannerId: bannerWithSquads.id,
                bannerName: bannerWithSquads.name,
                xpGained,
                oldXP,
                newXP,
                oldLevel: oldLevelInfo.level,
                newLevel: newLevelInfo.level,
                oldLevelName: oldLevelInfo.levelName,
                newLevelName: newLevelInfo.levelName,
                xpCurrentLevel: newLevelInfo.xpCurrentLevel,
                xpNextLevel: newLevelInfo.xpNextLevel,
              };

              // Update banner in state with losses and XP applied
              setBanners((bs) => bs.map((b) =>
                b.id === bannerWithSquads.id ? { ...updatedBanner, status: bannerStatus } :
                  m.deployed.includes(b.id) ? { ...b, status: 'ready' } : b
              ));

              // Store XP info for later use in mission return
              capturedBannerXP = bannerXPInfo;

              // Show battle report with XP info
              setBattleReport({ missionId: m.id, result: battleResult, bannerXP: bannerXPInfo, commanderXP: commanderXPInfo });

              // Update leaderboard
              if (battleResult) {
                const enemyUnitsKilled = battleResult.enemyInitial.total - battleResult.enemyFinal.total;
                const isVictory = battleResult.winner === 'player';
                const leaderboardBattleResult: LeaderboardBattleResult = {
                  enemyUnitsKilled,
                  isVictory,
                  playerId: REAL_PLAYER_ID,
                  playerName: REAL_PLAYER_NAME,
                  faction: REAL_PLAYER_FACTION,
                };
                setLeaderboard(prev => updateLeaderboardFromBattleResult(prev, leaderboardBattleResult));
              }
            }
          } else {
            // No combat, just bring banners back (preserve destroyed status)
            setBanners((bs) => bs.map((b) =>
              m.deployed.includes(b.id) && b.status !== 'destroyed'
                ? { ...b, status: 'ready' }
                : b
            ));
          }

          // Check if player won the battle
          const isVictory = battleResult && battleResult.winner === 'player';

          if (isVictory) {
            // Player won - calculate rewards and set to pending
            const enemyTotal = getEnemyTotal(m.enemyComposition);
            // For non-combat missions, give a small base reward
            const baseGold = enemyTotal > 0 ? Math.max(1, Math.floor(enemyTotal * 2)) : 1;
            const rewards = {
              gold: baseGold,
              wood: enemyTotal > 0 ? Math.floor(enemyTotal * 0.5) : 0,
              stone: enemyTotal > 0 ? Math.floor(enemyTotal * 0.3) : 0
            };

            missionsChanged = true;
            return { ...m, status: 'completedRewardsPending', elapsed: m.duration, deployed: [], battleResult, bannerXP: capturedBannerXP, rewards };
          } else {
            // Player lost - no rewards, mission becomes available for retry
            missionsChanged = true;
            return { ...m, status: 'available', elapsed: m.duration, deployed: [], battleResult, bannerXP: capturedBannerXP, rewards: undefined, rewardTier: undefined };
          }
        }
        missionsChanged = true;
        return { ...m, elapsed };
      });
      if (missionsChanged) {
        setMissions(nextMissions as Mission[]);
        // Mission map positions are synced by the useEffect watching `missions`
      }

      // Unified training queue processing (mercenaries + reinforcements)
      // Use the same nextPop that was already modified by banner training
      if (barracks) {
        const completedMercenaryJobs: Array<{ templateId: string; jobId: number }> = [];
        // nextPop is already defined above and modified by banner training

        // Process the queue
        const updatedBarracks = (() => {
          if (!barracks) return null;

          // Count active training entries
          const activeTraining = barracks.trainingQueue.filter(e => e.status === 'training').length;
          const availableSlots = barracks.trainingSlots - activeTraining;

          // Move 'arriving' entries to 'training' if slots are available
          let slotsToFill = availableSlots;

          const updatedQueue = barracks.trainingQueue.map(job => {
            // Process mercenary 'arriving' entries
            if (job.type === 'mercenary' && job.status === 'arriving') {
              const newElapsed = job.elapsedTime + 1;
              if (newElapsed >= (job.arrivalTime || 0)) {
                // Mercenary arrival complete - will create banner outside state update
                dbg.log('[GAME LOOP] Mercenary job completed! ID:', job.id, 'Template:', job.templateId);
                completedMercenaryJobs.push({ templateId: job.templateId || '', jobId: job.id });
                return null; // Remove from queue
              }
              // Move to training if slot available
              if (slotsToFill > 0 && newElapsed >= (job.arrivalTime || 0)) {
                slotsToFill--;
                return { ...job, elapsedTime: newElapsed, status: 'training' as const };
              }
              return { ...job, elapsedTime: newElapsed };
            }

            // Process 'training' entries (both mercenary and reinforcement)
            if (job.status === 'training') {
              // For reinforcement entries, train soldiers (only mercenary banners use barracks queue)
              if (job.type === 'reinforcement' && job.bannerId !== undefined && job.squadId !== undefined) {
                const banner = banners.find(b => b.id === job.bannerId);
                const isMercenary = banner?.type === 'mercenary';

                // For mercenary banners, consume gold (1 per unit)
                // For regular banners, consume population
                if (isMercenary) {
                  // Consume gold if available
                  if (warehouse.gold >= 1 && job.soldiersTrained < job.soldiersNeeded) {
                    setWarehouse(w => ({ ...w, gold: Math.max(0, w.gold - 1) }));
                    const newTrained = job.soldiersTrained + 1;

                    // Update squad currentSize
                    setBanners((bs) => bs.map(b => {
                      if (b.id !== job.bannerId) return b;

                      // Ensure squads are initialized
                      let displaySquads = b.squads;
                      if (!displaySquads || displaySquads.length === 0) {
                        const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
                        displaySquads = squads;
                      }

                      return {
                        ...b,
                        squads: displaySquads.map(s =>
                          s.id === job.squadId ? { ...s, currentSize: Math.min(s.maxSize, s.currentSize + 1) } : s
                        )
                      };
                    }));

                    // Check if complete
                    if (newTrained >= job.soldiersNeeded) {
                      return null; // Remove from queue when complete
                    }

                    return { ...job, soldiersTrained: newTrained };
                  }
                  // No gold available, keep entry but don't progress
                  return job;
                } else {
                  // Regular banner: consume population AND iron if available (keep at least 1 population)
                  const squad = banner?.squads?.find(s => s.id === job.squadId);
                  if (squad && nextPop > 1 && job.soldiersTrained < job.soldiersNeeded) {
                    const ironCostPerUnit = getIronCostPerUnit(squad.type);

                    // Use availableIron from the main training loop (barracks processes after main training)
                    // But since setWarehouse batches updates, we need to check the current warehouse state
                    // For now, use warehouse.iron but this will be updated by the main training loop's setWarehouse calls
                    if (warehouse.iron >= ironCostPerUnit) {
                      // Consume iron
                      setWarehouse(w => ({ ...w, iron: Math.max(0, w.iron - ironCostPerUnit) }));

                      // Consume population
                      nextPop = Math.max(1, nextPop - 1);
                      const newTrained = job.soldiersTrained + 1;

                      // Update squad currentSize
                      setBanners((bs) => bs.map(b => {
                        if (b.id !== job.bannerId) return b;

                        // Ensure squads are initialized
                        let displaySquads = b.squads;
                        if (!displaySquads || displaySquads.length === 0) {
                          const { squads } = initializeSquadsFromUnits(b.units, squadSeqRef.current);
                          displaySquads = squads;
                        }

                        return {
                          ...b,
                          squads: displaySquads.map(s =>
                            s.id === job.squadId ? { ...s, currentSize: Math.min(s.maxSize, s.currentSize + 1) } : s
                          )
                        };
                      }));

                      // Show feedback
                      setIronConsumptionFeedback({
                        message: `-${ironCostPerUnit.toFixed(1)} Iron (retraining 1 unit)`,
                        timestamp: Date.now()
                      });
                      setTimeout(() => {
                        setIronConsumptionFeedback(prev => {
                          if (prev && Date.now() - prev.timestamp >= 2000) {
                            return null;
                          }
                          return prev;
                        });
                      }, 2000);

                      // Check if complete
                      if (newTrained >= job.soldiersNeeded) {
                        return null; // Remove from queue when complete
                      }

                      return { ...job, soldiersTrained: newTrained };
                    }
                    // Not enough iron available, keep entry but don't progress
                    return job;
                  }
                  // No population available, keep entry but don't progress
                  return job;
                }
              }

              // For mercenary entries in training (shouldn't happen, but handle gracefully)
              return job;
            }

            // Move 'arriving' reinforcement entries to 'training' if slots available
            if (job.type === 'reinforcement' && job.status === 'arriving' && slotsToFill > 0) {
              slotsToFill--;
              return { ...job, status: 'training' as const };
            }

            return job;
          }).filter(Boolean) as TrainingEntry[];

          return { ...barracks, trainingQueue: updatedQueue };
        })();

        // Update barracks state
        if (updatedBarracks) {
          setBarracks(updatedBarracks);
        }

        // Create banners for completed mercenary jobs
        const completedJobs = completedMercenaryJobs;

        // Create banners outside of barracks state update to prevent duplicates
        dbg.log('[BANNER DEBUG] Checking completedJobs:', completedJobs.length);
        if (completedJobs.length > 0) {
          dbg.log('[BANNER DEBUG] Processing', completedJobs.length, 'completed job(s)');

          // Prepare all new banners first
          const newBanners: Banner[] = [];
          let nextSeq = bannerSeq;

          completedJobs.forEach(({ templateId }) => {
            // Find template from current bannerTemplates (from dependency)
            const template = bannerTemplates.find(t => t.id === templateId);
            if (!template) {
              dbg.error('[BANNER DEBUG] Template not found:', templateId, 'Available:', bannerTemplates.map(t => t.id));
              return;
            }

            const squads: string[] = [];
            template.squads.forEach(s => {
              for (let i = 0; i < s.count; i++) {
                squads.push(s.type); // Each count is a squad
              }
            });

            // Initialize squads with health tracking (use ref for closure access)
            const { squads: squadObjects, nextSeq: newSquadSeq } = initializeSquadsFromUnits(squads, squadSeqRef.current);
            setSquadSeq(newSquadSeq);
            squadSeqRef.current = newSquadSeq;

            // Generate auto-name based on composition
            const bannerId = nextSeq++;
            const autoName = generateBannerName(bannerId, squadObjects);

            // Initialize XP for new mercenary banner
            const initialXP = 0;
            const initialLevelInfo = calculateLevelFromXP(initialXP);

            newBanners.push({
              id: bannerId,
              name: autoName,
              units: squads, // Keep for backward compatibility
              squads: squadObjects,
              status: 'ready',
              reqPop: template.requiredPopulation,
              recruited: template.requiredPopulation,
              type: 'mercenary', // Mark as mercenary banner
              customNamed: false, // Auto-generated name
              xp: initialXP,
              level: initialLevelInfo.level,
              xpCurrentLevel: initialLevelInfo.xpCurrentLevel,
              xpNextLevel: initialLevelInfo.xpNextLevel,
            });
          });

          // Update states separately to ensure React processes them correctly
          if (newBanners.length > 0) {
            dbg.log('[BANNER DEBUG] Creating', newBanners.length, 'banner(s):', newBanners.map(b => `${b.name} (id: ${b.id})`));

            // Update bannerSeq first
            setBannerSeq(nextSeq);

            // Then update banners state - use functional update to get latest state
            setBanners(bs => {
              const updated = [...bs, ...newBanners];
              dbg.log('[BANNER DEBUG] Banner state updated. Previous:', bs.length, 'New total:', updated.length, 'Banners:', updated.map(b => b.name));
              return updated;
            });
          } else {
            dbg.warn('[BANNER DEBUG] No banners created from', completedJobs.length, 'completed jobs');
          }
        }
      }

      // EMERGENCY RULE: Ensure population never goes below 1
      setPopulation(Math.max(1, nextPop));
    }, 1000);
    return () => clearInterval(id);
  }, [lumberRate, stoneRate, foodRate, foodConsumption, netFoodRate, lumberCap, stoneCap, foodCap, netPopulationChange, population, banners, missions, warehouse.food, warehouse.iron, farm.stored, popCap, barracks, bannerTemplates, bannerSeq, recruitmentMode, lumberMill.workers, quarry.workers, farm.workers, warehouseCap, goldIncomePerSecond, squadSeqRef]);

  // === Auto-save on banner changes ===
  useEffect(() => {
    const timer = setTimeout(() => {
      saveGame();
    }, 500); // Debounce auto-save to avoid excessive localStorage writes
    return () => clearTimeout(timer);
  }, [banners, warehouse, population]);

  // === Mission Cooldown Timer ===
  useEffect(() => {
    const missionsWithCooldown = missions.filter(m => m.cooldownEndTime && m.cooldownEndTime > Date.now());
    if (missionsWithCooldown.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setMissions((ms) => {
        return ms.map((m) => {
          if (m.cooldownEndTime && m.cooldownEndTime <= now) {
            // Cooldown expired - replace with new random mission from pool
            // Exclude all currently active mission IDs to avoid duplicates
            const currentMissionIds = ms.map(m => m.id);
            const newMissions = selectRandomMissions(1, BASE_MISSION_POOL, currentMissionIds);
            return newMissions[0] || m; // Fallback to current if no replacement found
          }
          return m;
        });
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [missions]);

  // Clamp resources if capacity changes
  useEffect(() => {
    setWarehouse((w) => ({
      ...w,
      wood: Math.min(w.wood, warehouseCap.wood),
      stone: Math.min(w.stone, warehouseCap.stone),
      food: Math.min(w.food, warehouseCap.food),
      iron: Math.min(w.iron, warehouseCap.iron),
      gold: Math.min(w.gold, warehouseCap.gold),
    }));
  }, [warehouseCap.wood, warehouseCap.stone, warehouseCap.food, warehouseCap.iron, warehouseCap.gold]);

  // === Warehouse free per type ===
  const warehouseFree: WarehouseState = {
    wood: warehouseCap.wood - warehouse.wood,
    stone: warehouseCap.stone - warehouse.stone,
    food: warehouseCap.food - warehouse.food,
    iron: warehouseCap.iron - warehouse.iron,
    gold: warehouseCap.gold - warehouse.gold,
  };

  // === Collection ===
  function collect(from: "wood" | "stone" | "food" | "iron") {
    setWarehouse((w) => {
      const clone = { ...w } as WarehouseState;
      if (from === "wood") clone.wood += Math.min(lumberMill.stored, warehouseFree.wood);
      if (from === "stone") clone.stone += Math.min(quarry.stored, warehouseFree.stone);
      if (from === "food") clone.food += Math.min(farm.stored, warehouseFree.food);
      if (from === "iron") clone.iron += Math.min(ironMine.stored, warehouseFree.iron);
      return clone;
    });
    if (from === "wood") setLumberMill((b) => ({ ...b, stored: 0 }));
    if (from === "stone") setQuarry((b) => ({ ...b, stored: 0 }));
    if (from === "food") setFarm((b) => ({ ...b, stored: 0 }));
    if (from === "iron") setIronMine((b) => ({ ...b, stored: 0 }));
  }

  function collectAll() {
    setWarehouse((w) => ({
      ...w,
      wood: w.wood + Math.min(lumberMill.stored, warehouseFree.wood),
      stone: w.stone + Math.min(quarry.stored, warehouseFree.stone),
      food: w.food + Math.min(farm.stored, warehouseFree.food),
      iron: w.iron + Math.min(ironMine.stored, warehouseFree.iron),
    }));
    setLumberMill((b) => ({ ...b, stored: 0 }));
    setQuarry((b) => ({ ...b, stored: 0 }));
    setFarm((b) => ({ ...b, stored: 0 }));
    setIronMine((b) => ({ ...b, stored: 0 }));
  }

  // === Upgrade flows with confirmation ===
  const [pendingUpgrade, setPendingUpgrade] = useState<
    | null
    | { res: "wood" | "stone" | "food" | "iron" | "warehouse" | "house" | "townhall" | "barracks" | "tavern" | "militaryAcademy"; from: number; to: number; cost: { wood: number; stone: number } }
  >(null);

  function requestUpgrade(res: "wood" | "stone" | "food" | "iron" | "warehouse" | "house", currentLevel: number) {
    if (res === "warehouse") {
      const to = currentLevel + 1;
      const c = getWarehouseCost(to);
      setPendingUpgrade({ res, from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
      return;
    }
    if (res === "house") {
      const to = currentLevel + 1;
      const c = getHouseCost(to);
      setPendingUpgrade({ res, from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
      return;
    }
    const to = currentLevel + 1;
    const c = getBuildingCost(res, to);
    setPendingUpgrade({ res, from: currentLevel, to, cost: { wood: c.wood, stone: c.stone } });
  }

  function confirmUpgrade() {
    if (!pendingUpgrade) return;
    const { res, to, cost } = pendingUpgrade;

    if (res === "warehouse") {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setWarehouseLevel(to);
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "house") {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setHouse(to);
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "townhall") {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setTownHall({ level: to as TownHallLevel });
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "barracks" && barracks) {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setBarracks({
        ...barracks,
        level: to,
        trainingSlots: getMaxTrainingSlots(to),
        maxTemplates: to * 2,
      });
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "tavern" && tavern) {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setTavern({ ...tavern, level: to });
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    if (res === "militaryAcademy" && militaryAcademy) {
      setWarehouse((w) => ({
        ...w,
        wood: Math.max(0, w.wood - cost.wood),
        stone: Math.max(0, w.stone - cost.stone),
      }));
      setMilitaryAcademy({ ...militaryAcademy, level: to });
      setPendingUpgrade(null);
      saveGame(); // Save after upgrade
      return;
    }

    // Building upgrades, deduct both wood & stone per doc
    setWarehouse((w) => ({
      ...w,
      wood: Math.max(0, w.wood - cost.wood),
      stone: Math.max(0, w.stone - cost.stone),
    }));
    if (res === "wood") setLumberMill((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("wood", to, "capacity")), workers: b.enabled ? Math.min(to, b.workers) : 0 }));
    if (res === "stone") setQuarry((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("stone", to, "capacity")), workers: b.enabled ? Math.min(to, b.workers) : 0 }));
    if (res === "food") setFarm((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("food", to, "capacity")), workers: b.enabled ? Math.min(to, b.workers) : 0 }));
    if (res === "iron") setIronMine((b) => ({ ...b, level: to, stored: Math.min(b.stored, getProgression("iron", to, "capacity")), workers: b.enabled ? Math.min(to, b.workers) : 0 }));
    setPendingUpgrade(null);
    saveGame(); // Save after building upgrade
  }

  function cancelUpgrade() { setPendingUpgrade(null); }

  // Handle escape key and prevent body scroll when modal is open
  useEffect(() => {
    if (!pendingUpgrade) {
      // Don't reset overflow when modal closes - let CSS handle it
      return;
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelUpgrade();
      }
    };

    document.addEventListener("keydown", handleEscape);
    // Only prevent scroll when modal is actually open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      // Restore original overflow state
      document.body.style.overflow = originalOverflow;
    };
  }, [pendingUpgrade]);

  // === Building enable/disable ===
  function toggleBuilding(building: 'wood' | 'stone' | 'food' | 'iron') {
    if (building === 'wood') {
      setLumberMill(b => ({ ...b, enabled: !b.enabled, workers: 0 })); // Workers will be reassigned by useEffect
    }
    if (building === 'stone') {
      setQuarry(b => ({ ...b, enabled: !b.enabled, workers: 0 })); // Workers will be reassigned by useEffect
    }
    if (building === 'iron') {
      setIronMine(b => ({ ...b, enabled: !b.enabled, workers: 0 })); // Workers will be reassigned by useEffect
    }
    if (building === 'food') {
      // Emergency mechanic: Prevent disabling farm (population is always >= 1)
      // Farm must always be enabled to maintain minimum food production
      // Don't allow disabling - farm is critical for survival
      return;
    }
  }

  // === UI bits ===
  const RES_META: Record<"wood" | "stone" | "food" | "iron", { name: string; short: "W" | "S" | "F" | "I" }> = {
    wood: { name: "Wood", short: "W" },
    stone: { name: "Stone", short: "S" },
    food: { name: "Food", short: "F" },
    iron: { name: "Iron", short: "I" },
  };

  function formatInt(n: number) { return Math.floor(n).toLocaleString(); }

  function formatCap(n: number) { return Math.floor(n).toLocaleString(); }
  function pct(a: number, b: number) { return Math.max(0, Math.min(100, Math.floor((a / b) * 100))); }
  function formatShort(n: number) {
    const abs = Math.floor(n);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}K`;
    return abs.toLocaleString();
  }

  function formatRate(rate: number): string {
    const abs = Math.abs(rate);
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
    if (abs >= 1) return abs.toFixed(1);
    return abs.toFixed(2);
  }

  function RowBar({ value, max, label }: { value: number; max: number; label?: string }) {
    const p = pct(value, max);
    const barHeight = label ? 'h-4 sm:h-5' : 'h-1.5';
    return (
      <div className={`${barHeight} rounded bg-slate-800 overflow-hidden relative flex items-center`}>
        <div className="h-full bg-sky-500" style={{ width: `${p}%` }} />
        {label && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] sm:text-[10px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              {label}
            </span>
          </div>
        )}
      </div>
    );
  }

  function CostBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return <span className={`text-[10px] font-semibold ${ok ? "text-emerald-600" : "text-red-600"}`}>{children}</span>;
  }

  // === Top resource strip ===
  // === Population Pill with Breakdown Visualization ===
  function PopulationPill({
    value,
    cap,
    rate: _rate,
    trend,
    trendTooltip,
    trendColor,
    statusColor,
    lockedWorkers,
    bufferWorkers,
    freePop
  }: {
    value: number;
    cap: number;
    rate: number;
    trend?: string;
    trendTooltip?: string;
    trendColor?: string;
    statusColor?: 'red' | 'yellow' | 'green';
    lockedWorkers: number;
    bufferWorkers: number;
    freePop: number;
  }) {
    const valueColor = statusColor === 'red' ? 'text-red-500' : statusColor === 'yellow' ? 'text-yellow-500' : statusColor === 'green' ? 'text-emerald-500' : '';

    // Memoize bar calculations - only recalculate when INTEGER population changes
    const barCalculations = useMemo(() => {
      // Calculate percentages for the stacked bar relative to CAPACITY
      // Each segment represents its count as a percentage of total capacity
      // This ensures correct proportions regardless of population value
      const lockedPct = cap > 0 ? (lockedWorkers / cap) * 100 : 0;
      const bufferPct = cap > 0 ? (bufferWorkers / cap) * 100 : 0;
      const freePct = cap > 0 ? (freePop / cap) * 100 : 0;

      // Total filled portion = sum of all segments
      const totalFilledPct = lockedPct + bufferPct + freePct;

      // Empty capacity is the remainder
      const emptyPct = Math.max(0, 100 - totalFilledPct);

      // Safe recruits marker position (at the boundary between green and orange)
      const markerPct = lockedPct + bufferPct;
      const showMarker = bufferWorkers > 0; // Only show marker if there are buffer workers

      return {
        totalFilledPct,
        scaledLockedPct: lockedPct,
        scaledBufferPct: bufferPct,
        scaledFreePct: freePct,
        emptyPct,
        markerPct,
        showMarker
      };
    }, [Math.floor(value), cap, lockedWorkers, bufferWorkers, freePop]); // Recalculate when integer population, capacity, or breakdown values change

    const { totalFilledPct, scaledLockedPct, scaledBufferPct, scaledFreePct, emptyPct, markerPct: _markerPct, showMarker } = barCalculations;

    // Tooltip text with breakdown info
    const tooltipText = `Total: ${value} / ${cap}
${lockedWorkers === 1 ? '1 locked worker' : `${lockedWorkers} locked workers`} (keep buildings running)
Workers: ${bufferWorkers}
Free: ${Math.round(freePop * 10) / 10}
Safe recruits (unassigned people): ${freePop}`;

    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 px-0.5 sm:px-1.5 py-0.5 sm:py-1 shadow-sm flex gap-0.5 sm:gap-1.5" title={tooltipText}>
        {/* Icon column */}
        <div className="flex-shrink-0 flex items-center">
          <img src={rPopulation} alt="Population" className="h-4 w-4 sm:h-6 sm:w-6 object-contain drop-shadow-md" />
        </div>
        {/* Content column */}
        <div className="flex-1 min-w-0">
          {/* Single line: Pop value and timer */}
          <div className="text-[9px] sm:text-xs font-bold select-none flex items-center gap-1 sm:gap-1.5 flex-wrap">
            <span className={valueColor || ''}>Pop {formatShort(value)} / {formatShort(cap)}</span>
            {trend && (
              <span className={`text-[8px] sm:text-[10px] font-normal ${trendColor || 'text-slate-500'}`} title={trendTooltip || trend}>
                {trend}
              </span>
            )}
          </div>
          {/* Stacked bar visualization */}
          <div className="mt-0.5 sm:mt-1 h-0.5 sm:h-1 rounded bg-slate-800 border border-slate-700 overflow-hidden relative">
            {/* Red segment: Locked workers */}
            {scaledLockedPct > 0 && (
              <div
                className="h-full bg-red-600 absolute left-0 top-0"
                style={{ width: `${scaledLockedPct}%` }}
              />
            )}
            {/* Orange segment: Buffer workers */}
            {scaledBufferPct > 0 && (
              <div
                className="h-full bg-orange-500 absolute top-0"
                style={{ left: `${scaledLockedPct}%`, width: `${scaledBufferPct}%` }}
              />
            )}
            {/* Green segment: Free population */}
            {scaledFreePct > 0 && (
              <div
                className="h-full bg-emerald-500 absolute top-0"
                style={{ left: `${scaledLockedPct + scaledBufferPct}%`, width: `${scaledFreePct}%` }}
              />
            )}
            {/* Empty capacity (grey) */}
            {emptyPct > 0 && (
              <div
                className="h-full bg-slate-700 absolute top-0"
                style={{ left: `${totalFilledPct}%`, width: `${emptyPct}%` }}
              />
            )}
            {/* Marker at safe recruitment boundary (between green and orange) */}
            {showMarker && scaledBufferPct > 0 && (
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-yellow-400 z-10 shadow-sm"
                style={{ left: `${scaledLockedPct + scaledBufferPct}%`, marginLeft: '-1px' }}
                title="Safe recruitment limit"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Mobile Resource Cell (compact with tap-to-show rate) ===
  function MobileResourceCell({ label, value, cap, rate = 0 }: { label: string; value: number; cap: number; rate?: number }) {
    const isFood = label === 'Food';
    const rateColor = rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-500';
    const rateSign = rate > 0 ? '+' : '';
    const showRate = showingRateFor === label;

    // Food text color based on rate
    const valueTextColor = isFood
      ? (rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-100')
      : 'text-slate-100';

    const fillPercentage = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;

    return (
      <button
        onClick={(e) => handleResourceTap(label, e)}
        onTouchStart={(e) => handleResourceTap(label, e)}
        className="mobile-resource-cell relative flex items-center gap-0.5 px-0.5 py-0.5 rounded-lg border border-slate-700/50 touch-manipulation active:opacity-90 transition-opacity flex-shrink-0 overflow-hidden"
        style={{ minHeight: '32px' }}
      >
        {/* Background fill - darker base */}
        <div className="absolute inset-0 bg-slate-900/90" />

        {/* Progress fill - colored strip from left to right */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="h-full bg-cyan-500/40 transition-all duration-300"
            style={{ width: `${fillPercentage}%` }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 flex items-center gap-0.5">
          {/* Icon */}
          <img
            src={getResourceIcon(label)}
            alt={label}
            className="h-3.5 w-3.5 flex-shrink-0 object-contain drop-shadow-md"
          />

          {/* Amount - no max capacity text */}
          <span className={`text-[10px] font-bold ${valueTextColor} leading-tight drop-shadow-sm whitespace-nowrap`}>
            {formatShort(value)}
          </span>
          {showRate && (
            <span className={`text-[9px] font-normal ${rateColor} leading-tight drop-shadow-sm whitespace-nowrap`}>
              {rateSign}{formatRate(rate)}/s
            </span>
          )}
        </div>
      </button>
    );
  }

  function ResourcePill({ label, value, cap, rate = 0, showBar = true, trend, statusColor, workerInfo, className = '' }: { label: string; value: number; cap: number; rate?: number; showBar?: boolean; trend?: string; statusColor?: 'red' | 'yellow' | 'green'; workerInfo?: string; className?: string }) {
    const isFood = label === 'Food';
    const isResource = ['Wood', 'Stone', 'Food', 'Iron', 'Gold'].includes(label);
    const rateColor = rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-500';
    const rateSign = rate > 0 ? '+' : '';
    const showRate = showingRateFor === label;

    // Food text color based on rate
    const valueTextColor = isFood
      ? (rate > 0 ? 'text-emerald-500' : rate < 0 ? 'text-red-500' : 'text-slate-100')
      : 'text-slate-100';

    const fillPercentage = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;

    // For resources (Wood, Stone, Food, Iron, Gold), use clickable button with background fill
    if (isResource) {
      return (
        <button
          onClick={(e) => handleResourceTap(label, e)}
          onTouchStart={(e) => handleResourceTap(label, e)}
          className={`mobile-resource-cell relative rounded-lg border border-slate-700 bg-slate-900 px-1 sm:px-1.5 py-0.5 sm:py-0.5 shadow-sm flex items-center gap-0.5 sm:gap-1 overflow-hidden touch-manipulation active:opacity-90 transition-opacity flex-shrink-0 ${className}`}
        >
          {/* Background fill - darker base */}
          <div className="absolute inset-0 bg-slate-900" />

          {/* Progress fill - colored strip from left to right */}
          {showBar && (
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="h-full bg-cyan-500/30 transition-all duration-300"
                style={{ width: `${fillPercentage}%` }}
              />
            </div>
          )}

          {/* Content */}
          <div className="relative z-10 flex items-center gap-0.5 sm:gap-1">
            {/* Icon */}
            <img src={getResourceIcon(label)} alt={label} className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 object-contain drop-shadow-md" />
            {/* Value */}
            <span className={`text-[9px] sm:text-[10px] font-bold select-none ${valueTextColor} whitespace-nowrap`}>
              {formatShort(value)}
            </span>
            {showRate && (
              <span className={`text-[9px] sm:text-[10px] font-normal ${rateColor} whitespace-nowrap`}>
                {rateSign}{formatRate(rate)}/s
              </span>
            )}
            {trend && (
              <span className={`text-[9px] sm:text-[10px] font-normal ${trend.includes('-') ? 'text-red-500' : trend.includes('+') ? 'text-emerald-500' : 'text-slate-500'} whitespace-nowrap`}>
                {trend}
              </span>
            )}
            {workerInfo && (
              <span className="text-[9px] sm:text-[10px] text-slate-500 font-normal whitespace-nowrap">
                ({workerInfo})
              </span>
            )}
          </div>
        </button>
      );
    }

    // Skill Points - non-clickable, no progress fill, keep original behavior
    return (
      <div className={`rounded-xl border border-slate-700 bg-slate-900 px-1 sm:px-1.5 py-1 shadow-sm flex gap-1 sm:gap-1.5 ${className}`}>
        {/* Icon column */}
        <div className="flex-shrink-0 flex items-center">
          <img src={getResourceIcon(label)} alt={label} className="h-5 w-5 sm:h-6 sm:w-6 object-contain drop-shadow-md" />
        </div>
        {/* Content column */}
        <div className="flex-1 min-w-0">
          {/* Single line: Name and value */}
          <div className="text-[10px] sm:text-xs font-bold select-none flex items-center gap-1.5 flex-wrap">
            <span className={statusColor === 'red' ? 'text-red-500' : statusColor === 'yellow' ? 'text-yellow-500' : statusColor === 'green' ? 'text-emerald-500' : ''}>
              {label} {formatShort(value)}
            </span>
            {trend && (
              <span className={`text-[9px] sm:text-[10px] font-normal ${trend.includes('-') ? 'text-red-500' : trend.includes('+') ? 'text-emerald-500' : 'text-slate-500'}`}>
                {trend}
              </span>
            )}
            {workerInfo && (
              <span className="text-[9px] sm:text-[10px] text-slate-500 font-normal">
                ({workerInfo})
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Settings Button (replaces Logo) ===
  function LogoPill() {
    return (
      <button
        onClick={() => setShowCheatMenu(prev => !prev)}
        className="rounded-lg border border-slate-700 bg-slate-900 px-0.5 py-0.5 sm:px-1 sm:py-1 shadow-sm flex items-center justify-center hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer touch-manipulation flex-shrink-0"
        title="Settings / Cheat Menu"
        style={{ minHeight: '28px', minWidth: '28px', maxWidth: '32px' }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>
    );
  }

  // === Fullscreen Toggle Button ===
  function FullscreenPill() {
    return (
      <button
        onClick={toggleFullscreen}
        className="rounded-lg border border-slate-700 bg-slate-900 px-0.5 py-0.5 sm:px-1 sm:py-1 shadow-sm flex items-center justify-center hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer touch-manipulation flex-shrink-0"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        style={{ minHeight: '28px', minWidth: '28px', maxWidth: '32px' }}
      >
        {isFullscreen ? (
          // Exit fullscreen icon (arrows pointing inwards)
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
            />
          </svg>
        ) : (
          // Enter fullscreen icon (arrows pointing outwards)
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        )}
      </button>
    );
  }



  // === Taxes Pill ===
  function TaxesPill() {
    const taxLabels: Record<typeof tax, string> = {
      'very_low': 'Very Low',
      'low': 'Low',
      'normal': 'Normal',
      'high': 'High',
      'very_high': 'Very High'
    };

    const taxColors: Record<typeof tax, string> = {
      'very_low': 'text-emerald-500',
      'low': 'text-lime-500',
      'normal': 'text-yellow-400',
      'high': 'text-orange-500',
      'very_high': 'text-red-500'
    };

    const taxOrder: Array<typeof tax> = ['very_low', 'low', 'normal', 'high', 'very_high'];
    const currentIndex = taxOrder.indexOf(tax);
    const canDecrease = currentIndex > 0;
    const canIncrease = currentIndex < taxOrder.length - 1;

    const decreaseTax = () => {
      if (canDecrease) {
        setTax(taxOrder[currentIndex - 1]);
      }
    };

    const increaseTax = () => {
      if (canIncrease) {
        setTax(taxOrder[currentIndex + 1]);
      }
    };

    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 px-0.5 sm:px-1.5 py-0.5 sm:py-1 shadow-sm flex items-center gap-0.5 sm:gap-1.5">
        {/* Icon on the left */}
        <div className="flex-shrink-0 flex items-center">
          <img src={rTaxes} alt="Taxes" className="h-4 w-4 sm:h-6 sm:w-6 object-contain drop-shadow-md" />
        </div>
        {/* Text stack: Taxes title with tax level below */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="text-[9px] sm:text-xs font-bold select-none">Taxes</div>
          <div className={`text-[8px] sm:text-[10px] font-semibold ${taxColors[tax]}`}>{taxLabels[tax]}</div>
        </div>
        {/* Control buttons on the right, vertically centered */}
        <div className="flex-shrink-0 flex items-center gap-0.5 sm:gap-1.5">
          <button
            onClick={decreaseTax}
            disabled={!canDecrease}
            className={`px-0.5 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-xs font-semibold touch-manipulation ${canDecrease
              ? 'bg-slate-800 active:bg-slate-700 hover:bg-slate-700 text-white'
              : 'bg-slate-800/50 text-slate-500 cursor-not-allowed'
              }`}
            title={canDecrease ? 'Decrease taxes' : 'Taxes are already at minimum'}
          >
            −
          </button>
          <button
            onClick={increaseTax}
            disabled={!canIncrease}
            className={`px-0.5 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-xs font-semibold touch-manipulation ${canIncrease
              ? 'bg-slate-800 active:bg-slate-700 hover:bg-slate-700 text-white'
              : 'bg-slate-800/50 text-slate-500 cursor-not-allowed'
              }`}
            title={canIncrease ? 'Increase taxes' : 'Taxes are already at maximum'}
          >
            +
          </button>
        </div>
      </div>
    );
  }

  // === Compact Building Row ===
  function BuildingRow({
    name,
    res,
    level,
    rate,
    stored,
    cap,
    onCollect,
    enabled,
    workers,
    requiredWorkers,
    onToggle,
    toggleDisabled,
    onRequestDisable,
  }: {
    name: string;
    res: "wood" | "stone" | "food" | "iron";
    level: number;
    rate: number;
    stored: number;
    cap: number;
    onCollect: () => void;
    enabled: boolean;
    workers: number;
    requiredWorkers: number;
    onToggle: () => void;
    toggleDisabled?: boolean;
    onRequestDisable?: () => void;
  }) {
    const nextLevel = level + 1;
    const nextCost = getBuildingCost(res, nextLevel);
    const enoughWood = warehouse.wood >= nextCost.wood;
    const enoughStone = warehouse.stone >= nextCost.stone;
    const affordable = enoughWood && enoughStone;
    const meta = RES_META[res];
    const effectiveLevel = Math.min(level, workers);

    // Calculate fill percentage for Collect button color
    const fillPercent = cap > 0 ? (stored / cap) * 100 : 0;
    const isWarehouseFull = (warehouseFree as any)[res] <= 0;
    const isBlocked = stored > 0 && isWarehouseFull && enabled;

    const getCollectButtonColor = () => {
      if (stored <= 0) return 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600'; // Disabled state
      if (isBlocked) return 'bg-red-600 active:bg-red-700 hover:bg-red-700'; // Blocked - red
      if (fillPercent >= 100) return 'bg-emerald-400 active:bg-emerald-500 hover:bg-emerald-500'; // Full - pure green
      if (fillPercent >= 75) return 'bg-emerald-500 active:bg-emerald-600 hover:bg-emerald-600'; // High fill - strong green
      if (fillPercent >= 25) return 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700'; // Medium fill - clearly green
      return 'bg-emerald-700 active:bg-emerald-800 hover:bg-emerald-800'; // Low fill - slightly green
    };

    const handleCollectClick = () => {
      if (isBlocked) {
        setToastMessage('Warehouse full');
        return;
      }
      onCollect();
    };

    return (
      <div className={`rounded-lg border ${enabled ? 'border-slate-800' : 'border-slate-600 opacity-75'} bg-slate-900 p-2 sm:p-3 w-full`}>
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden">
            {res === 'wood' ? (
              <img src={lumberjackImg} alt={name} className="w-full h-full object-cover" />
            ) : (
              <div className="text-slate-500 text-xs sm:text-sm font-semibold">{meta.short}</div>
            )}
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Disable icon - far left */}
              {enabled ? (
                <button
                  className="rounded-lg bg-slate-900 px-1 py-1 sm:px-1.5 sm:py-1.5 shadow-sm flex items-center justify-center hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer touch-manipulation flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={onRequestDisable || onToggle}
                  disabled={toggleDisabled}
                  title={toggleDisabled ? "Farm cannot be disabled (required for survival)" : "Disable building (releases workers)"}
                  style={{ minHeight: '24px', minWidth: '24px', maxWidth: '28px' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-red-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 8l8 8M16 8l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              ) : (
                <button
                  className="rounded-lg bg-slate-900 px-1 py-1 sm:px-1.5 sm:py-1.5 shadow-sm flex items-center justify-center hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer touch-manipulation flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={onToggle}
                  disabled={toggleDisabled}
                  title="Enable building"
                  style={{ minHeight: '24px', minWidth: '24px', maxWidth: '28px' }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-emerald-400"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              )}
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">{name}</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {level}</div>
              {/* Production text - green */}
              <div className="text-[9px] sm:text-[10px] text-emerald-400 flex-shrink-0">+{formatRate(rate)} {meta.short}/s</div>
              {/* Workers text */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Workers: {workers}/{requiredWorkers}</div>
              {workers < requiredWorkers && (
                <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-amber-900 text-amber-200 flex-shrink-0">
                  Effective Lv {effectiveLevel}
                </div>
              )}
            </div>
            {/* Level-up block, Progress bar, and Collect button row - 3 column layout */}
            <div className="mt-0.5 sm:mt-1 grid grid-cols-3 gap-1 items-center w-full max-[340px]:grid-cols-2 max-[340px]:grid-rows-2">
              {/* Column 1: Level-up block - left aligned */}
              <div className="flex items-center justify-start w-full min-w-0">
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center overflow-hidden ${affordable
                      ? `bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold`
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => {
                      if (!affordable) { showMissingResourceToast({ wood: enoughWood, stone: enoughStone }); return; }
                      requestUpgrade(res, level);
                    }}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Column 2: Progress bar - center aligned, fills column width */}
              <div className="flex items-center justify-center min-w-0 w-full max-[340px]:col-span-2 max-[340px]:row-start-2">
                <div className="w-full">
                  <RowBar value={stored} max={cap} label={`${formatInt(stored)} / ${formatCap(cap)}`} />
                </div>
              </div>

              {/* Column 3: Collect button - right aligned */}
              <div className="flex items-center justify-end w-full max-[340px]:col-start-2 max-[340px]:row-start-1">
                <button
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs ${getCollectButtonColor()} text-white disabled:opacity-50 touch-manipulation min-h-[44px] sm:min-h-0 relative flex-shrink-0 overflow-hidden ${fillPercent >= 100 && stored > 0 && !isBlocked ? 'shimmer-gold' : ''} ${isBlocked ? 'pulse-red' : ''}`}
                  onClick={handleCollectClick}
                  disabled={stored <= 0 || (!isBlocked && (warehouseFree as any)[res] <= 0) || !enabled}
                  title={isBlocked ? "Warehouse full - Click to see message" : (warehouseFree as any)[res] <= 0 ? "Warehouse full for this resource" : `Collect ${meta.name}`}
                >
                  <span className="relative z-10 flex items-center gap-1">
                    Collect <img src={getResourceIcon(meta.name)} alt={meta.name} className="h-3.5 w-3.5 sm:h-4 sm:w-4 object-contain drop-shadow-md" />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === House Row ===
  function HouseRow() {
    const nextLevel = house + 1;
    const nextCost = getHouseCost(nextLevel);
    const enoughWood = warehouse.wood >= nextCost.wood;
    const enoughStone = warehouse.stone >= nextCost.stone;
    const affordable = enoughWood && enoughStone;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">🏠</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">House</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {house}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Capacity: {formatInt(popCap)}</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Workers: 0 (no workers required)</div>
            </div>
            {/* Upgrade block row */}
            <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
              {/* Upgrade block: costs + arrow button */}
              <div className="flex items-center gap-[5px] flex-shrink-0">
                {/* Costs - can wrap */}
                <div className="flex items-center gap-0.5 flex-wrap">
                  {nextCost.wood > 0 && (
                    <div className="flex items-center gap-0.5">
                      <img
                        src={getResourceIcon('Wood')}
                        alt="Wood"
                        className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                      />
                      <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                        {formatInt(nextCost.wood)}
                      </span>
                    </div>
                  )}
                  {nextCost.stone > 0 && (
                    <div className="flex items-center gap-0.5">
                      <img
                        src={getResourceIcon('Stone')}
                        alt="Stone"
                        className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                      />
                      <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                        {formatInt(nextCost.stone)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Arrow-up button - fixed position */}
                <button
                  className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                    ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                    : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                    } disabled:cursor-not-allowed`}
                  onClick={() => { if (!affordable) { showMissingResourceToast({ wood: enoughWood, stone: enoughStone }); return; } requestUpgrade("house", house); }}
                  title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel} (+5 capacity)`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === Town Hall Row ===
  function TownHallRow() {
    const nextLevel = townHall.level + 1;
    const canUpgrade = nextLevel <= 3;
    const nextCost = canUpgrade ? getTownHallCost(nextLevel) : null;
    const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
    const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
    const affordable = canUpgrade && enoughWood && enoughStone;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">🏛️</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Town Hall</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {townHall.level}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Net Pop: {netPopulationChange > 0 ? '+' : ''}{netPopulationChange.toFixed(1)}/s</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Happiness: {happiness}</div>
            </div>
            {/* Unlocks info - compact subtext */}
            {(townHall.level >= 2 || townHall.level >= 3) && (
              <div className="text-[9px] sm:text-[10px] text-slate-400 mt-0.5 flex-shrink-0">
                {townHall.level >= 2 && "Unlocks: Barracks, Tavern"}
                {townHall.level >= 3 && " | Market, Guard Tower (planned)"}
              </div>
            )}
            {/* Upgrade block row */}
            {canUpgrade && nextCost && (
              <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                {/* Upgrade block: costs + arrow button */}
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => { if (!affordable) { showMissingResourceToast({ wood: enoughWood, stone: enoughStone }); return; } requestTownHallUpgrade(townHall.level); }}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Barracks Row ===
  function BarracksRow() {
    if (!barracks) {
      const canBuild = canBuildBarracks(townHall.level);
      const buildCost = getBarracksBuildCost();
      const hasEnoughWood = warehouse.wood >= buildCost.wood;
      const hasEnoughStone = warehouse.stone >= buildCost.stone;
      const canAfford = hasEnoughWood && hasEnoughStone;

      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
            {/* Building Icon Frame */}
            <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
              <div className="text-slate-500 text-xs sm:text-sm font-semibold">⚔️</div>
            </div>
            {/* Content area - no flex-1, shrinks to content */}
            <div className="min-w-0 flex-shrink-0">
              {/* Header block - shrink to content */}
              <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
                {/* Building name */}
                <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Barracks</div>
                {/* Locked message - compact subtext */}
                {!canBuild && (
                  <div className="text-[9px] sm:text-[10px] text-red-400 flex-shrink-0">Requires Town Hall Level 2</div>
                )}
              </div>
              {/* Upgrade block row */}
              {canBuild && (
                <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                  {/* Upgrade block: costs + arrow button */}
                  <div className="flex items-center gap-[5px] flex-shrink-0">
                    {/* Costs - can wrap */}
                    <div className="flex items-center gap-0.5 flex-wrap">
                      {buildCost.wood > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Wood')}
                            alt="Wood"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${hasEnoughWood ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(buildCost.wood)}
                          </span>
                        </div>
                      )}
                      {buildCost.stone > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Stone')}
                            alt="Stone"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${hasEnoughStone ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(buildCost.stone)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Build button - fixed position */}
                    <button
                      className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${canAfford
                        ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                        : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                        } disabled:cursor-not-allowed`}
                      onClick={buildBarracks}
                      disabled={!canAfford}
                      title={!canAfford ? `Need more Wood/Stone in warehouse` : `Build Barracks`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    const nextLevel = barracks.level + 1;
    const canUpgrade = nextLevel <= 3;
    const nextCost = canUpgrade ? getBarracksCost(nextLevel) : null;
    const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
    const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
    const affordable = canUpgrade && enoughWood && enoughStone;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">⚔️</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Barracks</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {barracks.level}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Slots: {barracks.trainingSlots}</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Active: {barracks.trainingQueue.length}/{barracks.trainingSlots}</div>
            </div>
            {/* Upgrade block row */}
            {canUpgrade && nextCost && (
              <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                {/* Upgrade block: costs + arrow button */}
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => { if (!affordable) { showMissingResourceToast({ wood: enoughWood, stone: enoughStone }); return; } requestBarracksUpgrade(barracks.level); }}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Tavern Row ===
  function MilitaryAcademyRow() {
    if (!militaryAcademy) {
      const canBuild = canBuildMilitaryAcademy(townHall.level);
      const cost = getMilitaryAcademyBuildCost();
      const enoughWood = warehouse.wood >= cost.wood;
      const enoughStone = warehouse.stone >= cost.stone;
      const affordable = enoughWood && enoughStone;

      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
            {/* Building Icon Frame */}
            <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
              <div className="text-slate-500 text-xs sm:text-sm font-semibold">🎓</div>
            </div>
            {/* Content area - no flex-1, shrinks to content */}
            <div className="min-w-0 flex-shrink-0">
              {/* Header block - shrink to content */}
              <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
                {/* Building name */}
                <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Military Academy</div>
                {/* Locked message - compact subtext */}
                {!canBuild && (
                  <div className="text-[9px] sm:text-[10px] text-red-400 flex-shrink-0">Requires Town Hall Level 2</div>
                )}
              </div>
              {/* Upgrade block row */}
              {canBuild && (
                <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                  {/* Upgrade block: costs + arrow button */}
                  <div className="flex items-center gap-[5px] flex-shrink-0">
                    {/* Costs - can wrap */}
                    <div className="flex items-center gap-0.5 flex-wrap">
                      {cost.wood > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Wood')}
                            alt="Wood"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(cost.wood)}
                          </span>
                        </div>
                      )}
                      {cost.stone > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Stone')}
                            alt="Stone"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(cost.stone)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Build button - fixed position */}
                    <button
                      className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center overflow-hidden ${affordable
                        ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                        : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                        } disabled:cursor-not-allowed`}
                      onClick={() => { if (!affordable) { showMissingResourceToast({ wood: enoughWood, stone: enoughStone }); return; } buildMilitaryAcademy(); }}
                      title={!affordable ? `Need more Wood/Stone in warehouse` : `Build Military Academy`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    const nextLevel = militaryAcademy.level + 1;
    const nextCost = nextLevel <= 3 ? getMilitaryAcademyCost(nextLevel) : null;
    const canUpgrade = nextLevel <= 3;
    const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
    const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
    const affordable = canUpgrade && nextCost && enoughWood && enoughStone;
    const maxCommanders = militaryAcademy.level;
    const currentCommanders = commanders.length;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">🎓</div>
          </div>
          <div className="min-w-0 flex-shrink-0">
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Military Academy</div>
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {militaryAcademy.level}</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Commanders: {currentCommanders}/{maxCommanders}</div>
            </div>
            {/* Upgrade block row */}
            {canUpgrade && nextCost && (
              <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                {/* Upgrade block: costs + arrow button */}
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => { if (!affordable) { showMissingResourceToast({ wood: enoughWood, stone: enoughStone }); return; } requestMilitaryAcademyUpgrade(militaryAcademy.level); }}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function TavernRow() {
    if (!tavern) {
      const canBuild = canBuildTavern(townHall.level);
      const buildCost = getTavernBuildCost();
      const hasEnoughWood = warehouse.wood >= buildCost.wood;
      const hasEnoughStone = warehouse.stone >= buildCost.stone;
      const canAfford = hasEnoughWood && hasEnoughStone;

      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
            {/* Building Icon Frame */}
            <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
              <div className="text-slate-500 text-xs sm:text-sm font-semibold">🍺</div>
            </div>
            {/* Content area - no flex-1, shrinks to content */}
            <div className="min-w-0 flex-shrink-0">
              {/* Header block - shrink to content */}
              <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
                {/* Building name */}
                <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Tavern</div>
                {/* Locked message - compact subtext */}
                {!canBuild && (
                  <div className="text-[9px] sm:text-[10px] text-red-400 flex-shrink-0">Requires Town Hall Level 2</div>
                )}
              </div>
              {/* Upgrade block row */}
              {canBuild && (
                <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
                  {/* Upgrade block: costs + arrow button */}
                  <div className="flex items-center gap-[5px] flex-shrink-0">
                    {/* Costs - can wrap */}
                    <div className="flex items-center gap-0.5 flex-wrap">
                      {buildCost.wood > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Wood')}
                            alt="Wood"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${hasEnoughWood ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(buildCost.wood)}
                          </span>
                        </div>
                      )}
                      {buildCost.stone > 0 && (
                        <div className="flex items-center gap-0.5">
                          <img
                            src={getResourceIcon('Stone')}
                            alt="Stone"
                            className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <span className={`text-[9px] sm:text-[10px] font-semibold ${hasEnoughStone ? "text-emerald-600" : "text-red-600"}`}>
                            {formatInt(buildCost.stone)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Build button - fixed position */}
                    <button
                      className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${canAfford
                        ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                        : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                        } disabled:cursor-not-allowed`}
                      onClick={buildTavern}
                      disabled={!canAfford}
                      title={!canAfford ? `Need more Wood/Stone in warehouse` : `Build Tavern`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    const nextLevel = tavern.level + 1;
    const canUpgrade = nextLevel <= 3;
    const nextCost = canUpgrade ? getTavernCost(nextLevel) : null;
    const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
    const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
    const affordable = canUpgrade && enoughWood && enoughStone;
    const festivalActive = tavern.activeFestival && Date.now() < tavern.festivalEndTime;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">🍺</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Tavern</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {tavern.level}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Happiness: +{tavern.level === 1 ? 10 : tavern.level === 2 ? 20 : 25}</div>
              {festivalActive && (
                <div className="text-[9px] sm:text-[10px] text-amber-400 flex-shrink-0">Festival Active!</div>
              )}
            </div>
            {/* Total happiness - compact subtext */}
            <div className="text-[9px] sm:text-[10px] text-slate-400 mt-0.5 flex-shrink-0">
              Total: {happiness} ({happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'})
            </div>
            {/* Action buttons row */}
            <div className="mt-0.5 sm:mt-1 flex items-center gap-1">
              {/* Festival button */}
              {tavern.level >= 1 && !festivalActive && (
                <>
                  <button
                    onClick={startFestival}
                    disabled={warehouse.gold < 50}
                    className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs disabled:opacity-50 touch-manipulation min-h-[44px] sm:min-h-0 flex-shrink-0"
                    title={warehouse.gold < 50 ? "Need 50 Gold" : "Start Festival"}
                  >
                    Start Festival (50 Gold)
                  </button>
                </>
              )}
              {/* Upgrade block */}
              {canUpgrade && nextCost && (
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => { if (!affordable) { showMissingResourceToast({ wood: enoughWood, stone: enoughStone }); return; } requestTavernUpgrade(tavern.level); }}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === Taxes Row ===
  function TaxesRow() {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">💰</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Taxes</div>
            </div>
            {/* Info text - compact subtext */}
            <div className="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 flex-shrink-0">Taxes are now managed from the top bar.</div>
          </div>
        </div>
      </div>
    );
  }

  // === Compact Warehouse Row ===
  function WarehouseRow() {
    const nextLevel = warehouseLevel + 1;
    const nextCost = getWarehouseCost(nextLevel);
    const enoughWood = warehouse.wood >= nextCost.wood;
    const enoughStone = warehouse.stone >= nextCost.stone;
    const affordable = enoughWood && enoughStone;

    // Calculate total stored and check for blocked state
    const totalStored = lumberMill.stored + quarry.stored + farm.stored + ironMine.stored;
    const hasStored = totalStored > 0;
    const isBlocked = hasStored && (
      (lumberMill.stored > 0 && warehouseFree.wood <= 0) ||
      (quarry.stored > 0 && warehouseFree.stone <= 0) ||
      (farm.stored > 0 && warehouseFree.food <= 0) ||
      (ironMine.stored > 0 && warehouseFree.iron <= 0)
    );

    const handleCollectAllClick = () => {
      if (isBlocked) {
        setToastMessage('Warehouse full for one or more resources');
        return;
      }
      collectAll();
    };

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 sm:p-3 w-full">
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-2">
          {/* Building Icon Frame */}
          <div className="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
            <div className="text-slate-500 text-xs sm:text-sm font-semibold">📦</div>
          </div>
          {/* Content area - expands to fill available space */}
          <div className="min-w-0 flex-1">
            {/* Header block - shrink to content */}
            <div className="flex items-baseline gap-1 sm:gap-1.5 flex-wrap flex-shrink-0">
              {/* Building name */}
              <div className="text-xs sm:text-sm font-semibold truncate flex-shrink-0">Warehouse</div>
              {/* Level pill - immediately after name */}
              <div className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-800 flex-shrink-0">Lv {warehouseLevel}</div>
              {/* Stats */}
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Caps: W/S/F {formatCap(warehouseCap.wood)}/{formatCap(warehouseCap.stone)}/{formatCap(warehouseCap.food)}</div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 flex-shrink-0">Stored: W {formatInt(warehouse.wood)} S {formatInt(warehouse.stone)} F {formatInt(warehouse.food)}</div>
            </div>
            {/* Action buttons row - 2 column layout (Level-up + Collect All) */}
            <div className="mt-0.5 sm:mt-1 grid grid-cols-2 gap-1 items-center">
              {/* Column 1: Level-up block - left aligned */}
              <div className="flex items-center justify-start">
                <div className="flex items-center gap-[5px] flex-shrink-0">
                  {/* Costs - can wrap */}
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {nextCost.wood > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Wood')}
                          alt="Wood"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughWood ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.wood)}
                        </span>
                      </div>
                    )}
                    {nextCost.stone > 0 && (
                      <div className="flex items-center gap-0.5">
                        <img
                          src={getResourceIcon('Stone')}
                          alt="Stone"
                          className="h-3 w-3 object-contain drop-shadow-md flex-shrink-0"
                        />
                        <span className={`text-[9px] sm:text-[10px] font-semibold ${enoughStone ? "text-emerald-600" : "text-red-600"}`}>
                          {formatInt(nextCost.stone)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Arrow-up button - fixed position */}
                  <button
                    className={`px-1 py-1 rounded-lg text-[9px] sm:text-[10px] touch-manipulation flex-shrink-0 flex items-center justify-center relative self-center ${affordable
                      ? 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/50 shimmer-gold'
                      : 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-slate-300 disabled:opacity-50'
                      } disabled:cursor-not-allowed`}
                    onClick={() => { if (!affordable) { showMissingResourceToast({ wood: enoughWood, stone: enoughStone }); return; } requestUpgrade("warehouse", warehouseLevel); }}
                    title={!affordable ? `Need more Wood/Stone in warehouse` : `Level up to Lvl ${nextLevel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Column 2: Collect All button - right aligned */}
              <div className="flex items-center justify-end">
                <button
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs text-white disabled:opacity-50 touch-manipulation min-h-[44px] sm:min-h-0 flex-shrink-0 relative overflow-hidden ${!hasStored
                    ? 'bg-slate-700 active:bg-slate-600 hover:bg-slate-600'
                    : isBlocked
                      ? 'bg-red-600 active:bg-red-700 hover:bg-red-700 pulse-red'
                      : 'bg-emerald-600 active:bg-emerald-700 hover:bg-emerald-700'
                    }`}
                  onClick={handleCollectAllClick}
                  disabled={!hasStored && !isBlocked}
                  title={isBlocked ? "Warehouse full for one or more resources - Click to see message" : (!hasStored ? "No resources to collect" : "Collect all resources")}
                >
                  <span className="relative z-10">Collect All</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === Dev self-tests (run once in browser) ===
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      // Building production/capacity checks
      console.assert(Math.abs(getProgression("wood", 2, "production") - 1.25) < 1e-6, "Wood L2 prod");
      console.assert(Math.abs(getProgression("wood", 3, "capacity") - 169) < 1e-6, "Wood L3 cap");
      console.assert(Math.abs(getProgression("food", 1, "production") - 5) < 1e-6, "Food base prod");
      console.assert(Math.abs(getProgression("food", 2, "production") - 6.25) < 1e-6, "Food L2 prod");

      // Building cost checks vs doc seeds & tables
      // getBuildingCost(res, levelTo) returns cost to go from (levelTo-1) → levelTo
      const qc = getBuildingCost("stone", 2); // Quarry L1→L2 cost
      console.assert(qc.wood === 75 && qc.stone === 60, "Quarry L1→L2 cost");
      const fc = getBuildingCost("food", 2); // Farm L1→L2 cost
      console.assert(fc.wood === 105 && fc.stone === 53, "Farm L1→L2 cost");
      const lc2 = getBuildingCost("wood", 2); // Lumber L1→L2 cost
      console.assert(lc2.wood === 67 && lc2.stone === 27, "Lumber L1→L2 cost");
      const lc3 = getBuildingCost("wood", 3); // Lumber L2→L3 cost
      console.assert(lc3.wood === 101 && lc3.stone === 41, "Lumber L2→L3 cost");
      const lc4 = getBuildingCost("wood", 4); // Lumber L3→L4 cost
      console.assert(lc4.wood === 151 && lc4.stone === 61, "Lumber L3→L4 cost");
      const lc5 = getBuildingCost("wood", 5); // Lumber L4→L5 cost
      console.assert(lc5.wood === 226 && lc5.stone === 91, "Lumber L4→L5 cost");

      // Banner cap test (max 8 squads)
      {
        const max = 8;
        let comp: string[] = [];
        const add = (t: string) => { if (comp.length < max) comp = [...comp, t]; };
        for (let i = 0; i < 10; i++) add('archer');
        console.assert(comp.length === 8, 'Banner max 8 squads enforced');
      }

      // Taxes mapping quick check
      // Test removed - tax system now uses 5 levels with different base rates
      // Old test: const r = (t: 'low'|'normal'|'high') => (t==='low'?1:t==='high'?-1:0);
      // New system: very_low=1.2, low=0.8, normal=0.2, high=-0.4, very_high=-1.0

      // Extra tests: banner reqPop and one-tick training consumption
      {
        const squads = ['archer', 'warrior', 'warrior'];
        const req = 10 * squads.length; // 10 pop per squad
        console.assert(req === 30, 'reqPop formula: 10 per squad');
        let pop = 3;
        let d: any = { id: 1, name: 'T', units: squads, status: 'training', reqPop: 10, recruited: 0 };
        let nextPop = Math.max(0, pop + 0);
        if (d.status === 'training' && d.recruited < d.reqPop && nextPop > 0) { d.recruited += 1; nextPop -= 1; }
        console.assert(d.recruited === 1 && nextPop === 2, 'training tick consumes 1 pop');
      }

      // Warehouse checks
      console.assert(Math.abs(getWarehouseCapacity(1) - 1000) < 1e-6, "WH L1 cap");
      console.assert(Math.abs(getWarehouseCapacity(2) - 1300) < 1e-6, "WH L2 cap");
      const c1 = getWarehouseCost(1); // Level 1 base cost
      console.assert(c1.wood === 100 && c1.stone === 100, "WH base cost");
      const c2 = getWarehouseCost(2); // next level cost *1.5
      console.assert(c2.wood === 150 && c2.stone === 150, "WH L2 cost");
    } catch (e) {
      dbg.warn("Self-tests failed", e);
    }
  }, []);

  return (
    <div className="min-h-screen w-full text-slate-100 p-2 sm:p-4 md:p-6 lg:p-8 relative mobile-landscape-fullscreen">
      {/* Background Image */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: `url(${backgroundImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed'
        }}
      />
      {/* Dark overlay for readability */}
      <div className="fixed inset-0 -z-10 bg-slate-950/75" />
      {/* Fixed Top Menu - Resources, Cheat Panel, and Navigation */}
      <div className="fixed top-0 left-0 right-0 z-50 px-0.5 sm:px-1 py-0 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        {/* Resource Bar - Horizontal scrolling on mobile, flex on desktop */}
        <div className="w-full">
          <div className="flex flex-nowrap gap-0.5 mb-0 overflow-x-auto sm:overflow-x-visible items-center justify-between" style={{ maxHeight: 'min(75px, 14vh)', scrollbarWidth: 'thin' }}>
            <div className="flex flex-nowrap gap-0.5 items-center flex-shrink-0">
              <LogoPill />
              {(() => {
                // Compute shortened timer text
                let trendText = "Stable";
                let trendTooltip = "Population stable";
                let trendColor = 'text-slate-500';

                if (netPopulationChange !== 0) {
                  const secondsPerVillager = Math.abs(1 / netPopulationChange);
                  let timeText: string;
                  let fullTimeText: string;

                  if (secondsPerVillager <= 60) {
                    // Use seconds, round to nearest whole second
                    const seconds = Math.round(secondsPerVillager);
                    timeText = `${seconds}s`;
                    fullTimeText = `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
                  } else {
                    // Convert to minutes, round to nearest minute
                    const minutes = Math.round(secondsPerVillager / 60);
                    timeText = `${minutes}m`;
                    fullTimeText = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
                  }

                  // Build final text using direction - format: (+1 / 5s) or (-1 / 30s)
                  const direction = netPopulationChange > 0 ? "gain" : "loss";
                  if (direction === "gain") {
                    trendText = `(+1 / ${timeText})`;
                    trendTooltip = `+1 villager every ${fullTimeText}`;
                    trendColor = 'text-emerald-500';
                  } else if (direction === "loss") {
                    trendText = `(-1 / ${timeText})`;
                    trendTooltip = `-1 villager every ${fullTimeText}`;
                    trendColor = 'text-red-500';
                  }
                }

                return (
                  <PopulationPill
                    value={population}
                    cap={popCap}
                    rate={netPopulationChange}
                    trend={trendText}
                    trendTooltip={trendTooltip}
                    trendColor={trendColor}
                    statusColor={workerDeficit > 0 ? 'red' : workerSurplus > 0 ? 'green' : 'yellow'}
                    lockedWorkers={clampedLocked}
                    bufferWorkers={clampedBuffer}
                    freePop={clampedFree}
                  />
                );
              })()}
              <TaxesPill />
              <div className="rounded-xl border border-slate-700 bg-slate-900 px-0.5 sm:px-1.5 py-0.5 sm:py-1 shadow-sm flex flex-col">
                {/* Top line: Number */}
                <div className="flex items-center gap-0.5 sm:gap-1">
                  <span className={`text-[9px] sm:text-xs font-bold select-none ${happiness >= 70 ? 'text-emerald-500' : happiness <= 40 ? 'text-red-500' : 'text-yellow-500'}`}>
                    😊 {happiness}
                  </span>
                </div>
                {/* Second line: Status text */}
                <div className="text-[8px] sm:text-[10px] text-slate-500">
                  {happiness >= 70 ? 'Happy' : happiness <= 40 ? 'Unhappy' : 'Neutral'}
                </div>
              </div>
              {/* Mobile & Desktop: Full resource pills (Reflow & Scale) */}
              <div className="flex flex-wrap gap-1 items-center justify-center sm:justify-start w-full sm:w-auto origin-top transform scale-90 sm:scale-100">
                <ResourcePill label="Wood" value={warehouse.wood} cap={warehouseCap.wood} rate={lumberRate} />
                <ResourcePill label="Stone" value={warehouse.stone} cap={warehouseCap.stone} rate={stoneRate} />
                <ResourcePill label="Food" value={warehouse.food} cap={warehouseCap.food} rate={netFoodRate} />
                <ResourcePill
                  label="Iron"
                  value={warehouse.iron}
                  cap={warehouseCap.iron}
                  rate={ironRate}
                  trend={ironConsumptionFeedback ? ironConsumptionFeedback.message : undefined}
                />
                <ResourcePill label="Gold" value={warehouse.gold} cap={warehouseCap.gold} rate={goldIncomePerSecond} />
              </div>
            </div>
            {/* Fullscreen button on the right */}
            <FullscreenPill />
          </div>
        </div>

        {/* Cheat Area for Testing */}
        {showCheatMenu && (
          <div className="max-w-game mx-auto mb-1 sm:mb-1.5 p-1.5 sm:p-2 rounded-lg border-2 border-amber-500 bg-amber-950/30">
            <div className="flex items-center justify-between mb-0.5 sm:mb-1">
              <div className="text-[9px] sm:text-[10px] font-semibold text-amber-200">🧪 CHEAT PANEL (Testing)</div>
              <button
                onClick={() => setShowCheatMenu(false)}
                className="px-2 py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
                title="Hide cheat panel (click logo to show again)"
              >
                Hide
              </button>
            </div>
            <div className="flex gap-1 sm:gap-1.5 flex-wrap">
              <button
                onClick={() => setWarehouse(w => ({ ...w, wood: Math.min(warehouseCap.wood, w.wood + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Wood
              </button>
              <button
                onClick={() => setWarehouse(w => ({ ...w, stone: Math.min(warehouseCap.stone, w.stone + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Stone
              </button>
              <button
                onClick={() => setWarehouse(w => ({ ...w, food: Math.min(warehouseCap.food, w.food + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Food
              </button>
              <button
                onClick={() => setWarehouse(w => ({ ...w, iron: Math.min(warehouseCap.iron, w.iron + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Iron
              </button>
              <button
                onClick={() => setWarehouse(w => ({ ...w, gold: Math.min(warehouseCap.gold, w.gold + 999) }))}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +999 Gold
              </button>
              <button
                onClick={() => setSkillPoints(prev => prev + 5)}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +5 Skill Points
              </button>
              <button
                onClick={() => {
                  addFactionPoints(1);
                  saveGame();
                }}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-purple-600 active:bg-purple-700 hover:bg-purple-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +1 Faction Point
              </button>
              <button
                onClick={() => {
                  addFactionPoints(10);
                  saveGame();
                }}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-purple-600 active:bg-purple-700 hover:bg-purple-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                +10 Faction Points
              </button>
              <button
                onClick={() => {
                  // Shuffle missions: replace current 3 with 3 new random ones
                  const newMissions = selectRandomMissions(3, BASE_MISSION_POOL);
                  setMissions(newMissions);
                  setMissionBannerSelector(null); // Close any open selectors
                }}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-blue-600 active:bg-blue-700 hover:bg-blue-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                Shuffle Missions
              </button>
              <button
                onClick={resetGame}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-red-600 active:bg-red-700 hover:bg-red-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
              >
                Reset Game
              </button>
              <button
                onClick={toggleFullscreen}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0"
                title={isFullscreen ? "Exit fullscreen mode" : "Enter fullscreen mode"}
              >
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
            </div>
            {/* Simulators Section */}
            <div className="mt-2 pt-2 border-t border-amber-700/50">
              <div className="text-[8px] sm:text-[9px] text-amber-300/70 mb-1 font-semibold">Simulators</div>
              <div className="flex gap-1 sm:gap-1.5 flex-wrap">
                <a
                  href="/fortress_siege_simulator.html"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(_e) => {
                    // Find the Godonis expedition fortress stats
                    const godonisExp = expeditions.find(exp => exp.expeditionId === 'godonis_mountain_expedition');
                    if (godonisExp?.fortress?.stats) {
                      const stats = godonisExp.fortress.stats;
                      // Calculate actual garrison from banners
                      const garrisonBannerIds = godonisExp.fortress.garrison || [];
                      const actualGarrison = calculateGarrisonFromBanners(garrisonBannerIds);
                      // Calculate wall archer capacity from Watch Post level
                      const wallArchers = calculateActiveWallArchers('godonis_mountain_expedition');
                      localStorage.setItem('fortressSimulatorStats', JSON.stringify({
                        fortHP: stats.fortHP,
                        fortArcherSlots: wallArchers.capacity, // Wall archer capacity from Watch Post
                        garrisonArchers: actualGarrison.archers || 0,
                        garrisonWarriors: actualGarrison.warriors || 0,
                      }));
                    }
                  }}
                  className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0 inline-flex items-center gap-1"
                >
                  🏰 Fortress Simulator
                </a>
                <a
                  href="/ck_3_style_battle_simulator_ui_single_file_html.html"
                  target="_blank"
                  rel="noreferrer"
                  className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-amber-600 active:bg-amber-700 hover:bg-amber-700 text-white text-[10px] sm:text-xs font-semibold touch-manipulation min-h-[44px] sm:min-h-0 inline-flex items-center gap-1"
                >
                  ⚔ Combat Simulator
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Menu - Mobile tabs below HUD, desktop tabs in nav */}
        <div className="max-w-game mx-auto">
          {/* Mobile Tab Menu - Shows below HUD */}
          <div className="flex md:hidden mb-0.5 mt-1 overflow-x-auto gap-1 pb-0.5" style={{ scrollbarWidth: 'thin' }}>
            <button
              onClick={() => setMainTab('production')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'production' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Buildings
            </button>
            <button
              onClick={() => setMainTab('council')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'council' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Council
            </button>
            <button
              onClick={() => {
                if (barracks && barracks.level >= 1) {
                  setMainTab('army');
                }
              }}
              disabled={!barracks || barracks.level < 1}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${!barracks || barracks.level < 1
                ? 'bg-red-900/50 text-red-300 border border-red-800 opacity-75'
                : mainTab === 'army'
                  ? 'bg-slate-900 text-white border border-slate-600'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Army
            </button>
            <button
              onClick={() => setMainTab('missions')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'missions' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Missions
            </button>
            <button
              onClick={() => setMainTab('expeditions')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'expeditions' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Expeditions
            </button>
            <button
              onClick={() => setMainTab('leaderboard')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'leaderboard' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Leaderboard
            </button>
            <button
              onClick={() => setMainTab('factions')}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] ${mainTab === 'factions' ? 'bg-slate-900 text-white border border-slate-600' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
            >
              Factions
            </button>
            <button
              onClick={() => setBlacksmithOpen(true)}
              className="px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] bg-slate-800 text-slate-300 border border-slate-700"
            >
              Blacksmith
            </button>
            <button
              onClick={() => setTechnologiesOpen(true)}
              className="px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap touch-manipulation min-h-[44px] bg-slate-800 text-slate-300 border border-slate-700"
            >
              Technologies
            </button>
          </div>

          {/* Desktop Tab Menu - Hidden on mobile */}
          <div className="hidden md:flex mb-1 items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden border border-slate-700">
              <button
                onClick={() => setMainTab('production')}
                className={`px-2 py-1 text-xs ${mainTab === 'production' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Buildings
              </button>
              <button
                onClick={() => setMainTab('council')}
                className={`px-2 py-1 text-xs ${mainTab === 'council' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Council
              </button>
              <button
                onClick={() => {
                  if (barracks && barracks.level >= 1) {
                    setMainTab('army');
                  }
                }}
                disabled={!barracks || barracks.level < 1}
                className={`px-2 py-1 text-xs ${!barracks || barracks.level < 1
                  ? 'bg-red-900 text-red-300 cursor-not-allowed opacity-75'
                  : mainTab === 'army'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-700'
                  }`}
                title={!barracks || barracks.level < 1 ? 'Requires Barracks Level 1' : 'Army'}
              >
                Army
              </button>
              <button
                onClick={() => setMainTab('missions')}
                className={`px-2 py-1 text-xs ${mainTab === 'missions' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Missions
              </button>
              <button
                onClick={() => setMainTab('expeditions')}
                className={`px-2 py-1 text-xs ${mainTab === 'expeditions' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Expeditions
              </button>
              <button
                onClick={() => setMainTab('leaderboard')}
                className={`px-2 py-1 text-xs ${mainTab === 'leaderboard' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Leaderboard
              </button>
              <button
                onClick={() => setMainTab('factions')}
                className={`px-2 py-1 text-xs ${mainTab === 'factions' ? 'bg-slate-900 text-white' : 'bg-slate-700'}`}
              >
                Factions
              </button>
              <button
                onClick={() => setBlacksmithOpen(true)}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600"
              >
                Blacksmith
              </button>
              <button
                onClick={() => setTechnologiesOpen(true)}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600"
              >
                Technologies
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer to prevent content from going under fixed header - Responsive height */}
      {/* On mobile, account for HUD height + tabs + padding */}
      <div className="h-[60px] sm:h-[65px] md:h-[70px]"></div>

      {/* Main Content - Buildings (Default) */}
      {mainTab === 'production' && (
        <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 mt-1 sm:mt-1 md:mt-2">
          <div className="grid grid-cols-2 max-[340px]:grid-cols-1 gap-2 sm:gap-3 md:gap-4">
            <BuildingRow
              name="Lumber Mill"
              res="wood"
              level={lumberMill.level}
              rate={lumberRate}
              stored={lumberMill.stored}
              cap={lumberCap}
              onCollect={() => collect("wood")}
              enabled={lumberMill.enabled}
              workers={lumberMill.workers}
              requiredWorkers={lumberMill.level}
              onToggle={() => toggleBuilding('wood')}
              onRequestDisable={() => setDisableBuildingModal({ resource: 'wood', buildingName: 'Lumber Mill' })}
            />
            <BuildingRow
              name="Quarry"
              res="stone"
              level={quarry.level}
              rate={stoneRate}
              stored={quarry.stored}
              cap={stoneCap}
              onCollect={() => collect("stone")}
              enabled={quarry.enabled}
              workers={quarry.workers}
              requiredWorkers={quarry.level}
              onToggle={() => toggleBuilding('stone')}
              onRequestDisable={() => setDisableBuildingModal({ resource: 'stone', buildingName: 'Quarry' })}
            />
            <BuildingRow
              name="Iron Mine"
              res="iron"
              level={ironMine.level}
              rate={ironRate}
              stored={ironMine.stored}
              cap={ironCap}
              onCollect={() => collect("iron")}
              enabled={ironMine.enabled}
              workers={ironMine.workers}
              requiredWorkers={ironMine.level}
              onToggle={() => toggleBuilding('iron')}
              onRequestDisable={() => setDisableBuildingModal({ resource: 'iron', buildingName: 'Iron Mine' })}
            />
            <BuildingRow
              name="Farm"
              res="food"
              level={farm.level}
              rate={foodRate}
              stored={farm.stored}
              cap={foodCap}
              onCollect={() => collect("food")}
              enabled={farm.enabled}
              workers={farm.workers}
              requiredWorkers={farm.level}
              onToggle={() => toggleBuilding('food')}
              toggleDisabled={true}
            />
            <HouseRow />
            <TownHallRow />
            <BarracksRow />
            <TavernRow />
            <MilitaryAcademyRow />
            <WarehouseRow />
          </div>
        </section>
      )}

      {mainTab === 'army' && (
        <ArmyTab
          isMobile={isMobile}
          barracks={barracks}
          bannerTemplates={bannerTemplates}
          banners={banners}
          missions={missions}
          expeditions={expeditions}
          armyTab={armyTab}
          editingBannerId={editingBannerId}
          bannersDraft={bannersDraft}
          commanders={commanders}
          recruitmentMode={recruitmentMode}
          showRecruitmentInfo={showRecruitmentInfo}
          bannerHint={bannerHint}
          warehouse={warehouse}
          onSetArmyTab={setArmyTab}
          onGoToProduction={() => setMainTab('production')}
          onStartBarracksTraining={startBarracksTraining}
          onDeleteBannerModal={setDeleteBannerModal}
          onOpenAssignModal={(commanderId, bannerId) => setCommanderAssignModal({ commanderId, bannerId })}
          onSetBannerHint={setBannerHint}
          onSetRecruitmentMode={setRecruitmentMode}
          onSetShowRecruitmentInfo={setShowRecruitmentInfo}
          onToggleBannerTraining={(bannerId, isCurrentlyTraining) => {
            if (isCurrentlyTraining) {
              // Stop training: set to idle
              setBanners(prev => prev.map(b => b.id === bannerId ? { ...b, status: 'idle', trainingPaused: false } : b));
            } else {
              // Start training: use the proper function that calculates reqPop
              startTraining(bannerId);
            }
          }}
          onUpdateBannerNameDraft={updateBannerNameDraft}
          onCancelEditingBanner={cancelEditingBanner}
          onConfirmEditingBanner={confirmEditingBanner}
          onStartEditingBanner={startEditingBanner}
          onDeleteBanner={deleteBanner}
          onCreateNewBanner={createNewBanner}
          onShowResourceError={(msg: string) => setToastMessage(msg)}
          onRequestReinforcement={(bannerId) => requestReinforcement(bannerId)}
          onSelectUnit={(unitType, bannerId, slotIndex) => {
            const squadId = Date.now();
            setBanners(prev => prev.map(banner => {
              if (banner.id !== bannerId) return banner;
              const squads = banner.squads || [];
              const existingIdx = squads.findIndex(s => s.slotIndex === slotIndex);
              const newSquad = { id: squadId, type: unitType, slotIndex, maxSize: 10, currentSize: 0, count: 1 };
              const updatedSquads = existingIdx >= 0
                ? squads.map((s, i) => i === existingIdx ? newSquad : s)
                : [...squads, newSquad];
              return { ...banner, squads: updatedSquads };
            }));
            if (bannersDraft && bannersDraft.id === bannerId) {
              const squads = bannersDraft.squads || [];
              const existingIdx = squads.findIndex(s => s.slotIndex === slotIndex);
              const newSquad = { id: squadId, type: unitType, slotIndex, maxSize: 10, currentSize: 0, count: 1 };
              const updatedSquads = existingIdx >= 0
                ? squads.map((s, i) => i === existingIdx ? newSquad : s)
                : [...squads, newSquad];
              setBannersDraft({ ...bannersDraft, squads: updatedSquads });
            }
          }}
        />
      )}

      {
        mainTab === 'leaderboard' && (
          <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
            <h2 className="text-base sm:text-lg md:text-xl font-semibold">Kill Score Leaderboard</h2>
            <LeaderboardUI leaderboard={leaderboard} realPlayerId={REAL_PLAYER_ID} />
          </section>
        )
      }

      {
        mainTab === 'council' && (
          <CouncilUI
            militaryAcademy={militaryAcademy}
            commanders={commanders}
            townHall={townHall}
            banners={banners}
            warehouse={{ wood: warehouse.wood, stone: warehouse.stone, gold: warehouse.gold }}
            onShowResourceError={(msg) => setToastMessage(msg)}
            commanderRecruitModal={commanderRecruitModal}
            candidateNames={candidateNames}
            onBuildMilitaryAcademy={buildMilitaryAcademy}
            onUpgradeMilitaryAcademy={requestMilitaryAcademyUpgrade}
            onOpenRecruitModal={() => setCommanderRecruitModal(true)}
            onCloseRecruitModal={() => setCommanderRecruitModal(false)}
            onRecruitCommander={recruitCommander}
            onOpenAssignModal={(id) => setCommanderAssignModal({ commanderId: id })}
            onUnassignCommander={unassignCommander}
          />
        )
      }

      {
        mainTab === 'factions' && (
          <FactionsUI
            factionState={factionState}
            selectedFaction={selectedFaction}
            onSelectFaction={setSelectedFaction}
            onAssignFP={assignFPToFaction}
            onUnlockPerk={unlockPerk}
            onSave={saveGame}
          />
        )
      }

      {
        mainTab === 'missions' && (
          <MissionsUI
            missions={missions}
            expeditionMissions={expeditions
              .filter(e => e.state === 'completed' && e.mapState?.expeditionMissions)
              .flatMap(e => e.mapState!.expeditionMissions!)}
            banners={banners}
            missionBannerSelector={missionBannerSelector}
            missionLoading={missionLoading}
            onSetBannerSelector={setMissionBannerSelector}
            onAssignBanner={assignBannerToMission}
            onClearMissionNew={(missionId) => setMissions((ms) => ms.map((m) =>
              m.id === missionId ? { ...m, isNew: false } : m
            ))}
            onSendMission={confirmSendMission}
            onViewReport={(missionId, result, bannerXP) =>
              setBattleReport({ missionId, result, bannerXP })
            }
            onCloseMission={(missionId) => {
              const currentIds = missions.map(m => m.id);
              const newMissions = selectRandomMissions(1, BASE_MISSION_POOL, currentIds);
              if (newMissions.length > 0) {
                setMissions((ms) => ms.map((m) =>
                  m.id === missionId ? newMissions[0] : m
                ));
              }
              saveGame();
            }}
          />
        )
      }

      {
        mainTab === 'expeditions' && (
          <ExpeditionsUI
            expeditions={expeditions}
            banners={banners}
            missions={missions}
            population={population}
            warehouse={warehouse}
            onAcceptExpedition={acceptExpedition}
            onSendResource={sendResourceToExpedition}
            onLaunchExpedition={launchExpedition}
            onGetWallArchers={calculateActiveWallArchers}
            onUpgradeFortressBuilding={upgradeFortressBuilding}
            onRemoveBannerFromFortress={removeBannerFromFortress}
            onAssignBannerToFortress={assignBannerToFortress}
            onRestartExpedition={restartExpedition}
            onDeployArmyToProvince={(expeditionId, bannerId, provinceId) => {
              setExpeditions(prev => prev.map(exp => {
                if (exp.expeditionId !== expeditionId || !exp.mapState) return exp;
                const pd = provinceDataRef.current;
                const prov = pd?.provinces?.find((p: any) => p.id === provinceId);
                return {
                  ...exp,
                  fortress: {
                    ...exp.fortress!,
                    garrison: exp.fortress!.garrison.filter(id => id !== bannerId),
                  },
                  mapState: {
                    ...exp.mapState,
                    armyPositions: { ...exp.mapState.armyPositions, [bannerId]: provinceId },
                    revealedProvinces: [
                      ...new Set([
                        ...exp.mapState.revealedProvinces,
                        provinceId,
                        ...(prov?.adjacentProvinces || []),
                      ]),
                    ],
                  },
                };
              }));
            }}
            onSetArmyOrder={(expeditionId, bannerId, order) => {
              setExpeditions(prev => prev.map(exp => {
                if (exp.expeditionId !== expeditionId || !exp.mapState) return exp;
                return {
                  ...exp,
                  mapState: {
                    ...exp.mapState,
                    pendingOrders: { ...exp.mapState.pendingOrders, [bannerId]: order },
                  },
                };
              }));
            }}
            onClearArmyOrder={(expeditionId, bannerId) => {
              setExpeditions(prev => prev.map(exp => {
                if (exp.expeditionId !== expeditionId || !exp.mapState) return exp;
                const { [bannerId]: _, ...rest } = exp.mapState.pendingOrders;
                return {
                  ...exp,
                  mapState: {
                    ...exp.mapState,
                    pendingOrders: rest,
                  },
                };
              }));
            }}
            onExecuteTurn={(expeditionId) => {
              setExpeditions(prev => prev.map(exp => {
                if (exp.expeditionId !== expeditionId || !exp.mapState) return exp;
                if (exp.mapState.expeditionFailed) return exp;
                const pd = provinceDataRef.current;
                const newTurnNumber = exp.mapState.turnNumber + 1;
                const fortId = exp.mapState.fortressProvinceId;
                const currentPositions = { ...exp.mapState.armyPositions };
                const currentEnemies = exp.mapState.enemyArmies || [];
                let newRevealed = new Set(exp.mapState.revealedProvinces);

                // ── Phase 0: Compute all destinations (no movement yet) ──
                const playerDests = computePlayerDestinations(currentPositions, exp.mapState.pendingOrders);
                const enemyDests = computeEnemyDestinations(currentEnemies, fortId, pd || { provinces: [] });

                // ── Phase 1: Detect province conflicts (multi-army) ──
                const provinceConflicts = detectProvinceConflicts(currentPositions, playerDests, currentEnemies, enemyDests);
                const battlePlayerIds = new Set(provinceConflicts.flatMap(c => c.playerBannerIds));
                const battleEnemyIds = new Set(provinceConflicts.flatMap(c => c.enemyIds));

                // ── Event log accumulator ──
                const newLogEntries: import('./types').ExpeditionLogEntry[] = [];
                let logIdx = 0;

                // ── Phase 2: Resolve province battles (stack & merge) ──
                const newFieldBattles: FieldBattleResult[] = [];
                const battleProvs: string[] = [];
                let updatedEnemies = [...currentEnemies];
                const destroyedPlayerIds = new Set<number>();

                for (let bi = 0; bi < provinceConflicts.length; bi++) {
                  const conflict = provinceConflicts[bi];
                  const playerBanners = conflict.playerBannerIds.map(id => banners.find(b => b.id === id)).filter((b): b is Banner => !!b);
                  const enemyForces = conflict.enemyIds.map(id => updatedEnemies.find(e => e.id === id && e.status === 'marching')).filter((e): e is EnemyArmy => !!e);

                  if (playerBanners.length === 0 || enemyForces.length === 0) continue;

                  const playerNames = playerBanners.map(b => b.name).join(' + ');
                  const enemyNames = enemyForces.map(e => e.name).join(' + ');
                  dbg.log(`[FIELD] Battle at ${conflict.provinceId}: [${playerNames}] vs [${enemyNames}]`);

                  try {
                    const result = runMergedBattle(playerBanners, enemyForces, conflict.provinceId, newTurnNumber, bi);
                    newFieldBattles.push(result);
                    battleProvs.push(conflict.provinceId);

                    // Log: battle resolved
                    const outcomeLabel = result.outcome === 'player_wins' ? 'Victory' : result.outcome === 'enemy_wins' ? 'Defeat' : 'Draw';
                    newLogEntries.push({
                      id: `log_${newTurnNumber}_${logIdx++}`,
                      turn: newTurnNumber,
                      type: 'battle_resolved',
                      text: `Battle at ${conflict.provinceId.replace('prov_', 'P')} — ${outcomeLabel}`,
                      provinceId: conflict.provinceId,
                      battleResultId: result.id,
                    });

                    const casualties = applyFieldBattleCasualties(result, newTurnNumber, conflict.provinceId);

                    // Update enemies in local array
                    const allEnemyResults = result.enemyArmies || [result.enemyArmy];
                    for (const eResult of allEnemyResults) {
                      updatedEnemies = updatedEnemies.map(e => {
                        if (e.id !== eResult.enemyId) return e;
                        if (casualties.destroyedEnemyIds.includes(e.id)) {
                          return {
                            ...e,
                            status: 'destroyed' as const,
                            totalTroops: 0,
                            destroyedTurn: newTurnNumber,
                            destroyedByBannerId: playerBanners[0]?.id,
                            destroyedByBannerName: playerNames,
                            fieldBattleId: result.id,
                          };
                        }
                        // Survived: scale troops by ratio
                        const origEnemy = enemyForces.find(ef => ef.id === e.id);
                        if (!origEnemy) return e;
                        const ratio = origEnemy.totalTroops > 0 ? eResult.finalTroops / origEnemy.totalTroops : 0;
                        return {
                          ...e,
                          totalTroops: Math.round(eResult.finalTroops),
                          squads: e.squads.map(sq => ({ ...sq, count: Math.max(0, Math.round(sq.count * ratio)) })),
                          provinceId: conflict.provinceId,
                        };
                      });
                    }

                    // Log destroyed armies
                    for (const bid of casualties.destroyedBannerIds) {
                      destroyedPlayerIds.add(bid);
                      const bName = banners.find(b => b.id === bid)?.name || 'Army';
                      newLogEntries.push({
                        id: `log_${newTurnNumber}_${logIdx++}`,
                        turn: newTurnNumber, type: 'army_destroyed',
                        text: `${bName} destroyed`,
                        provinceId: conflict.provinceId,
                      });
                    }
                    for (const eid of casualties.destroyedEnemyIds) {
                      const eName = enemyForces.find(e => e.id === eid)?.name || 'Enemy';
                      newLogEntries.push({
                        id: `log_${newTurnNumber}_${logIdx++}`,
                        turn: newTurnNumber, type: 'army_destroyed',
                        text: `${eName} destroyed`,
                        provinceId: conflict.provinceId,
                      });
                    }

                    // Leaderboard update
                    const totalEnemyKilled = allEnemyResults.reduce((sum, e) => sum + (e.initialTroops - e.finalTroops), 0);
                    if (totalEnemyKilled > 0) {
                      setLeaderboard(lprev => updateLeaderboardFromBattleResult(lprev, {
                        enemyUnitsKilled: totalEnemyKilled,
                        isVictory: result.outcome === 'player_wins',
                        playerId: REAL_PLAYER_ID,
                        playerName: REAL_PLAYER_NAME,
                        faction: REAL_PLAYER_FACTION,
                      }));
                    }
                  } catch (err) {
                    dbg.error('[FIELD] Battle error:', err);
                  }
                }

                // ── Phase 3: Apply movement for non-combatants ──
                const newPositions: Record<number, string> = {};
                for (const [bidStr, pos] of Object.entries(currentPositions)) {
                  const bid = Number(bidStr);
                  if (destroyedPlayerIds.has(bid)) continue; // destroyed, remove from map

                  if (battlePlayerIds.has(bid)) {
                    // Fought a battle — stay at battle province
                    const conflict = provinceConflicts.find(c => c.playerBannerIds.includes(bid));
                    newPositions[bid] = conflict?.provinceId || pos;
                  } else {
                    // Normal movement
                    const dest = playerDests[bid];
                    newPositions[bid] = dest;
                  }

                  // Expand fog of war for player army destination
                  const destId = newPositions[bid];
                  newRevealed.add(destId);
                  const prov = pd?.provinces?.find((p: any) => p.id === destId);
                  if (prov?.adjacentProvinces) {
                    for (const adj of prov.adjacentProvinces) newRevealed.add(adj);
                  }
                }

                // Move non-combatant enemies
                updatedEnemies = updatedEnemies.map(e => {
                  if (e.status !== 'marching') return e;
                  if (battleEnemyIds.has(e.id)) return e; // already positioned by battle logic
                  const dest = enemyDests.get(e.id);
                  return dest ? { ...e, provinceId: dest } : e;
                });

                // ── Phase 3.5: Check expedition mission completions ──
                const missionPos = exp.mapState.missionPositions || {};
                const completedExpMissionIds: number[] = [];
                const armyProvinceSet = new Set(Object.values(newPositions));
                const updatedExpMissions = (exp.mapState.expeditionMissions || []).map(m => {
                  if (m.status !== 'available') return m;
                  const mProvId = (missionPos as Record<string, string>)[m.id] || (missionPos as Record<string, string>)[String(m.id)];
                  if (!mProvId) return m;

                  // Check if any player army arrived at this province
                  if (!armyProvinceSet.has(mProvId)) return m;

                  // Auto-complete: compute rewards using existing generateMissionRewards()
                  const enemyTotal = ((m.enemyComposition as any)?.warrior || 0) + ((m.enemyComposition as any)?.archer || 0);
                  const { tier, rewards } = generateMissionRewards(enemyTotal);
                  completedExpMissionIds.push(m.id);
                  newLogEntries.push({
                    id: `log_${newTurnNumber}_${logIdx++}`,
                    turn: newTurnNumber, type: 'mission_completed',
                    text: `Mission complete: ${m.name}`,
                    provinceId: mProvId,
                  });
                  dbg.log(`[EXPEDITION-MISSION] "${m.name}" auto-completed at ${mProvId} (tier: ${tier})`);

                  return {
                    ...m,
                    status: 'completedRewardsPending' as const,
                    rewards,
                    rewardTier: tier,
                  };
                });

                // ── Phase 4: Check fortress arrivals — trigger siege battles ──
                let expeditionFailed = false;
                let updatedFortress = exp.fortress;
                for (let i = 0; i < updatedEnemies.length; i++) {
                  const enemy = updatedEnemies[i];
                  if (enemy.status !== 'marching' || enemy.provinceId !== fortId) continue;

                  dbg.log(`[NPC] Enemy "${enemy.name}" (${enemy.totalTroops} troops) reached fortress! Triggering siege...`);
                  newLogEntries.push({
                    id: `log_${newTurnNumber}_${logIdx++}`,
                    turn: newTurnNumber, type: 'fortress_attacked',
                    text: `Fortress under attack by ${enemy.name}!`,
                    provinceId: fortId,
                  });
                  try {
                    const result = runSiegeBattle(expeditionId, enemy.totalTroops, enemy.squads.map(s => ({ type: s.type, count: s.count * 10 })));
                    const destroyedBanners = applyFortressBattleCasualties(expeditionId, result);

                    if (updatedFortress) {
                      const updatedGarrison = destroyedBanners.length > 0
                        ? (updatedFortress.garrison || []).filter(id => !destroyedBanners.includes(id))
                        : updatedFortress.garrison;
                      updatedFortress = {
                        ...updatedFortress,
                        garrison: updatedGarrison,
                        lastBattle: result,
                      };
                    }

                    updatedEnemies = updatedEnemies.map((e, idx) =>
                      idx === i ? { ...e, status: 'destroyed' as const } : e
                    );

                    const isVictory = result.outcome === 'fortress_holds_walls' || result.outcome === 'fortress_holds_inner';
                    if (!isVictory && result.outcome === 'fortress_falls') {
                      dbg.log('[NPC] Fortress has fallen! Expedition failed.');
                      expeditionFailed = true;
                      newLogEntries.push({
                        id: `log_${newTurnNumber}_${logIdx++}`,
                        turn: newTurnNumber, type: 'fortress_damaged',
                        text: 'Fortress has fallen — expedition lost',
                        provinceId: fortId,
                      });
                    } else {
                      newLogEntries.push({
                        id: `log_${newTurnNumber}_${logIdx++}`,
                        turn: newTurnNumber, type: 'fortress_attacked',
                        text: `Fortress assault repelled — ${enemy.name} destroyed`,
                        provinceId: fortId,
                      });
                    }

                    const lastRound = result.siegeTimeline[result.siegeTimeline.length - 1];
                    if (lastRound) {
                      const enemyUnitsKilled = result.initialAttackers - lastRound.attackers;
                      setLeaderboard(lprev => updateLeaderboardFromBattleResult(lprev, {
                        enemyUnitsKilled,
                        isVictory,
                        playerId: REAL_PLAYER_ID,
                        playerName: REAL_PLAYER_NAME,
                        faction: REAL_PLAYER_FACTION,
                      }));
                    }
                  } catch (err) {
                    dbg.error('[NPC] Siege battle error:', err);
                  }
                }

                // ── Phase 5: Spawn new enemies ──
                let nextEnemyId = exp.mapState.nextEnemyId ?? 1;
                if (pd && newTurnNumber >= 5 && ((newTurnNumber - 5) % 4 === 0)) {
                  const newEnemy = spawnEnemyArmy(
                    { ...exp.mapState, turnNumber: newTurnNumber, enemyArmies: updatedEnemies, nextEnemyId },
                    pd
                  );
                  if (newEnemy) {
                    dbg.log(`[NPC] Spawned enemy "${newEnemy.name}" at ${newEnemy.provinceId} (turn ${newTurnNumber})`);
                    updatedEnemies = [...updatedEnemies, newEnemy];
                    nextEnemyId = newEnemy.id + 1;
                    newLogEntries.push({
                      id: `log_${newTurnNumber}_${logIdx++}`,
                      turn: newTurnNumber, type: 'hostile_detected',
                      text: `Hostile army detected: ${newEnemy.name}`,
                      provinceId: newEnemy.provinceId,
                    });
                  }
                }

                // ── Phase 6: Cleanup + state update ──
                updatedEnemies = updatedEnemies.filter(e =>
                  e.status === 'marching' || (newTurnNumber - (e.destroyedTurn || e.spawnTurn)) < 20
                );

                const existingFieldBattles = exp.mapState.fieldBattleResults || [];

                // Battle aftermath: decay existing, add new
                const aftermath: Record<string, number> = {};
                for (const [provId, turns] of Object.entries(exp.mapState.battleAftermath || {})) {
                  if (turns > 1) aftermath[provId] = turns - 1;
                }
                for (const provId of battleProvs) {
                  aftermath[provId] = 3;
                }
                // Also mark fortress if siege happened
                if (battleProvs.length === 0 && newLogEntries.some(e => e.type === 'fortress_attacked')) {
                  aftermath[fortId] = 3;
                }

                // Merge log: new entries first, then existing
                const existingLog = exp.mapState.expeditionLog || [];
                const mergedLog = [...newLogEntries, ...existingLog].slice(0, 50); // cap at 50

                const isFailed = expeditionFailed || exp.mapState.expeditionFailed || false;

                // Auto-return banners to 'ready' when expedition fails
                if (isFailed && !exp.mapState.expeditionFailed) {
                  // Only run on the turn the expedition actually fails (not on subsequent turns)
                  const garrisonIds = new Set((updatedFortress?.garrison || []) as number[]);
                  const mapBannerIds = new Set(Object.keys(newPositions).map(Number));
                  const allExpBannerIds = new Set([...garrisonIds, ...mapBannerIds]);

                  setBanners(bs => bs.map(b => {
                    if (!allExpBannerIds.has(b.id)) return b;
                    if (b.status === 'destroyed') return b;
                    return { ...b, status: 'ready' as const };
                  }));

                  dbg.log(`[NPC] Expedition failed — returned ${allExpBannerIds.size} banner(s) to 'ready' status.`);
                }

                return {
                  ...exp,
                  state: isFailed ? 'failed' as const : exp.state,
                  fortress: updatedFortress,
                  mapState: {
                    ...exp.mapState,
                    armyPositions: newPositions,
                    revealedProvinces: [...newRevealed],
                    turnNumber: newTurnNumber,
                    pendingOrders: {},
                    enemyArmies: updatedEnemies,
                    nextEnemyId,
                    expeditionFailed: isFailed,
                    fieldBattleResults: [...existingFieldBattles, ...newFieldBattles],
                    battleProvinces: battleProvs,
                    expeditionMissions: updatedExpMissions,
                    completedExpeditionMissionIds: completedExpMissionIds,
                    expeditionLog: mergedLog,
                    battleAftermath: aftermath,
                  },
                };
              }));
            }}
            onClaimExpeditionReward={(expeditionId, missionId) => {
              // Add rewards to warehouse
              setExpeditions(prev => prev.map(exp => {
                if (exp.expeditionId !== expeditionId || !exp.mapState) return exp;
                const mission = (exp.mapState.expeditionMissions || []).find(m => m.id === missionId);
                if (!mission || !mission.rewards) return exp;

                // Credit rewards
                const r = mission.rewards;
                setWarehouse(w => ({
                  ...w,
                  gold: w.gold + (r.gold || 0),
                  wood: w.wood + (r.wood || 0),
                  stone: w.stone + (r.stone || 0),
                  food: w.food + (r.food || 0),
                  iron: w.iron + (r.iron || 0),
                }));

                // Update mission status and clear completedExpeditionMissionIds
                return {
                  ...exp,
                  mapState: {
                    ...exp.mapState,
                    expeditionMissions: (exp.mapState.expeditionMissions || []).map(m =>
                      m.id === missionId ? { ...m, status: 'completedRewardsClaimed' as const } : m
                    ),
                    completedExpeditionMissionIds: (exp.mapState.completedExpeditionMissionIds || []).filter(id => id !== missionId),
                  },
                };
              }));
            }}
            onShowResourceError={(msg) => setToastMessage(msg)}
            onRunBattle={(expeditionId) => {
              try {
                const result = runSiegeBattle(expeditionId, 100);
                const destroyedBanners = applyFortressBattleCasualties(expeditionId, result);
                setExpeditions((exps) => exps.map((e) => {
                  if (e.expeditionId !== expeditionId || !e.fortress) return e;
                  const updatedGarrison = destroyedBanners.length > 0
                    ? (e.fortress.garrison || []).filter(id => !destroyedBanners.includes(id))
                    : e.fortress.garrison;
                  return {
                    ...e,
                    fortress: {
                      ...e.fortress,
                      garrison: updatedGarrison,
                      lastBattle: result
                    }
                  };
                }));
                const lastRound = result.siegeTimeline[result.siegeTimeline.length - 1];
                const enemyUnitsKilled = result.initialAttackers - lastRound.attackers;
                const isVictory = result.outcome === 'fortress_holds_walls' || result.outcome === 'fortress_holds_inner';
                setLeaderboard(prev => updateLeaderboardFromBattleResult(prev, {
                  enemyUnitsKilled,
                  isVictory,
                  playerId: REAL_PLAYER_ID,
                  playerName: REAL_PLAYER_NAME,
                  faction: REAL_PLAYER_FACTION,
                }));
                return { result, destroyedBanners };
              } catch (err) {
                dbg.error('Siege battle error:', err);
                return null;
              }
            }}
          />
        )
      }

      {/* Upgrade Confirmation Bottom Sheet */}
      {
        pendingUpgrade && (() => {
          const getBuildingName = (res: string) => {
            const names: Record<string, string> = {
              "wood": "Lumber Mill",
              "stone": "Quarry",
              "food": "Farm",
              "iron": "Iron Mine",
              "house": "House",
              "townhall": "Town Hall",
              "barracks": "Barracks",
              "tavern": "Tavern",
              "militaryAcademy": "Military Academy",
              "warehouse": "Warehouse",
            };
            return names[res] || "Building";
          };

          const getBuildingIcon = (res: string) => {
            if (res === "wood") return lumberjackImg;
            // For other buildings, use emoji or placeholder
            const icons: Record<string, string> = {
              "stone": "⛏️",
              "food": "🌾",
              "iron": "⚒️",
              "house": "🏠",
              "townhall": "🏛️",
              "barracks": "⚔️",
              "tavern": "🍺",
              "militaryAcademy": "🎓",
              "warehouse": "📦",
            };
            return icons[res] || "🏗️";
          };

          const buildingName = getBuildingName(pendingUpgrade.res);
          const buildingIcon = getBuildingIcon(pendingUpgrade.res);
          const cost = pendingUpgrade.cost;
          const enoughWood = warehouse.wood >= cost.wood;
          const enoughStone = warehouse.stone >= cost.stone;
          const affordable = enoughWood && enoughStone;

          // Calculate benefits
          const getBenefits = () => {
            const benefits: string[] = [];
            const { res, from, to } = pendingUpgrade;

            if (res === "wood" || res === "stone" || res === "food" || res === "iron") {
              const currentCap = getProgression(res, from, "capacity");
              const nextCap = getProgression(res, to, "capacity");
              const capIncrease = Math.floor(nextCap - currentCap);
              if (capIncrease > 0) {
                benefits.push(`Capacity: +${formatInt(capIncrease)}`);
              }

              const currentProd = getProgression(res, from, "production");
              const nextProd = getProgression(res, to, "production");
              const prodIncrease = (nextProd - currentProd).toFixed(1);
              if (parseFloat(prodIncrease) > 0) {
                benefits.push(`Production: +${prodIncrease}/s`);
              }

              // Worker slots increase
              benefits.push(`Worker slots: ${from} → ${to}`);
            } else if (res === "house") {
              const currentCap = getHouseCapacity(from);
              const nextCap = getHouseCapacity(to);
              const capIncrease = nextCap - currentCap;
              if (capIncrease > 0) {
                benefits.push(`Population capacity: +${capIncrease}`);
              }
            } else if (res === "warehouse") {
              const currentCap = Math.floor(1000 * Math.pow(1.3, from - 1));
              const nextCap = Math.floor(1000 * Math.pow(1.3, to - 1));
              const capIncrease = nextCap - currentCap;
              if (capIncrease > 0) {
                benefits.push(`Storage capacity: +${formatInt(capIncrease)} per resource`);
              }
            } else if (res === "townhall") {
              benefits.push(`Unlocks new buildings and features`);
            }

            return benefits;
          };

          const benefits = getBenefits();

          return (
            <div
              className="fixed inset-0 bg-black/60 z-[9999] flex items-end justify-center sm:items-center p-0 sm:p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  cancelUpgrade();
                }
              }}
            >
              <div
                className="w-full sm:w-[92%] md:w-[600px] max-h-[70vh] bg-slate-900 rounded-t-3xl sm:rounded-2xl border-t border-l border-r border-slate-800 shadow-2xl relative z-[10000] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 border-b border-slate-800 flex-shrink-0">
                  {/* Building Icon */}
                  <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-xl border border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden">
                    {pendingUpgrade.res === "wood" ? (
                      <img src={buildingIcon} alt={buildingName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-2xl sm:text-3xl">{buildingIcon}</div>
                    )}
                  </div>

                  {/* Title and Level Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-lg sm:text-xl font-semibold mb-1">Level Up</h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm sm:text-base text-slate-300">{buildingName}</span>
                      <span className="text-xs sm:text-sm px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-semibold">Lv {pendingUpgrade.from}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-xs sm:text-sm px-2 py-0.5 rounded-md bg-emerald-900/50 text-emerald-300 font-semibold">Lv {pendingUpgrade.to}</span>
                    </div>
                  </div>

                  {/* Close Button */}
                  <button
                    onClick={cancelUpgrade}
                    className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors"
                    aria-label="Close"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6">
                  {/* Costs Section */}
                  <div className="mb-6 sm:mb-8">
                    <h5 className="text-sm font-semibold text-slate-400 mb-3">Cost</h5>
                    <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                      {cost.wood > 0 && (
                        <div className="flex items-center gap-2">
                          <img
                            src={getResourceIcon('Wood')}
                            alt="Wood"
                            className="h-5 w-5 sm:h-6 sm:w-6 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <div className="flex flex-col">
                            <span className={`text-base sm:text-lg font-semibold ${enoughWood ? "text-emerald-400" : "text-red-400"}`}>
                              {formatInt(cost.wood)}
                            </span>
                            <span className="text-[10px] sm:text-xs text-slate-500">Owned: {formatInt(warehouse.wood)}</span>
                          </div>
                        </div>
                      )}
                      {cost.stone > 0 && (
                        <div className="flex items-center gap-2">
                          <img
                            src={getResourceIcon('Stone')}
                            alt="Stone"
                            className="h-5 w-5 sm:h-6 sm:w-6 object-contain drop-shadow-md flex-shrink-0"
                          />
                          <div className="flex flex-col">
                            <span className={`text-base sm:text-lg font-semibold ${enoughStone ? "text-emerald-400" : "text-red-400"}`}>
                              {formatInt(cost.stone)}
                            </span>
                            <span className="text-[10px] sm:text-xs text-slate-500">Owned: {formatInt(warehouse.stone)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    {!affordable && (
                      <div className="mt-3 text-sm text-red-400 font-medium">Not enough resources</div>
                    )}
                  </div>

                  {/* Benefits Section */}
                  {benefits.length > 0 && (
                    <div className="mb-4 sm:mb-6">
                      <h5 className="text-sm font-semibold text-slate-400 mb-3">You gain</h5>
                      <div className="space-y-2">
                        {benefits.map((benefit, idx) => (
                          <div key={idx} className="text-sm sm:text-base text-slate-300 flex items-center gap-2">
                            <span className="text-emerald-400">✓</span>
                            <span>{benefit}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Buttons */}
                <div className="px-4 sm:px-6 pt-4 border-t border-slate-800 flex gap-3 sm:gap-4 justify-end flex-shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                  <button
                    onClick={cancelUpgrade}
                    className="px-5 sm:px-6 py-3 sm:py-3.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm sm:text-base transition-colors touch-manipulation min-h-[44px] sm:min-h-0"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmUpgrade}
                    disabled={!affordable}
                    className={`px-5 sm:px-6 py-3 sm:py-3.5 rounded-xl font-semibold text-sm sm:text-base transition-colors touch-manipulation min-h-[44px] sm:min-h-0 ${affordable
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white active:bg-emerald-800"
                      : "bg-slate-700 text-slate-400 cursor-not-allowed opacity-50"
                      }`}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      }

      {/* Delete Banner Confirmation Modal */}
      {
        deleteBannerModal !== null && (() => {
          const banner = banners.find(b => b.id === deleteBannerModal);
          if (!banner) return null;
          return (
            <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
              <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
                <h4 className="text-lg font-semibold mb-2">{banner.type === 'mercenary' ? 'Dismiss Army' : 'Delete Army'}</h4>
                <p className="text-sm mb-4">
                  Are you sure you want to {banner.type === 'mercenary' ? 'dismiss' : 'delete'} <strong>{banner.name}</strong>?
                </p>
                <div className="text-sm mb-4 space-y-1">
                  <div>This will:</div>
                  <div>• Erase the army permanently</div>
                  {banner.type === 'regular' && banner.recruited > 0 && (
                    <div>• Return <strong>{banner.recruited}</strong> population to the village</div>
                  )}
                  {banner.type === 'mercenary' && (
                    <div className="text-slate-400">• No population will be returned (mercenary banner)</div>
                  )}
                  {banner.status === 'deployed' && (
                    <div className="text-amber-400">• Remove banner from active mission</div>
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setDeleteBannerModal(null)}
                    className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteBanner}
                    className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      }

      {/* Disable Building Confirmation Modal */}
      {
        disableBuildingModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-[9999]">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800 relative z-[10000]">
              <h4 className="text-lg font-semibold mb-2">Disable building?</h4>
              <p className="text-sm mb-4">
                Are you sure you want to disable <strong>{disableBuildingModal.buildingName}</strong>?
              </p>
              <div className="text-sm mb-4 space-y-1 text-slate-300">
                <div>Disabling stops this building from producing resources.</div>
                <div>All workers assigned to this building will be released and become available again.</div>
                <div>You can enable the building later to resume production.</div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDisableBuildingModal(null)}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    toggleBuilding(disableBuildingModal.resource);
                    setDisableBuildingModal(null);
                  }}
                  className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Siege Attack Modal */}
      {
        siegeAttackModal && (() => {
          const expedition = expeditions.find(exp => exp.expeditionId === siegeAttackModal.expeditionId);
          if (!expedition?.fortress) return null;

          const garrison = calculateGarrisonFromBanners(expedition.fortress.garrison || []);

          return (
            <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
              <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
                <h4 className="text-lg font-semibold mb-2">Attack Fortress</h4>
                <div className="text-sm mb-4 space-y-2">
                  <div>
                    <div className="text-slate-400">Fortress Stats:</div>
                    <div className="text-xs text-slate-300 ml-2">
                      Fort HP: {formatInt(expedition.fortress.stats.fortHP)} |
                      Archer Slots: {formatInt(expedition.fortress.stats.archerSlots)} |
                      Garrison: {formatInt(garrison.warriors)} Warriors, {formatInt(garrison.archers)} Archers
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Number of Attackers:</label>
                    <input
                      type="number"
                      min="1"
                      value={siegeAttackModal.attackers}
                      onChange={(e) => setSiegeAttackModal({ ...siegeAttackModal, attackers: parseInt(e.target.value) || 100 })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setSiegeAttackModal(null)}
                    className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      try {
                        const result = runSiegeBattle(siegeAttackModal.expeditionId, siegeAttackModal.attackers);
                        const destroyedBanners = applyFortressBattleCasualties(siegeAttackModal.expeditionId, result);
                        setExpeditions((exps) => exps.map((exp) => {
                          if (exp.expeditionId !== siegeAttackModal.expeditionId || !exp.fortress) return exp;
                          const updatedGarrison = destroyedBanners.length > 0
                            ? (exp.fortress.garrison || []).filter(id => !destroyedBanners.includes(id))
                            : exp.fortress.garrison;
                          return {
                            ...exp,
                            fortress: {
                              ...exp.fortress,
                              garrison: updatedGarrison,
                              lastBattle: result
                            }
                          };
                        }));
                        setSiegeAttackModal(null);
                      } catch (error) {
                        dbg.error('Siege battle error:', error);
                        alert('Error running siege battle. Please try again.');
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                  >
                    Launch Attack
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      }

      {/* Mercenary Reinforcement Confirmation Modal */}
      {
        reinforcementModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
              <h4 className="text-lg font-semibold mb-2">Reinforce Squad</h4>
              <p className="text-sm mb-4">
                Reinforce <strong>{reinforcementModal.squadType} Squad</strong> in <strong>{reinforcementModal.bannerName}</strong>?
              </p>
              <div className="text-sm mb-4 space-y-1">
                <div>Soldiers needed: <strong>{reinforcementModal.soldiersNeeded}</strong></div>
                <div>Gold cost: <strong className={warehouse.gold >= reinforcementModal.goldCost ? 'text-emerald-400' : 'text-red-400'}>{reinforcementModal.goldCost}</strong></div>
                <div className="text-xs text-slate-400 mt-2">
                  This will consume {reinforcementModal.goldCost} gold over time as the squad is reinforced.
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setReinforcementModal(null)}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Create reinforcement entry
                    const { bannerId, squadId, soldiersNeeded } = reinforcementModal;
                    if (!barracks) {
                      setReinforcementModal(null);
                      return;
                    }

                    // Guard: Don't allow reinforcing destroyed banners
                    const banner = banners.find(b => b.id === bannerId);
                    if (!banner || banner.status === 'destroyed') {
                      setReinforcementModal(null);
                      return;
                    }

                    // Check if this squad already has a reinforcement entry
                    const hasActiveReinforcement = barracks.trainingQueue.some(
                      entry => entry.type === 'reinforcement' && entry.bannerId === bannerId && entry.squadId === squadId
                    );
                    if (hasActiveReinforcement) {
                      setReinforcementModal(null);
                      return;
                    }

                    // Check if training slots are available
                    const activeEntries = barracks.trainingQueue.filter(e => e.status === 'training' || e.status === 'arriving');
                    const availableSlots = barracks.trainingSlots - activeEntries.length;

                    // Create reinforcement training entry in barracks queue
                    const reinforcementEntry: TrainingEntry = {
                      id: Date.now(),
                      type: 'reinforcement',
                      bannerId,
                      squadId,
                      soldiersNeeded,
                      soldiersTrained: 0,
                      elapsedTime: 0,
                      status: availableSlots > 0 ? 'training' : 'arriving',
                    };

                    setBarracks(prev => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        trainingQueue: [...prev.trainingQueue, reinforcementEntry],
                      };
                    });

                    setReinforcementModal(null);
                  }}
                  disabled={warehouse.gold < reinforcementModal.goldCost}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Reinforce Modal */}
      {
        hireAndRefillModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 border border-slate-800">
              <h4 className="text-lg font-semibold mb-2">Reinforce</h4>
              <p className="text-sm mb-4">
                Refill all damaged squads in <strong>{hireAndRefillModal.bannerName}</strong>?
              </p>
              <div className="text-sm mb-4 space-y-1">
                <div>Refill damaged squads: <strong>{hireAndRefillModal.refillCost}</strong> Gold</div>
                <div className="mt-2 pt-2 border-t border-slate-700">
                  Total cost: <strong className={warehouse.gold >= hireAndRefillModal.totalCost ? 'text-emerald-400' : 'text-red-400'}>{hireAndRefillModal.totalCost}</strong> Gold
                </div>
                {warehouse.gold < hireAndRefillModal.totalCost && (
                  <div className="text-xs text-red-400 mt-1">
                    Insufficient gold. You need {hireAndRefillModal.totalCost - warehouse.gold} more gold.
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setHireAndRefillModal(null)}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!barracks || warehouse.gold < hireAndRefillModal.totalCost) {
                      setHireAndRefillModal(null);
                      return;
                    }

                    // Refill all damaged squads in the existing banner
                    const banner = banners.find(b => b.id === hireAndRefillModal.bannerId);

                    // Guard: Don't allow reinforcing destroyed banners
                    if (!banner || banner.status === 'destroyed') {
                      setHireAndRefillModal(null);
                      return;
                    }

                    // Deduct gold
                    setWarehouse(w => ({ ...w, gold: w.gold - hireAndRefillModal.totalCost }));

                    if (banner) {
                      let displaySquads = banner.squads;
                      if (!displaySquads || displaySquads.length === 0) {
                        const { squads } = initializeSquadsFromUnits(banner.units, squadSeqRef.current);
                        displaySquads = squads;
                      }

                      // Create reinforcement entries for all damaged squads
                      displaySquads.forEach(squad => {
                        if (squad.currentSize < squad.maxSize) {
                          const missing = squad.maxSize - squad.currentSize;
                          // Check if already has reinforcement entry
                          const hasActiveReinforcement = barracks.trainingQueue.some(
                            entry => entry.type === 'reinforcement' && entry.bannerId === banner.id && entry.squadId === squad.id
                          );
                          if (!hasActiveReinforcement) {
                            const activeEntries = barracks.trainingQueue.filter(e => e.status === 'training' || e.status === 'arriving');
                            const availableSlots = barracks.trainingSlots - activeEntries.length;

                            const reinforcementEntry: TrainingEntry = {
                              id: Date.now() + Math.random(), // Unique ID
                              type: 'reinforcement',
                              bannerId: banner.id,
                              squadId: squad.id,
                              soldiersNeeded: missing,
                              soldiersTrained: 0,
                              elapsedTime: 0,
                              status: availableSlots > 0 ? 'training' : 'arriving',
                            };

                            setBarracks(prev => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                trainingQueue: [...prev.trainingQueue, reinforcementEntry],
                              };
                            });
                          }
                        }
                      });
                    }

                    setHireAndRefillModal(null);
                  }}
                  disabled={warehouse.gold < hireAndRefillModal.totalCost}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Reward Modal */}
      {
        rewardModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-4 border border-slate-800 text-center">
              <h4 className="text-lg font-semibold mb-2">Mission Complete</h4>
              <p className="text-sm mb-4">You received <strong>1 Gold</strong>.</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => claimMissionReward(rewardModal.missionId)} className="px-3 py-2 rounded-xl bg-amber-500 text-white">Collect</button>
              </div>
            </div>
          </div>
        )
      }

      {/* Blacksmith Modal */}
      <BlacksmithUI
        isOpen={blacksmithOpen}
        onClose={() => setBlacksmithOpen(false)}
        warehouse={{ iron: warehouse.iron, gold: warehouse.gold }}
        onUpgrade={handleBlacksmithUpgrade}
      />

      {/* Technologies Modal */}
      <TechnologiesUI
        isOpen={technologiesOpen}
        onClose={() => setTechnologiesOpen(false)}
        skillPoints={skillPoints}
        onStartResearch={handleStartResearch}
        onCompleteResearch={handleCompleteResearch}
      />

      {/* Battle Report Modal */}
      {
        battleReport && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Battle Report - {missions.find(m => m.id === battleReport.missionId)?.name}</h2>
                <button onClick={() => {
                  const mission = missions.find(m => m.id === battleReport.missionId);
                  // Only show reward popup if player won and rewards haven't been claimed yet
                  const isVictory = battleReport.result.winner === 'player';
                  if (isVictory && mission && mission.status === 'completedRewardsPending' && mission.enemyComposition) {
                    const enemyTotal = getEnemyTotal(mission.enemyComposition);
                    const { tier, rewards } = generateMissionRewards(enemyTotal);
                    setBattleReport(null);
                    setRewardPopup({ missionId: mission.id, tier, rewards });
                  } else {
                    // Player lost or rewards already claimed - just close
                    setBattleReport(null);
                  }
                }} className="text-slate-400 hover:text-white text-2xl">✕</button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-slate-800 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Player Forces</h3>
                  <div className="text-sm space-y-1">
                    <div className="text-slate-400 text-xs mb-1">Initial</div>
                    <div>Warriors: {battleReport.result.playerInitial.warrior.toFixed(0)}</div>
                    <div>Archers: {battleReport.result.playerInitial.archer.toFixed(0)}</div>
                    <div>Total: {battleReport.result.playerInitial.total.toFixed(0)}</div>
                    <div className="text-slate-400 text-xs mt-2 mb-1">Final</div>
                    <div>Warriors: {battleReport.result.playerFinal.warrior.toFixed(0)}</div>
                    <div>Archers: {battleReport.result.playerFinal.archer.toFixed(0)}</div>
                    <div>Total: {battleReport.result.playerFinal.total.toFixed(0)}</div>
                    <div>Morale: {battleReport.result.playerFinal.morale.toFixed(1)}</div>
                  </div>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Enemy Forces</h3>
                  <div className="text-sm space-y-1">
                    <div className="text-slate-400 text-xs mb-1">Initial</div>
                    <div>Warriors: {battleReport.result.enemyInitial.warrior.toFixed(0)}</div>
                    <div>Archers: {battleReport.result.enemyInitial.archer.toFixed(0)}</div>
                    <div>Total: {battleReport.result.enemyInitial.total.toFixed(0)}</div>
                    <div className="text-slate-400 text-xs mt-2 mb-1">Final</div>
                    <div>Warriors: {battleReport.result.enemyFinal.warrior.toFixed(0)}</div>
                    <div>Archers: {battleReport.result.enemyFinal.archer.toFixed(0)}</div>
                    <div>Total: {battleReport.result.enemyFinal.total.toFixed(0)}</div>
                    <div>Morale: {battleReport.result.enemyFinal.morale.toFixed(1)}</div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 p-4 rounded-lg mb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold mb-2">Result</h3>
                    <div className="text-lg">
                      Winner: <span className={battleReport.result.winner === 'player' ? 'text-emerald-400' : battleReport.result.winner === 'enemy' ? 'text-red-400' : 'text-amber-400'}>
                        {battleReport.result.winner === 'player' ? 'Player Victory' : battleReport.result.winner === 'enemy' ? 'Enemy Victory' : 'Draw'}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400 mt-1">Battle lasted {battleReport.result.ticks} ticks</div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Surviving Troops</h3>
                    <div className="text-sm space-y-1">
                      <div>
                        <span className="text-slate-400">Player: </span>
                        <span className="text-emerald-400">{battleReport.result.playerFinal.total.toFixed(0)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Enemy: </span>
                        <span className="text-red-400">{battleReport.result.enemyFinal.total.toFixed(0)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Banner Overview */}
              {battleReport.bannerXP && (() => {
                const banner = banners.find(b => b.id === battleReport.bannerXP!.bannerId);
                const initialTroops = battleReport.result.playerInitial.total;
                const finalTroops = battleReport.result.playerFinal.total;
                const losses = initialTroops - finalTroops;
                const isDestroyed = finalTroops === 0;

                return (
                  <div className={`bg-slate-800 rounded-lg p-4 mb-4 border ${isDestroyed ? 'border-red-700' : 'border-slate-700'}`}>
                    <h3 className="text-sm font-semibold text-slate-300 mb-3">
                      Banner Overview: {battleReport.bannerXP.bannerName}
                    </h3>
                    {isDestroyed ? (
                      <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-3 mb-3">
                        <div className="text-red-400 font-bold text-sm">⚠️ Banner Destroyed</div>
                        <div className="text-xs text-red-300 mt-1">All units have been lost in battle.</div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-slate-400 text-xs mb-1">Initial Troops</div>
                            <div className="text-white font-semibold">{initialTroops.toFixed(0)}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs mb-1">Final Troops</div>
                            <div className="text-emerald-400 font-semibold">{finalTroops.toFixed(0)}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs mb-1">Losses</div>
                            <div className="text-red-400 font-semibold">-{losses.toFixed(0)}</div>
                          </div>
                        </div>
                        {banner && banner.squads && banner.squads.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-700">
                            <div className="text-slate-400 text-xs mb-2">Squad Status:</div>
                            <div className="space-y-1">
                              {banner.squads.map((squad, idx) => {
                                const squadLosses = squad.maxSize - squad.currentSize;
                                const squadDestroyed = squad.currentSize === 0;
                                return (
                                  <div key={squad.id || idx} className="flex items-center justify-between text-xs">
                                    <span className={squadDestroyed ? 'text-red-400 line-through' : 'text-slate-300'}>
                                      {unitDisplayNames[squad.type]} Squad
                                    </span>
                                    <div className="flex items-center gap-2">
                                      {squadDestroyed ? (
                                        <span className="text-red-400 font-semibold">Destroyed</span>
                                      ) : (
                                        <>
                                          <span className="text-slate-400">
                                            {squad.currentSize}/{squad.maxSize}
                                          </span>
                                          {squadLosses > 0 && (
                                            <span className="text-red-400">
                                              (-{squadLosses})
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Banner XP Display */}
              {battleReport.bannerXP && (
                <div className="bg-slate-800 rounded-lg p-4 mb-4 border border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Banner Experience: {battleReport.bannerXP.bannerName}
                  </h3>
                  <div className="space-y-3">
                    {/* XP Gained */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">XP Gained:</span>
                      <span className={`font-semibold ${battleReport.bannerXP.xpGained > 0 ? 'text-emerald-400' : battleReport.bannerXP.xpGained < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {battleReport.bannerXP.xpGained > 0 ? '+' : ''}{battleReport.bannerXP.xpGained.toLocaleString()} XP
                      </span>
                    </div>

                    {/* Level Up Indicator */}
                    {battleReport.bannerXP.newLevel > battleReport.bannerXP.oldLevel && (
                      <div className="bg-emerald-600/20 border border-emerald-500/50 rounded-lg p-3 mb-2">
                        <div className="text-emerald-400 font-bold text-sm mb-1">🎉 Level Up!</div>
                        <div className="text-xs text-slate-300">
                          <span className="text-slate-400">Lvl {battleReport.bannerXP.oldLevel} – {battleReport.bannerXP.oldLevelName}</span>
                          <span className="mx-2">→</span>
                          <span className="text-emerald-400 font-semibold">Lvl {battleReport.bannerXP.newLevel} – {battleReport.bannerXP.newLevelName}</span>
                        </div>
                      </div>
                    )}

                    {/* Level Down Indicator */}
                    {battleReport.bannerXP.newLevel < battleReport.bannerXP.oldLevel && (
                      <div className="bg-red-600/20 border border-red-500/50 rounded-lg p-3 mb-2">
                        <div className="text-red-400 font-bold text-sm mb-1">⚠️ Level Down</div>
                        <div className="text-xs text-slate-300">
                          <span className="text-slate-400">Lvl {battleReport.bannerXP.oldLevel} – {battleReport.bannerXP.oldLevelName}</span>
                          <span className="mx-2">→</span>
                          <span className="text-red-400 font-semibold">Lvl {battleReport.bannerXP.newLevel} – {battleReport.bannerXP.newLevelName}</span>
                        </div>
                      </div>
                    )}

                    {/* Current Level and XP Progress */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Current Level:</span>
                        <span className="text-blue-300 font-semibold">
                          Lvl {battleReport.bannerXP.newLevel} – {battleReport.bannerXP.newLevelName}
                        </span>
                      </div>

                      {/* XP Progress Bar */}
                      <div className="w-full">
                        <div className="h-2 rounded-full overflow-hidden bg-slate-700">
                          <div
                            className="h-full bg-blue-500 transition-all"
                            style={{
                              width: `${Math.max(0, Math.min(100, ((battleReport.bannerXP.newXP - battleReport.bannerXP.xpCurrentLevel) / (battleReport.bannerXP.xpNextLevel - battleReport.bannerXP.xpCurrentLevel || 1)) * 100))}%`
                            }}
                          />
                        </div>
                        <div className="text-xs text-slate-400 mt-1 text-right">
                          {battleReport.bannerXP.newXP.toLocaleString()} / {battleReport.bannerXP.xpNextLevel.toLocaleString()} XP
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Commander XP Display */}
              {battleReport.commanderXP && (
                <div className="bg-slate-800 rounded-lg p-4 mb-4 border border-blue-700">
                  <h3 className="text-sm font-semibold text-blue-300 mb-3">
                    Commander Experience: {battleReport.commanderXP.commanderName}
                  </h3>
                  <div className="space-y-3">
                    {/* XP Gained */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">XP Gained:</span>
                      <span className="font-semibold text-emerald-400">
                        +{battleReport.commanderXP.xpGained.toLocaleString()} XP
                      </span>
                    </div>

                    {/* Level Up Indicator */}
                    {battleReport.commanderXP.newLevel > battleReport.commanderXP.oldLevel && (
                      <div className="bg-emerald-600/20 border border-emerald-500/50 rounded-lg p-3 mb-2">
                        <div className="text-emerald-400 font-bold text-sm mb-1">🎉 Level Up!</div>
                        <div className="text-xs text-slate-300">
                          <span className="text-slate-400">Lv {battleReport.commanderXP.oldLevel}</span>
                          <span className="mx-2">→</span>
                          <span className="text-emerald-400 font-semibold">Lv {battleReport.commanderXP.newLevel}</span>
                        </div>
                      </div>
                    )}

                    {/* Current Level and XP Progress */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Current Level:</span>
                        <span className="text-blue-300 font-semibold">
                          Lv {battleReport.commanderXP.newLevel}
                        </span>
                      </div>

                      {/* XP Progress Bar */}
                      {battleReport.commanderXP.newLevel < 99 && (
                        <div className="w-full">
                          <div className="h-2 rounded-full overflow-hidden bg-slate-700">
                            <div
                              className="h-full bg-blue-500 transition-all"
                              style={{
                                width: `${Math.max(0, Math.min(100, (battleReport.commanderXP.newXP / battleReport.commanderXP.xpToNextLevel) * 100))}%`
                              }}
                            />
                          </div>
                          <div className="text-xs text-slate-400 mt-1 text-right">
                            {battleReport.commanderXP.newXP.toLocaleString()} / {battleReport.commanderXP.xpToNextLevel.toLocaleString()} XP
                          </div>
                        </div>
                      )}
                      {battleReport.commanderXP.newLevel >= 99 && (
                        <div className="text-xs text-amber-400 font-semibold">
                          Max Level Reached
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Battle Graph */}
              <div className="bg-slate-800 p-4 rounded-lg mb-4">
                <h3 className="font-semibold mb-2">Battle Graph</h3>
                <BattleChart timeline={battleReport.result.timeline} />
                <div className="flex flex-wrap gap-4 mt-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-[#6fb3ff]"></span>
                    <span className="text-slate-400">Player morale</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-[#ff8c00]"></span>
                    <span className="text-slate-400">Enemy morale</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-[#2d9cff]"></span>
                    <span className="text-slate-400">Player troops</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-[#ff5d5d]"></span>
                    <span className="text-slate-400">Enemy troops</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">Battle Timeline</h3>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left p-2">Tick</th>
                        <th className="text-left p-2">Phase</th>
                        <th className="text-right p-2">P Troops</th>
                        <th className="text-right p-2">E Troops</th>
                        <th className="text-right p-2">P Morale</th>
                        <th className="text-right p-2">E Morale</th>
                        <th className="text-right p-2">P→E</th>
                        <th className="text-right p-2">E→P</th>
                      </tr>
                    </thead>
                    <tbody>
                      {battleReport.result.timeline.map((row, i) => (
                        <tr key={i} className="border-b border-slate-700/50">
                          <td className="p-2">{row.tick}</td>
                          <td className="p-2">{row.phase}</td>
                          <td className="text-right p-2">{row.A_troops.toFixed(1)}</td>
                          <td className="text-right p-2">{row.B_troops.toFixed(1)}</td>
                          <td className="text-right p-2">{row.A_morale.toFixed(1)}</td>
                          <td className="text-right p-2">{row.B_morale.toFixed(1)}</td>
                          <td className="text-right p-2">{row.AtoB?.toFixed(2) || '—'}</td>
                          <td className="text-right p-2">{row.BtoA?.toFixed(2) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {(() => {
                const mission = missions.find(m => m.id === battleReport.missionId);
                const isCompleted = mission?.status === 'completedRewardsClaimed';
                const isRewardsPending = mission?.status === 'completedRewardsPending';
                const isVictory = battleReport.result.winner === 'player';

                if (isCompleted) {
                  return (
                    <button
                      onClick={() => setBattleReport(null)}
                      className="mt-4 w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold"
                    >
                      Back
                    </button>
                  );
                }

                if (!isVictory) {
                  // Player lost - no rewards, just close button
                  return (
                    <button
                      onClick={() => setBattleReport(null)}
                      className="mt-4 w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold"
                    >
                      Close
                    </button>
                  );
                }

                return (
                  <button
                    onClick={() => {
                      // Only show reward popup if player won and rewards haven't been claimed yet
                      if (isRewardsPending && mission?.enemyComposition) {
                        const enemyTotal = getEnemyTotal(mission.enemyComposition);
                        const { tier, rewards } = generateMissionRewards(enemyTotal);
                        setBattleReport(null);
                        setRewardPopup({ missionId: mission.id, tier, rewards });
                      } else {
                        setBattleReport(null);
                      }
                    }}
                    className="mt-4 w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold"
                  >
                    {isRewardsPending ? 'Continue' : 'Close'}
                  </button>
                );
              })()}
            </div>
          </div>
        )
      }

      {/* Reward Popup Modal */}
      {
        rewardPopup && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-slate-900 border-2 border-amber-600 rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl">
              <div className="text-center mb-6">
                <div className="text-6xl mb-4">{REWARD_TIERS[rewardPopup.tier as RewardTier].icon}</div>
                <h2 className="text-3xl font-bold text-amber-400 mb-2">
                  {REWARD_TIERS[rewardPopup.tier as RewardTier].name}
                </h2>
                <p className="text-slate-300 text-sm">
                  {REWARD_TIERS[rewardPopup.tier as RewardTier].flavor}
                </p>
              </div>

              {/* Rewards List */}
              <div className="bg-slate-800 rounded-lg p-4 mb-6 border border-slate-700">
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Rewards:</h3>
                <div className="space-y-2">
                  {(rewardPopup.rewards.gold || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-yellow-400">💰</span>
                        <span className="text-slate-300">Gold</span>
                      </div>
                      <span className="text-yellow-400 font-semibold">{formatInt(rewardPopup.rewards.gold || 0)}</span>
                    </div>
                  )}
                  {(rewardPopup.rewards.wood || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-600">🪵</span>
                        <span className="text-slate-300">Wood</span>
                      </div>
                      <span className="text-amber-400 font-semibold">{formatInt(rewardPopup.rewards.wood || 0)}</span>
                    </div>
                  )}
                  {(rewardPopup.rewards.stone || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">🪨</span>
                        <span className="text-slate-300">Stone</span>
                      </div>
                      <span className="text-slate-300 font-semibold">{formatInt(rewardPopup.rewards.stone || 0)}</span>
                    </div>
                  )}
                  {(rewardPopup.rewards.food || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-green-400">🌾</span>
                        <span className="text-slate-300">Food</span>
                      </div>
                      <span className="text-green-400 font-semibold">{formatInt(rewardPopup.rewards.food || 0)}</span>
                    </div>
                  )}
                  {(rewardPopup.rewards.iron || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">⚙️</span>
                        <span className="text-slate-300">Iron</span>
                      </div>
                      <span className="text-gray-300 font-semibold">{formatInt(rewardPopup.rewards.iron || 0)}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  // Add rewards to warehouse
                  setWarehouse((w) => ({
                    ...w,
                    gold: Math.min(warehouseCap.gold, w.gold + (rewardPopup.rewards.gold || 0)),
                    wood: Math.min(warehouseCap.wood, w.wood + (rewardPopup.rewards.wood || 0)),
                    stone: Math.min(warehouseCap.stone, w.stone + (rewardPopup.rewards.stone || 0)),
                    food: Math.min(warehouseCap.food, w.food + (rewardPopup.rewards.food || 0)),
                    iron: Math.min(warehouseCap.iron, w.iron + (rewardPopup.rewards.iron || 0)),
                  }));

                  // Mark mission as completedRewardsClaimed and store reward tier
                  setMissions((ms) => ms.map((m) =>
                    m.id === rewardPopup.missionId
                      ? { ...m, status: 'completedRewardsClaimed' as const, rewardTier: rewardPopup.tier, rewards: rewardPopup.rewards }
                      : m
                  ));

                  // Close popup
                  setRewardPopup(null);

                  // Save game after claiming rewards
                  saveGame();
                }}
                className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-bold text-lg text-white transition-colors shadow-lg"
              >
                Claim Rewards
              </button>
            </div>
          </div>
        )
      }



      {/* Delete Squad Confirmation Modal */}
      {
        deleteSquadModal && (() => {
          const banner = banners.find(b => b.id === deleteSquadModal.bannerId);
          if (!banner) return null;

          // Ensure squads are initialized
          let displaySquads = banner.squads;
          if (!displaySquads || displaySquads.length === 0) {
            const { squads } = initializeSquadsFromUnits(banner.units, squadSeqRef.current);
            displaySquads = squads;
          }

          const squad = displaySquads.find(s => s.id === deleteSquadModal.squadId);
          if (!squad) return null;

          // Calculate refunds (only for trained units)
          const category = unitCategory[squad.type];
          const config = squadConfig[category];
          const perUnitPop = config.reqPop / config.maxSize;
          const perUnitIron = (ironCostPerSquad[squad.type] || 0) / config.maxSize;
          const populationRefund = Math.floor(perUnitPop * squad.currentSize); // proportional to trained soldiers
          const ironRefund = Math.floor(perUnitIron * squad.currentSize * 0.5); // 50% of trained soldiers' iron cost

          return (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
              <div className="bg-slate-900 border-2 border-red-600 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
                <h4 className="text-lg font-semibold mb-4 text-red-400">Delete Squad</h4>
                <p className="text-sm text-slate-300 mb-4">
                  Are you sure you want to delete this squad from <strong>{banner.name}</strong>?
                </p>

                {/* Squad to delete */}
                <div className="bg-slate-800 rounded-lg p-3 mb-4 border border-slate-700">
                  <div className="text-xs font-semibold text-slate-400 mb-2">Squad to delete:</div>
                  <div className="flex flex-wrap gap-1">
                    <span className="px-2 py-1 rounded text-xs bg-red-900/50 border border-red-700 text-red-200">
                      {unitDisplayNames[squad.type]} Squad ({squad.currentSize}/{squad.maxSize})
                    </span>
                  </div>
                </div>

                {/* Refunds */}
                <div className="bg-slate-800 rounded-lg p-3 mb-4 border border-slate-700">
                  <div className="text-xs font-semibold text-slate-400 mb-2">Resources recovered:</div>
                  <div className="space-y-1 text-sm">
                    {populationRefund > 0 ? (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Population:</span>
                        <span className="text-green-400 font-semibold">+{populationRefund}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Population:</span>
                        <span className="text-slate-500 text-xs">No refund (squad is empty)</span>
                      </div>
                    )}
                    {ironRefund > 0 ? (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Iron (50%):</span>
                        <span className="text-gray-300 font-semibold">+{ironRefund}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Iron (50%):</span>
                        <span className="text-slate-500 text-xs">No refund (squad is empty)</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setDeleteSquadModal(null);
                    }}
                    className="flex-1 px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteSquad}
                    className="flex-1 px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-semibold"
                  >
                    Delete Squad
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      }

      {/* Assign Commander Modal - Available from any tab */}
      {
        commanderAssignModal && (
          <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 border border-slate-800">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">Assign Commander</h3>
                <button
                  onClick={() => setCommanderAssignModal(null)}
                  className="text-slate-400 hover:text-white text-2xl"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                {commanderAssignModal.bannerId
                  ? 'Select a commander to assign to this banner:'
                  : 'Select a banner to assign this commander to:'}
              </p>
              {commanderAssignModal.bannerId ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {commanders.filter(c => c.assignedBannerId === null).length === 0 ? (
                    <div className="space-y-3">
                      <p className="text-slate-400 text-sm">No available commanders. Recruit one first.</p>
                      <button
                        onClick={() => {
                          setCommanderAssignModal(null);
                          setMainTab('council');
                        }}
                        className="w-full px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                      >
                        Go to Council to Recruit Commander
                      </button>
                    </div>
                  ) : (
                    commanders.filter(c => c.assignedBannerId === null).map(commander => {
                      const config = COMMANDER_ARCHETYPES[commander.archetype];
                      return (
                        <button
                          key={commander.id}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (commanderAssignModal?.bannerId) {
                              assignCommanderToBanner(commander.id, commanderAssignModal.bannerId);
                            }
                          }}
                          className="w-full text-left px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
                        >
                          <div className="font-semibold">{commander.name}</div>
                          <div className="text-xs text-slate-400">{config.label}</div>
                          <div className="text-xs text-slate-300">
                            +{commander.rangedAttackBonusPercent}% ranged, +{commander.meleeAttackBonusPercent}% melee
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {banners.filter(b => !b.commanderId).map(banner => (
                    <button
                      key={banner.id}
                      onClick={() => {
                        if (commanderAssignModal.commanderId) {
                          assignCommanderToBanner(commanderAssignModal.commanderId, banner.id);
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
                    >
                      <div className="font-semibold">{banner.name}</div>
                      <div className="text-xs text-slate-400">
                        {banner.squads.length} squads • {banner.status}
                      </div>
                    </button>
                  ))}
                  {banners.filter(b => !b.commanderId).length === 0 && (
                    <p className="text-slate-400 text-sm">No banners available (all have commanders assigned)</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      }

      {/* Bottom Navigation - Mobile Only */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur border-t border-slate-800">
        <div className="grid grid-cols-5 gap-1 p-1">
          <button
            onClick={() => setMainTab('production')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'production'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">🏭</span>
            <span className="text-[10px] font-semibold">Buildings</span>
          </button>
          <button
            onClick={() => setMainTab('council')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'council'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">👥</span>
            <span className="text-[10px] font-semibold">Council</span>
          </button>
          <button
            onClick={() => {
              if (barracks && barracks.level >= 1) {
                setMainTab('army');
              }
            }}
            disabled={!barracks || barracks.level < 1}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${!barracks || barracks.level < 1
              ? 'bg-transparent text-slate-600 cursor-not-allowed opacity-50'
              : mainTab === 'army'
                ? 'bg-slate-800 text-white'
                : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
            title={!barracks || barracks.level < 1 ? 'Requires Barracks Level 1' : 'Army'}
          >
            <span className="text-lg">⚔️</span>
            <span className="text-[10px] font-semibold">Army</span>
          </button>
          <button
            onClick={() => setMainTab('missions')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'missions'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">📜</span>
            <span className="text-[10px] font-semibold">Missions</span>
          </button>
          <button
            onClick={() => setMainTab('expeditions')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'expeditions'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">🗺️</span>
            <span className="text-[10px] font-semibold">Expeditions</span>
          </button>
        </div>
        {/* Secondary row for additional tabs */}
        <div className="grid grid-cols-4 gap-1 p-1 border-t border-slate-800">
          <button
            onClick={() => setMainTab('leaderboard')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'leaderboard'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">🏆</span>
            <span className="text-[10px] font-semibold">Leaderboard</span>
          </button>
          <button
            onClick={() => setMainTab('factions')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] ${mainTab === 'factions'
              ? 'bg-slate-800 text-white'
              : 'bg-transparent text-slate-400 active:bg-slate-800'
              }`}
          >
            <span className="text-lg">⚡</span>
            <span className="text-[10px] font-semibold">Factions</span>
          </button>
          <button
            onClick={() => setBlacksmithOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] bg-transparent text-slate-400 active:bg-slate-800"
          >
            <span className="text-lg">🔨</span>
            <span className="text-[10px] font-semibold">Blacksmith</span>
          </button>
          <button
            onClick={() => setTechnologiesOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-lg touch-manipulation min-h-[60px] bg-transparent text-slate-400 active:bg-slate-800"
          >
            <span className="text-lg">🔬</span>
            <span className="text-[10px] font-semibold">Tech</span>
          </button>
        </div>
      </div>

      {/* Bottom padding for mobile navigation */}
      <div className="md:hidden h-[140px]"></div>

      {/* Touch Overlay (Mobile Only) */}

      {/* Toast Notification */}
      {toastMessage !== null && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-[200] text-sm font-semibold animate-in fade-in duration-200 pointer-events-none">
          {toastMessage}
        </div>
      )}

    </div >
  );
}
