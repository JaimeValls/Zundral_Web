/**
 * FortressMarker — HTML overlay showing fortress status on the map.
 * Displays: icon, HP bar, garrison count, battle alert.
 */

import React from 'react';

interface Props {
  screenX: number;
  screenY: number;
  label?: string;
  fortHP?: number;
  maxFortHP?: number;
  garrisonCount?: number;
  deployedCount?: number;
  wasAttacked?: boolean;
}

export const FortressMarker: React.FC<Props> = ({
  screenX, screenY, label,
  fortHP, maxFortHP, garrisonCount, deployedCount, wasAttacked,
}) => {
  const hpPercent = (maxFortHP && maxFortHP > 0)
    ? Math.max(0, Math.min(100, ((fortHP ?? maxFortHP) / maxFortHP) * 100))
    : 100;

  const hpColor = hpPercent >= 60 ? '#22c55e' : hpPercent >= 30 ? '#eab308' : '#ef4444';

  return (
    <div
      className="absolute pointer-events-none z-30"
      style={{
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="flex flex-col items-center">
        {/* Fortress icon with optional battle alert */}
        <div className="relative">
          <div className="text-2xl drop-shadow-lg">🏰</div>
          {wasAttacked && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse border border-red-300" />
          )}
        </div>

        {/* HP bar */}
        {maxFortHP != null && maxFortHP > 0 && (
          <div className="w-12 h-1 bg-slate-700 rounded-full mt-0.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${hpPercent}%`, backgroundColor: hpColor }}
            />
          </div>
        )}

        {/* Label */}
        {label && (
          <div className="text-amber-300 text-[10px] font-bold bg-slate-900/80 px-1.5 py-0.5 rounded mt-0.5 whitespace-nowrap">
            {label}
          </div>
        )}

        {/* Troop counts — garrison + deployed */}
        {(garrisonCount != null && garrisonCount > 0) || (deployedCount != null && deployedCount > 0) ? (
          <div className="text-[9px] bg-slate-800/90 px-1.5 py-0.5 rounded mt-0.5 whitespace-nowrap flex items-center gap-1.5">
            {garrisonCount != null && garrisonCount > 0 && (
              <span className="text-slate-300">🏰 {garrisonCount}</span>
            )}
            {deployedCount != null && deployedCount > 0 && (
              <span className="text-emerald-400">⚔ {deployedCount}</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
