/**
 * MissionMarker — HTML overlay for a mission at a province on the map.
 * Shows for available, running, and completed missions with visual distinction.
 * Supports both list missions and expedition missions.
 */

import React from 'react';

interface Props {
  screenX: number;
  screenY: number;
  missionName: string;
  terrain?: string;
  provinceName?: string;  // optional province label (e.g. "Province 47")
  isActive?: boolean;     // true when mission is running (deployed)
  isCompleted?: boolean;  // true when mission has been completed
  isExpedition?: boolean; // true for expedition-type missions (distinct styling)
  difficulty?: string;    // Easy, Medium, Hard, Boss
  enemyTotal?: number;    // total enemy troops
}

const TERRAIN_ICONS: Record<string, string> = {
  forest: '🌲',
  hills: '⛰️',
  plains: '🏕️',
  building: '🏚️',
};

const DIFF_COLORS: Record<string, string> = {
  easy: 'text-emerald-400 bg-emerald-950/70 border-emerald-700/50',
  medium: 'text-amber-400 bg-amber-950/70 border-amber-700/50',
  hard: 'text-red-400 bg-red-950/70 border-red-700/50',
  very_hard: 'text-red-400 bg-red-950/70 border-red-700/50',
  extreme: 'text-purple-400 bg-purple-950/70 border-purple-700/50',
};
const DIFF_LABELS: Record<string, string> = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard', very_hard: 'Very Hard', extreme: 'Extreme',
};

export const MissionMarker: React.FC<Props> = ({ screenX, screenY, missionName, terrain, provinceName, isActive, isCompleted, isExpedition, difficulty, enemyTotal }) => {
  const icon = (terrain && TERRAIN_ICONS[terrain]) || '📜';

  // Completed state — muted green with checkmark
  if (isCompleted) {
    return (
      <div
        className="absolute pointer-events-none z-20"
        style={{
          left: screenX,
          top: screenY,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <div className="flex flex-col items-center opacity-70">
          <div className="text-lg drop-shadow-lg relative">
            {icon}
            <span className="absolute -top-1 -right-2 text-xs">✅</span>
          </div>
          <div className="text-xs font-bold px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 bg-emerald-900/70 border border-emerald-700/50 text-emerald-300/80">
            {missionName}
            <span className="ml-1 text-emerald-400 text-[10px]">Cleared</span>
          </div>
        </div>
      </div>
    );
  }

  // Active/available state
  const labelStyle = isActive
    ? 'bg-red-900/90 border border-red-500 text-red-200 shadow-red-500/30 shadow-sm'
    : isExpedition
      ? 'bg-purple-900/80 border border-purple-500/50 text-purple-200'
      : 'bg-amber-900/80 border border-amber-600/50 text-amber-200';

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
        <div className={`text-lg drop-shadow-lg ${isActive ? 'animate-pulse' : isExpedition ? 'animate-[pulse_3s_ease-in-out_infinite]' : ''}`}>{icon}</div>
        <div className={`text-xs font-bold px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 ${labelStyle}`}>
          {missionName}
          {isActive && <span className="ml-1 text-red-400">⚔</span>}
          {isExpedition && !isActive && <span className="ml-1 text-purple-400 text-[10px]">⭐</span>}
        </div>
        {provinceName && (
          <div className="text-[9px] text-slate-400 whitespace-nowrap mt-0.5 drop-shadow-sm">{provinceName}</div>
        )}
        {difficulty && enemyTotal != null && !isCompleted && (
          <div className={`text-[9px] font-bold px-1 py-0.5 rounded border whitespace-nowrap mt-0.5 ${DIFF_COLORS[difficulty] || 'text-slate-400 bg-slate-950/70 border-slate-700/50'}`}>
            ⚔ {DIFF_LABELS[difficulty] || difficulty} ({enemyTotal})
          </div>
        )}
      </div>
    </div>
  );
};
