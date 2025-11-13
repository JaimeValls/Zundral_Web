import React from 'react'
import { useGameStore } from '../../app/store'
import { BuildingCard } from '../widgets/BuildingCard'
import { BUILDINGS } from '../../config/gameConfig'
import { calcWarehouseCapacity, getStorageState } from '../../domain/warehouse'
import { Badge } from '../components/Badge'

export function Village() {
  const warehouse = useGameStore((state) => state.warehouse)
  const population = useGameStore((state) => state.population)

  const warehouseCap = calcWarehouseCapacity(warehouse.level)
  const storageState = getStorageState(warehouse.stored, warehouseCap)

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Village</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {BUILDINGS.map((building) => (
          <BuildingCard key={building} building={building} />
        ))}
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Warehouse</h2>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Level</span>
            <Badge variant="info">{warehouse.level}</Badge>
          </div>
          <div className="flex justify-between">
            <span>Capacity</span>
            <span>{warehouseCap}</span>
          </div>
          <div className="flex justify-between">
            <span>Used</span>
            <span>{Math.floor(storageState.used)} / {storageState.total}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                storageState.fillRatio >= 0.66 ? 'bg-red-500' : storageState.fillRatio >= 0.33 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${storageState.fillRatio * 100}%` }}
            />
          </div>
          {storageState.slowdown < 1.0 && (
            <Badge variant="warning">Slowdown: {Math.floor(storageState.slowdown * 100)}%</Badge>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Population</h2>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Total</span>
            <span>{population.total}</span>
          </div>
          <div className="flex justify-between">
            <span>Happiness</span>
            <Badge variant={population.happiness >= 80 ? 'success' : population.happiness >= 50 ? 'warning' : 'error'}>
              {population.happiness}%
            </Badge>
          </div>
        </div>
      </div>
    </div>
  )
}
