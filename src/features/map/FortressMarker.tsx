/**
 * FortressMarker — HTML overlay positioned at a province center on the map.
 */

import React from 'react';

interface Props {
  screenX: number;
  screenY: number;
  label?: string;
}

export const FortressMarker: React.FC<Props> = ({ screenX, screenY, label }) => {
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
        <div className="text-2xl drop-shadow-lg">🏰</div>
        {label && (
          <div className="text-amber-300 text-[10px] font-bold bg-slate-900/80 px-1.5 py-0.5 rounded mt-0.5 whitespace-nowrap">
            {label}
          </div>
        )}
      </div>
    </div>
  );
};
