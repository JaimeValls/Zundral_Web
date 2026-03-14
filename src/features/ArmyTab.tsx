// ============================================================================
// Zundral — ArmyTab
// Army tab: mercenary hiring, regular banner management, and unit formation.
// Keeps anchoredPickerState as internal UI state; everything else via props.
// ============================================================================

import React, { useState } from 'react';
import type {
  Banner,
  BannerTemplate,
  BarracksState,
  Commander,
  UnitType,
  WarehouseState,
} from '../types';
import { unitCategory, unitDisplayNames } from '../constants';
import { getResourceIcon } from '../gameFormulas';
import AnchoredUnitPicker from '../components/AnchoredUnitPicker';

// ---------------------------------------------------------------------------
// Local helper
// ---------------------------------------------------------------------------

function formatShort(n: number) {
  const abs = Math.floor(n);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}K`;
  return abs.toLocaleString();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ArmyTabProps {
  isMobile: boolean;
  barracks: BarracksState | null;
  bannerTemplates: BannerTemplate[];
  banners: Banner[];
  armyTab: 'mercenaries' | 'regular';
  editingBannerId: number | string | null;
  bannersDraft: Banner | null;
  commanders: Commander[];
  recruitmentMode: 'regular' | 'forced';
  showRecruitmentInfo: boolean;
  bannerHint: { id: number | string; message: string } | null;
  warehouse: WarehouseState;
  // Callbacks
  onSetArmyTab: (tab: 'mercenaries' | 'regular') => void;
  onGoToProduction: () => void;
  onStartBarracksTraining: (templateId: string) => void;
  onDeleteBannerModal: (bannerId: number) => void;
  onOpenAssignModal: (commanderId: number | null, bannerId: number) => void;
  onSetBannerHint: (hint: { id: number | string; message: string } | null) => void;
  onSetRecruitmentMode: (mode: 'regular' | 'forced') => void;
  onSetShowRecruitmentInfo: (show: boolean) => void;
  onToggleBannerTraining: (bannerId: number, isCurrentlyTraining: boolean) => void;
  onUpdateBannerNameDraft: (name: string) => void;
  onCancelEditingBanner: () => void;
  onConfirmEditingBanner: () => void;
  onStartEditingBanner: (bannerId: number | string) => void;
  onDeleteBanner: (bannerId: number) => void;
  onCreateNewBanner: () => void;
  onSelectUnit: (unitType: UnitType, bannerId: number, slotIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ArmyTab({
  isMobile,
  barracks,
  bannerTemplates,
  banners,
  armyTab,
  editingBannerId,
  bannersDraft,
  commanders,
  recruitmentMode,
  showRecruitmentInfo,
  bannerHint,
  warehouse,
  onSetArmyTab,
  onGoToProduction,
  onStartBarracksTraining,
  onDeleteBannerModal,
  onOpenAssignModal,
  onSetBannerHint,
  onSetRecruitmentMode,
  onSetShowRecruitmentInfo,
  onToggleBannerTraining,
  onUpdateBannerNameDraft,
  onCancelEditingBanner,
  onConfirmEditingBanner,
  onStartEditingBanner,
  onDeleteBanner,
  onCreateNewBanner,
  onSelectUnit,
}: ArmyTabProps) {
  // Internal UI-only state — does not affect game logic or saves
  const [anchoredPickerState, setAnchoredPickerState] = useState<{
    isOpen: boolean;
    bannerId: number;
    slotIndex: number;
    anchorRect: DOMRect | null;
  }>({
    isOpen: false,
    bannerId: 0,
    slotIndex: 0,
    anchorRect: null,
  });

  return (
    <section className={`max-w-game mx-auto px-4 sm:px-6 ${isMobile ? 'pb-32 pt-0' : 'pb-24 pt-1'}`}>

      {/* Army Tab Navigation - Compact Segmented Control */}
      <div className="mb-3">
        <div className="flex p-1 bg-slate-800/80 rounded-lg border border-slate-600">
          <button
            onClick={() => onSetArmyTab('mercenaries')}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${armyTab === 'mercenaries'
              ? 'bg-amber-700 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
          >
            ⚔️ Mercenaries
          </button>
          <button
            onClick={() => onSetArmyTab('regular')}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${armyTab === 'regular'
              ? 'bg-amber-700 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
          >
            🛡️ Regular Army
          </button>
        </div>
      </div>

      {!barracks && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center mt-3">
          <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center mx-auto mb-4 border border-slate-700">
            <span className="text-2xl">⚔️</span>
          </div>
          <h3 className="text-sm font-semibold text-white mb-2">Barracks Required</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">Build a Barracks to begin forming your army.</p>
          <button
            onClick={onGoToProduction}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
          >
            Go to Buildings
          </button>
        </div>
      )}

      {/* Mercenaries Tab Content */}
      {armyTab === 'mercenaries' && barracks && (
        <div className={`animate-in fade-in slide-in-from-bottom-4 duration-500 ${isMobile ? 'space-y-4 mt-2' : 'space-y-6 mt-4'}`}>
          <div className="flex items-center justify-between px-1">
            <div className="flex flex-col">
              <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none">Mercenary Contracts</h3>
            </div>
            <div className="text-[9px] font-semibold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-1 rounded-lg">
              Slots: {barracks.trainingSlots}
            </div>
          </div>

          {/* Mercenary Cards - Compact Style */}
          <div className="space-y-2">
            {bannerTemplates.slice(0, barracks.maxTemplates).map(template => {
              const hasEnoughGold = warehouse.gold >= template.cost;
              const isAlreadyHiring = barracks.trainingQueue.some(job => job.templateId === template.id);
              const canHire = barracks.trainingQueue.length < barracks.trainingSlots && hasEnoughGold && !isAlreadyHiring;

              const hasWarriors = template.squads.some(s => s.type === 'warrior');
              const hasArchers = template.squads.some(s => s.type === 'archer');
              const roleTag = hasWarriors && hasArchers ? 'Mixed' : hasWarriors ? 'Melee' : 'Ranged';
              const roleIcon = roleTag === 'Melee' ? '⚔️' : roleTag === 'Ranged' ? '🏹' : '⚡';

              return (
                <div
                  key={template.id}
                  className={`rounded-lg border bg-slate-900 p-2 sm:p-3 transition-all ${isAlreadyHiring ? 'border-blue-500' : 'border-slate-800'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    {/* Icon */}
                    <div className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
                      <span className="text-lg sm:text-xl">{roleIcon}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs sm:text-sm font-semibold text-slate-200 truncate mb-0.5">{template.name}</h4>
                      <div className="flex gap-1.5 flex-wrap">
                        {/* Unit Composition - Detailed Breakdown */}
                        {template.squads.map((squad, idx) => {
                          const squadIcon = unitCategory[squad.type as UnitType] === 'ranged_infantry' ? '🏹' :
                            unitCategory[squad.type as UnitType] === 'cavalry' ? '🐴' : '⚔️';
                          const squadCount = squad.count * 10;

                          return (
                            <div
                              key={idx}
                              className="h-5 sm:h-6 px-1.5 rounded bg-slate-800/60 border border-slate-700 flex items-center gap-1"
                            >
                              <span className="text-[10px] sm:text-xs leading-none">{squadIcon}</span>
                              <span className="text-[9px] sm:text-[10px] text-slate-300 font-medium">{unitDisplayNames[squad.type as UnitType]}</span>
                              <span className="text-[9px] text-slate-500">×{squadCount}</span>
                            </div>
                          );
                        })}

                        {/* Arrival Time Badge */}
                        <span className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800/50">
                          5s arrival
                        </span>

                        {/* Role Tag */}
                        <span className={`text-[9px] sm:text-[10px] px-1 py-0.5 rounded border ${roleTag === 'Melee' ? 'text-red-400 bg-red-950/30 border-red-900/50' :
                          roleTag === 'Ranged' ? 'text-emerald-400 bg-emerald-950/30 border-emerald-900/50' :
                            'text-blue-400 bg-blue-950/30 border-blue-900/50'
                          }`}>
                          {roleTag}
                        </span>
                      </div>
                    </div>

                    {/* Cost & Action */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-0.5">
                        <span className={`text-xs font-semibold ${hasEnoughGold ? 'text-emerald-600' : 'text-red-600'}`}>
                          {formatShort(template.cost)}
                        </span>
                        <img src={getResourceIcon('Gold')} className="w-3 h-3" alt="gold" />
                      </div>
                      <button
                        onClick={() => onStartBarracksTraining(template.id)}
                        disabled={!canHire}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${canHire
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                          }`}
                      >
                        {isAlreadyHiring ? 'Hiring' : 'Hire'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Training Queue - Compact Display */}
          {barracks.trainingQueue.length > 0 && (
            <div className="mt-3 p-2 rounded-lg bg-slate-950/50 border border-slate-800">
              <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-1.5">
                Training: {barracks.trainingQueue.length}/{barracks.trainingSlots}
              </div>
              <div className="space-y-1.5">
                {barracks.trainingQueue.map(job => {
                  const progress = (job.elapsedTime / (job.arrivalTime || 1)) * 100;
                  return (
                    <div key={job.id} className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-400 font-semibold whitespace-nowrap">
                        {job.elapsedTime}s / {job.arrivalTime || 0}s
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stationed Mercenaries */}
          <div className="mt-3 pt-3 border-t border-slate-800">
            <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Stationed</div>
            <div className="space-y-2">
              {banners.filter(b => b.type === 'mercenary').length === 0 ? (
                <div className="text-xs text-slate-600 italic">No mercenaries stationed</div>
              ) : (
                banners.filter(b => b.type === 'mercenary').map(b => (
                  <div key={b.id} className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">{b.name}</span>
                    <button
                      onClick={() => onDeleteBannerModal(b.id)}
                      className="w-6 h-6 rounded bg-red-950/30 text-red-500 flex items-center justify-center text-xs hover:bg-red-500 hover:text-white transition-all"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {armyTab === 'regular' && barracks && (
        <div className={`space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 ${isMobile ? 'mt-2' : 'mt-4'}`}>
          {/* Recruitment Strategy - Compact */}
          <div className="flex items-center justify-between p-2 rounded-lg border border-slate-700 bg-slate-900 mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-500 font-semibold uppercase">Strategy:</span>
              <span className="text-xs font-semibold text-slate-200">
                {recruitmentMode === 'regular' ? 'Stable Growth' : 'Total Mobilization'}
              </span>
            </div>
            <div className="flex p-0.5 bg-slate-950 rounded border border-slate-800">
              <button
                onClick={() => onSetRecruitmentMode('regular')}
                className={`px-2 py-0.5 text-[9px] rounded font-semibold transition-colors ${recruitmentMode === 'regular' ? 'bg-emerald-600 text-white' : 'text-slate-500'
                  }`}
              >
                Regular
              </button>
              <button
                onClick={() => onSetRecruitmentMode('forced')}
                className={`px-2 py-0.5 text-[9px] rounded font-semibold transition-colors ${recruitmentMode === 'forced' ? 'bg-red-600 text-white' : 'text-slate-500'
                  }`}
              >
                Forced
              </button>
            </div>
          </div>
          {isMobile && (
            <div className="mb-2">
              <button
                onClick={() => onSetShowRecruitmentInfo(!showRecruitmentInfo)}
                className="text-[9px] text-slate-600 font-bold flex items-center gap-1"
              >
                {showRecruitmentInfo ? 'Hide details' : 'Learn more'}
                <span className="text-[7px]">{showRecruitmentInfo ? '▲' : '▼'}</span>
              </button>
              {showRecruitmentInfo && (
                <div className="mt-1 text-[10px] text-slate-400 p-2 rounded-lg bg-slate-950/50 border border-slate-800/50">
                  {recruitmentMode === 'regular'
                    ? "Uses ONLY free population. Slow, safe."
                    : "Drafts active workers. Fast, costly."}
                </div>
              )}
            </div>
          )}

          {/* Banners Section Header */}
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Regular Army</div>

          {/* Banner List Section */}
          <div className={`${isMobile ? 'space-y-4 pb-32' : 'space-y-6'}`}>
            {banners.filter(b => b.type === 'regular').length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed border-slate-800 bg-slate-900 flex flex-col items-center gap-2">
                <span className="text-2xl">🏴</span>
                <span className="text-xs font-semibold text-slate-400 uppercase">No Banners</span>
              </div>
            ) : (
              <div className="space-y-3">
                {banners.filter(b => b.type === 'regular').map((b) => {
                  const isEditing = b.id === editingBannerId;
                  const isGlobalEditing = editingBannerId !== null;
                  const isDisabled = isGlobalEditing && !isEditing;
                  const commander = b.commanderId ? commanders.find(c => c.id === b.commanderId) : null;
                  const isTraining = b.status === 'training';

                  const hasSquads = (b.squads || []).length > 0;

                  const handleSlotClick = (e: React.MouseEvent, idx: number) => {
                    e.stopPropagation();
                    if (!isEditing) {
                      onSetBannerHint({ id: b.id, message: "Editing is OFF. Click Edit to modify." });
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    setAnchoredPickerState({
                      isOpen: true,
                      bannerId: b.id,
                      slotIndex: idx,
                      anchorRect: rect
                    });
                  };

                  return (
                    <div
                      key={b.id}
                      className={`rounded-lg border bg-slate-900 p-2 transition-all relative group ${isDisabled ? 'opacity-40 pointer-events-none grayscale border-slate-800' : 'opacity-100'} ${isEditing ? 'border-blue-500 shadow-sm' : 'border-slate-800'}`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Icon & Basic Info */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {/* Commander Icon (Left placement, interactive) */}
                          <div
                            className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center shadow-sm border cursor-pointer transition-colors ${commander ? 'bg-blue-900/20 border-blue-800 text-blue-400 hover:bg-blue-900/40' : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700'}`}
                            onClick={(e) => { e.stopPropagation(); onOpenAssignModal(null, b.id); }}
                            title={commander ? "Change Commander" : "Assign Commander"}
                          >
                            <span className={commander ? 'text-lg' : 'text-base'}>{commander ? '⚔️' : '👤'}</span>
                          </div>

                          {/* Banner Icon (Compact) */}
                          <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center shadow-sm border ${commander ? 'bg-blue-900/20 border-blue-800' : 'bg-slate-800 border-slate-700'}`}>
                            <span className="text-lg">{commander ? '⚔️' : '🏴'}</span>
                          </div>

                          {/* Banner Name & Status Column */}
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {!isEditing ? (
                                <h3
                                  className="text-sm font-bold text-slate-200 truncate cursor-pointer hover:text-slate-400"
                                  onClick={() => !isEditing && onSetBannerHint({ id: b.id, message: "Editing is OFF. Click Edit to modify." })}
                                >
                                  {b.name}
                                </h3>
                              ) : (
                                <input
                                  type="text"
                                  value={bannersDraft && bannersDraft.id === b.id ? bannersDraft.name : b.name}
                                  onChange={(e) => onUpdateBannerNameDraft(e.target.value)}
                                  className={`border text-sm font-semibold px-2 py-1 rounded outline-none w-40 transition-colors shadow-inner ${
                                    hasSquads
                                      ? 'bg-slate-900 border-slate-600 text-white focus:border-blue-500 focus:bg-slate-800'
                                      : 'bg-slate-950/40 border-slate-700/50 text-slate-400 focus:border-slate-600 focus:bg-slate-900'
                                  }`}
                                  placeholder="Banner Name..."
                                  onClick={(e) => e.stopPropagation()}
                                />
                              )}

                              {/* Badges - Tight group */}
                              <div className="flex items-center gap-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-semibold ${b.status === 'ready' ? 'text-emerald-400 bg-emerald-950/30 border-emerald-900/50' : (b.status as string) === 'training' ? 'text-blue-400 bg-blue-950/30 border-blue-900/50' : 'text-amber-500 bg-amber-950/30 border-amber-900/50'}`}>
                                  {b.status}
                                </span>
                              </div>
                            </div>

                            {/* Commander Subtext (Name only if assigned) */}
                            <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>{commander ? `Cmdr. ${commander.name}` : ''}</span>
                            </div>
                          </div>

                          {/* Progression Information Area (Moved inside left group) */}
                          {!isEditing && (
                            <div className="hidden sm:flex items-center gap-3 ml-2 px-3 py-1.5 rounded-lg bg-slate-950/40 border border-slate-800/50 shrink-0">
                              {/* Tier Badge (Compact) */}
                              <div className="h-5 px-1.5 min-w-[20px] rounded bg-slate-800 flex items-center justify-center border border-slate-700">
                                <span className="text-slate-400 font-bold text-[10px] tracking-tight">T{b.level || 1}</span>
                              </div>

                              {/* XP Bar & Stats */}
                              <div className="flex flex-col justify-center min-w-[120px]">
                                <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium mb-1 leading-none">
                                  <span>XP Progress</span>
                                  <span>{Math.floor(b.xp || 0)} <span className="text-slate-600">/</span> {b.xpNextLevel || 100}</span>
                                </div>
                                <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                                  <div
                                    className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)] relative"
                                    style={{ width: `${Math.max(0, Math.min(100, ((b.xp || 0) - (b.xpCurrentLevel || 0)) / ((b.xpNextLevel || 100) - (b.xpCurrentLevel || 0)) * 100))}%` }}
                                  >
                                    <div className="absolute inset-0 bg-white/20"></div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Actions Group (Right aligned on desktop) */}
                        <div className="flex items-center gap-2 justify-end">
                          {isEditing ? (
                            <>
                              <button onClick={() => onCancelEditingBanner()} className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-[10px] sm:text-xs font-semibold hover:bg-slate-700">Cancel</button>
                              <button onClick={() => onConfirmEditingBanner()} className="px-3 py-1 rounded bg-emerald-600 text-white text-[10px] sm:text-xs font-semibold hover:bg-emerald-500">Save</button>
                            </>
                          ) : (
                            <>
                              {/* Train Button */}
                              {(() => {
                                const needsTraining = b.squads ? b.squads.some(s => s.currentSize < s.maxSize) : b.recruited < b.reqPop;

                                if (needsTraining || isTraining) {
                                  return (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleBannerTraining(b.id, isTraining);
                                      }}
                                      className={`px-2 py-1 rounded-lg text-[10px] sm:text-xs font-semibold border ${isTraining ? 'bg-blue-900/20 text-blue-400 border-blue-800' : 'bg-amber-900/20 text-amber-500 border-amber-800'}`}
                                    >
                                      {isTraining ? 'Training...' : 'Train'}
                                    </button>
                                  );
                                }
                                return null;
                              })()}
                              <button
                                onClick={(e) => { e.stopPropagation(); onStartEditingBanner(b.id); }}
                                disabled={isGlobalEditing}
                                className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px] sm:text-xs font-semibold border border-slate-700 hover:bg-slate-700 disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteBanner(b.id); }}
                                disabled={isGlobalEditing}
                                className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 text-[10px] sm:text-xs font-semibold border border-slate-700 hover:text-red-400 hover:border-red-900/50 hover:bg-red-950/20 disabled:opacity-50 transition-colors"
                                title="Delete Banner"
                              >
                                🗑️
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Formation Grid - Integrated tightly */}
                      <div className="mt-2 border-t border-slate-800/50 pt-2">
                        {/* Onboarding hint when editing an empty banner */}
                        {isEditing && !hasSquads && (
                          <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-md bg-amber-950/20 border border-amber-800/30">
                            <span className="text-amber-400 text-sm">👇</span>
                            <span className="text-[11px] text-amber-400/90 font-medium">Start by selecting your first unit</span>
                          </div>
                        )}
                        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                          {Array.from({ length: 8 }).map((_, idx) => {
                            let displaySquads = b.squads || [];
                            const squad = displaySquads.some(s => s.slotIndex !== undefined)
                              ? displaySquads.find(s => s.slotIndex === idx)
                              : displaySquads[idx];

                            const isFirstEmptySlot = isEditing && !hasSquads && idx === 0;

                            return (
                              <button
                                key={idx}
                                disabled={!isEditing}
                                onClick={(e) => handleSlotClick(e, idx)}
                                title={squad ? unitDisplayNames[squad.type] : isEditing ? "Add Unit" : "Empty Slot"}
                                className={`relative h-9 sm:h-10 rounded-md border flex items-center px-1.5 transition-all overflow-hidden gap-1.5 ${squad
                                  ? 'bg-slate-800/60 border-slate-700 hover:border-slate-500'
                                  : isFirstEmptySlot
                                    ? 'bg-amber-950/20 border-amber-500/60 border-dashed hover:border-amber-400 hover:bg-amber-950/30 animate-pulse'
                                    : isEditing ? 'bg-slate-900/50 border-slate-800 border-dashed hover:border-slate-600 hover:bg-slate-800/50' : 'bg-slate-950/20 border-slate-800/20 border-dashed'
                                  } ${!isEditing ? 'cursor-default' : 'cursor-pointer'}`}
                              >
                                {squad ? (
                                  <>
                                    {/* Icon */}
                                    <span className="text-sm shrink-0 leading-none filter drop-shadow-sm">
                                      {unitCategory[squad.type] === 'ranged_infantry' ? '🏹' : unitCategory[squad.type] === 'cavalry' ? '🐴' : '⚔️'}
                                    </span>

                                    {/* Name & Progress */}
                                    <div className="flex flex-col min-w-0 flex-1 leading-none justify-center h-full py-0.5">
                                      <div className="flex items-center justify-between gap-1 w-full">
                                        <span className="text-[10px] sm:text-[11px] font-semibold text-slate-200 truncate">{unitDisplayNames[squad.type]}</span>
                                        <span className={`text-[9px] font-medium shrink-0 ${squad.currentSize < squad.maxSize ? 'text-amber-400' : 'text-slate-500'}`}>
                                          {squad.currentSize}/{squad.maxSize}
                                        </span>
                                      </div>

                                      {/* Tiny progress bar at bottom of text area */}
                                      <div className="w-full h-0.5 bg-slate-950/50 rounded-full mt-0.5 overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all duration-500 ${squad.currentSize < squad.maxSize ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                          style={{ width: `${(squad.currentSize / squad.maxSize) * 100}%` }}
                                        />
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  isEditing && (
                                    <div className={`flex items-center gap-1.5 w-full ${isFirstEmptySlot ? 'opacity-90' : 'opacity-50'}`}>
                                      <span className={`text-xs ${isFirstEmptySlot ? 'text-amber-400' : 'text-slate-500'}`}>➕</span>
                                      <span className={`text-[10px] font-medium uppercase tracking-wide truncate ${isFirstEmptySlot ? 'text-amber-400' : 'text-slate-500'}`}>
                                        {isFirstEmptySlot ? 'Add Unit' : 'Select Unit'}
                                      </span>
                                    </div>
                                  )
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Hint Overlay if needed */}
                      {bannerHint && bannerHint.id === b.id && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60 rounded-lg animate-in fade-in duration-200" onClick={() => onSetBannerHint(null)}>
                          <div className="bg-slate-900 border border-slate-700 px-3 py-2 rounded shadow-xl text-xs text-slate-300 font-semibold">
                            ⚠️ Edit mode OFF
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* New Banner Button - Compact */}
          <button
            onClick={() => onCreateNewBanner()}
            className="w-full p-3 rounded-lg border border-dashed border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-emerald-500/50 transition-colors flex items-center justify-center gap-2"
          >
            <span className="text-lg">+</span>
            <span className="text-xs font-semibold text-slate-400">Form New Banner</span>
          </button>
        </div>
      )}

      <AnchoredUnitPicker
        isOpen={anchoredPickerState.isOpen}
        onClose={() => setAnchoredPickerState(prev => ({ ...prev, isOpen: false }))}
        anchorRect={anchoredPickerState.anchorRect}
        warehouse={warehouse}
        currentUnitType={(() => {
          const banner = banners.find(b => b.id === anchoredPickerState.bannerId);
          if (!banner) return undefined;
          const squads = banner.squads || [];
          const squad = squads.find(s => s.slotIndex === anchoredPickerState.slotIndex);
          return squad ? squad.type : undefined;
        })()}
        onSelectUnit={(unitType) => {
          if (anchoredPickerState.bannerId !== null && anchoredPickerState.slotIndex !== null) {
            onSelectUnit(unitType, anchoredPickerState.bannerId, anchoredPickerState.slotIndex);
            setAnchoredPickerState(prev => ({ ...prev, isOpen: false }));
          }
        }}
      />
    </section>
  );
}
