/**
 * ArmyMarker — HTML overlay for an army at a province on the map.
 */

import React from 'react';
import type { ArmyOrder } from '../../types';

interface Props {
  screenX: number;
  screenY: number;
  armyName: string;
  armySize: number;
  order?: ArmyOrder;
  isSelected?: boolean;
  hostile?: boolean;
}

export const ArmyMarker: React.FC<Props> = ({ screenX, screenY, armyName, armySize, order, isSelected, hostile }) => {
  const orderType = order?.type || 'hold';

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -50%)',
        zIndex: isSelected ? 35 : 30,
      }}
    >
      <div className="flex flex-col items-center">
        {/* Glow ring when selected for ordering (player only) */}
        <div className={`text-lg drop-shadow-lg ${
          hostile
            ? 'ring-2 ring-red-500 rounded-full bg-red-900/50 px-1'
            : isSelected
              ? 'ring-2 ring-amber-400 rounded-full bg-amber-900/40 px-1'
              : ''
        }`}>
          {hostile ? '☠️' : '⚔️'}
        </div>
        <div className={`text-xs font-bold border px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 flex items-center gap-1 ${
          hostile
            ? 'bg-red-900/90 border-red-500/70 text-red-200'
            : isSelected
              ? 'bg-amber-900/90 border-amber-500/70 text-amber-200'
              : orderType === 'move'
                ? 'bg-blue-900/90 border-blue-500/50 text-blue-200'
                : 'bg-slate-800/90 border-slate-600/50 text-slate-200'
        }`}>
          {hostile ? '⚔️' : orderType === 'move' ? '➡️' : '🛡️'}
          {armyName}
          {armySize > 0 && <span className={hostile ? 'text-red-400 ml-1' : 'text-slate-400 ml-1'}>({armySize})</span>}
        </div>
      </div>
    </div>
  );
};
