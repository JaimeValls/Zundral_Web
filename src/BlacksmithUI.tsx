import React, { useState, useEffect } from "react";

// Types
type GearType = 'weapon' | 'armour';
type WeaponName = 'short_swords' | 'long_swords' | 'pikes' | 'bows';
type ArmourName = 'clothes' | 'leather_armour' | 'coat_of_mail' | 'plates';

interface GearItem {
  id: string;
  name: string;
  level: number;
  bonusPerLevel: number;
  type: GearType;
  affects: string;
}

interface UpgradeCost {
  iron: number;
  gold: number;
}

interface BlacksmithUIProps {
  isOpen: boolean;
  onClose: () => void;
  warehouse: { iron: number; gold: number };
  onUpgrade: (itemId: string, cost: UpgradeCost) => void;
}

interface UpgradingState {
  itemId: string;
  targetLevel: number;
  timeRemaining: number; // seconds
}

// Initial gear data
const INITIAL_WEAPONS: Record<WeaponName, GearItem> = {
  short_swords: {
    id: 'short_swords',
    name: 'Short Swords',
    level: 7,
    bonusPerLevel: 1,
    type: 'weapon',
    affects: 'Units equipped with Short Swords',
  },
  long_swords: {
    id: 'long_swords',
    name: 'Long Swords',
    level: 3,
    bonusPerLevel: 1,
    type: 'weapon',
    affects: 'Units equipped with Long Swords',
  },
  pikes: {
    id: 'pikes',
    name: 'Pikes',
    level: 5,
    bonusPerLevel: 1,
    type: 'weapon',
    affects: 'Units equipped with Pikes',
  },
  bows: {
    id: 'bows',
    name: 'Bows',
    level: 4,
    bonusPerLevel: 1,
    type: 'weapon',
    affects: 'Units equipped with Bows',
  },
};

const INITIAL_ARMOUR: Record<ArmourName, GearItem> = {
  clothes: {
    id: 'clothes',
    name: 'Clothes',
    level: 1,
    bonusPerLevel: 1,
    type: 'armour',
    affects: 'Units equipped with Clothes',
  },
  leather_armour: {
    id: 'leather_armour',
    name: 'Leather Armour',
    level: 6,
    bonusPerLevel: 1,
    type: 'armour',
    affects: 'Units equipped with Leather Armour',
  },
  coat_of_mail: {
    id: 'coat_of_mail',
    name: 'Coat of Mail',
    level: 2,
    bonusPerLevel: 1,
    type: 'armour',
    affects: 'Units equipped with Coat of Mail',
  },
  plates: {
    id: 'plates',
    name: 'Plates',
    level: 0,
    bonusPerLevel: 1,
    type: 'armour',
    affects: 'Units equipped with Plates',
  },
};

// Calculate upgrade cost based on level
// Examples from spec:
// - Long Swords (Lvl 3) → Next: 55 Iron, 22 Gold
// - Plates (Lvl 0) → Next: 80 Iron, 40 Gold
function getUpgradeCost(level: number, type: GearType): UpgradeCost {
  if (type === 'weapon') {
    // Weapons: base ~50 iron, ~20 gold, scales with level
    const baseIron = 50;
    const baseGold = 20;
    // Scale factor: Lvl 3 should give ~55 iron, so factor ≈ 1.1 per level
    const factor = 1 + (level * 0.05); // Rough approximation
    return {
      iron: Math.round(baseIron * factor),
      gold: Math.round(baseGold * factor),
    };
  } else {
    // Armour: base 80 iron, 40 gold, scales with level
    const baseIron = 80;
    const baseGold = 40;
    const factor = 1 + (level * 0.05);
    return {
      iron: Math.round(baseIron * factor),
      gold: Math.round(baseGold * factor),
    };
  }
}

const UPGRADE_DURATION = 10; // 10 seconds

export default function BlacksmithUI({ isOpen, onClose, warehouse, onUpgrade }: BlacksmithUIProps) {
  const [activeTab, setActiveTab] = useState<'weapons' | 'armour'>('weapons');
  const [weapons, setWeapons] = useState(INITIAL_WEAPONS);
  const [armour, setArmour] = useState(INITIAL_ARMOUR);
  const [upgrading, setUpgrading] = useState<UpgradingState | null>(null);

  // Countdown timer for upgrades
  useEffect(() => {
    if (!upgrading) return;

    const interval = setInterval(() => {
      setUpgrading(prev => {
        if (!prev) return null;
        const newTime = prev.timeRemaining - 1;
        
        if (newTime <= 0) {
          // Upgrade complete - increase level
          const itemId = prev.itemId;
          const targetLevel = prev.targetLevel;
          
          // Find which type it is
          const isWeapon = weapons[itemId as WeaponName] !== undefined;
          
          if (isWeapon) {
            setWeapons(prevWeapons => ({
              ...prevWeapons,
              [itemId as WeaponName]: {
                ...prevWeapons[itemId as WeaponName],
                level: targetLevel,
              },
            }));
          } else {
            setArmour(prevArmour => ({
              ...prevArmour,
              [itemId as ArmourName]: {
                ...prevArmour[itemId as ArmourName],
                level: targetLevel,
              },
            }));
          }
          
          return null; // Clear upgrading state
        }
        
        return { ...prev, timeRemaining: newTime };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [upgrading, weapons]);

  if (!isOpen) return null;

  const weaponsList = Object.values(weapons);
  const armourList = Object.values(armour);
  const currentList = activeTab === 'weapons' ? weaponsList : armourList;

  const getTotalBonus = (item: GearItem) => {
    return item.level * item.bonusPerLevel;
  };

  const getBonusType = (type: GearType) => {
    return type === 'weapon' ? 'Attack' : 'Defence';
  };

  const formatInt = (n: number) => Math.floor(n).toLocaleString();

  const handleUpgrade = (item: GearItem) => {
    // Check if Blacksmith is already busy
    if (upgrading) {
      return; // Blacksmith is busy
    }
    
    const nextLevel = item.level + 1;
    if (nextLevel > 10) return; // Max level 10
    
    const cost = getUpgradeCost(item.level, item.type);
    
    // Check if player has enough resources
    if (warehouse.iron >= cost.iron && warehouse.gold >= cost.gold) {
      // Pay the cost immediately
      onUpgrade(item.id, cost);
      
      // Start the upgrade timer
      setUpgrading({
        itemId: item.id,
        targetLevel: nextLevel,
        timeRemaining: UPGRADE_DURATION,
      });
    }
  };

  // Get the item that's currently upgrading
  const upgradingItem = upgrading 
    ? [...weaponsList, ...armourList].find(item => item.id === upgrading.itemId)
    : null;

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl bg-slate-900 border border-slate-800 flex flex-col overflow-hidden">
        {/* TOP BAR */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-xl font-bold">BLACKSMITH – Gear Upgrades</h2>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            X
          </button>
        </div>

        {/* BODY: Two columns */}
        <div className="flex-1 overflow-hidden flex gap-4 p-4">
          {/* LEFT COLUMN: Upgrades List */}
          <div className="w-1/2 flex flex-col">
            <div className="rounded-xl border border-slate-700 bg-slate-800 flex flex-col overflow-hidden">
              {/* Title bar with tabs inside */}
              <div className="p-3 border-b border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-300">Upgrades List</h3>
                </div>
                {/* Tabs inside the left card */}
                <div className="flex rounded-lg overflow-hidden border border-slate-600">
                  <button
                    onClick={() => setActiveTab('weapons')}
                    className={`flex-1 px-3 py-1.5 text-xs font-semibold ${
                      activeTab === 'weapons'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    WEAPONS
                  </button>
                  <button
                    onClick={() => setActiveTab('armour')}
                    className={`flex-1 px-3 py-1.5 text-xs font-semibold ${
                      activeTab === 'armour'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    ARMOUR
                  </button>
                </div>
              </div>
              
              {/* Scrollable list */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {currentList.map((item) => {
                    const isUpgradingThis = upgrading && upgrading.itemId === item.id;
                    const totalBonus = getTotalBonus(item);
                    const bonusType = getBonusType(item.type);
                    const cost = getUpgradeCost(item.level, item.type);
                    const hasEnoughResources = warehouse.iron >= cost.iron && warehouse.gold >= cost.gold;
                    const canUpgrade = !upgrading && hasEnoughResources && item.level < 10;
                    const isBlacksmithBusy = upgrading && !isUpgradingThis;
                    
                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-slate-600 bg-slate-900 p-3"
                      >
                        <div className="space-y-2">
                          {/* Name and level */}
                          <div className="font-semibold">
                            {item.name} (Lvl {item.level})
                          </div>
                          
                          {/* Fixed description */}
                          <div className="text-xs text-slate-400">
                            +{item.bonusPerLevel}% {bonusType} per level
                          </div>
                          
                          {/* Total bonus */}
                          <div className="text-xs text-slate-300">
                            Total Bonus: +{totalBonus}% {bonusType}
                          </div>
                          
                          {/* Cost */}
                          <div className="text-xs">
                            <span className="text-slate-400">Cost: </span>
                            <span className={warehouse.iron >= cost.iron ? 'text-emerald-400' : 'text-red-400'}>
                              {formatInt(cost.iron)} Iron
                            </span>
                            <span className="text-slate-400"> • </span>
                            <span className={warehouse.gold >= cost.gold ? 'text-emerald-400' : 'text-red-400'}>
                              {formatInt(cost.gold)} Gold
                            </span>
                          </div>
                          
                          {/* Busy message or upgrade button */}
                          {isBlacksmithBusy && (
                            <div className="text-xs text-amber-400">
                              Blacksmith is busy.
                            </div>
                          )}
                          
                          {isUpgradingThis ? (
                            <button
                              disabled
                              className="w-full px-3 py-2 rounded bg-slate-700 text-slate-400 text-sm font-semibold cursor-not-allowed"
                            >
                              Upgrading…
                            </button>
                          ) : (
                            <button
                              onClick={() => handleUpgrade(item)}
                              disabled={!canUpgrade}
                              className="w-full px-3 py-2 rounded bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              UPGRADE
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Upgrades in Progress */}
          <div className="w-1/2 flex flex-col">
            <div className="rounded-xl border border-slate-700 bg-slate-800 flex flex-col overflow-hidden">
              {/* Title bar */}
              <div className="p-3 border-b border-slate-700">
                <h3 className="text-sm font-semibold text-slate-300">Upgrades in Progress</h3>
              </div>
              
              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {!upgrading ? (
                  <div className="flex items-center justify-center h-full text-slate-500 text-sm text-center">
                    <div>
                      <div>No upgrades in progress.</div>
                      <div className="mt-2">Select an item on the left and press UPGRADE to begin.</div>
                    </div>
                  </div>
                ) : upgradingItem ? (
                  <div className="rounded-lg border border-slate-600 bg-slate-900 p-4 space-y-3">
                    {/* Item name */}
                    <div className="font-semibold text-lg">{upgradingItem.name}</div>
                    
                    {/* Type */}
                    <div className="text-sm text-slate-400">
                      Type: {upgradingItem.type === 'weapon' ? 'Weapon' : 'Armour'}
                    </div>
                    
                    {/* Target level */}
                    <div className="text-sm text-slate-300">
                      Upgrading to Level {upgrading.targetLevel}
                    </div>
                    
                    {/* Timer */}
                    <div className="text-sm text-slate-300">
                      Time remaining: {upgrading.timeRemaining}s
                    </div>
                    
                    {/* Progress bar */}
                    <div className="space-y-2">
                      <div className="h-4 rounded bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-sky-500 transition-all duration-300"
                          style={{ width: `${((UPGRADE_DURATION - upgrading.timeRemaining) / UPGRADE_DURATION) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
