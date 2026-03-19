/**
 * ProvinceTooltip — Hover tooltip showing province info.
 * Positioned via CSS transform to follow the cursor.
 */

import React from 'react';
import type { ProvinceData } from '../../types';
import { TERRAIN_NAMES } from './mapUtils';

interface Props {
  province: ProvinceData;
  screenX: number;
  screenY: number;
}

const TERRAIN_EMOJI: Record<string, string> = {
  plains: '🌾',
  forest: '🌲',
  mountain: '⛰️',
  hills: '🏔️',
  volcanic: '🌋',
  swamp: '🌿',
  coast: '🏖️',
};

export const ProvinceTooltip: React.FC<Props> = ({ province, screenX, screenY }) => {
  const terrainName = TERRAIN_NAMES[province.terrain] || province.terrain;
  const emoji = TERRAIN_EMOJI[province.terrain] || '📍';

  return (
    <div
      className="absolute pointer-events-none z-50"
      style={{
        left: screenX + 16,
        top: screenY - 8,
        transform: 'translateY(-100%)',
      }}
    >
      <div className="bg-slate-900/95 border border-amber-600/50 rounded-lg px-3 py-2 shadow-lg backdrop-blur-sm min-w-[160px]">
        <div className="text-amber-300 font-bold text-sm">
          {province.id.replace('prov_', 'Province ')}
        </div>
        <div className="text-slate-300 text-xs mt-1 flex items-center gap-1.5">
          <span>{emoji}</span>
          <span>{terrainName}</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">Elev {province.elevation}</span>
        </div>
        {province.adjacentProvinces.length > 0 && (
          <div className="text-slate-500 text-xs mt-0.5">
            {province.adjacentProvinces.length} neighbors
          </div>
        )}
      </div>
    </div>
  );
};
