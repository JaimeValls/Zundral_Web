import React from 'react'
import { useGameStore } from '../../app/store'
import { Badge } from '../components/Badge'
import { formatDistanceToNow } from 'date-fns'
import { nowSec } from '../../lib/time'
import { isClaimExpired, canClaimMission } from '../../domain/missions'

export function Reports() {
  const missions = useGameStore((state) => state.missions)
  const time = useGameStore((state) => state.time)
  const claimMission = useGameStore((state) => state.claimMission)
  const currentTime = nowSec(time.offset)

  const claimableMissions = missions.completed.filter((c) => canClaimMission(c) && !isClaimExpired(c, currentTime))
  const expiredMissions = missions.completed.filter((c) => isClaimExpired(c, currentTime))

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Reports</h1>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Claim Rewards</h2>
        {claimableMissions.length === 0 ? (
          <p className="text-gray-500">No rewards to claim</p>
        ) : (
          <div className="space-y-2">
            {claimableMissions.map((completed) => (
              <div key={completed.mission.id} className="border p-3 rounded">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-semibold capitalize">{completed.mission.type.replace('_', ' ')}</div>
                    <div className="text-sm text-gray-600">
                      Completed {formatDistanceToNow(new Date(completed.completedAt * 1000), { addSuffix: true })}
                    </div>
                    <div className="text-sm mt-1">
                      Reward: {Object.entries(completed.reward).map(([r, a]) => `${a} ${r}`).join(', ')}
                    </div>
                    {completed.losses > 0 && (
                      <Badge variant="warning" className="mt-1">Losses: {completed.losses}%</Badge>
                    )}
                  </div>
                  <button
                    onClick={() => claimMission(completed.mission.id)}
                    className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm"
                  >
                    Claim
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {expiredMissions.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2 text-red-600">Expired Missions</h2>
          <div className="space-y-2">
            {expiredMissions.map((completed) => (
              <div key={completed.mission.id} className="border p-3 rounded opacity-50">
                <div className="font-semibold capitalize">{completed.mission.type.replace('_', ' ')}</div>
                <div className="text-sm text-gray-600">Expired</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
