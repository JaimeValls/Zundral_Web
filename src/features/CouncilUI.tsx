// ============================================================================
// Zundral — CouncilUI
// Council tab: Military Academy management and Commander recruitment/assignment.
// Receives all data and callbacks as props — no internal game state.
// ============================================================================

import React from 'react';
import type { Commander, Banner, MilitaryAcademyState, TownHallState, CommanderArchetype } from '../types';
import { COMMANDER_ARCHETYPES } from '../constants';
import {
  getMilitaryAcademyBuildCost,
  canBuildMilitaryAcademy,
  calculateCommanderXPToNextLevel,
  generateCommanderName,
} from '../gameFormulas';

export interface CouncilUIProps {
  militaryAcademy: MilitaryAcademyState | null;
  commanders: Commander[];
  townHall: TownHallState;
  banners: Banner[];
  commanderRecruitModal: boolean;
  candidateNames: Record<CommanderArchetype, string>;
  onBuildMilitaryAcademy: () => void;
  onUpgradeMilitaryAcademy: (currentLevel: number) => void;
  onOpenRecruitModal: () => void;
  onCloseRecruitModal: () => void;
  onRecruitCommander: (archetype: CommanderArchetype) => void;
  onOpenAssignModal: (commanderId: number) => void;
  onUnassignCommander: (commanderId: number) => void;
}

export default function CouncilUI({
  militaryAcademy,
  commanders,
  townHall,
  banners,
  commanderRecruitModal,
  candidateNames,
  onBuildMilitaryAcademy,
  onUpgradeMilitaryAcademy,
  onOpenRecruitModal,
  onCloseRecruitModal,
  onRecruitCommander,
  onOpenAssignModal,
  onUnassignCommander,
}: CouncilUIProps) {
  return (
    <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
      <h2 className="text-base sm:text-lg md:text-xl font-semibold">Council - Commanders</h2>

      {/* Military Academy Status */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        {!militaryAcademy || militaryAcademy.level === 0 ? (
          <div className="text-slate-400">
            <p className="font-semibold mb-2">A Military Academy is required to recruit a commander</p>
            {!militaryAcademy && canBuildMilitaryAcademy(townHall.level) && (
              <button
                onClick={onBuildMilitaryAcademy}
                className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
              >
                Build Military Academy ({getMilitaryAcademyBuildCost().wood} Wood, {getMilitaryAcademyBuildCost().stone} Stone)
              </button>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-semibold">Military Academy Level: {militaryAcademy.level}</div>
                <div className="text-sm text-slate-400">Commanders: {commanders.length} / {militaryAcademy.level}</div>
              </div>
              {militaryAcademy.level < 3 && (
                <button
                  onClick={() => onUpgradeMilitaryAcademy(militaryAcademy.level)}
                  className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                >
                  Upgrade (Lvl {militaryAcademy.level + 1})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Recruit Commander Button */}
      {militaryAcademy && militaryAcademy.level > 0 && commanders.length < militaryAcademy.level && (
        <button
          onClick={onOpenRecruitModal}
          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
        >
          Recruit Commander
        </button>
      )}

      {/* Available Commanders List */}
      {militaryAcademy && militaryAcademy.level > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 className="font-semibold mb-3">Available Commanders</h3>
          {commanders.filter(c => c.assignedBannerId === null).length === 0 ? (
            <p className="text-slate-400 text-sm">No available commanders. Recruit one to get started.</p>
          ) : (
            <div className="space-y-2">
              {commanders.filter(c => c.assignedBannerId === null).map(commander => {
                const config = COMMANDER_ARCHETYPES[commander.archetype];
                const level = commander.level || 1;
                const currentXP = commander.currentXP || 0;
                const xpToNextLevel = commander.xpToNextLevel || calculateCommanderXPToNextLevel(level);
                const levelBonus = level - 1;
                return (
                  <div key={commander.id} className="bg-slate-900 rounded p-3 border border-slate-700">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold">{commander.name}</div>
                          <div className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded font-semibold">
                            Lv {level}
                          </div>
                        </div>
                        <div className="text-xs text-slate-400">{config.label}</div>
                        <div className="text-xs text-slate-300 mt-1">
                          +{commander.rangedAttackBonusPercent}% ranged, +{commander.meleeAttackBonusPercent}% melee
                        </div>
                        {levelBonus > 0 && (
                          <div className="text-xs text-emerald-400 mt-1">
                            +{levelBonus}% all troop stats
                          </div>
                        )}
                        {/* XP Progress Bar */}
                        {level < 99 && (
                          <div className="mt-2">
                            <div className="h-1.5 rounded-full overflow-hidden bg-slate-700">
                              <div
                                className="h-full bg-blue-500 transition-all"
                                style={{
                                  width: `${Math.max(0, Math.min(100, (currentXP / xpToNextLevel) * 100))}%`
                                }}
                              />
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {currentXP.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP
                            </div>
                          </div>
                        )}
                        {level >= 99 && (
                          <div className="text-xs text-amber-400 mt-1 font-semibold">
                            Max Level
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => onOpenAssignModal(commander.id)}
                        className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm ml-2"
                      >
                        Assign to banner
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Assigned Commanders List */}
      {militaryAcademy && militaryAcademy.level > 0 && commanders.filter(c => c.assignedBannerId !== null).length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 className="font-semibold mb-3">Assigned Commanders</h3>
          <div className="space-y-2">
            {commanders.filter(c => c.assignedBannerId !== null).map(commander => {
              const banner = banners.find(b => b.id === commander.assignedBannerId);
              const config = COMMANDER_ARCHETYPES[commander.archetype];
              const level = commander.level || 1;
              const currentXP = commander.currentXP || 0;
              const xpToNextLevel = commander.xpToNextLevel || calculateCommanderXPToNextLevel(level);
              const levelBonus = level - 1;
              return (
                <div key={commander.id} className="bg-slate-900 rounded p-3 border border-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold">{commander.name}</div>
                        <div className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded font-semibold">
                          Lv {level}
                        </div>
                      </div>
                      <div className="text-xs text-slate-400">{config.label}</div>
                      <div className="text-xs text-slate-300 mt-1">
                        Assigned to: <strong>{banner?.name || 'Unknown Banner'}</strong>
                      </div>
                      {levelBonus > 0 && (
                        <div className="text-xs text-emerald-400 mt-1">
                          +{levelBonus}% all troop stats
                        </div>
                      )}
                      {/* XP Progress Bar */}
                      {level < 99 && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full overflow-hidden bg-slate-700">
                            <div
                              className="h-full bg-blue-500 transition-all"
                              style={{
                                width: `${Math.max(0, Math.min(100, (currentXP / xpToNextLevel) * 100))}%`
                              }}
                            />
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {currentXP.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP
                          </div>
                        </div>
                      )}
                      {level >= 99 && (
                        <div className="text-xs text-amber-400 mt-1 font-semibold">
                          Max Level
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => onUnassignCommander(commander.id)}
                      className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-sm ml-2"
                    >
                      Unassign
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recruit Commander Modal */}
      {commanderRecruitModal && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 p-6 border border-slate-800">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">Recruit Commander</h3>
              <button
                onClick={onCloseRecruitModal}
                className="text-slate-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-4">Choose one of the following candidates:</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['ranged_specialist', 'melee_specialist', 'balanced_leader'] as CommanderArchetype[]).map(archetype => {
                const config = COMMANDER_ARCHETYPES[archetype];
                const candidateName = candidateNames[archetype] || generateCommanderName(archetype);
                return (
                  <div
                    key={archetype}
                    className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-blue-500 cursor-pointer transition-colors"
                    onClick={() => onRecruitCommander(archetype)}
                  >
                    <div className="text-center mb-3">
                      <div className="text-4xl mb-2">⚔️</div>
                      <div className="font-semibold">{candidateName}</div>
                      <div className="text-xs text-slate-400">{config.label}</div>
                    </div>
                    <div className="text-xs text-slate-300 mt-2">
                      <div>+{config.rangedBonus}% Ranged Attack</div>
                      <div>+{config.meleeBonus}% Melee Attack</div>
                    </div>
                    <div className="text-xs text-slate-400 mt-2">{config.description}</div>
                    <button
                      className="w-full mt-3 px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRecruitCommander(archetype);
                      }}
                    >
                      Recruit
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
