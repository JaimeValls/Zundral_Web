import React, { useState } from 'react'
import { useGameStore } from '../../app/store'
import { Badge } from '../components/Badge'
import { calcTrainingCost } from '../../domain/army'

export function Army() {
  const army = useGameStore((state) => state.army)
  const resources = useGameStore((state) => state.resources)
  const trainArmy = useGameStore((state) => state.trainArmy)
  const refillArmy = useGameStore((state) => state.refillArmy)
  const [unitCount, setUnitCount] = useState(10)

  const handleTrain = () => {
    if (army.templates.length > 0) {
      trainArmy(army.templates[0].id, unitCount)
    }
  }

  const trainingCost = calcTrainingCost(unitCount)
  const canAfford = 
    resources.wood >= (trainingCost.wood || 0) &&
    resources.stone >= (trainingCost.stone || 0) &&
    resources.food >= (trainingCost.food || 0) &&
    resources.iron >= (trainingCost.iron || 0)

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Army</h1>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Templates</h2>
        {army.templates.length === 0 ? (
          <p className="text-gray-500">No templates yet</p>
        ) : (
          <div className="space-y-2">
            {army.templates.map((template) => (
              <div key={template.id} className="border p-2 rounded">
                <div className="font-semibold">{template.name}</div>
                <div className="text-sm text-gray-600">
                  {template.battalions.length} battalions
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Train Units</h2>
        <div className="space-y-2">
          <div>
            <label className="block text-sm font-medium mb-1">Unit Count</label>
            <input
              type="number"
              value={unitCount}
              onChange={(e) => setUnitCount(parseInt(e.target.value) || 0)}
              className="w-full border rounded px-2 py-1"
              min="1"
            />
          </div>
          <div className="text-sm text-gray-600">
            Cost: {trainingCost.wood} wood, {trainingCost.stone} stone, {trainingCost.food} food, {trainingCost.iron} iron
          </div>
          <button
            onClick={handleTrain}
            disabled={!canAfford || army.templates.length === 0}
            className={`w-full py-2 px-4 rounded ${
              canAfford && army.templates.length > 0
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Train
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Active Divisions</h2>
        {army.active.length === 0 ? (
          <p className="text-gray-500">No active divisions</p>
        ) : (
          <div className="space-y-2">
            {army.active.map((division) => (
              <div key={division.id} className="border p-2 rounded">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-semibold">Division {division.id}</div>
                    <div className="text-sm text-gray-600">Power: {Math.floor(division.power)}</div>
                  </div>
                  <button
                    onClick={() => refillArmy(division.id)}
                    className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm"
                  >
                    Refill
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
