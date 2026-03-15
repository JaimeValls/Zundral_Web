// ============================================================================
// Zundral — MissionsUI
// Missions tab: banner assignment, mission dispatch, and battle reports.
// Receives all data and callbacks as props — no internal game state.
// ============================================================================

import React from 'react';
import type { Mission, Banner, BattleResult } from '../types';
import type { Division, UnitType } from '../types';
import { unitDisplayNames } from '../constants';

// ---------------------------------------------------------------------------
// Local helpers (duplicated from ResourceVillageUI to keep this module self-contained)
// ---------------------------------------------------------------------------

function formatInt(n: number) { return Math.floor(n).toLocaleString(); }

function pct(a: number, b: number) { return Math.max(0, Math.min(100, Math.floor((a / b) * 100))); }

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

function getEnemyTotal(comp: Division | { warrior?: number; archer?: number } | undefined): number {
  if (!comp) return 0;
  let sum = 0;
  for (const key in comp) {
    sum += (comp as Record<string, number>)[key] || 0;
  }
  return Math.max(0, sum);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MissionsUIProps {
  missions: Mission[];
  banners: Banner[];
  missionBannerSelector: number | null;
  missionLoading: number | null;
  onSetBannerSelector: (missionId: number | null) => void;
  onAssignBanner: (missionId: number, bannerId: number) => void;
  onClearMissionNew: (missionId: number) => void;
  onSendMission: (missionId: number) => void;
  onViewReport: (missionId: number, result: BattleResult, bannerXP?: number) => void;
  onCloseMission: (missionId: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MissionsUI({
  missions,
  banners,
  missionBannerSelector,
  missionLoading,
  onSetBannerSelector,
  onAssignBanner,
  onClearMissionNew,
  onSendMission,
  onViewReport,
  onCloseMission,
}: MissionsUIProps) {
  return (
    <section className="max-w-game mx-auto px-2 sm:px-4 md:px-6 space-y-3 sm:space-y-4">
      <h2 className="text-base sm:text-lg md:text-xl font-semibold">Missions</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Left: ready banners info panel */}
        <div className="md:col-span-1 rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-sm font-semibold mb-2">Ready Armies</div>
          {banners.filter(b => b.status === 'ready').length === 0 ? (
            <div className="text-xs text-slate-500">No ready armies.</div>
          ) : (
            <div className="space-y-2">
              {banners.filter(b => b.status === 'ready').map((b) => {
                const assignedMission = missions.find(m => m.status === 'available' && m.staged.includes(b.id));
                const isAssigned = assignedMission !== undefined;
                const totalTroops = b.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;

                return (
                  <div
                    key={b.id}
                    className={`rounded-lg border p-2 transition-colors ${isAssigned
                      ? 'border-red-500 bg-red-900/20 opacity-75'
                      : 'border-slate-700 bg-slate-800'
                      }`}
                  >
                    <div className={`text-sm font-semibold ${isAssigned ? 'text-red-300' : ''}`}>
                      {b.name}
                      {isAssigned && <span className="ml-2 text-xs text-red-400">(Unavailable)</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {totalTroops} troops
                      {b.squads && b.squads.length > 0 && (
                        <span className="ml-1">
                          ({b.squads.map(s => `${s.currentSize} ${s.type}`).join(', ')})
                        </span>
                      )}
                    </div>
                    {isAssigned && assignedMission && (
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-xs text-red-400">
                          Assigned to: {assignedMission.name}
                        </div>
                        <button
                          onClick={() => onSetBannerSelector(assignedMission.id)}
                          className="px-2 py-0.5 rounded text-[10px] bg-slate-700 hover:bg-slate-600 text-white"
                          title="Assign different banner"
                        >
                          Change
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: missions list */}
        <div className="md:col-span-2 space-y-3">
          {missions.map((m) => {
            const readyBanners = banners.filter(b => b.status === 'ready');
            const hasReadyBanners = readyBanners.length > 0;
            const assignedBannerId = m.staged.length > 0 ? m.staged[0] : null;
            const assignedBanner = assignedBannerId ? banners.find(b => b.id === assignedBannerId) : null;
            const isSelectorOpen = missionBannerSelector === m.id;
            const isLoading = missionLoading === m.id;
            const secsLeft = Math.max(0, m.duration - m.elapsed);
            const hasReport = m.battleResult !== undefined;
            const isOnCooldown = m.cooldownEndTime !== undefined && m.cooldownEndTime > Date.now();
            const cooldownSeconds = isOnCooldown ? Math.ceil((m.cooldownEndTime! - Date.now()) / 1000) : 0;

            const isReady = m.status === 'available' && !isOnCooldown;
            const isCompletedRewardPending = m.status === 'completedRewardsPending';
            const isCompletedRewardsClaimed = m.status === 'completedRewardsClaimed';
            const isFailed = m.status === 'available' && m.battleResult && m.battleResult.winner !== 'player';

            return (
              <div key={m.id} className={`rounded-xl border ${m.isNew ? 'border-red-500' : 'border-slate-800'} bg-slate-900 p-3`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold">{m.name}</div>
                    {isCompletedRewardsClaimed && (
                      <span className="px-2 py-0.5 bg-emerald-900 text-emerald-200 text-xs font-semibold rounded">
                        Completed
                      </span>
                    )}
                    {isFailed && (
                      <span className="px-2 py-0.5 bg-red-900 text-red-200 text-xs font-semibold rounded">
                        Failed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {m.isNew && (
                      <div className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
                        NEW!
                      </div>
                    )}
                    {isReady && (
                      <>
                        {!assignedBanner ? (
                          <button
                            onClick={() => {
                              if (m.isNew) onClearMissionNew(m.id);
                              if (readyBanners.length === 1) {
                                onAssignBanner(m.id, readyBanners[0].id);
                              } else {
                                onSetBannerSelector(isSelectorOpen ? null : m.id);
                              }
                            }}
                            disabled={!hasReadyBanners}
                            className={`px-3 py-1.5 rounded text-sm ${!hasReadyBanners
                              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                              : 'bg-slate-700 hover:bg-slate-600 text-white'
                              }`}
                            title={!hasReadyBanners ? 'Train a banner in the Army tab first' : ''}
                          >
                            Assign banner
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                if (m.isNew) onClearMissionNew(m.id);
                                onSetBannerSelector(isSelectorOpen ? null : m.id);
                              }}
                              disabled={isLoading}
                              className={`px-3 py-1.5 rounded text-sm ${isLoading
                                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                : 'bg-slate-700 hover:bg-slate-600 text-white'
                                }`}
                              title="Change assigned banner"
                            >
                              Change banner
                            </button>
                            <button
                              onClick={() => onSendMission(m.id)}
                              disabled={isLoading}
                              className={`px-3 py-1.5 rounded text-sm ${isLoading
                                ? 'bg-slate-600 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                }`}
                            >
                              {isLoading ? 'In progress...' : 'Send mission'}
                            </button>
                          </>
                        )}
                      </>
                    )}
                    {m.status === 'running' && (
                      <div className="text-xs text-slate-500">{secsLeft}s left</div>
                    )}
                    {isCompletedRewardPending && hasReport && m.battleResult && (
                      <button
                        onClick={() => onViewReport(m.id, m.battleResult!, m.bannerXP)}
                        className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                      >
                        View report
                      </button>
                    )}
                    {isFailed && hasReport && m.battleResult && (
                      <button
                        onClick={() => onViewReport(m.id, m.battleResult!, m.bannerXP)}
                        className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                        title="View previous battle report"
                      >
                        View report
                      </button>
                    )}
                    {isCompletedRewardsClaimed && (
                      <>
                        {hasReport && m.battleResult && (
                          <button
                            onClick={() => {
                              if (m.isNew) onClearMissionNew(m.id);
                              onViewReport(m.id, m.battleResult!, m.bannerXP);
                            }}
                            className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm"
                          >
                            View report
                          </button>
                        )}
                        <button
                          onClick={() => onCloseMission(m.id)}
                          className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
                          title="Remove this completed mission and get a new one"
                        >
                          ✕ Close
                        </button>
                      </>
                    )}
                    {isOnCooldown && (
                      <div className="text-xs text-slate-400">
                        Available in {cooldownSeconds}s
                      </div>
                    )}
                  </div>
                </div>

                {m.description && (
                  <div className="mt-2 text-xs text-slate-400 leading-relaxed">
                    {m.description}
                  </div>
                )}

                {/* Rewards summary for completed missions */}
                {isCompletedRewardsClaimed && m.rewardTier && m.rewards && (
                  <div className="mt-2 text-xs text-amber-300 font-semibold">
                    Rewards collected: {m.rewardTier}: {[
                      m.rewards.food ? `${formatInt(m.rewards.food)} Food` : null,
                      m.rewards.wood ? `${formatInt(m.rewards.wood)} Wood` : null,
                      m.rewards.stone ? `${formatInt(m.rewards.stone)} Stone` : null,
                      m.rewards.iron ? `${formatInt(m.rewards.iron)} Iron` : null,
                      m.rewards.gold ? `${formatInt(m.rewards.gold)} Gold` : null,
                    ].filter(Boolean).join(', ')}
                  </div>
                )}

                {/* Enemy troop count */}
                {m.enemyComposition && (() => {
                  const comp = m.enemyComposition as Division;
                  const total = getEnemyTotal(comp);
                  const unitCounts: string[] = [];
                  for (const unitType in comp) {
                    const count = comp[unitType as UnitType] || 0;
                    if (count > 0) {
                      unitCounts.push(`${count} ${unitDisplayNames[unitType as UnitType] || unitType}`);
                    }
                  }
                  return (
                    <div className="mt-2 text-xs font-semibold text-slate-300">
                      Enemies: {total} troops ({unitCounts.join(', ')})
                    </div>
                  );
                })()}

                {/* Banner selector dropdown */}
                {m.status === 'available' && isSelectorOpen && (
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <div className="text-xs font-semibold text-slate-300 mb-2">Choose banner</div>
                    <div className="space-y-1.5">
                      {readyBanners.map((b) => {
                        const totalTroops = b.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;
                        const isCurrentlyAssigned = assignedBannerId === b.id;
                        return (
                          <button
                            key={b.id}
                            onClick={() => onAssignBanner(m.id, b.id)}
                            className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${isCurrentlyAssigned
                              ? 'bg-emerald-900/30 border-emerald-500 hover:bg-emerald-900/40'
                              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 hover:border-slate-600'
                              }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className={`text-sm font-semibold ${isCurrentlyAssigned ? 'text-emerald-300' : ''}`}>
                                {b.name}
                              </div>
                              {isCurrentlyAssigned && (
                                <span className="text-xs text-emerald-400 font-semibold">(Selected)</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400">
                              {totalTroops} troops
                              {b.squads && b.squads.length > 0 && (
                                <span className="ml-1">
                                  ({b.squads.map(s => `${s.currentSize} ${s.type}`).join(', ')})
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Assigned banner display */}
                {m.status === 'available' && assignedBanner && (
                  <div className="mt-2 text-xs text-slate-300">
                    Assigned: <span className="text-emerald-400 font-semibold">{assignedBanner.name}</span>
                  </div>
                )}

                {/* Progress */}
                {m.status !== 'available' && (
                  <div className="mt-2">
                    <RowBar value={m.elapsed} max={m.duration} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
