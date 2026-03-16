// ============================================================================
// Zundral — ExpeditionsUI
// Expeditions tab: expedition management, fortress operations, and siege battles.
// Receives all data and callbacks as props — no internal game state.
// UI-only state (battleLoading, battleError) is managed internally.
// ============================================================================

import React, { useState } from 'react';
import type { Expedition, Banner, WarehouseState, SiegeBattleResult, UnitType } from '../types';
import { SiegeGraphCanvas, InnerBattleGraphCanvas } from '../components/BattleChart';
import { unitCategory, unitDisplayNames } from '../constants';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function formatInt(n: number) { return Math.floor(n).toLocaleString(); }

const BATTLE_PROGRESS_DURATION_MS = 3000;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExpeditionsUIProps {
  expeditions: Expedition[];
  banners: Banner[];
  population: number;
  warehouse: WarehouseState;
  onAcceptExpedition: (expeditionId: string) => void;
  onSendResource: (expeditionId: string, resource: 'wood' | 'stone' | 'food' | 'population') => void;
  onLaunchExpedition: (expeditionId: string) => void;
  onGetWallArchers: (expeditionId: string) => { available: number; capacity: number; active: number };
  onUpgradeFortressBuilding: (expeditionId: string, buildingId: string) => void;
  onRemoveBannerFromFortress: (expeditionId: string, bannerId: number) => void;
  onAssignBannerToFortress: (expeditionId: string, bannerId: number) => void;
  /** Run battle, apply casualties, update parent state. Returns destroyed banner IDs or null on error. */
  onRunBattle: (expeditionId: string) => { result: SiegeBattleResult; destroyedBanners: number[] } | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExpeditionsUI({
  expeditions,
  banners,
  population,
  warehouse,
  onAcceptExpedition,
  onSendResource,
  onLaunchExpedition,
  onGetWallArchers,
  onUpgradeFortressBuilding,
  onRemoveBannerFromFortress,
  onAssignBannerToFortress,
  onRunBattle,
}: ExpeditionsUIProps) {
  const [battleLoading, setBattleLoading] = useState<{ expeditionId: string; progress: number } | null>(null);
  const [battleError, setBattleError] = useState<{ expeditionId: string; message: string } | null>(null);

  return (
    <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
      <h2 className="text-base sm:text-lg md:text-xl font-semibold">Expeditions</h2>
      <div className="space-y-3">
        {expeditions.map((exp) => {
          return (
            <div key={exp.expeditionId} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="font-semibold text-sm mb-1">{exp.title}</div>
                  <div className="text-xs text-slate-400 mb-2">{exp.shortSummary}</div>
                  {(exp.state === 'available' || exp.state === 'funding' || exp.state === 'readyToLaunch') && (
                    <div className="text-xs text-slate-300 whitespace-pre-line mt-2">{exp.description}</div>
                  )}
                </div>
                {exp.state === 'completed' && (
                  <div className="text-xs px-2 py-1 rounded bg-emerald-900 text-emerald-200">Completed</div>
                )}
              </div>

              {/* Available state: Show Accept button */}
              {exp.state === 'available' && (
                <div className="mt-3">
                  <div className="text-xs text-slate-300 mb-3">
                    Preparation requires 500 Wood, 250 Stone, 1000 Food and 5 Population.
                  </div>
                  <button
                    onClick={() => onAcceptExpedition(exp.expeditionId)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                  >
                    Accept Expedition
                  </button>
                </div>
              )}

              {/* Funding state: Show requirements with progress bars */}
              {exp.state === 'funding' && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-300 mb-2">Resource Progress:</div>
                  {(['wood', 'stone', 'food', 'population'] as const).map((resourceType) => {
                    const req = exp.requirements[resourceType];
                    const isComplete = req.current >= req.required;
                    const currentStock = resourceType === 'population'
                      ? population
                      : warehouse[resourceType];
                    const canSend = currentStock > 0 && !isComplete;
                    const progress = Math.min(100, (req.current / req.required) * 100);

                    return (
                      <div key={resourceType} className="flex items-center gap-2 text-xs">
                        <span className="capitalize w-20">{resourceType === 'population' ? 'Population' : resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}:</span>
                        <span className={isComplete ? 'text-emerald-400' : 'text-slate-300'}>
                          {formatInt(req.current)} / {formatInt(req.required)}
                        </span>
                        <div className="flex-1 h-1.5 rounded bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full ${isComplete ? 'bg-emerald-500' : 'bg-sky-500'}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        {!isComplete && (
                          <button
                            onClick={() => onSendResource(exp.expeditionId, resourceType)}
                            disabled={!canSend}
                            className={`px-1.5 py-0.5 rounded text-xs font-bold ${canSend
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-red-900 text-red-300 cursor-not-allowed opacity-75'
                              }`}
                            title={canSend ? `Send ${resourceType}` : `Insufficient ${resourceType}`}
                          >
                            +
                          </button>
                        )}
                        {isComplete && <span className="text-emerald-400 text-[10px]">✓</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ReadyToLaunch state: Show completed requirements and Launch button */}
              {exp.state === 'readyToLaunch' && (
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300 mb-2">Resource Progress:</div>
                    {(['wood', 'stone', 'food', 'population'] as const).map((resourceType) => {
                      const req = exp.requirements[resourceType];
                      return (
                        <div key={resourceType} className="flex items-center gap-2 text-xs">
                          <span className="capitalize w-20">{resourceType === 'population' ? 'Population' : resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}:</span>
                          <span className="text-emerald-400">
                            {formatInt(req.current)} / {formatInt(req.required)}
                          </span>
                          <div className="flex-1 h-1.5 rounded bg-slate-800 overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: '100%' }} />
                          </div>
                          <span className="text-emerald-400 text-[10px]">✓</span>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => onLaunchExpedition(exp.expeditionId)}
                    className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                  >
                    Launch Expedition
                  </button>
                </div>
              )}

              {/* Travelling state: Show progress bar */}
              {exp.state === 'travelling' && (
                <div className="mt-3">
                  <div className="text-xs text-slate-300 mb-2">The expedition is travelling through the mountain passes of Godonis...</div>
                  <div className="h-2 rounded bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-100"
                      style={{ width: `${exp.travelProgress}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">Travelling</div>
                </div>
              )}

              {/* Completed state: Show completion message and fortress section */}
              {exp.state === 'completed' && exp.fortress && (
                <div className="mt-3 space-y-4">
                  <div className="text-xs text-emerald-400">
                    The expedition was successful. A frontier fortress has been established in the mountains of Godonis.
                  </div>

                  {/* Frontier Fortress Section */}
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <div className="text-sm font-semibold mb-3">Frontier Fortress of Godonis</div>

                    {/* Fortress Stats Summary */}
                    {(() => {
                      const wallArchers = onGetWallArchers(exp.expeditionId);
                      const watchPost = exp.fortress.buildings.find(b => b.id === 'watch_post');
                      const watchPostLevel = watchPost?.level || 0;
                      return (
                        <div className="text-xs text-slate-300 mb-3">
                          Fort HP: <span className="text-slate-100">{formatInt(exp.fortress.stats.fortHP)}</span> |
                          Watch Post: <span className="text-slate-100">Lv {watchPostLevel}</span> |
                          Wall Archers: <span className="text-slate-100">{formatInt(wallArchers.active)} / {formatInt(wallArchers.capacity)}</span> |
                          Garrison: <span className="text-slate-100">{formatInt(exp.fortress.stats.garrisonWarriors)} Warriors, {formatInt(exp.fortress.stats.garrisonArchers)} Archers</span> |
                          Stored Squads: <span className="text-slate-100">{formatInt(exp.fortress.stats.storedSquads)}</span>
                        </div>
                      );
                    })()}
                    <div className="text-[10px] text-slate-500 mb-3">
                      These stats feed the Fortress Simulator.
                    </div>

                    {/* Fortress Buildings List */}
                    <div className="space-y-2">
                      {exp.fortress.buildings.map((building) => {
                        const nextLevel = building.level + 1;
                        const canUpgrade = nextLevel <= building.maxLevel;
                        const nextCost = canUpgrade ? building.getUpgradeCost(nextLevel) : null;
                        const enoughWood = nextCost ? warehouse.wood >= nextCost.wood : false;
                        const enoughStone = nextCost ? warehouse.stone >= nextCost.stone : false;
                        const affordable = canUpgrade && enoughWood && enoughStone;
                        const nextEffect = canUpgrade ? building.getEffect(nextLevel) : null;
                        const currentEffect = building.getEffect(building.level);

                        return (
                          <div key={building.id} className="rounded-lg border border-slate-800 bg-slate-800 p-2">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-1.5 flex-wrap">
                                  <div className="text-sm font-semibold truncate">{building.name}</div>
                                  <div className="text-[10px] px-1 py-0.5 rounded bg-slate-700">Lv {building.level}</div>
                                  <div className="text-[10px] text-slate-400">
                                    {building.id === 'watch_post'
                                      ? `+${currentEffect.archerSlots || 0} Archer slots (max ${currentEffect.archerSlots || 0} archers shooting from walls)`
                                      : building.description
                                    }
                                  </div>
                                </div>
                                {building.id === 'watch_post' && (
                                  <div className="text-[10px] text-slate-500 mt-1" title="Watch Post: Allows up to X archers from the defending armies to fire from the walls during the first phase of the siege.">
                                    Allows up to {currentEffect.archerSlots || 0} archers from defending armies to fire from walls during phase 1.
                                  </div>
                                )}
                                {canUpgrade && nextEffect && (
                                  <div className="text-[10px] text-slate-500 mt-1">
                                    Next level: {
                                      nextEffect.fortHP ? `+${nextEffect.fortHP - (currentEffect.fortHP || 0)} Fort HP` :
                                        nextEffect.archerSlots ? `+${nextEffect.archerSlots - (currentEffect.archerSlots || 0)} Archer slots (max ${nextEffect.archerSlots} archers shooting from walls)` :
                                          nextEffect.garrisonWarriors ? `+${nextEffect.garrisonWarriors - (currentEffect.garrisonWarriors || 0)} Garrison capacity` :
                                            ''
                                    }
                                  </div>
                                )}
                              </div>
                              {canUpgrade && nextCost && (
                                <div className="text-right">
                                  <div className="text-[10px] text-slate-500 mb-0.5">Cost: W {formatInt(nextCost.wood)} S {formatInt(nextCost.stone)}</div>
                                  <button
                                    className="px-2 py-1 rounded-lg text-xs bg-slate-900 text-white disabled:opacity-50"
                                    onClick={() => onUpgradeFortressBuilding(exp.expeditionId, building.id)}
                                    disabled={!affordable}
                                    title={!affordable ? "Not enough resources" : `Upgrade to Lvl ${nextLevel}`}
                                  >
                                    Upgrade
                                  </button>
                                </div>
                              )}
                              {!canUpgrade && (
                                <div className="text-[10px] text-slate-500">Max Level</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Fortress Garrison Section */}
                    <div className="mt-4 pt-4 border-t border-slate-700">
                      <div className="text-sm font-semibold mb-2">Fortress Garrison</div>

                      {/* Currently Stationed Banners */}
                      {(exp.fortress.garrison?.length ?? 0) > 0 && (
                        <div className="mb-3">
                          <div className="text-xs text-slate-400 mb-1.5">Stationed Armies:</div>
                          <div className="space-y-1.5">
                            {(exp.fortress.garrison || []).map((bannerId) => {
                              const banner = banners.find(b => b.id === bannerId);
                              if (!banner) return null;
                              const totalTroops = banner.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;
                              return (
                                <div key={bannerId} className="rounded-lg border border-slate-700 bg-slate-800 p-2">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="text-xs font-semibold">{banner.name}</div>
                                    <button
                                      onClick={() => onRemoveBannerFromFortress(exp.expeditionId, bannerId)}
                                      className="px-2 py-0.5 rounded text-[10px] bg-red-900 hover:bg-red-800 text-red-200"
                                      title="Remove from fortress"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                  <div className="flex gap-1 flex-wrap items-center">
                                    {(banner.squads || []).length === 0
                                      ? <span className="text-[10px] text-slate-600 italic">No units</span>
                                      : (banner.squads || []).map((sq, i) => {
                                          const icon = unitCategory[sq.type as UnitType] === 'ranged_infantry' ? '🏹' : unitCategory[sq.type as UnitType] === 'cavalry' ? '🐴' : '⚔️';
                                          return (
                                            <span key={i} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                                              <span>{icon}</span>
                                              <span className="font-medium">{unitDisplayNames[sq.type as UnitType] || sq.type}</span>
                                              <span className="text-slate-500">{sq.currentSize}/{sq.maxSize}</span>
                                            </span>
                                          );
                                        })
                                    }
                                    <span className="text-[10px] text-slate-500 ml-1">{totalTroops} total</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Available Ready Banners */}
                      {(() => {
                        const garrison = exp.fortress.garrison || [];
                        const readyBanners = banners.filter(b =>
                          b.status === 'ready' &&
                          !garrison.includes(b.id)
                        );

                        if (readyBanners.length === 0 && garrison.length === 0) {
                          return (
                            <div className="text-xs text-slate-500">
                              No ready armies available. Train armies in the Army section to assign them to the fortress.
                            </div>
                          );
                        }

                        if (readyBanners.length === 0) {
                          return null;
                        }

                        return (
                          <div>
                            <div className="text-xs text-slate-400 mb-1.5">Available Armies:</div>
                            <div className="space-y-1.5">
                              {readyBanners.map((banner) => {
                                const totalTroops = banner.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;
                                return (
                                  <div key={banner.id} className="rounded-lg border border-slate-700 bg-slate-800 p-2">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="text-xs font-semibold">{banner.name}</div>
                                      <button
                                        onClick={() => onAssignBannerToFortress(exp.expeditionId, banner.id)}
                                        className="px-2 py-0.5 rounded text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white"
                                        title="Assign to fortress"
                                      >
                                        Assign
                                      </button>
                                    </div>
                                    <div className="flex gap-1 flex-wrap items-center">
                                      {(banner.squads || []).length === 0
                                        ? <span className="text-[10px] text-slate-600 italic">No units</span>
                                        : (banner.squads || []).map((sq, i) => {
                                            const icon = unitCategory[sq.type as UnitType] === 'ranged_infantry' ? '🏹' : unitCategory[sq.type as UnitType] === 'cavalry' ? '🐴' : '⚔️';
                                            return (
                                              <span key={i} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                                                <span>{icon}</span>
                                                <span className="font-medium">{unitDisplayNames[sq.type as UnitType] || sq.type}</span>
                                                <span className="text-slate-500">{sq.currentSize}/{sq.maxSize}</span>
                                              </span>
                                            );
                                          })
                                      }
                                      <span className="text-[10px] text-slate-500 ml-1">{totalTroops} total</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Attack Button */}
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      {(() => {
                        const isLoading = battleLoading?.expeditionId === exp.expeditionId;
                        const hasReport = !!(exp.fortress?.lastBattle);
                        const error = battleError?.expeditionId === exp.expeditionId ? battleError.message : null;

                        const handleAttack = () => {
                          if (hasReport) {
                            const reportElement = document.getElementById(`battle-report-${exp.expeditionId}`);
                            if (reportElement) {
                              reportElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                            return;
                          }

                          setBattleError(null);
                          setBattleLoading({ expeditionId: exp.expeditionId, progress: 0 });

                          try {
                            const battleOutcome = onRunBattle(exp.expeditionId);
                            if (!battleOutcome) {
                              setBattleLoading(null);
                              setBattleError({ expeditionId: exp.expeditionId, message: 'Error running siege battle. Please try again.' });
                              return;
                            }

                            // Animate progress bar over BATTLE_PROGRESS_DURATION_MS
                            const startTime = Date.now();
                            const updateInterval = 16; // ~60fps
                            const progressInterval = setInterval(() => {
                              const elapsed = Date.now() - startTime;
                              const progress = Math.min(100, (elapsed / BATTLE_PROGRESS_DURATION_MS) * 100);
                              setBattleLoading({ expeditionId: exp.expeditionId, progress });
                              if (progress >= 100) {
                                clearInterval(progressInterval);
                                setTimeout(() => {
                                  setBattleLoading(null);
                                  setTimeout(() => {
                                    const reportElement = document.getElementById(`battle-report-${exp.expeditionId}`);
                                    if (reportElement) {
                                      reportElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                  }, 100);
                                }, 50);
                              }
                            }, updateInterval);
                          } catch (err) {
                            console.error('Siege battle error:', err);
                            setBattleLoading(null);
                            setBattleError({
                              expeditionId: exp.expeditionId,
                              message: err instanceof Error ? err.message : 'Error running siege battle. Please try again.',
                            });
                          }
                        };

                        return (
                          <div className="space-y-2">
                            <button
                              onClick={handleAttack}
                              disabled={isLoading}
                              className={`w-full px-3 py-2 rounded-lg text-white text-sm font-semibold transition-colors ${isLoading
                                ? 'bg-slate-600 cursor-not-allowed'
                                : hasReport
                                  ? 'bg-slate-700 hover:bg-slate-600'
                                  : 'bg-red-700 hover:bg-red-600'
                                }`}
                            >
                              {isLoading ? 'Battle in progress...' : hasReport ? 'View report' : '⚔ Attack Fortress'}
                            </button>

                            {/* Progress Bar */}
                            {isLoading && battleLoading && (
                              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-red-500 transition-all duration-75 ease-out"
                                  style={{ width: `${battleLoading.progress || 0}%` }}
                                />
                              </div>
                            )}

                            {/* Error Message */}
                            {error && (
                              <div className="text-xs text-red-400 mt-1">
                                {error}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Battle Report */}
                    {exp.fortress.lastBattle && (
                      <div id={`battle-report-${exp.expeditionId}`} className="mt-4 pt-4 border-t border-slate-700">
                        <div className="text-sm font-semibold mb-3">Battle Report</div>
                        {(() => {
                          const battle = exp.fortress.lastBattle!;
                          const firstRound = battle.siegeTimeline[0];
                          const lastRound = battle.siegeTimeline[battle.siegeTimeline.length - 1];

                          const totalAttackersKilled = battle.initialAttackers - lastRound.attackers;
                          const totalDamageToFort = battle.initialFortHP - lastRound.fortHP;
                          const wallsDestroyed = lastRound.fortHP <= 0;

                          const outcomeInfo = {
                            fortress_holds_walls: {
                              title: 'Fortress Holds',
                              color: 'text-emerald-400',
                              description: 'The attackers were repelled before breaching the walls.'
                            },
                            fortress_holds_inner: {
                              title: 'Fortress Holds',
                              color: 'text-emerald-400',
                              description: 'The walls were breached, but the garrison successfully defended the inner fortress.'
                            },
                            fortress_falls: {
                              title: 'Fortress Falls',
                              color: 'text-red-400',
                              description: 'The attackers breached the walls and overwhelmed the defenders.'
                            },
                            stalemate: {
                              title: 'Stalemate',
                              color: 'text-amber-400',
                              description: 'Both sides suffered heavy losses with no clear victor.'
                            }
                          };

                          const outcome = outcomeInfo[battle.outcome];

                          return (
                            <div className="space-y-3 text-xs">
                              {/* Outcome */}
                              <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-slate-400">Result:</span>
                                  <span className={`font-semibold ${outcome.color}`}>
                                    {outcome.title}
                                  </span>
                                </div>
                                <div className="text-slate-300 text-[11px]">
                                  {outcome.description}
                                </div>
                              </div>

                              {/* Siege Phase Summary */}
                              <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                <div className="font-semibold text-slate-300 mb-2">Siege on the Walls</div>
                                <div className="space-y-1.5 text-[11px] text-slate-300">
                                  <div>
                                    The attackers ({formatInt(battle.initialAttackers)} warriors) assaulted the fortress walls over <strong>{battle.siegeRounds}</strong> rounds.
                                  </div>
                                  <div>
                                    The defenders' archers on the walls killed <span className="text-red-300 font-semibold">{formatInt(totalAttackersKilled)}</span> attackers.
                                  </div>
                                  <div>
                                    The attackers damaged the walls, reducing fort HP from <span className="text-blue-300">{formatInt(battle.initialFortHP)}</span> to <span className="text-blue-300">{formatInt(lastRound.fortHP)}</span> ({formatInt(totalDamageToFort)} damage).
                                  </div>
                                  {wallsDestroyed ? (
                                    <div className="text-amber-400 font-semibold">
                                      The walls were breached! The attackers broke through.
                                    </div>
                                  ) : (
                                    <div className="text-emerald-400 font-semibold">
                                      The walls held strong. The attackers were repelled.
                                    </div>
                                  )}
                                </div>

                                {/* Siege Phase Detailed Logs */}
                                <details className="mt-3 pt-3 border-t border-slate-700" open>
                                  <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
                                    Siege Logs ({battle.siegeTimeline.length} rounds)
                                  </summary>
                                  <div className="mt-2 max-h-60 overflow-y-auto">
                                    <table className="w-full text-[10px] border-collapse">
                                      <thead>
                                        <tr className="bg-slate-900 border-b border-slate-700">
                                          <th className="p-1 text-left text-slate-300">Round</th>
                                          <th className="p-1 text-right text-slate-300">Wall HP</th>
                                          <th className="p-1 text-right text-slate-300">Attackers</th>
                                          <th className="p-1 text-right text-slate-300">Archers</th>
                                          <th className="p-1 text-right text-slate-300">Killed</th>
                                          <th className="p-1 text-right text-slate-300">Wall Dmg</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {battle.siegeTimeline.map((round, idx) => {
                                          const prevRound = idx > 0 ? battle.siegeTimeline[idx - 1] : null;
                                          const attackersAtStart = prevRound ? prevRound.attackers : battle.initialAttackers;
                                          const fortHPAtStart = prevRound ? prevRound.fortHP : battle.initialFortHP;

                                          return (
                                            <tr key={idx} className="border-b border-slate-800 hover:bg-slate-900">
                                              <td className="p-1 text-slate-200 font-semibold">{round.round}</td>
                                              <td className="p-1 text-right">
                                                <span className="text-blue-300">{formatInt(round.fortHP)}</span>
                                                <span className="text-slate-500">/{formatInt(battle.initialFortHP)}</span>
                                                {prevRound && (
                                                  <span className="text-red-400 text-[9px] ml-1">
                                                    (-{formatInt(fortHPAtStart - round.fortHP)})
                                                  </span>
                                                )}
                                              </td>
                                              <td className="p-1 text-right">
                                                <span className="text-red-300">{formatInt(round.attackers)}</span>
                                                {prevRound && (
                                                  <span className="text-red-400 text-[9px] ml-1">
                                                    (-{formatInt(attackersAtStart - round.attackers)})
                                                  </span>
                                                )}
                                              </td>
                                              <td className="p-1 text-right text-blue-200">{formatInt(round.archers)}</td>
                                              <td className="p-1 text-right text-red-400">{formatInt(round.killed)}</td>
                                              <td className="p-1 text-right text-amber-300">{formatInt(round.dmgToFort)}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>

                                  {/* Siege Graph */}
                                  <SiegeGraphCanvas
                                    timeline={battle.siegeTimeline}
                                    fortHPmax={battle.initialFortHP}
                                  />
                                </details>
                              </div>

                              {/* Inner Battle Summary */}
                              {battle.innerTimeline.length > 0 && (
                                <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                  <div className="font-semibold text-slate-300 mb-2">Inner Battle</div>
                                  {(() => {
                                    const firstInner = battle.innerTimeline[0];
                                    const lastInner = battle.innerTimeline[battle.innerTimeline.length - 1];
                                    const defendersKilled = battle.initialGarrison.warriors + battle.initialGarrison.archers - lastInner.defenders;
                                    const attackersKilledInInner = firstInner.attackers - lastInner.attackers;

                                    return (
                                      <>
                                        <div className="space-y-1.5 text-[11px] text-slate-300">
                                          <div>
                                            After breaching the walls, <span className="text-red-300 font-semibold">{formatInt(firstInner.attackers)}</span> attackers engaged the garrison ({formatInt(battle.initialGarrison.warriors)} warriors, {formatInt(battle.initialGarrison.archers)} archers) inside the fortress.
                                          </div>
                                          <div>
                                            The battle lasted <strong>{battle.innerTimeline.length}</strong> steps through skirmish, melee, and pursuit phases.
                                          </div>
                                          <div>
                                            The defenders lost <span className="text-blue-300 font-semibold">{formatInt(defendersKilled)}</span> troops.
                                          </div>
                                          <div>
                                            The attackers lost <span className="text-red-300 font-semibold">{formatInt(attackersKilledInInner)}</span> more troops in the inner battle.
                                          </div>
                                          <div className="mt-2 pt-2 border-t border-slate-700">
                                            <div className="text-slate-400">Final State:</div>
                                            <div className="flex gap-4 mt-1">
                                              <div>
                                                <span className="text-slate-400">Defenders:</span>{' '}
                                                <span className="text-blue-300 font-semibold">{formatInt(lastInner.defenders)}</span> remaining
                                              </div>
                                              <div>
                                                <span className="text-slate-400">Attackers:</span>{' '}
                                                <span className="text-red-300 font-semibold">{formatInt(lastInner.attackers)}</span> remaining
                                              </div>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Inner Battle Detailed Logs */}
                                        <details className="mt-3 pt-3 border-t border-slate-700" open>
                                          <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
                                            Inner Battle Logs ({battle.innerTimeline.length} steps)
                                          </summary>
                                          <div className="mt-2 max-h-60 overflow-y-auto">
                                            <table className="w-full text-[10px] border-collapse">
                                              <thead>
                                                <tr className="bg-slate-900 border-b border-slate-700">
                                                  <th className="p-1 text-left text-slate-300">Step</th>
                                                  <th className="p-1 text-left text-slate-300">Phase</th>
                                                  <th className="p-1 text-right text-slate-300">Def. Warriors</th>
                                                  <th className="p-1 text-right text-slate-300">Def. Archers</th>
                                                  <th className="p-1 text-right text-slate-300">Def. Total</th>
                                                  <th className="p-1 text-right text-slate-300">Attackers</th>
                                                  <th className="p-1 text-right text-slate-300">Def. Killed</th>
                                                  <th className="p-1 text-right text-slate-300">Atk. Killed</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {battle.innerTimeline.map((step, idx) => {
                                                  const prevStep = idx > 0 ? battle.innerTimeline[idx - 1] : null;
                                                  const defendersAtStart = prevStep ? prevStep.defenders : (battle.initialGarrison.warriors + battle.initialGarrison.archers);
                                                  const attackersAtStart = prevStep ? prevStep.attackers : firstInner.attackers;

                                                  return (
                                                    <tr key={idx} className="border-b border-slate-800 hover:bg-slate-900">
                                                      <td className="p-1 text-slate-200 font-semibold">{step.step}</td>
                                                      <td className="p-1 text-slate-300 capitalize">{step.phase}</td>
                                                      <td className="p-1 text-right text-blue-200">{formatInt(step.defWarriors)}</td>
                                                      <td className="p-1 text-right text-blue-200">{formatInt(step.defArchers)}</td>
                                                      <td className="p-1 text-right">
                                                        <span className="text-blue-300">{formatInt(step.defenders)}</span>
                                                        {prevStep && (
                                                          <span className="text-red-400 text-[9px] ml-1">
                                                            (-{formatInt(defendersAtStart - step.defenders)})
                                                          </span>
                                                        )}
                                                      </td>
                                                      <td className="p-1 text-right">
                                                        <span className="text-red-300">{formatInt(step.attackers)}</span>
                                                        {prevStep && (
                                                          <span className="text-red-400 text-[9px] ml-1">
                                                            (-{formatInt(attackersAtStart - step.attackers)})
                                                          </span>
                                                        )}
                                                      </td>
                                                      <td className="p-1 text-right text-blue-400">{formatInt(step.killedDefenders)}</td>
                                                      <td className="p-1 text-right text-red-400">{formatInt(step.killedAttackers)}</td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>

                                          {/* Inner Battle Graph */}
                                          <InnerBattleGraphCanvas
                                            timeline={battle.innerTimeline}
                                          />
                                        </details>
                                      </>
                                    );
                                  })()}
                                </div>
                              )}

                              {/* Final Statistics */}
                              <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                <div className="font-semibold text-slate-300 mb-2">Casualties</div>
                                <div className="grid grid-cols-2 gap-2 text-[11px]">
                                  <div>
                                    <div className="text-slate-400">Attackers Lost:</div>
                                    <div className="text-red-300 font-semibold">
                                      {formatInt(battle.initialAttackers - battle.finalAttackers)} / {formatInt(battle.initialAttackers)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-slate-400">Defenders Lost:</div>
                                    <div className="text-blue-300 font-semibold">
                                      {formatInt((battle.initialGarrison.warriors + battle.initialGarrison.archers) - battle.finalDefenders)} / {formatInt(battle.initialGarrison.warriors + battle.initialGarrison.archers)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
