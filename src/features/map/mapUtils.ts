/**
 * mapUtils — Coordinate transforms, BFS pathfinding, province utilities.
 */

import type { ProvinceData } from '../../types';

// ---------------------------------------------------------------------------
// Coordinate transforms (screen ↔ map, accounting for pan/zoom)
// ---------------------------------------------------------------------------

export interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

/** Convert screen (canvas) coords to map pixel coords */
export function screenToMap(
  screenX: number,
  screenY: number,
  view: ViewTransform
): [number, number] {
  return [
    (screenX - view.offsetX) / view.scale,
    (screenY - view.offsetY) / view.scale,
  ];
}

/** Convert map pixel coords to screen (canvas) coords */
export function mapToScreen(
  mapX: number,
  mapY: number,
  view: ViewTransform
): [number, number] {
  return [
    mapX * view.scale + view.offsetX,
    mapY * view.scale + view.offsetY,
  ];
}

// ---------------------------------------------------------------------------
// Province lookup from pixel coordinate
// ---------------------------------------------------------------------------

/**
 * O(1) province lookup from map coordinates.
 * Uses the precomputed lookup buffer from buildProvinceLookup().
 */
export function getProvinceAtPixel(
  mapX: number,
  mapY: number,
  lookup: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  provinces: ProvinceData[]
): ProvinceData | null {
  const ix = Math.floor(mapX);
  const iy = Math.floor(mapY);
  if (ix < 0 || ix >= mapWidth || iy < 0 || iy >= mapHeight) return null;

  const idx = lookup[iy * mapWidth + ix];
  if (idx === 0) return null; // Water/no province
  return provinces[idx - 1] || null; // idx is 1-based
}

// ---------------------------------------------------------------------------
// BFS Pathfinding on adjacency graph
// ---------------------------------------------------------------------------

export interface PathResult {
  path: string[];       // Province IDs from start to end (inclusive)
  distance: number;     // Number of steps
}

/**
 * BFS shortest path between two provinces on the adjacency graph.
 * Only traverses land provinces.
 */
export function findPath(
  startId: string,
  endId: string,
  provinceById: Map<string, ProvinceData>
): PathResult | null {
  if (startId === endId) return { path: [startId], distance: 0 };

  const visited = new Set<string>([startId]);
  const parent = new Map<string, string>();
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const prov = provinceById.get(current);
    if (!prov) continue;

    for (const neighborId of prov.adjacentProvinces) {
      if (visited.has(neighborId)) continue;
      const neighbor = provinceById.get(neighborId);
      if (!neighbor || !neighbor.isLand) continue; // Skip water

      visited.add(neighborId);
      parent.set(neighborId, current);

      if (neighborId === endId) {
        // Reconstruct path
        const path: string[] = [endId];
        let node = endId;
        while (parent.has(node)) {
          node = parent.get(node)!;
          path.unshift(node);
        }
        return { path, distance: path.length - 1 };
      }

      queue.push(neighborId);
    }
  }

  return null; // No path found
}

// ---------------------------------------------------------------------------
// Terrain movement cost (for weighted pathfinding later)
// ---------------------------------------------------------------------------

const TERRAIN_COST: Record<string, number> = {
  plains: 1,
  coast: 1,
  building: 1,
  forest: 1.5,
  hills: 1.5,
  swamp: 2,
  mountain: 3,
  volcanic: 2.5,
  river: Infinity, // impassable
};

export function getMovementCost(terrain: string): number {
  return TERRAIN_COST[terrain] ?? 1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Terrain type to display color (for province highlights/overlays) */
export const TERRAIN_COLORS: Record<string, string> = {
  plains: '#90C040',
  forest: '#2D5A1E',
  mountain: '#808080',
  hills: '#C8A060',
  volcanic: '#802020',
  swamp: '#405030',
  coast: '#C8D8A0',
  building: '#A0A0A0',
  river: '#3366AA',
};

/** Terrain type to display name */
export const TERRAIN_NAMES: Record<string, string> = {
  plains: 'Plains',
  forest: 'Forest',
  mountain: 'Mountain',
  hills: 'Hills',
  volcanic: 'Volcanic',
  swamp: 'Swamp',
  coast: 'Coast',
  building: 'Settlement',
  river: 'River',
};
