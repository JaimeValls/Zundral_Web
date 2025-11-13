import React from 'react'
import { useGameStore } from '../../app/store'
import { formatDistanceToNow } from 'date-fns'
import { getQueueTimeRemaining } from '../../domain/queues'
import { nowSec } from '../../lib/time'
import { Badge } from '../components/Badge'

export function Home() {
  const resources = useGameStore((state) => state.resources)
  const queues = useGameStore((state) => state.queues)
  const missions = useGameStore((state) => state.missions)
  const time = useGameStore((state) => state.time)
  const currentTime = nowSec(time.offset)

  const nextQueueFinish = (() => {
    let minTime = Infinity
    for (const building of Object.keys(queues.buildings) as any[]) {
      const queue = queues.buildings[building]
      if (queue) {
        const remaining = getQueueTimeRemaining(queue, currentTime)
        if (remaining > 0 && remaining < minTime) minTime = remaining
      }
    }
    if (queues.research) {
      const remaining = getQueueTimeRemaining(queues.research, currentTime)
      if (remaining > 0 && remaining < minTime) minTime = remaining
    }
    if (queues.training) {
      const remaining = getQueueTimeRemaining(queues.training, currentTime)
      if (remaining > 0 && remaining < minTime) minTime = remaining
    }
    return minTime === Infinity ? null : minTime
  })()

  const nextMissionFinish = missions.active.length > 0
    ? Math.min(...missions.active.map((m) => m.completesAt - currentTime))
    : null

  const completedMissions = missions.completed.filter((c) => c.result === 'success').length

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Home</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Wood</div>
          <div className="text-2xl font-bold">{Math.floor(resources.wood)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Stone</div>
          <div className="text-2xl font-bold">{Math.floor(resources.stone)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Food</div>
          <div className="text-2xl font-bold">{Math.floor(resources.food)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Iron</div>
          <div className="text-2xl font-bold">{Math.floor(resources.iron)}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Next Finishes</h2>
        <div className="space-y-2">
          {nextQueueFinish !== null && (
            <div className="flex items-center justify-between">
              <span>Queue completion</span>
              <Badge variant="info">
                {formatDistanceToNow(new Date(Date.now() + nextQueueFinish * 1000), {
                  addSuffix: true,
                })}
              </Badge>
            </div>
          )}
          {nextMissionFinish !== null && nextMissionFinish > 0 && (
            <div className="flex items-center justify-between">
              <span>Mission completion</span>
              <Badge variant="success">
                {formatDistanceToNow(new Date(Date.now() + nextMissionFinish * 1000), {
                  addSuffix: true,
                })}
              </Badge>
            </div>
          )}
          {completedMissions > 0 && (
            <div className="flex items-center justify-between">
              <span>Completed missions</span>
              <Badge variant="warning">{completedMissions} ready to claim</Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
