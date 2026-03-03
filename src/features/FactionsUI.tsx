// ============================================================================
// Zundral — FactionsUI
// Factions tab: FP management, faction selection, and perk tree.
// Receives all data and callbacks as props — no internal game state.
// ============================================================================

import React from 'react';
import type { PlayerFactionState, FactionId, FactionBranchId } from '../types';
import { canUnlockPerk } from '../gameFormulas';

export interface FactionsUIProps {
  factionState: PlayerFactionState;
  selectedFaction: FactionId;
  onSelectFaction: (faction: FactionId) => void;
  onAssignFP: (faction: FactionId, amount: number) => void;
  onUnlockPerk: (nodeId: string) => void;
  onSave: () => void;
}

export default function FactionsUI({
  factionState,
  selectedFaction,
  onSelectFaction,
  onAssignFP,
  onUnlockPerk,
  onSave,
}: FactionsUIProps) {
  return (
    <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
      <h2 className="text-base sm:text-lg md:text-xl font-semibold">Factions</h2>

      {/* FP Summary */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-slate-400 text-xs mb-1">Available FP</div>
            <div className="text-white font-semibold text-lg">{factionState.availableFP}</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs mb-1">Alsus</div>
            <div className="text-white font-semibold">{factionState.alsusFP} FP ({factionState.alsusUnspentFP} unspent)</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs mb-1">Atrox</div>
            <div className="text-white font-semibold">{factionState.atroxFP} FP ({factionState.atroxUnspentFP} unspent)</div>
          </div>
        </div>

        {/* Assign FP Buttons */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onAssignFP('Alsus', 1)}
            disabled={factionState.availableFP < 1}
            className={`px-3 py-1.5 rounded text-sm ${factionState.availableFP < 1
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
          >
            Assign 1 FP to Alsus
          </button>
          <button
            onClick={() => onAssignFP('Atrox', 1)}
            disabled={factionState.availableFP < 1}
            className={`px-3 py-1.5 rounded text-sm ${factionState.availableFP < 1
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
          >
            Assign 1 FP to Atrox
          </button>
        </div>
      </div>

      {/* Faction Selection */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => onSelectFaction('Alsus')}
          className={`px-4 py-2 rounded-lg font-semibold ${selectedFaction === 'Alsus'
            ? 'bg-blue-600 text-white'
            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
        >
          Alsus
        </button>
        <button
          onClick={() => onSelectFaction('Atrox')}
          className={`px-4 py-2 rounded-lg font-semibold ${selectedFaction === 'Atrox'
            ? 'bg-red-600 text-white'
            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
        >
          Atrox
        </button>
      </div>

      {/* Perk Trees */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(() => {
          const branches = selectedFaction === 'Alsus'
            ? [
              { id: 'Alsus_Tactics' as FactionBranchId, name: 'Magnus War Council', desc: 'Tactics / Army Quality' },
              { id: 'Alsus_Lux' as FactionBranchId, name: 'Lux Guardians', desc: 'Defence / Healing / Morale' },
              { id: 'Alsus_Crowns' as FactionBranchId, name: 'Pact of Crowns', desc: 'Economy / Stability' },
            ]
            : [
              { id: 'Atrox_Blood' as FactionBranchId, name: 'Blood Legions', desc: 'Offence / Aggression' },
              { id: 'Atrox_Fortress' as FactionBranchId, name: 'Iron Bastions of Roctium', desc: 'Fortifications / Counter-attack' },
              { id: 'Atrox_Spoils' as FactionBranchId, name: 'Spoils of War', desc: 'Raiding / Loot' },
            ];

          return branches.map(branch => {
            const branchPerks = Object.values(factionState.perks)
              .filter(p => p.branchId === branch.id)
              .sort((a, b) => a.tier - b.tier);

            return (
              <div key={branch.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <h3 className="text-sm font-semibold mb-1">{branch.name}</h3>
                <p className="text-xs text-slate-400 mb-3">{branch.desc}</p>
                <div className="space-y-2">
                  {branchPerks.map(perk => {
                    const canUnlock = canUnlockPerk(factionState, perk.id);
                    const unspentFP = selectedFaction === 'Alsus' ? factionState.alsusUnspentFP : factionState.atroxUnspentFP;

                    return (
                      <div
                        key={perk.id}
                        className={`rounded-lg border p-2 ${perk.unlocked
                          ? 'border-emerald-600 bg-emerald-900/20'
                          : canUnlock
                            ? 'border-slate-600 bg-slate-800 cursor-pointer hover:bg-slate-700'
                            : 'border-slate-700 bg-slate-800/50 opacity-60'
                          }`}
                        onClick={() => {
                          if (!perk.unlocked && canUnlock) {
                            onUnlockPerk(perk.id);
                            onSave();
                          }
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-xs font-semibold">{perk.name}</div>
                          <div className="text-xs text-slate-400">Tier {perk.tier}</div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-slate-400">Cost: {perk.costFP} FP</div>
                          {perk.unlocked ? (
                            <div className="text-xs text-emerald-400">✓ Unlocked</div>
                          ) : !canUnlock && unspentFP < perk.costFP ? (
                            <div className="text-xs text-red-400">Not enough Faction Points assigned to {selectedFaction}.</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </section>
  );
}
