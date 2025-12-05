// Leaderboard System

// ============================================================================
// Types
// ============================================================================

export type Faction = 'Alsus' | 'Atrox' | 'Neutral';

export interface LeaderboardEntry {
  playerId: string;
  playerName: string;
  faction: Faction;
  totalScore: number;
  totalKills: number;
  totalVictories: number;
  rank: number;
  title: string;
}

export interface BattleResult {
  enemyUnitsKilled: number;
  isVictory: boolean;
  playerId: string;
  playerName: string;
  faction: Faction;
}

// ============================================================================
// Title Mapping
// ============================================================================

const TITLES = [
  'Recruit',
  'Militiaman',
  'Footsoldier',
  'Vanguard',
  'Skirmisher',
  'Man-at-Arms',
  'Sergeant',
  'Veteran Sergeant',
  'Lieutenant',
  'Captain',
  'Battle Captain',
  'Major',
  'Field Commander',
  'War Captain',
  'High Commander',
  'Marshal',
  'High Marshal',
  'Warlord',
  'High Warlord',
  'Champion of the Front',
  'Grand Champion',
  'Hero of the Realm',
  'Legend of War',
  'Mythic Conqueror',
] as const;

export function getTitleForRank(rank: number, totalPlayers: number): string {
  if (rank <= 0) return TITLES[0];
  if (rank === 1) return TITLES[23]; // Mythic Conqueror
  if (rank >= 2 && rank <= 5) return TITLES[22]; // Legend of War
  if (rank >= 6 && rank <= 10) return TITLES[21]; // Hero of the Realm
  if (rank >= 11 && rank <= 20) return TITLES[20]; // Grand Champion
  if (rank >= 21 && rank <= 35) return TITLES[19]; // Champion of the Front
  if (rank >= 36 && rank <= 50) return TITLES[18]; // High Warlord
  if (rank >= 51 && rank <= 75) return TITLES[17]; // Warlord
  if (rank >= 76 && rank <= 100) return TITLES[16]; // High Marshal
  if (rank >= 101 && rank <= 140) return TITLES[15]; // Marshal
  if (rank >= 141 && rank <= 180) return TITLES[14]; // High Commander
  if (rank >= 181 && rank <= 220) return TITLES[13]; // War Captain
  if (rank >= 221 && rank <= 260) return TITLES[12]; // Field Commander
  if (rank >= 261 && rank <= 320) return TITLES[11]; // Major
  if (rank >= 321 && rank <= 380) return TITLES[10]; // Battle Captain
  if (rank >= 381 && rank <= 440) return TITLES[9]; // Captain
  if (rank >= 441 && rank <= 500) return TITLES[8]; // Lieutenant
  if (rank >= 501 && rank <= 600) return TITLES[7]; // Veteran Sergeant
  if (rank >= 601 && rank <= 700) return TITLES[6]; // Sergeant
  if (rank >= 701 && rank <= 850) return TITLES[5]; // Man-at-Arms
  if (rank >= 851 && rank <= 1000) return TITLES[4]; // Skirmisher
  if (rank >= 1001 && rank <= 1200) return TITLES[3]; // Vanguard
  if (rank >= 1201 && rank <= 1400) return TITLES[2]; // Footsoldier
  if (rank >= 1401 && rank <= 1600) return TITLES[1]; // Militiaman
  return TITLES[0]; // Recruit
}

// ============================================================================
// Scoring Functions
// ============================================================================

export function calculateBattlePoints(enemyUnitsKilled: number, isVictory: boolean): number {
  const basePoints = enemyUnitsKilled;
  if (isVictory) {
    return Math.floor(basePoints * 1.2);
  }
  return basePoints;
}

// ============================================================================
// Leaderboard Management
// ============================================================================

export function updateLeaderboardFromBattleResult(
  leaderboard: LeaderboardEntry[],
  battleResult: BattleResult
): LeaderboardEntry[] {
  const updated = [...leaderboard];
  
  // Find or create entry for this player
  let entryIndex = updated.findIndex(e => e.playerId === battleResult.playerId);
  
  if (entryIndex === -1) {
    // Create new entry
    const newEntry: LeaderboardEntry = {
      playerId: battleResult.playerId,
      playerName: battleResult.playerName,
      faction: battleResult.faction,
      totalScore: 0,
      totalKills: 0,
      totalVictories: 0,
      rank: 0,
      title: TITLES[0],
    };
    updated.push(newEntry);
    entryIndex = updated.length - 1;
  }
  
  // Update entry
  const entry = updated[entryIndex];
  const battlePoints = calculateBattlePoints(battleResult.enemyUnitsKilled, battleResult.isVictory);
  
  updated[entryIndex] = {
    ...entry,
    totalKills: entry.totalKills + battleResult.enemyUnitsKilled,
    totalVictories: entry.totalVictories + (battleResult.isVictory ? 1 : 0),
    totalScore: entry.totalScore + battlePoints,
  };
  
  // Sort and reassign ranks
  return recalculateRanksAndTitles(updated);
}

export function recalculateRanksAndTitles(leaderboard: LeaderboardEntry[]): LeaderboardEntry[] {
  // Sort by totalScore descending, then by totalKills descending, then by totalVictories descending, then by playerId
  const sorted = [...leaderboard].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
    if (b.totalVictories !== a.totalVictories) return b.totalVictories - a.totalVictories;
    return a.playerId.localeCompare(b.playerId);
  });
  
  const totalPlayers = sorted.length;
  
  // Assign ranks and titles
  return sorted.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    title: getTitleForRank(index + 1, totalPlayers),
  }));
}

// ============================================================================
// Placeholder Data Generation
// ============================================================================

export function createPlaceholderLeaderboard(realPlayerName: string = 'REAL PLAYER', realPlayerFaction: Faction = 'Alsus'): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  
  // Real player entry
  entries.push({
    playerId: 'real_player',
    playerName: realPlayerName,
    faction: realPlayerFaction,
    totalScore: 0,
    totalKills: 0,
    totalVictories: 0,
    rank: 0,
    title: TITLES[0],
  });
  
  // Generate 19 fake players with varied stats
  const factions: Faction[] = ['Alsus', 'Atrox', 'Neutral'];
  const namePrefixes = ['Shadow', 'Iron', 'Storm', 'Blood', 'Fire', 'Dark', 'Light', 'Frost', 'Thunder', 'Steel'];
  const nameSuffixes = ['Warrior', 'Blade', 'Shield', 'Arrow', 'Spear', 'Axe', 'Hammer', 'Bow', 'Sword', 'Dagger'];
  
  for (let i = 1; i <= 19; i++) {
    const prefix = namePrefixes[Math.floor(Math.random() * namePrefixes.length)];
    const suffix = nameSuffixes[Math.floor(Math.random() * nameSuffixes.length)];
    const playerName = `${prefix}${suffix}${i}`;
    const faction = factions[Math.floor(Math.random() * factions.length)];
    
    // Generate varied stats
    // Higher index = generally higher stats (but with some randomness)
    const baseKills = 50 + (i * 20) + Math.floor(Math.random() * 100);
    const baseVictories = Math.floor(baseKills / 10) + Math.floor(Math.random() * 5);
    const baseScore = baseKills + Math.floor(baseKills * 0.2 * baseVictories);
    
    entries.push({
      playerId: `player${i}`,
      playerName,
      faction,
      totalScore: baseScore,
      totalKills: baseKills,
      totalVictories: baseVictories,
      rank: 0,
      title: TITLES[0],
    });
  }
  
  // Recalculate ranks and titles
  return recalculateRanksAndTitles(entries);
}

