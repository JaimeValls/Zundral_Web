// ============================================================================
// Zundral — AnchoredUnitPicker
// Floating unit-type selection picker anchored to a triggering button.
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UnitType, UnitCategory, WarehouseState } from '../types';
import { unitCategory, ironCostPerSquad, unitDisplayNames } from '../constants';
import { useMobileDetection } from '../hooks/useMobileDetection';

export interface AnchoredUnitPickerProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  onSelectUnit: (unitType: UnitType) => void;
  warehouse: WarehouseState;
  currentUnitType?: UnitType;
}

const AnchoredUnitPicker: React.FC<AnchoredUnitPickerProps> = ({
  isOpen,
  onClose,
  anchorRect,
  onSelectUnit,
  warehouse,
  currentUnitType,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<UnitCategory>('infantry');
  const pickerRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobileDetection();

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Calculate position
  const positionStyle: React.CSSProperties = useMemo(() => {
    if (!anchorRect) return {};

    const PADDING = 12;
    const WIDTH = isMobile ? Math.min(window.innerWidth - PADDING * 2, 340) : 340;
    const HEIGHT = isMobile ? 360 : 400;

    let top = anchorRect.bottom + 8;
    let left = anchorRect.left;

    if (isMobile) {
      left = (window.innerWidth - WIDTH) / 2;
    } else {
      if (left + WIDTH > window.innerWidth) left = window.innerWidth - WIDTH - PADDING;
      if (left < PADDING) left = PADDING;
    }

    if (top + HEIGHT > window.innerHeight) top = anchorRect.top - HEIGHT - 8;
    top = Math.max(PADDING, Math.min(top, window.innerHeight - HEIGHT - PADDING));

    return {
      top: `${top + window.scrollY}px`,
      left: `${left + window.scrollX}px`,
      width: `${WIDTH}px`,
      position: 'absolute',
      zIndex: 60,
    };
  }, [anchorRect, isMobile]);

  if (!isOpen || !anchorRect) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-50 transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      />

      <div
        ref={pickerRef}
        style={positionStyle}
        className="max-h-[400px] flex flex-col bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex flex-col gap-0.5 p-4 pb-3">
          <span className="text-[9px] font-black text-pink-500 uppercase tracking-[0.2em] leading-none">Deployment</span>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white uppercase tracking-tight">Select Unit Type</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors border border-slate-700/50"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex px-4 gap-1 mb-2 border-b border-slate-800/50 pb-2">
          {(['infantry', 'ranged_infantry', 'cavalry'] as UnitCategory[]).map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                selectedCategory === cat
                  ? 'text-pink-500 bg-pink-500/5'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {cat === 'infantry' ? 'Infantry' : cat === 'ranged_infantry' ? 'Ranged' : 'Cavalry'}
            </button>
          ))}
        </div>

        {/* Unit List */}
        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2.5 custom-scrollbar max-h-[280px]">
          {Object.entries(unitCategory)
            .filter(([_, cat]) => cat === selectedCategory)
            .map(([type]) => {
              const uType = type as UnitType;
              const cost = ironCostPerSquad[uType];
              const canAfford = warehouse.iron >= cost;
              const isSelected = currentUnitType === uType;

              return (
                <button
                  key={uType}
                  onClick={() => canAfford && onSelectUnit(uType)}
                  disabled={!canAfford}
                  className={`relative h-14 px-3 py-2 rounded-2xl border-2 transition-all flex items-center gap-3 ${
                    isSelected
                      ? 'bg-emerald-500/5 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                      : canAfford
                      ? 'bg-slate-800/40 border-slate-800 hover:border-slate-700 active:scale-95'
                      : 'bg-slate-950/40 border-slate-900/50 opacity-40 grayscale'
                  }`}
                >
                  <span className={`text-2xl shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {unitCategory[uType] === 'ranged_infantry' ? '🏹' : unitCategory[uType] === 'cavalry' ? '🐴' : '⚔️'}
                  </span>

                  <div className="flex flex-col items-start min-w-0 overflow-hidden leading-tight">
                    <span className="text-[10px] font-black text-white uppercase truncate w-full">
                      {unitDisplayNames[uType]}
                    </span>
                    <span className={`text-[9px] font-bold ${
                      cost === 0 ? 'text-emerald-500/60' : canAfford ? 'text-slate-500' : 'text-red-500/60'
                    }`}>
                      {cost === 0 ? 'FREE' : `${cost} Iron`}
                    </span>
                  </div>

                  {isSelected && (
                    <div className="absolute top-1 right-1">
                      <span className="px-1 py-0.5 bg-emerald-500 text-white text-[6px] font-black uppercase rounded-[4px] tracking-tighter shadow-sm pulse-subtle">
                        Active
                      </span>
                    </div>
                  )}

                  {!canAfford && cost > 0 && !isSelected && (
                    <div className="absolute top-1 right-1">
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      </div>
    </>
  );
};

export default AnchoredUnitPicker;
