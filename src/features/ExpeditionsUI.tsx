// ============================================================================
// Zundral — ExpeditionsUI
// Expeditions tab: expedition management, fortress operations, and siege battles.
// Receives all data and callbacks as props — no internal game state.
// UI-only state (battleLoading, battleError) is managed internally.
// ============================================================================

import React, { useState } from 'react';
import type { Expedition, Banner, Mission, WarehouseState, SiegeBattleResult, BattleSquadEntry, UnitType, ArmyOrder, ExpeditionLogEntry, BattleRole } from '../types';
import { BattleChart, SiegeGraphCanvas } from '../components/BattleChart';
import { unitCategory, unitDisplayNames } from '../constants';
import { ExpeditionMap } from './map/ExpeditionMap';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function formatInt(n: number) { return Math.floor(n).toLocaleString(); }

const BATTLE_PROGRESS_DURATION_MS = 3000;

/** Small colored badge showing army role in a multi-army battle */
function RoleBadge({ role }: { role?: BattleRole }) {
  if (!role) return null;
  const config: Record<string, { label: string; color: string }> = {
    primary_attacker: { label: 'Primary', color: 'bg-amber-700/60 text-amber-200 border-amber-500/40' },
    flank_attacker: { label: 'Flank', color: 'bg-orange-700/60 text-orange-200 border-orange-500/40' },
    defender: { label: 'Defender', color: 'bg-blue-700/60 text-blue-200 border-blue-500/40' },
    reinforcement: { label: 'Reinforcement', color: 'bg-slate-600/60 text-slate-200 border-slate-400/40' },
    // Backward compat for old saved battle results
    primary_defender: { label: 'Defender', color: 'bg-blue-700/60 text-blue-200 border-blue-500/40' },
    flank_defender: { label: 'Defender', color: 'bg-blue-700/60 text-blue-200 border-blue-500/40' },
  };
  const c = config[role];
  if (!c) return null;
  return <span className={`text-[8px] px-1 py-0 rounded border ${c.color} ml-1 font-semibold uppercase`}>{c.label}</span>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExpeditionsUIProps {
  expeditions: Expedition[];
  banners: Banner[];
  missions: Mission[];
  population: number;
  warehouse: WarehouseState;
  onAcceptExpedition: (expeditionId: string) => void;
  onSendResource: (expeditionId: string, resource: 'wood' | 'stone' | 'food' | 'population') => void;
  onLaunchExpedition: (expeditionId: string) => void;
  onGetWallArchers: (expeditionId: string) => { available: number; capacity: number; active: number };
  onUpgradeFortressBuilding: (expeditionId: string, buildingId: string) => void;
  onRemoveBannerFromFortress: (expeditionId: string, bannerId: number) => void;
  onAssignBannerToFortress: (expeditionId: string, bannerId: number) => void;
  onRestartExpedition: (expeditionId: string) => void;
  onDeployArmyToProvince: (expeditionId: string, bannerId: number, provinceId: string) => void;
  onSetArmyOrder: (expeditionId: string, bannerId: number, order: ArmyOrder) => void;
  onClearArmyOrder: (expeditionId: string, bannerId: number) => void;
  onExecuteTurn: (expeditionId: string) => void;
  onClaimExpeditionReward: (expeditionId: string, missionId: number) => void;
  /** Run battle, apply casualties, update parent state. Returns destroyed banner IDs or null on error. */
  onRunBattle: (expeditionId: string) => { result: SiegeBattleResult; destroyedBanners: number[] } | null;
  onShowResourceError?: (msg: string) => void;
  onRequestReinforcement?: (bannerId: number) => void;
  onCancelReinforcement?: (bannerId: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExpeditionsUI({
  expeditions,
  banners,
  missions,
  population,
  warehouse,
  onAcceptExpedition,
  onSendResource,
  onLaunchExpedition,
  onGetWallArchers,
  onUpgradeFortressBuilding,
  onRemoveBannerFromFortress,
  onAssignBannerToFortress,
  onRestartExpedition,
  onDeployArmyToProvince,
  onSetArmyOrder,
  onClearArmyOrder,
  onExecuteTurn,
  onClaimExpeditionReward,
  onRunBattle,
  onShowResourceError,
  onRequestReinforcement,
  onCancelReinforcement,
}: ExpeditionsUIProps) {
  const [battleLoading, setBattleLoading] = useState<{ expeditionId: string; progress: number } | null>(null);
  const [battleError, setBattleError] = useState<{ expeditionId: string; message: string } | null>(null);
  const [expeditionTab, setExpeditionTab] = useState<'map' | 'army' | 'building'>('map');

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
                {exp.state === 'failed' && (
                  <div className="text-xs px-2 py-1 rounded bg-red-900 text-red-200">Failed</div>
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

              {/* Completed/Failed state: fortress tabs (operational controls hidden when failed) */}
              {(exp.state === 'completed' || exp.state === 'failed') && exp.fortress && (
                <div className="mt-3 space-y-4">
                  {exp.state === 'completed' && (
                    <div className="text-xs text-emerald-400">
                      The expedition was successful. A frontier fortress has been established in the mountains of Godonis.
                    </div>
                  )}

                  {exp.state === 'failed' && (
                    <div className="rounded-lg border border-red-800 bg-red-950/50 p-4 text-center">
                      <div className="text-3xl mb-2">💀</div>
                      <div className="text-red-300 font-bold text-lg mb-1">Expedition Failed</div>
                      <div className="text-red-200/70 text-sm mb-3">
                        The fortress has fallen to enemy forces. All surviving armies have returned to the village.
                      </div>
                      <div className="text-xs text-slate-500 mb-4">
                        You may launch a new expedition, but it will require fresh resources and preparation.
                      </div>
                      <button
                        onClick={() => onRestartExpedition(exp.expeditionId)}
                        className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors"
                      >
                        Prepare New Expedition
                      </button>
                    </div>
                  )}

                  {/* Expedition Tab Navigation */}
                  <div className="flex p-1 bg-slate-800/80 rounded-lg border border-slate-600 sticky top-0 z-10">
                    {(['map', 'army', 'building'] as const).map(tab => {
                      const labels = { map: '🗺️ Map', army: '⚔️ Army', building: '🏗️ Building' };
                      const disabled = exp.state === 'failed' && tab !== 'map';
                      return (
                        <button
                          key={tab}
                          onClick={() => !disabled && setExpeditionTab(tab)}
                          className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                            expeditionTab === tab
                              ? 'bg-amber-700 text-white shadow-md'
                              : disabled
                                ? 'text-slate-600 cursor-not-allowed'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                          }`}
                        >
                          {labels[tab]}
                        </button>
                      );
                    })}
                  </div>

                  {/* ══════ MAP TAB ══════ */}
                  <div style={{ display: expeditionTab === 'map' ? 'block' : 'none' }}>
                    {/* Inline Expedition Map */}
                    <div className="rounded-lg overflow-hidden border border-slate-700" style={{ height: 560 }}>
                      <ExpeditionMap
                        expedition={exp}
                        banners={banners}
                        missions={missions}
                        onDeployArmy={(bannerId, provId) => onDeployArmyToProvince(exp.expeditionId, bannerId, provId)}
                        onSetArmyOrder={(bannerId, order) => onSetArmyOrder(exp.expeditionId, bannerId, order)}
                        onClearArmyOrder={(bannerId) => onClearArmyOrder(exp.expeditionId, bannerId)}
                        onExecuteTurn={() => onExecuteTurn(exp.expeditionId)}
                        onClaimExpeditionReward={(missionId) => onClaimExpeditionReward(exp.expeditionId, missionId)}
                        onRequestReinforcement={onRequestReinforcement}
                        onCancelReinforcement={onCancelReinforcement}
                      />
                    </div>

                    {/* ── Event Log (below map, above battle reports) ── */}
                    {(exp.mapState?.expeditionLog?.length ?? 0) > 0 && (() => {
                      const log = exp.mapState!.expeditionLog!;
                      const currentTurn = exp.mapState!.turnNumber;
                      const colorMap: Record<string, string> = {
                        hostile_detected: 'text-red-400',
                        battle_resolved: 'text-amber-300',
                        army_destroyed: 'text-red-500',
                        mission_completed: 'text-emerald-400',
                        mission_failed: 'text-orange-400 font-bold',
                        fortress_attacked: 'text-red-400 font-bold',
                        fortress_damaged: 'text-red-500 font-bold',
                      };
                      const iconMap: Record<string, string> = {
                        hostile_detected: '👁️',
                        battle_resolved: '⚔️',
                        army_destroyed: '💀',
                        mission_completed: '⭐',
                        mission_failed: '❌',
                        fortress_attacked: '🏰',
                        fortress_damaged: '🏚️',
                      };
                      return (
                        <div className="mt-3 bg-slate-800/50 rounded-lg border border-slate-700 p-3">
                          <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
                            📜 Event Log
                          </div>
                          <div className="space-y-1 max-h-[160px] overflow-y-auto">
                            {log.slice(0, 25).map(entry => {
                              const turnsAgo = currentTurn - entry.turn;
                              return (
                                <div key={entry.id} className="flex items-start gap-1.5 text-[11px] leading-tight">
                                  <span className="text-slate-600 whitespace-nowrap shrink-0">T{entry.turn}</span>
                                  <span className="shrink-0">{iconMap[entry.type] || '•'}</span>
                                  <span className={colorMap[entry.type] || 'text-slate-300'}>{entry.text}</span>
                                  {turnsAgo > 0 && (
                                    <span className="text-slate-600 text-[9px] shrink-0 ml-auto">({turnsAgo} turn{turnsAgo !== 1 ? 's' : ''} ago)</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Battle Reports (inside Map tab, below map) ── */}

                    {/* Siege Battle Report (collapsible) */}
                    {exp.fortress.lastBattle && (() => {
                      const battle = exp.fortress.lastBattle!;
                      const siegeRounds = battle.siegeTimeline.length;
                      const totalDef = battle.initialGarrison.warriors + battle.initialGarrison.archers;
                      const isHold = battle.outcome === 'fortress_holds_walls' || battle.outcome === 'fortress_holds_inner';
                      return (
                        <details id={`battle-report-${exp.expeditionId}`} className="mt-4 pt-4 border-t border-slate-700">
                          <summary className={`p-3 cursor-pointer rounded-lg border list-none ${
                            isHold
                              ? 'bg-emerald-950/20 border-emerald-800/40 hover:bg-emerald-900/20'
                              : 'bg-red-950/20 border-red-800/40 hover:bg-red-900/20'
                          }`}>
                            {/* Battle header */}
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-lg">🏰</span>
                              <div className="flex-1">
                                <div className="text-xs font-bold text-slate-200">Fortress Siege — {exp.mapState?.fortressProvinceId?.replace('prov_', 'Province ') || 'Fortress'}</div>
                                <div className="text-[10px] text-slate-500">
                                  Turn {exp.mapState?.turnNumber || '?'} · {siegeRounds} wall round{siegeRounds !== 1 ? 's' : ''}{battle.innerTimeline?.length ? `, ${battle.innerTimeline.length} inner steps` : ''} — {battle.initialAttackers} attackers vs {totalDef} defenders
                                </div>
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${isHold ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-800' : 'bg-red-900/50 text-red-400 border border-red-800'}`}>
                                {isHold ? 'Victory' : 'Defeat'}
                              </span>
                            </div>
                            {/* Per-unit summary — squad cards */}
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                              <div className="bg-red-950/20 border border-red-900/30 rounded px-2 py-1.5">
                                <div className="text-[9px] text-red-400 uppercase font-bold mb-1.5">Attackers — {battle.initialAttackers} → {battle.finalAttackers}</div>
                                <div className="grid grid-cols-4 gap-1">
                                  {(battle.attackerComposition || []).map((s, si) => {
                                    const sqIcon = s.role === 'ranged' ? '🏹' : '⚔️';
                                    const SQUAD_MAX = 10;
                                    const isDamaged = s.final < SQUAD_MAX;
                                    const fillPct = (s.final / SQUAD_MAX) * 100;
                                    return (
                                      <div key={si} className="h-9 rounded-md border bg-slate-800/60 border-slate-700 flex items-center px-1.5 gap-1.5 overflow-hidden">
                                        <span className="text-sm shrink-0 leading-none">{sqIcon}</span>
                                        <div className="flex flex-col min-w-0 flex-1 leading-none justify-center h-full py-0.5">
                                          <div className="flex items-center justify-between gap-1 w-full">
                                            <span className="text-[9px] font-semibold text-slate-200 truncate">{s.displayName}</span>
                                            <span className={`text-[9px] font-medium shrink-0 ${s.final === 0 ? 'text-red-500' : isDamaged ? 'text-red-400' : 'text-slate-500'}`}>
                                              {Math.round(s.final)}/10
                                            </span>
                                          </div>
                                          <div className="w-full h-0.5 bg-slate-950/50 rounded-full mt-0.5 overflow-hidden">
                                            <div
                                              className={`h-full rounded-full ${s.final === 0 ? 'bg-red-600' : isDamaged ? 'bg-red-500' : 'bg-emerald-500'}`}
                                              style={{ width: `${Math.max(fillPct, s.final === 0 ? 0 : 2)}%` }}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="bg-blue-950/20 border border-blue-900/30 rounded px-2 py-1.5">
                                <div className="text-[9px] text-blue-400 uppercase font-bold mb-1.5">Defenders — {totalDef} → {Math.round(battle.finalDefenders)}</div>
                                <div className="grid grid-cols-4 gap-1">
                                  {(battle.defenderComposition || []).flatMap(s => {
                                    if (s.initial <= 10) return [s];
                                    const SQ = 10;
                                    const n = Math.ceil(s.initial / SQ);
                                    const lossRate = s.initial > 0 ? s.lost / s.initial : 0;
                                    return Array.from({ length: n }, (_, i) => {
                                      const sqInit = Math.min(SQ, s.initial - i * SQ);
                                      const sqLost = Math.round(sqInit * lossRate);
                                      return { ...s, initial: sqInit, final: sqInit - sqLost, lost: sqLost };
                                    });
                                  }).map((s, si) => {
                                    const sqIcon = s.role === 'ranged' ? '🏹' : '⚔️';
                                    const SQUAD_MAX = 10;
                                    const isDamaged = s.final < SQUAD_MAX;
                                    const fillPct = (s.final / SQUAD_MAX) * 100;
                                    return (
                                      <div key={si} className="h-9 rounded-md border bg-slate-800/60 border-slate-700 flex items-center px-1.5 gap-1.5 overflow-hidden">
                                        <span className="text-sm shrink-0 leading-none">{sqIcon}</span>
                                        <div className="flex flex-col min-w-0 flex-1 leading-none justify-center h-full py-0.5">
                                          <div className="flex items-center justify-between gap-1 w-full">
                                            <span className="text-[9px] font-semibold text-slate-200 truncate">{s.displayName}</span>
                                            <span className={`text-[9px] font-medium shrink-0 ${s.final === 0 ? 'text-red-500' : isDamaged ? 'text-amber-400' : 'text-slate-500'}`}>
                                              {Math.round(s.final)}/10
                                            </span>
                                          </div>
                                          <div className="w-full h-0.5 bg-slate-950/50 rounded-full mt-0.5 overflow-hidden">
                                            <div
                                              className={`h-full rounded-full ${s.final === 0 ? 'bg-red-600' : isDamaged ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                              style={{ width: `${Math.max(fillPct, s.final === 0 ? 0 : 2)}%` }}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                {/* Per-army garrison breakdown inline (only when 2+ armies) */}
                                {battle.garrisonArmies && battle.garrisonArmies.length > 1 && (
                                  <div className="mt-1.5 pt-1.5 border-t border-blue-900/30 space-y-0.5">
                                    {battle.garrisonArmies.map((a, i) => {
                                      const lost = a.initialTroops - a.finalTroops;
                                      const pct = a.initialTroops > 0 ? lost / a.initialTroops : 0;
                                      const severity = a.finalTroops === 0 ? 'text-red-500 font-bold'
                                        : pct > 0.3 ? 'text-red-400'
                                        : pct > 0.1 ? 'text-amber-400'
                                        : 'text-emerald-400';
                                      return (
                                        <div key={i} className="flex justify-between items-center py-0.5">
                                          <span className="text-slate-300 truncate text-[9px]">⚔️ {a.bannerName}</span>
                                          <span className={`text-[9px] ${severity}`}>
                                            {Math.round(a.initialTroops)} → {Math.round(a.finalTroops)}
                                            {lost > 0 && <span className="text-red-400 ml-1">(-{Math.round(lost)})</span>}
                                            {a.finalTroops === 0 && <span className="ml-1">💀</span>}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              {/* Flanking armies (if any) */}
                              {battle.flankingArmies && battle.flankingArmies.length > 0 && (
                                <div className="mt-1.5 pt-1.5 border-t border-amber-900/30">
                                  <div className="text-[9px] text-amber-400 uppercase font-bold mb-0.5">Flanking Support</div>
                                  {battle.flankingArmies.map((a, i) => {
                                    const lost = a.initialTroops - a.finalTroops;
                                    const pct = a.initialTroops > 0 ? lost / a.initialTroops : 0;
                                    const severity = a.finalTroops === 0 ? 'text-red-500 font-bold'
                                      : pct > 0.3 ? 'text-red-400'
                                      : pct > 0.1 ? 'text-amber-400'
                                      : 'text-emerald-400';
                                    return (
                                      <div key={i} className="flex justify-between items-center py-0.5">
                                        <span className="text-slate-300 truncate text-[9px]">⚔️ {a.bannerName} <span className="text-[8px] px-1 py-0 rounded border bg-orange-700/60 text-orange-200 border-orange-500/40 ml-1 font-semibold uppercase">Flank</span></span>
                                        <span className={`text-[9px] ${severity}`}>
                                          {Math.round(a.initialTroops)} → {Math.round(a.finalTroops)}
                                          {lost > 0 && <span className="text-red-400 ml-1">(-{Math.round(lost)})</span>}
                                          {a.finalTroops === 0 && <span className="ml-1">💀</span>}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {/* Wall HP + destroyed callouts */}
                            <div className="mt-2 flex items-center gap-3 text-[10px]">
                              <span className="text-slate-400">
                                🧱 Wall HP: <span className="text-white font-semibold">{battle.initialFortHP}</span> → <span className={battle.finalFortHP <= 0 ? 'text-red-400 font-semibold' : 'text-white font-semibold'}>{battle.finalFortHP}</span>
                                {battle.finalFortHP <= 0 && <span className="text-red-400 ml-1">(breached)</span>}
                              </span>
                              {battle.finalAttackers === 0 && (
                                <span className="px-1.5 py-0.5 bg-emerald-950/50 border border-emerald-800 rounded text-emerald-400 font-bold">
                                  ☠ Siege force eliminated
                                </span>
                              )}
                            </div>
                            {/* Extended Report toggle button */}
                            <div className="mt-2 flex justify-center">
                              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-900/40 hover:bg-amber-800/60 border border-amber-600/50 rounded text-[11px] text-amber-300 font-bold uppercase tracking-wider transition-colors">
                                📊 Extended Battle Report
                                <svg className="w-3 h-3 transition-transform [details[open]_&]:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              </span>
                            </div>
                          </summary>
                          <div className="mt-3 border-l-2 border-amber-700/50 pl-3 ml-1">
                        <div className="text-[10px] text-amber-500/70 uppercase tracking-wider font-semibold mb-3">Detailed Breakdown</div>
                        {(() => {
                          const lastRound = battle.siegeTimeline[battle.siegeTimeline.length - 1];

                          const totalAttackersKilled = lastRound ? battle.initialAttackers - lastRound.attackers : 0;
                          const totalDamageToFort = lastRound ? battle.initialFortHP - lastRound.fortHP : 0;
                          const wallsDestroyed = lastRound ? lastRound.fortHP <= 0 : false;
                          const totalDefenders = battle.initialGarrison.warriors + battle.initialGarrison.archers;
                          const totalDefLost = totalDefenders - battle.finalDefenders;
                          const totalAtkLost = battle.initialAttackers - battle.finalAttackers;

                          const outcomeInfo = {
                            fortress_holds_walls: { title: 'Victory', color: 'text-emerald-400', bg: 'bg-emerald-950/30 border-emerald-900/50' },
                            fortress_holds_inner: { title: 'Victory', color: 'text-emerald-400', bg: 'bg-emerald-950/30 border-emerald-900/50' },
                            fortress_falls: { title: 'Defeat', color: 'text-red-400', bg: 'bg-red-950/30 border-red-900/50' },
                            stalemate: { title: 'Draw', color: 'text-amber-400', bg: 'bg-amber-950/30 border-amber-900/50' },
                          };
                          const outcome = outcomeInfo[battle.outcome];

                          // Composition helpers
                          const atkComp = battle.attackerComposition;
                          const defComp = battle.defenderComposition;

                          const renderCasualtyList = (squads: BattleSquadEntry[], colorClass: string, lostColor: string) => (
                            <div className="space-y-1">
                              {squads.map((s, i) => (
                                <div key={i} className={`flex items-center justify-between text-[11px] ${s.final === 0 ? 'opacity-50' : ''}`}>
                                  <span className={colorClass}>{s.displayName}</span>
                                  <div className="flex items-center gap-1">
                                    <span className="text-slate-400">{formatInt(s.initial)}</span>
                                    <span className="text-slate-600">→</span>
                                    <span className={s.final === 0 ? 'text-slate-500' : colorClass}>{formatInt(s.final)}</span>
                                    {s.lost > 0 && <span className={`${lostColor} text-[10px]`}>-{formatInt(s.lost)}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );

                          return (
                            <div className="space-y-3 text-xs">
                              {/* ── Takeaway (summary cards removed — info already in collapsed header) ── */}
                              {battle.battleTakeaway && (
                                <div className={`p-2 rounded-lg border ${outcome.bg} text-[11px] text-slate-400 italic text-center`}>
                                  {battle.battleTakeaway}
                                </div>
                              )}

                              {/* ── Wall Assault ─────────────────────────────────── */}
                              {battle.siegeTimeline.length > 0 && (
                                <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                  <div className="font-semibold text-slate-300 mb-2">Wall Assault</div>
                                  <div className="space-y-1.5 text-[11px] text-slate-300">
                                    <div>
                                      <span className="text-red-300 font-semibold">{formatInt(battle.initialAttackers)}</span> attackers assaulted the fortress walls over <strong>{battle.siegeRounds}</strong> rounds.
                                    </div>
                                    <div>
                                      <span className="text-blue-300 font-semibold">{formatInt(battle.siegeTimeline[0]?.archers || 0)}</span> archers firing from the walls{battle.flankingArmies && battle.flankingArmies.length > 0 ? <>, supported by <span className="text-amber-300 font-semibold">{battle.flankingArmies.length} flanking {battle.flankingArmies.length === 1 ? 'army' : 'armies'}</span> attacking from the field</> : ''}, killed <span className="text-red-300 font-semibold">{formatInt(totalAttackersKilled)}</span> attackers during the siege.
                                    </div>
                                    <div>
                                      Wall HP reduced from <span className="text-amber-300">{formatInt(battle.initialFortHP)}</span> to <span className="text-amber-300">{formatInt(lastRound.fortHP)}</span> (<span className="text-amber-400">{formatInt(totalDamageToFort)}</span> damage).
                                    </div>
                                    {wallsDestroyed ? (
                                      <div className="text-amber-400 font-semibold">The walls were breached! Attackers broke through.</div>
                                    ) : (
                                      <div className="text-emerald-400 font-semibold">The walls held strong. Attackers repelled.</div>
                                    )}
                                  </div>

                                  <details className="mt-3 pt-3 border-t border-slate-700" open>
                                    <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
                                      ▾ Siege Round Logs ({battle.siegeTimeline.length} rounds)
                                    </summary>
                                    <div className="mt-2 max-h-60 overflow-y-auto">
                                      <table className="w-full text-[10px] border-collapse">
                                        <thead>
                                          <tr className="bg-slate-900 border-b border-slate-700">
                                            <th className="p-1 text-left text-slate-300">Round</th>
                                            <th className="p-1 text-right text-slate-200">Wall HP</th>
                                            <th className="p-1 text-right text-red-300">Attackers</th>
                                            <th className="p-1 text-right text-blue-300">Defenders</th>
                                            <th className="p-1 text-right text-slate-300">Wall Dmg</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(() => {
                                            const totalGarrison = (battle.initialGarrison?.warriors || 0) + (battle.initialGarrison?.archers || 0);
                                            return battle.siegeTimeline.map((round, idx) => {
                                              const prevRound = idx > 0 ? battle.siegeTimeline[idx - 1] : null;
                                              const attackersAtStart = prevRound ? prevRound.attackers : battle.initialAttackers;
                                              const fortHPAtStart = prevRound ? prevRound.fortHP : battle.initialFortHP;
                                              const hpLoss = fortHPAtStart - round.fortHP;
                                              const atkLoss = attackersAtStart - round.attackers;
                                              return (
                                                <tr key={idx} className="border-b border-slate-800 hover:bg-slate-900">
                                                  <td className="p-1 text-slate-200 font-semibold">{round.round}</td>
                                                  <td className="p-1 text-right">
                                                    <span className="text-slate-100 font-semibold">{formatInt(round.fortHP)}</span>
                                                    <span className="text-slate-500">/{formatInt(battle.initialFortHP)}</span>
                                                    {hpLoss > 0 && <span className="text-red-400 text-[9px] ml-1">(-{Math.round(hpLoss)})</span>}
                                                  </td>
                                                  <td className="p-1 text-right">
                                                    <span className="text-red-300">{formatInt(round.attackers)}</span>
                                                    {atkLoss > 0 && <span className="text-red-400 text-[9px] ml-1">(-{Math.round(atkLoss)})</span>}
                                                  </td>
                                                  <td className="p-1 text-right">
                                                    <span className="text-blue-300">{formatInt(totalGarrison)}</span>
                                                    <span className="text-slate-600 text-[9px] ml-1">(safe)</span>
                                                  </td>
                                                  <td className="p-1 text-right text-amber-300">{formatInt(round.dmgToFort)}</td>
                                                </tr>
                                              );
                                            });
                                          })()}
                                        </tbody>
                                      </table>
                                    </div>
                                  </details>

                                  <details className="mt-2" open>
                                    <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
                                      ▾ Wall Assault Graph
                                    </summary>
                                    <SiegeGraphCanvas timeline={battle.siegeTimeline} fortHPmax={battle.initialFortHP} initialGarrison={(battle.initialGarrison?.warriors || 0) + (battle.initialGarrison?.archers || 0)} />
                                  </details>
                                </div>
                              )}

                              {/* ── Inner Defence Battle ─────────────────────────── */}
                              {battle.innerTimeline.length > 0 && (() => {
                                const firstInner = battle.innerTimeline[0];
                                const lastInner = battle.innerTimeline[battle.innerTimeline.length - 1];
                                const defendersKilled = totalDefenders - lastInner.A_troops;
                                const attackersKilledInInner = firstInner.B_troops - lastInner.B_troops;

                                return (
                                  <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                                    <div className="font-semibold text-slate-300 mb-2">Inner Defence Battle</div>

                                    {/* Phase Summary Cards (Skirmish/Melee/Pursuit) */}
                                    {(() => {
                                      const phases: Record<string, { steps: number; defKilled: number; atkKilled: number }> = {};
                                      for (const step of battle.innerTimeline) {
                                        if (!phases[step.phase]) phases[step.phase] = { steps: 0, defKilled: 0, atkKilled: 0 };
                                        phases[step.phase].steps++;
                                        phases[step.phase].defKilled += step.BtoA;
                                        phases[step.phase].atkKilled += step.AtoB;
                                      }
                                      const phaseOrder = ['skirmish', 'melee', 'pursuit'];
                                      const phaseColors: Record<string, string> = {
                                        skirmish: 'border-sky-800 bg-sky-950/30',
                                        melee: 'border-red-800 bg-red-950/30',
                                        pursuit: 'border-amber-800 bg-amber-950/30',
                                      };
                                      const phaseIcons: Record<string, string> = { skirmish: '🏹', melee: '⚔️', pursuit: '🏃' };
                                      const activePhases = phaseOrder.filter(p => phases[p]);
                                      if (activePhases.length === 0) return null;
                                      return (
                                        <div className={`grid grid-cols-${Math.min(activePhases.length, 3)} gap-2 mb-3`}>
                                          {activePhases.map(p => {
                                            const d = phases[p];
                                            const totalKills = d.defKilled + d.atkKilled;
                                            const isDecisive = totalKills > 0 && (d.atkKilled / Math.max(totalKills, 1)) > 0.5;
                                            return (
                                              <div key={p} className={`rounded-lg border p-2 ${phaseColors[p] || 'border-slate-700 bg-slate-800/30'}`}>
                                                <div className="text-[9px] uppercase font-bold text-slate-400 mb-1">
                                                  {phaseIcons[p]} {p} ({d.steps} step{d.steps !== 1 ? 's' : ''})
                                                </div>
                                                <div className="flex justify-between text-[10px]">
                                                  <span className="text-blue-300">Defender losses: <span className="text-red-400 font-semibold">{Math.round(d.defKilled)}</span></span>
                                                </div>
                                                <div className="flex justify-between text-[10px]">
                                                  <span className="text-red-300">Attacker losses: <span className="text-red-400 font-semibold">{Math.round(d.atkKilled)}</span></span>
                                                </div>
                                                {isDecisive && <div className="text-[8px] text-amber-400 mt-0.5 font-bold uppercase">Decisive phase</div>}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })()}

                                    <div className="space-y-1.5 text-[11px] text-slate-300">
                                      <div>
                                        <span className="text-red-300 font-semibold">{formatInt(firstInner.B_troops)}</span> attackers engaged the garrison (<span className="text-blue-300">{formatInt(battle.initialGarrison.warriors)}</span> melee, <span className="text-blue-300">{formatInt(battle.initialGarrison.archers)}</span> ranged) inside the fortress.
                                      </div>
                                      <div>
                                        The battle lasted <strong>{battle.innerTimeline.length}</strong> steps through skirmish, melee, and pursuit phases.
                                      </div>
                                      <div className="flex gap-4 mt-1.5 pt-1.5 border-t border-slate-700">
                                        <div>
                                          <span className="text-slate-400">Defenders:</span>{' '}
                                          <span className="text-blue-300 font-semibold">{formatInt(lastInner.A_troops)}</span> remaining
                                          <span className="text-blue-400 text-[10px] ml-1">(-{formatInt(defendersKilled)})</span>
                                        </div>
                                        <div>
                                          <span className="text-slate-400">Attackers:</span>{' '}
                                          <span className="text-red-300 font-semibold">{formatInt(lastInner.B_troops)}</span> remaining
                                          <span className="text-red-400 text-[10px] ml-1">(-{formatInt(attackersKilledInInner)})</span>
                                        </div>
                                      </div>
                                    </div>

                                    <details className="mt-3 pt-3 border-t border-slate-700" open>
                                      <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
                                        ▾ Battle Step Logs ({battle.innerTimeline.length} steps)
                                      </summary>
                                      <div className="mt-2 max-h-60 overflow-y-auto">
                                        <table className="w-full text-[10px] border-collapse">
                                          <thead>
                                            <tr className="bg-slate-900 border-b border-slate-700">
                                              <th className="p-1 text-left text-slate-300">Step</th>
                                              <th className="p-1 text-left text-slate-300">Phase</th>
                                              <th className="p-1 text-right text-slate-300">Defenders</th>
                                              <th className="p-1 text-right text-slate-300">Attackers</th>
                                              <th className="p-1 text-right text-slate-300">Casualties</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {battle.innerTimeline.map((step, idx) => (
                                                <tr key={idx} className="border-b border-slate-800 hover:bg-slate-900">
                                                  <td className="p-1 text-slate-200 font-semibold">{step.tick}</td>
                                                  <td className="p-1 text-slate-300 capitalize">{step.phase}</td>
                                                  <td className="p-1 text-right text-blue-300">{formatInt(step.A_troops)}</td>
                                                  <td className="p-1 text-right text-red-300">{formatInt(step.B_troops)}</td>
                                                  <td className="p-1 text-right">
                                                    {step.BtoA > 0 && <span className="text-blue-400">Def -{formatInt(step.BtoA)}</span>}
                                                    {step.BtoA > 0 && step.AtoB > 0 && <span className="text-slate-600 mx-0.5">/</span>}
                                                    {step.AtoB > 0 && <span className="text-red-400">Atk -{formatInt(step.AtoB)}</span>}
                                                  </td>
                                                </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </details>

                                    <details className="mt-2" open>
                                      <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
                                        ▾ Inner Battle Graph
                                      </summary>
                                      <BattleChart timeline={battle.innerTimeline} />
                                    </details>
                                  </div>
                                );
                              })()}

                              {/* Casualties by unit type removed — already shown in squad cards above */}
                            </div>
                          );
                        })()}
                          </div>
                        </details>
                      );
                    })()}

                    {/* ── Field Battle Reports ── */}
                    {(() => {
                      const fieldBattles = exp.mapState?.fieldBattleResults || [];
                      if (fieldBattles.length === 0) return null;
                      // Show most recent battles first, max 10
                      const recentBattles = [...fieldBattles].reverse().slice(0, 10);
                      const turnNumber = exp.mapState?.turnNumber || 0;
                      return (
                        <div className="mt-4 pt-4 border-t border-slate-700">
                          <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
                            ⚔️ Field Battle Reports ({recentBattles.length})
                          </div>
                          <div className="space-y-3">
                            {recentBattles.map((fb) => {
                              const isVictory = fb.outcome === 'player_wins';
                              const isDefeat = fb.outcome === 'enemy_wins';
                              const turnsAgo = turnNumber - fb.turn;
                              const pAll = fb.playerArmies || [fb.playerArmy];
                              const eAll = fb.enemyArmies || [fb.enemyArmy];
                              const pInit = pAll.reduce((s, a) => s + a.initialTroops, 0);
                              const pFin = pAll.reduce((s, a) => s + a.finalTroops, 0);
                              const eInit = eAll.reduce((s, a) => s + a.initialTroops, 0);
                              const eFin = eAll.reduce((s, a) => s + a.finalTroops, 0);
                              const destroyedPlayer = pAll.filter(a => a.finalTroops === 0);
                              const destroyedEnemy = eAll.filter(a => a.finalTroops === 0);
                              return (
                                <details key={fb.id} className={`rounded-lg border ${
                                  isVictory ? 'border-emerald-800/60 bg-gradient-to-b from-emerald-950/30 via-slate-800/50 to-slate-800/50'
                                  : isDefeat ? 'border-red-800/60 bg-gradient-to-b from-red-950/30 via-slate-800/50 to-slate-800/50'
                                  : 'border-amber-800/60 bg-gradient-to-b from-amber-950/20 via-slate-800/50 to-slate-800/50'
                                }`}>
                                  {/* ── Option D: Battle Header Card ── */}
                                  <summary className="p-3 cursor-pointer hover:bg-slate-700/30 list-none">
                                    <div className="flex items-center gap-3 mb-2">
                                      <span className="text-lg">⚔️</span>
                                      <div className="flex-1">
                                        <div className="text-xs font-bold text-slate-200">Battle of {fb.provinceId.replace('prov_', 'Province ')}</div>
                                        <div className="text-[10px] text-slate-500">
                                          Turn {fb.turn}{turnsAgo > 0 ? ` · ${turnsAgo} turn${turnsAgo !== 1 ? 's' : ''} ago` : ''} · {pAll.length} allied {pAll.length === 1 ? 'army' : 'armies'} vs {eAll.length} hostile {eAll.length === 1 ? 'force' : 'forces'}
                                        </div>
                                      </div>
                                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                        isVictory ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-800'
                                        : isDefeat ? 'bg-red-900/50 text-red-400 border border-red-800'
                                        : 'bg-amber-900/50 text-amber-400 border border-amber-800'
                                      }`}>
                                        {isVictory ? 'Victory' : isDefeat ? 'Defeat' : 'Draw'}
                                      </span>
                                      {fb.flanking && (fb.flanking.playerFlanking > 0 || fb.flanking.enemyFlanking > 0) && (
                                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                          fb.flanking.playerFlanking > 0
                                            ? 'bg-amber-900/50 text-amber-300 border border-amber-700'
                                            : 'bg-red-900/50 text-red-300 border border-red-700'
                                        }`}>
                                          {fb.flanking.playerFlanking > 0
                                            ? `⚔ Flanked (${fb.flanking.playerFlanking + 1} dirs)`
                                            : `⚔ You flanked (${fb.flanking.enemyFlanking + 1} dirs)`}
                                        </span>
                                      )}
                                    </div>
                                    {/* ── Option A: Per-army summary rows ── */}
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                      <div className="bg-blue-950/20 border border-blue-900/30 rounded px-2 py-1.5">
                                        <div className="text-[9px] text-blue-400 uppercase font-bold mb-1">Your Forces — {Math.round(pInit)} → {Math.round(pFin)}</div>
                                        {pAll.map((a, i) => {
                                          const lost = a.initialTroops - a.finalTroops;
                                          const pct = a.initialTroops > 0 ? lost / a.initialTroops : 0;
                                          const share = pInit > 0 ? Math.round((a.initialTroops / pInit) * 100) : 100;
                                          const severity = a.finalTroops === 0 ? 'text-red-500 font-bold' : pct > 0.3 ? 'text-red-400' : pct > 0.1 ? 'text-amber-400' : 'text-emerald-400';
                                          return (
                                            <div key={i} className="flex justify-between items-center py-0.5">
                                              <span className="text-slate-300 truncate">
                                                {a.bannerName}
                                                {pAll.length > 1 && <span className="text-slate-600 ml-1 text-[9px]">{share}%</span>}
                                                <RoleBadge role={a.role} />
                                              </span>
                                              <span className={severity}>
                                                {Math.round(a.initialTroops)} → {Math.round(a.finalTroops)}
                                                {lost > 0 && <span className="text-red-400 ml-1">(-{Math.round(lost)})</span>}
                                                {a.finalTroops === 0 && <span className="ml-1">💀</span>}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <div className="bg-red-950/20 border border-red-900/30 rounded px-2 py-1.5">
                                        <div className="text-[9px] text-red-400 uppercase font-bold mb-1">Enemy Forces — {Math.round(eInit)} → {Math.round(eFin)}</div>
                                        {eAll.map((a, i) => {
                                          const lost = a.initialTroops - a.finalTroops;
                                          const pct = a.initialTroops > 0 ? lost / a.initialTroops : 0;
                                          const share = eInit > 0 ? Math.round((a.initialTroops / eInit) * 100) : 100;
                                          const severity = a.finalTroops === 0 ? 'text-red-500 font-bold' : pct > 0.3 ? 'text-red-400' : pct > 0.1 ? 'text-amber-400' : 'text-emerald-400';
                                          return (
                                            <div key={i} className="flex justify-between items-center py-0.5">
                                              <span className="text-slate-300 truncate">
                                                {a.enemyName}
                                                {eAll.length > 1 && <span className="text-slate-600 ml-1 text-[9px]">{share}%</span>}
                                                <RoleBadge role={a.role} />
                                              </span>
                                              <span className={severity}>
                                                {Math.round(a.initialTroops)} → {Math.round(a.finalTroops)}
                                                {lost > 0 && <span className="text-red-400 ml-1">(-{Math.round(lost)})</span>}
                                                {a.finalTroops === 0 && <span className="ml-1">💀</span>}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                    {/* Destroyed army callout */}
                                    {(destroyedPlayer.length > 0 || destroyedEnemy.length > 0) && (
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {destroyedPlayer.map((a, i) => (
                                          <span key={`dp${i}`} className="text-[9px] px-1.5 py-0.5 bg-red-950/50 border border-red-800 rounded text-red-400 font-bold">
                                            💀 {a.bannerName} destroyed
                                          </span>
                                        ))}
                                        {destroyedEnemy.map((a, i) => (
                                          <span key={`de${i}`} className="text-[9px] px-1.5 py-0.5 bg-emerald-950/50 border border-emerald-800 rounded text-emerald-400 font-bold">
                                            ☠ {a.enemyName} eliminated
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {/* Extended Report toggle button */}
                                    <div className="mt-2 flex justify-center">
                                      <span className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-900/40 hover:bg-amber-800/60 border border-amber-600/50 rounded text-[11px] text-amber-300 font-bold uppercase tracking-wider transition-colors [details[open]_&]:bg-amber-700/60 [details[open]_&]:border-amber-400 [details[open]_&]:text-amber-100 [details[open]_&]:shadow-[0_0_12px_rgba(245,158,11,0.3)]">
                                        📊 Extended Battle Report
                                        <svg className="w-3 h-3 transition-transform [details[open]_&]:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                      </span>
                                    </div>
                                  </summary>
                                  <div className="px-3 pb-3 border-t border-slate-700">
                                    {/* Takeaway */}
                                    <div className="text-[11px] italic text-slate-400 mt-3 mb-3">{fb.battleTakeaway}</div>
                                    {/* Army compositions — squad cards per army */}
                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                      <div>
                                        <div className="text-[10px] font-semibold text-blue-400 uppercase mb-1.5">Your Forces</div>
                                        {(fb.playerArmies || [fb.playerArmy]).map((army, ai) => (
                                          <div key={ai} className="mb-2.5">
                                            <div className="text-[9px] text-blue-300/70 font-semibold mb-1">
                                              {army.bannerName} ({army.initialTroops} → {army.finalTroops})
                                              <RoleBadge role={army.role} />
                                            </div>
                                            <div className="grid grid-cols-4 gap-1">
                                              {army.composition.map((s, si) => {
                                                const sqIcon = s.role === 'ranged' ? '🏹' : '⚔️';
                                                const SQUAD_MAX = 10;
                                                const isDamaged = s.final < SQUAD_MAX;
                                                const fillPct = (s.final / SQUAD_MAX) * 100;
                                                return (
                                                  <div key={si} className="h-9 rounded-md border bg-slate-800/60 border-slate-700 flex items-center px-1.5 gap-1.5 overflow-hidden">
                                                    <span className="text-sm shrink-0 leading-none">{sqIcon}</span>
                                                    <div className="flex flex-col min-w-0 flex-1 leading-none justify-center h-full py-0.5">
                                                      <div className="flex items-center justify-between gap-1 w-full">
                                                        <span className="text-[9px] font-semibold text-slate-200 truncate">{s.displayName}</span>
                                                        <span className={`text-[9px] font-medium shrink-0 ${s.final === 0 ? 'text-red-500' : isDamaged ? 'text-amber-400' : 'text-slate-500'}`}>
                                                          {Math.round(s.final)}/10
                                                        </span>
                                                      </div>
                                                      <div className="w-full h-0.5 bg-slate-950/50 rounded-full mt-0.5 overflow-hidden">
                                                        <div
                                                          className={`h-full rounded-full ${s.final === 0 ? 'bg-red-600' : isDamaged ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                                          style={{ width: `${Math.max(fillPct, s.final === 0 ? 0 : 2)}%` }}
                                                        />
                                                      </div>
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-semibold text-red-400 uppercase mb-1.5">Enemy Forces</div>
                                        {(fb.enemyArmies || [fb.enemyArmy]).map((army, ai) => (
                                          <div key={ai} className="mb-2.5">
                                            <div className="text-[9px] text-red-300/70 font-semibold mb-1">
                                              {army.enemyName} ({army.initialTroops} → {army.finalTroops})
                                              <RoleBadge role={army.role} />
                                            </div>
                                            <div className="grid grid-cols-4 gap-1">
                                              {army.composition.map((s, si) => {
                                                const sqIcon = s.role === 'ranged' ? '🏹' : '⚔️';
                                                const SQUAD_MAX = 10;
                                                const isDamaged = s.final < SQUAD_MAX;
                                                const fillPct = (s.final / SQUAD_MAX) * 100;
                                                return (
                                                  <div key={si} className="h-9 rounded-md border bg-slate-800/60 border-slate-700 flex items-center px-1.5 gap-1.5 overflow-hidden">
                                                    <span className="text-sm shrink-0 leading-none">{sqIcon}</span>
                                                    <div className="flex flex-col min-w-0 flex-1 leading-none justify-center h-full py-0.5">
                                                      <div className="flex items-center justify-between gap-1 w-full">
                                                        <span className="text-[9px] font-semibold text-slate-200 truncate">{s.displayName}</span>
                                                        <span className={`text-[9px] font-medium shrink-0 ${s.final === 0 ? 'text-red-500' : isDamaged ? 'text-red-400' : 'text-slate-500'}`}>
                                                          {Math.round(s.final)}/10
                                                        </span>
                                                      </div>
                                                      <div className="w-full h-0.5 bg-slate-950/50 rounded-full mt-0.5 overflow-hidden">
                                                        <div
                                                          className={`h-full rounded-full ${s.final === 0 ? 'bg-red-600' : isDamaged ? 'bg-red-500' : 'bg-emerald-500'}`}
                                                          style={{ width: `${Math.max(fillPct, s.final === 0 ? 0 : 2)}%` }}
                                                        />
                                                      </div>
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    {/* Timeline graph */}
                                    {fb.timeline.length > 0 && (
                                      <details className="border-t border-slate-700 pt-2">
                                        <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-300 font-semibold">
                                          ▸ Battle Timeline Graph
                                        </summary>
                                        <BattleChart timeline={fb.timeline} />
                                      </details>
                                    )}
                                  </div>
                                </details>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Fallen Armies ── */}
                    {(() => {
                      const destroyedBanners = banners.filter(b =>
                        b.status === 'destroyed' && b.fieldBattleId && b.destroyedTurn
                      );
                      if (destroyedBanners.length === 0) return null;
                      return (
                        <div className="mt-4 pt-4 border-t border-slate-700">
                          <div className="text-sm font-semibold mb-3 text-red-400">Fallen Armies</div>
                          <div className="space-y-1.5">
                            {destroyedBanners.map(b => (
                              <div key={b.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-red-950/20 border border-red-900/30 opacity-70">
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border shrink-0 text-red-400 bg-red-950/50 border-red-900/50">
                                  Destroyed
                                </span>
                                <span className="text-xs font-semibold text-slate-400 line-through truncate">{b.name}</span>
                                <span className="text-[10px] text-slate-500 shrink-0">
                                  Turn {b.destroyedTurn} — {b.destroyedInProvince}
                                </span>
                                {b.destroyedByEnemy && (
                                  <span className="text-[10px] text-red-400 shrink-0">by {b.destroyedByEnemy}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* ══════ ARMY TAB ══════ */}
                  {expeditionTab === 'army' && (
                    <div>
                      {exp.state === 'completed' ? (
                        <div className="space-y-4">
                          {/* Fortress Stats Summary */}
                          {(() => {
                            const wallArchers = onGetWallArchers(exp.expeditionId);
                            const garrisonCount = exp.fortress!.garrison?.length || 0;
                            const garrisonCap = exp.fortress!.stats?.garrisonCapacity || 1;
                            return (
                              <div className="grid grid-cols-4 gap-2">
                                <div className="rounded-lg bg-slate-800 border border-slate-700 p-2 text-center">
                                  <div className="text-[10px] text-slate-400">Fort HP</div>
                                  <div className="text-sm font-bold text-amber-300">{formatInt(exp.fortress!.stats?.fortHP || 0)}</div>
                                </div>
                                <div className="rounded-lg bg-slate-800 border border-slate-700 p-2 text-center">
                                  <div className="text-[10px] text-slate-400">Watch Post</div>
                                  <div className="text-sm font-bold text-slate-200">Lv {exp.fortress!.buildings.find(b => b.id === 'watch_post')?.level || 0}</div>
                                </div>
                                <div className="rounded-lg bg-slate-800 border border-slate-700 p-2 text-center">
                                  <div className="text-[10px] text-slate-400">Wall Archers</div>
                                  <div className="text-sm font-bold text-blue-300">{wallArchers.active}/{wallArchers.capacity}</div>
                                </div>
                                <div className="rounded-lg bg-slate-800 border border-slate-700 p-2 text-center">
                                  <div className="text-[10px] text-slate-400">Garrison</div>
                                  <div className="text-sm font-bold text-emerald-300">{garrisonCount}/{garrisonCap}</div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Fortress Garrison Section */}
                          <div className="pt-4 border-t border-slate-700">
                            {(() => {
                              const garrisonIds = exp.fortress!.garrison || [];
                              const garrisonArmies = garrisonIds.map(id => banners.find(b => b.id === id)).filter(Boolean);
                              const totalGarrison = garrisonArmies.reduce((sum, a) => sum + (a?.squads?.reduce((s, sq) => s + sq.currentSize, 0) || 0), 0);
                              const maxGarrison = garrisonArmies.reduce((sum, a) => sum + (a?.squads?.reduce((s, sq) => s + (sq.maxSize || 0), 0) || 0), 0);
                              return (
                                <div className="flex items-center justify-between mb-3">
                                  <div className="text-sm font-semibold">Fortress Garrison</div>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-medium ${garrisonIds.length >= (exp.fortress!.stats?.garrisonCapacity || 1) ? 'text-amber-400' : 'text-slate-400'}`}>
                                      {garrisonIds.length} / {exp.fortress!.stats?.garrisonCapacity || 1} armies
                                    </span>
                                    {garrisonIds.length > 0 && (
                                      <span className="text-[10px] font-medium text-emerald-400">{totalGarrison}/{maxGarrison} troops</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Currently Stationed Armies */}
                            {(exp.fortress!.garrison?.length ?? 0) > 0 && (
                              <div className="mb-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-emerald-400 text-sm">🏰</span>
                                  <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide">Stationed</span>
                                  <span className="text-[9px] text-slate-600">({exp.fortress!.garrison?.length || 0})</span>
                                </div>
                                <div className="space-y-1.5">
                                  {(exp.fortress!.garrison || []).map((bannerId) => {
                                    const army = banners.find(b => b.id === bannerId);
                                    if (!army) return null;
                                    const totalTroops = army.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;
                                    const maxTroops = army.squads?.reduce((sum, squad) => sum + (squad.maxSize || 0), 0) || 0;
                                    const readiness = maxTroops > 0 ? Math.round((totalTroops / maxTroops) * 100) : 0;
                                    return (
                                      <div key={bannerId} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-900 border border-emerald-900/40">
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border shrink-0 ${
                                          army.type === 'regular'
                                            ? 'text-blue-400 bg-blue-950/30 border-blue-900/50'
                                            : 'text-amber-400 bg-amber-950/30 border-amber-900/50'
                                        }`}>
                                          {army.type === 'regular' ? 'REG' : 'MERC'}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-200 truncate min-w-[80px] max-w-[120px]">{army.name}</span>
                                        <div className="flex gap-1 flex-wrap flex-1">
                                          {(army.squads || []).length === 0
                                            ? <span className="text-[10px] text-slate-600 italic">No units</span>
                                            : (army.squads || []).map((sq, i) => {
                                                const icon = unitCategory[sq.type as UnitType] === 'ranged_infantry' ? '🏹' : unitCategory[sq.type as UnitType] === 'cavalry' ? '🐴' : '⚔️';
                                                return (
                                                  <span key={i} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                                                    <span>{icon}</span>
                                                    <span className="font-medium">{unitDisplayNames[sq.type as UnitType] || sq.type}</span>
                                                    <span className="text-slate-500">{sq.currentSize}/{sq.maxSize}</span>
                                                  </span>
                                                );
                                              })
                                          }
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0 min-w-[70px]">
                                          <span className={`text-[9px] font-medium ${readiness >= 80 ? 'text-emerald-400' : readiness >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {totalTroops} troops ({readiness}%)
                                          </span>
                                          <button
                                            onClick={() => onRemoveBannerFromFortress(exp.expeditionId, bannerId)}
                                            className="px-2 py-0.5 rounded text-[10px] bg-red-900/60 hover:bg-red-800 text-red-300 border border-red-900/50"
                                            title="Remove from fortress"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Available Ready Armies */}
                            {(() => {
                              const garrison = exp.fortress!.garrison || [];
                              const readyArmies = banners.filter(b =>
                                b.status === 'ready' &&
                                !garrison.includes(b.id)
                              );

                              if (readyArmies.length === 0 && garrison.length === 0) {
                                return (
                                  <div className="text-xs text-slate-500 italic py-3 px-2">
                                    No ready armies available. Train armies in the Army section to assign them to the fortress.
                                  </div>
                                );
                              }

                              if (readyArmies.length === 0) {
                                return null;
                              }

                              const atCapacity = garrison.length >= (exp.fortress!.stats?.garrisonCapacity || 1);

                              return (
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-blue-400 text-sm">⚔️</span>
                                    <span className="text-[10px] text-blue-400 font-semibold uppercase tracking-wide">Available to Deploy</span>
                                    <span className="text-[9px] text-slate-600">({readyArmies.length})</span>
                                  </div>
                                  {atCapacity && (
                                    <div className="text-[10px] text-amber-400 italic mb-2 px-2 py-1.5 rounded bg-amber-950/20 border border-amber-900/30">
                                      Garrison full. Upgrade Garrison Hut to station more armies.
                                    </div>
                                  )}
                                  <div className="space-y-1.5">
                                    {readyArmies.map((army) => {
                                      const totalTroops = army.squads?.reduce((sum, squad) => sum + squad.currentSize, 0) || 0;
                                      const maxTroops = army.squads?.reduce((sum, squad) => sum + (squad.maxSize || 0), 0) || 0;
                                      const readiness = maxTroops > 0 ? Math.round((totalTroops / maxTroops) * 100) : 0;
                                      return (
                                        <div key={army.id} className={`flex items-center gap-3 p-2.5 rounded-lg bg-slate-900 border ${atCapacity ? 'border-slate-800 opacity-50' : 'border-slate-700'}`}>
                                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border shrink-0 ${
                                            army.type === 'regular'
                                              ? 'text-blue-400 bg-blue-950/30 border-blue-900/50'
                                              : 'text-amber-400 bg-amber-950/30 border-amber-900/50'
                                          }`}>
                                            {army.type === 'regular' ? 'REG' : 'MERC'}
                                          </span>
                                          <span className="text-xs font-semibold text-slate-200 truncate min-w-[80px] max-w-[120px]">{army.name}</span>
                                          <div className="flex gap-1 flex-wrap flex-1">
                                            {(army.squads || []).length === 0
                                              ? <span className="text-[10px] text-slate-600 italic">No units</span>
                                              : (army.squads || []).map((sq, i) => {
                                                  const icon = unitCategory[sq.type as UnitType] === 'ranged_infantry' ? '🏹' : unitCategory[sq.type as UnitType] === 'cavalry' ? '🐴' : '⚔️';
                                                  return (
                                                    <span key={i} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                                                      <span>{icon}</span>
                                                      <span className="font-medium">{unitDisplayNames[sq.type as UnitType] || sq.type}</span>
                                                      <span className="text-slate-500">{sq.currentSize}/{sq.maxSize}</span>
                                                    </span>
                                                  );
                                                })
                                            }
                                          </div>
                                          <div className="flex flex-col items-end gap-1 shrink-0 min-w-[70px]">
                                            <span className={`text-[9px] font-medium ${readiness >= 80 ? 'text-emerald-400' : readiness >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                              {totalTroops} troops ({readiness}%)
                                            </span>
                                            <button
                                              onClick={() => onAssignBannerToFortress(exp.expeditionId, army.id)}
                                              className={`px-2 py-0.5 rounded text-[10px] ${atCapacity ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-emerald-700 hover:bg-emerald-600 text-white'}`}
                                              title={atCapacity ? 'Garrison full — upgrade Garrison Hut' : 'Assign to fortress'}
                                              disabled={atCapacity}
                                            >
                                              Assign
                                            </button>
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
                                  setExpeditionTab('map');
                                  setTimeout(() => {
                                    const reportElement = document.getElementById(`battle-report-${exp.expeditionId}`);
                                    if (reportElement) {
                                      reportElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                  }, 100);
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
                                        setExpeditionTab('map');
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
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 italic p-4 text-center">
                          The fortress has fallen. No operations available.
                        </div>
                      )}
                    </div>
                  )}

                  {/* ══════ BUILDING TAB ══════ */}
                  {expeditionTab === 'building' && (
                    <div>
                      {exp.state === 'completed' ? (
                        <div className="space-y-2">
                          {exp.fortress!.buildings.map((building) => {
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
                                          : building.id === 'garrison_hut'
                                            ? `Garrison capacity: ${currentEffect.garrisonCapacity || 1} ${(currentEffect.garrisonCapacity || 1) === 1 ? 'army' : 'armies'}`
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
                                              nextEffect.garrisonCapacity ? `Increase garrison to ${nextEffect.garrisonCapacity} armies` :
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
                                        onClick={() => {
                                          if (!affordable) {
                                            const missing: string[] = [];
                                            if (!enoughWood) missing.push('Wood');
                                            if (!enoughStone) missing.push('Stone');
                                            if (missing.length > 0) onShowResourceError?.(`Not enough ${missing.join(', ')}`);
                                            return;
                                          }
                                          onUpgradeFortressBuilding(exp.expeditionId, building.id);
                                        }}
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
                      ) : (
                        <div className="text-xs text-slate-500 italic p-4 text-center">
                          The fortress has fallen. Buildings cannot be managed.
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}

            </div>
          );
        })}
      </div>

    </section>
  );
}
