import React, { useState } from 'react'
import { useGameStore } from '../../app/store'
import type { Resource, Building } from '../../config/gameConfig'
import type { Mission } from '../../types/core'

export function DevPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [resourceAmount, setResourceAmount] = useState(1000)
  const [timeOffset, setTimeOffset] = useState(0)
  const [happiness, setHappiness] = useState(100)
  const [missionType, setMissionType] = useState<Mission['type']>('resource_raid')
  const [missionTier, setMissionTier] = useState(1)

  const addResources = useGameStore((state) => state.addResources)
  const setTimeOffsetAction = useGameStore((state) => state.setTimeOffset)
  const setHappinessAction = useGameStore((state) => state.setHappiness)
  const finishQueues = useGameStore((state) => state.finishQueues)
  const spawnMission = useGameStore((state) => state.spawnMission)
  const reset = useGameStore((state) => state.reset)

  const handleAddResource = (resource: Resource) => {
    addResources({ [resource]: resourceAmount })
  }

  const handleSetTimeOffset = () => {
    setTimeOffsetAction(timeOffset)
  }

  const handleSetHappiness = () => {
    setHappinessAction(happiness)
  }

  const handleSpawnMission = () => {
    spawnMission(missionType, missionTier)
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-4 right-4 bg-purple-800 text-white px-4 py-2 rounded shadow-lg z-50"
      >
        Dev Panel
      </button>
    )
  }

  return (
    <div className="fixed top-0 right-0 w-96 h-full bg-gray-900 text-white shadow-2xl overflow-y-auto z-50">
      <div className="p-4 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold">Dev Panel</h2>
          <button
            onClick={() => setIsOpen(false)}
            className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          <div className="border-t border-gray-700 pt-4">
            <h3 className="font-semibold mb-2">Add Resources</h3>
            <div className="space-y-2">
              <input
                type="number"
                value={resourceAmount}
                onChange={(e) => setResourceAmount(parseInt(e.target.value) || 0)}
                className="w-full bg-gray-800 text-white px-2 py-1 rounded"
              />
              <div className="grid grid-cols-2 gap-2">
                {(['wood', 'stone', 'food', 'iron'] as Resource[]).map((resource) => (
                  <button
                    key={resource}
                    onClick={() => handleAddResource(resource)}
                    className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded capitalize"
                  >
                    +{resourceAmount} {resource}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="font-semibold mb-2">Time Offset</h3>
            <div className="space-y-2">
              <input
                type="number"
                value={timeOffset}
                onChange={(e) => setTimeOffset(parseInt(e.target.value) || 0)}
                className="w-full bg-gray-800 text-white px-2 py-1 rounded"
                placeholder="Seconds offset"
              />
              <button
                onClick={handleSetTimeOffset}
                className="w-full bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded"
              >
                Set Time Offset
              </button>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="font-semibold mb-2">Happiness</h3>
            <div className="space-y-2">
              <input
                type="number"
                value={happiness}
                onChange={(e) => setHappiness(parseInt(e.target.value) || 0)}
                className="w-full bg-gray-800 text-white px-2 py-1 rounded"
                min="0"
                max="100"
              />
              <button
                onClick={handleSetHappiness}
                className="w-full bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded"
              >
                Set Happiness
              </button>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="font-semibold mb-2">Queues</h3>
            <button
              onClick={finishQueues}
              className="w-full bg-green-600 hover:bg-green-700 px-3 py-2 rounded"
            >
              Finish All Queues
            </button>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="font-semibold mb-2">Spawn Mission</h3>
            <div className="space-y-2">
              <select
                value={missionType}
                onChange={(e) => setMissionType(e.target.value as Mission['type'])}
                className="w-full bg-gray-800 text-white px-2 py-1 rounded"
              >
                <option value="resource_raid">Resource Raid</option>
                <option value="tech_salvage">Tech Salvage</option>
                <option value="boss_hunt">Boss Hunt</option>
                <option value="escort_defense">Escort Defense</option>
                <option value="scouting">Scouting</option>
              </select>
              <input
                type="number"
                value={missionTier}
                onChange={(e) => setMissionTier(parseInt(e.target.value) || 1)}
                className="w-full bg-gray-800 text-white px-2 py-1 rounded"
                min="1"
                placeholder="Tier"
              />
              <button
                onClick={handleSpawnMission}
                className="w-full bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded"
              >
                Spawn Mission
              </button>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <button
              onClick={reset}
              className="w-full bg-red-600 hover:bg-red-700 px-3 py-2 rounded"
            >
              Reset Game
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

