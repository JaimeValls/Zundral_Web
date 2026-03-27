// ═══════════════════════════════════════════════════════════════════════════
// Expedition Mission Definitions — EDIT THIS FILE TO BALANCE MISSIONS
// ═══════════════════════════════════════════════════════════════════════════
//
// Each mission defines:
//   id          — Unique identifier (must not collide with BASE_MISSION_POOL IDs 1-5)
//   name        — Display name shown on map marker and battle report
//   description — Flavour text shown in mission details
//   terrain     — Determines which province type the mission spawns on
//   difficulty  — Label for UI display + future scaling hooks
//   enemySquads — The enemy army composition for the field battle
//                 type: any UnitType (warrior, archer, militia, pikemen, light_cavalry, etc.)
//                 count: INDIVIDUAL troops (not squad units)
//
// To add a new mission: add an entry to EXPEDITION_MISSIONS below.
// To rebalance: edit the enemySquads counts.
// To add new unit types to enemies: use any valid UnitType from constants.ts
// ═══════════════════════════════════════════════════════════════════════════

export type ExpeditionMissionDef = {
  id: number;
  name: string;
  description: string;
  terrain: 'plains' | 'hills' | 'forest' | 'building';
  difficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'extreme';
  enemySquads: Array<{ type: string; count: number }>;
};

export const EXPEDITION_MISSIONS: ExpeditionMissionDef[] = [
  // ── EASY (beatable with 1 army of 80 troops) ─────────────────────────
  {
    id: 6,
    name: 'Break the Southern Blockade',
    terrain: 'plains',
    difficulty: 'easy',
    description: 'Enemy forces have erected a blockade on the southern path, disrupting trade and movement. Scouts confirm a small warrior squad supported by a handful of archers holding the chokepoint. Break their line and reopen the route.',
    enemySquads: [{ type: 'warrior', count: 50 }, { type: 'archer', count: 15 }],
  },
  {
    id: 15,
    name: 'Intercept the Supply Caravan',
    terrain: 'plains',
    difficulty: 'easy',
    description: 'A lightly guarded caravan is transporting weapons and armour to frontline forces. Intelligence indicates one warrior squad escorting supply wagons. Halt the caravan and seize the supplies.',
    enemySquads: [{ type: 'warrior', count: 60 }, { type: 'archer', count: 20 }],
  },

  // ── MEDIUM (needs 2 armies / ~160 troops) ─────────────────────────────
  {
    id: 10,
    name: 'Cleanse the Bandit Warrens',
    terrain: 'hills',
    difficulty: 'medium',
    description: 'A network of caves has become the base of a growing bandit force. Intelligence confirms three disorganised squads with mixed weaponry. Expect cramped fighting conditions and opportunistic strikes. Push through the warrens and eliminate their leadership.',
    enemySquads: [{ type: 'warrior', count: 100 }, { type: 'archer', count: 30 }],
  },
  {
    id: 21,
    name: 'Clear the Ruined Barracks',
    terrain: 'building',
    difficulty: 'medium',
    description: 'An abandoned barracks complex has been reoccupied by hostile troops and is now being used as a forward staging point. Clear the complex and deny the enemy a foothold.',
    enemySquads: [{ type: 'warrior', count: 120 }, { type: 'archer', count: 40 }],
  },
  {
    id: 7,
    name: 'Destroy the War Camp at Red Valley',
    terrain: 'plains',
    difficulty: 'medium',
    description: 'A medium-sized war camp has been established in Red Valley, preparing forces for future assaults. Disrupt their preparations and cripple their ability to expand.',
    enemySquads: [{ type: 'warrior', count: 150 }, { type: 'archer', count: 50 }],
  },
  {
    id: 11,
    name: 'Eliminate the Elite Vanguard',
    terrain: 'plains',
    difficulty: 'medium',
    description: 'Enemy commanders have deployed an elite vanguard to probe your defences. Expect coordinated attacks and higher combat proficiency. Disrupt their advance.',
    enemySquads: [{ type: 'warrior', count: 180 }, { type: 'archer', count: 60 }],
  },
  {
    id: 22,
    name: 'Seize the Broken Gatehouse',
    terrain: 'building',
    difficulty: 'medium',
    description: 'A shattered gatehouse on the old frontier road has been fortified again. Seize the gatehouse and reopen the route.',
    enemySquads: [{ type: 'warrior', count: 200 }, { type: 'archer', count: 50 }],
  },

  // ── HARD (total 500–1000) ─────────────────────────────────────────────
  {
    id: 13,
    name: 'Assault the Siege Workshop',
    terrain: 'building',
    difficulty: 'hard',
    description: 'A hidden workshop is producing siege equipment for future assaults. Intelligence estimates two warrior squads, one engineer squad, and a small archer detachment guarding the site. Expect traps and defensive constructs. Destroy the facility before production escalates.',
    enemySquads: [{ type: 'warrior', count: 480 }, { type: 'archer', count: 120 }],
  },
  {
    id: 23,
    name: 'Purge the Desecrated Chapel',
    terrain: 'building',
    difficulty: 'hard',
    description: 'A once-sacred chapel has been converted into an enemy strongpoint and rally site. Scouts identify three warrior squads, one archer detachment, and a veteran guard unit holding the main hall. Expect stubborn resistance in confined spaces. Purge the chapel and break the enemy hold over the area.',
    enemySquads: [{ type: 'warrior', count: 520 }, { type: 'archer', count: 130 }],
  },
  {
    id: 16,
    name: 'Break the Ironclad Phalanx',
    terrain: 'hills',
    difficulty: 'hard',
    description: 'A highly trained phalanx is blocking a strategic mountain pass. Scouts report one phalanx unit supported by two elite warriors. Expect a strong frontal defence. Flank their formation, break their discipline, and reopen the pass.',
    enemySquads: [{ type: 'warrior', count: 700 }, { type: 'archer', count: 200 }],
  },
  {
    id: 24,
    name: 'Break the Hall of Chains',
    terrain: 'building',
    difficulty: 'hard',
    description: 'A fortified prison hall is being used to hold captives and stockpile weapons for enemy operations. Intelligence reports four warrior squads supported by one archer unit guarding the central corridors and cell blocks. Expect heavy resistance across multiple interior positions. Break their control and secure the structure.',
    enemySquads: [{ type: 'warrior', count: 760 }, { type: 'archer', count: 140 }],
  },

  // ── VERY HARD (total 1000–4000) ───────────────────────────────────────
  {
    id: 17,
    name: 'Storm the Fortress of Grey Ridge',
    terrain: 'hills',
    difficulty: 'very_hard',
    description: 'A reinforced enemy fortress dominates Grey Ridge and controls several valleys. Intelligence confirms four warrior squads, two archer squads, and a veteran commander. Expect prolonged resistance. Breach their defences and reclaim the stronghold.',
    enemySquads: [{ type: 'warrior', count: 2000 }, { type: 'archer', count: 500 }],
  },
  {
    id: 18,
    name: "Defeat the Beastlord's Horde",
    terrain: 'forest',
    difficulty: 'very_hard',
    description: 'A monstrous warlord has assembled a large horde of beasts and fanatics. Scouts estimate three beast packs supported by two frenzied warrior squads. Expect erratic and aggressive assaults. Hold formation and cut through the enemy swarm.',
    enemySquads: [{ type: 'warrior', count: 2400 }, { type: 'archer', count: 800 }],
  },

  // ── EXTREME (total 4000+) ─────────────────────────────────────────────
  {
    id: 19,
    name: 'Burn the Great Encampment',
    terrain: 'plains',
    difficulty: 'extreme',
    description: 'A sprawling encampment is hosting large numbers of enemy troops and resources. Intelligence identifies five warrior squads, two archer units, and multiple auxiliary detachments. Expect widespread resistance across several positions. Torch the encampment and disrupt their supply network.',
    enemySquads: [{ type: 'warrior', count: 4000 }, { type: 'archer', count: 1000 }],
  },
];
