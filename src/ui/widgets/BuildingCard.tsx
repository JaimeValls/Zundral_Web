import React from 'react'
import { useGameStore } from '../../app/store'
import { calcStorageCap, calcNextCost } from '../../domain/buildings'
import { getStorageState } from '../../domain/warehouse'
import { calcWarehouseCapacity } from '../../domain/warehouse'
import type { Building } from '../../config/gameConfig'
import { Badge } from '../components/Badge'

interface BuildingCardProps {
  building: Building
}

export function BuildingCard({ building }: BuildingCardProps) {
  const level = useGameStore((state) => state.buildings[building])
  const warehouse = useGameStore((state) => state.warehouse)
  const resources = useGameStore((state) => state.resources)
  const collectBuilding = useGameStore((state) => state.collectBuilding)
  const upgradeBuilding = useGameStore((state) => state.upgradeBuilding)

  const storageCap = calcStorageCap(level)
  const fillRatio = storageCap > 0 ? 0.5 : 0 // Simplified - would need building stored state
  const slowdown = fillRatio >= 0.66 ? 0.5 : fillRatio >= 0.33 ? 0.8 : 1.0

  const cost = calcNextCost(level)
  const canAfford = resources.wood >= (cost.wood || 0) && resources.stone >= (cost.stone || 0)

  const buildingNames: Record<Building, string> = {
    house: 'House',
    warehouse: 'Warehouse',
    lumberMill: 'Lumber Mill',
    quarry: 'Quarry',
    farm: 'Farm',
    ironMine: 'Iron Mine',
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">{buildingNames[building]}</h3>
        <Badge variant="info">Level {level}</Badge>
      </div>

      {level > 0 && (
        <>
          <div className="mb-2">
            <div className="flex justify-between text-sm mb-1">
              <span>Storage</span>
              <span>{Math.floor(fillRatio * 100)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  fillRatio >= 0.66 ? 'bg-red-500' : fillRatio >= 0.33 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${fillRatio * 100}%` }}
              />
            </div>
            {slowdown < 1.0 && (
              <Badge variant="warning" className="mt-1">
                Slowdown: {Math.floor(slowdown * 100)}%
              </Badge>
            )}
          </div>

          <button
            onClick={() => collectBuilding(building)}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded mb-2"
          >
            Tap to Collect
          </button>
        </>
      )}

      <button
        onClick={() => upgradeBuilding(building)}
        disabled={!canAfford || level === 0}
        className={`w-full py-2 px-4 rounded ${
          canAfford && level > 0
            ? 'bg-green-500 hover:bg-green-600 text-white'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
        }`}
      >
        Upgrade ({cost.wood} wood, {cost.stone} stone)
      </button>
    </div>
  )
}
