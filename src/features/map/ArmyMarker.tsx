/**
 * ArmyMarker — HTML overlay for an army at a province on the map.
 */

import React from 'react';

interface Props {
  screenX: number;
  screenY: number;
  armyName: string;
  armySize: number;
}

export const ArmyMarker: React.FC<Props> = ({ screenX, screenY, armyName, armySize }) => {
  return (
    <div
      className="absolute pointer-events-none z-20"
      style={{
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="flex flex-col items-center">
        <div className="text-lg drop-shadow-lg">⚔️</div>
        <div className="text-xs font-bold bg-slate-800/90 border border-slate-600/50 text-slate-200 px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5">
          {armyName}
          {armySize > 0 && <span className="text-slate-400 ml-1">({armySize})</span>}
        </div>
      </div>
    </div>
  );
};
