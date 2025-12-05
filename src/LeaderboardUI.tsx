import { useState, useMemo } from 'react';
import { LeaderboardEntry, Faction } from './leaderboard';

interface LeaderboardUIProps {
  leaderboard: LeaderboardEntry[];
  realPlayerId: string;
}

type SortField = 'score' | 'kills' | 'victories';
type SortDirection = 'asc' | 'desc';

export default function LeaderboardUI({ leaderboard, realPlayerId }: LeaderboardUIProps) {
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Find real player entry
  const realPlayerEntry = leaderboard.find(e => e.playerId === realPlayerId);

  // Sort leaderboard
  const sortedLeaderboard = useMemo(() => {
    const sorted = [...leaderboard].sort((a, b) => {
      let comparison = 0;
      
      if (sortField === 'score') {
        comparison = b.totalScore - a.totalScore;
      } else if (sortField === 'kills') {
        comparison = b.totalKills - a.totalKills;
      } else if (sortField === 'victories') {
        comparison = b.totalVictories - a.totalVictories;
      }
      
      // If equal, use score as tiebreaker
      if (comparison === 0) {
        comparison = b.totalScore - a.totalScore;
      }
      // If still equal, use kills
      if (comparison === 0) {
        comparison = b.totalKills - a.totalKills;
      }
      // If still equal, use victories
      if (comparison === 0) {
        comparison = b.totalVictories - a.totalVictories;
      }
      
      return sortDirection === 'desc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [leaderboard, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return '↕';
    return sortDirection === 'desc' ? '↓' : '↑';
  };

  const getFactionColor = (faction: Faction) => {
    switch (faction) {
      case 'Alsus':
        return 'text-blue-400';
      case 'Atrox':
        return 'text-red-400';
      case 'Neutral':
        return 'text-gray-400';
      default:
        return 'text-slate-300';
    }
  };

  return (
    <div className="space-y-4">
      {/* Real Player Summary */}
      {realPlayerEntry && (
        <div className="bg-slate-800 border-2 border-emerald-500 rounded-lg p-4">
          <h2 className="text-lg font-bold text-emerald-400 mb-3">Your Ranking</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-slate-400">Rank</div>
              <div className="text-xl font-bold text-white">#{realPlayerEntry.rank}</div>
            </div>
            <div>
              <div className="text-slate-400">Title</div>
              <div className="text-lg font-semibold text-emerald-400">{realPlayerEntry.title}</div>
            </div>
            <div>
              <div className="text-slate-400">Score</div>
              <div className="text-xl font-bold text-white">{realPlayerEntry.totalScore.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-slate-400">Kills</div>
              <div className="text-xl font-bold text-white">{realPlayerEntry.totalKills.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-slate-400">Victories</div>
              <div className="text-xl font-bold text-white">{realPlayerEntry.totalVictories}</div>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Table */}
      <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">#</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Player</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Title</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300">Faction</th>
                <th 
                  className="px-3 py-2 text-left text-xs font-semibold text-slate-300 cursor-pointer hover:bg-slate-800 select-none"
                  onClick={() => handleSort('score')}
                >
                  Score {getSortIcon('score')}
                </th>
                <th 
                  className="px-3 py-2 text-left text-xs font-semibold text-slate-300 cursor-pointer hover:bg-slate-800 select-none"
                  onClick={() => handleSort('kills')}
                >
                  Kills {getSortIcon('kills')}
                </th>
                <th 
                  className="px-3 py-2 text-left text-xs font-semibold text-slate-300 cursor-pointer hover:bg-slate-800 select-none"
                  onClick={() => handleSort('victories')}
                >
                  Victories {getSortIcon('victories')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {sortedLeaderboard.map((entry, index) => {
                const isRealPlayer = entry.playerId === realPlayerId;
                return (
                  <tr
                    key={entry.playerId}
                    className={isRealPlayer ? 'bg-emerald-900/30 hover:bg-emerald-900/40' : 'hover:bg-slate-700/50'}
                  >
                    <td className="px-3 py-2 text-sm text-slate-300">
                      {entry.rank}
                    </td>
                    <td className="px-3 py-2 text-sm font-semibold">
                      <span className={isRealPlayer ? 'text-emerald-400' : 'text-white'}>
                        {entry.playerName}
                        {isRealPlayer && ' (You)'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-300">
                      {entry.title}
                    </td>
                    <td className={`px-3 py-2 text-sm font-medium ${getFactionColor(entry.faction)}`}>
                      {entry.faction}
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-300">
                      {entry.totalScore.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-300">
                      {entry.totalKills.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-300">
                      {entry.totalVictories}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

