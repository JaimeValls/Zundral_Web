import React from 'react'
import { useGameStore } from '../../app/store'
import { Badge } from '../components/Badge'
import { formatDistanceToNow } from 'date-fns'
import { nowSec } from '../../lib/time'
import { isMissionExpired } from '../../domain/missions'

export function Missions() {
  const missions = useGameStore((state) => state.missions)
  const army = useGameStore((state) => state.army)
  const time = useGameStore((state) => state.time)
  const sendMission = useGameStore((state) => state.sendMission)
  const abortMission = useGameStore((state) => state.abortMission)
  const currentTime = nowSec(time.offset)

  const activeMissions = missions.active.filter((m) => {
    const completesAt = m.completesAt
    return currentTime < completesAt
  })

  const availableMissions = missions.offered.filter((m) => !isMissionExpired(m, currentTime))

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Missions</h1>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Offered Missions</h2>
        {availableMissions.length === 0 ? (
          <p className="text-gray-500">No missions available</p>
        ) : (
          <div className="space-y-2">
            {availableMissions.map((mission) => (
              <div key={mission.id} className="border p-3 rounded">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-semibold capitalize">{mission.type.replace('_', ' ')}</div>
                    <div className="text-sm text-gray-600">Tier {mission.tier}</div>
                  </div>
                  <Badge variant="info">Requires {mission.requirements.power} power</Badge>
                </div>
                <div className="text-sm mb-2">
                  Reward: {Object.entries(mission.reward).map(([r, a]) => `${a} ${r}`).join(', ')}
                </div>
                {army.active.length > 0 && (
                  <button
                    onClick={() => sendMission(mission.id, army.active[0].id)}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
                  >
                    Send Division
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Active Missions</h2>
        {activeMissions.length === 0 ? (
          <p className="text-gray-500">No active missions</p>
        ) : (
          <div className="space-y-2">
            {activeMissions.map((active) => (
              <div key={active.mission.id} className="border p-3 rounded">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-semibold capitalize">{active.mission.type.replace('_', ' ')}</div>
                    <div className="text-sm text-gray-600">
                      Completes {formatDistanceToNow(new Date((active.completesAt + time.offset) * 1000), { addSuffix: true })}
                    </div>
                  </div>
                  <button
                    onClick={() => abortMission(active.mission.id)}
                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                  >
                    Abort
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
