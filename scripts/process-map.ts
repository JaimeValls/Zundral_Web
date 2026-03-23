/**
 * process-map.ts — V2 map asset pipeline
 *
 * Reads province_id_map2.png from public/godonis/v2/ and produces
 * province_data.json with computed centroids, adjacency, terrain type.
 *
 * Terrain type is inferred from the province color using HSL classification:
 *   Dark green  → forest
 *   Light green → plains
 *   Brown/orange → hills
 *   Grey (low saturation) → building
 *   Blue → river (impassable)
 *   Black → background (skipped)
 *
 * Usage:  npx tsx scripts/process-map.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAP_DIR = path.resolve(__dirname, '../public/godonis/v2');
const OUT_FILE = path.join(MAP_DIR, 'province_data.json');

/** Quantization step — 1 = exact color matching (no rounding). Must be 1 for province
 *  maps with many similar colors. Higher values cause color collisions. */
const Q = 1;
/** Connected regions smaller than this are absorbed into neighbors */
const MIN_REGION_PX = 200;
/** RGB sum below this is classified as black background */
const BLACK_THRESHOLD = 40;

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l]; // achromatic

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s * 100, l * 100];
}

type TerrainType = 'forest' | 'plains' | 'hills' | 'building' | 'river';

function classifyTerrain(r: number, g: number, b: number): TerrainType | 'black' {
  const rgbSum = r + g + b;

  // Black background
  if (rgbSum < BLACK_THRESHOLD) return 'black';

  const [h, s, l] = rgbToHsl(r, g, b);

  // Grey (low saturation, mid lightness) → building
  if (s < 25 && l > 20 && l < 75) return 'building';

  // Blue → river
  if (h >= 180 && h <= 270 && s > 20) return 'river';

  // Brown/orange → hills (hue 15-45, moderate saturation)
  if (h >= 10 && h < 50 && s > 20) return 'hills';

  // Green range — split by lightness
  if (h >= 60 && h <= 170) {
    // Light green = plains, dark green = forest
    if (l >= 40) return 'plains';
    return 'forest';
  }

  // Yellow-green (hue 50-60) — treat as plains
  if (h >= 50 && h < 60) return 'plains';

  // Fallback: classify by lightness
  if (l < 35) return 'forest';
  return 'plains';
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

function loadPng(name: string): PNG {
  const filePath = path.join(MAP_DIR, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing asset: ${filePath}`);
  }
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

function quantize(v: number): number {
  return Math.round(v / Q) * Q;
}

function quantizedKey(r: number, g: number, b: number): number {
  return (quantize(r) << 16) | (quantize(g) << 8) | quantize(b);
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

function main() {
  console.log('=== V2 Map Pipeline ===');
  console.log('Loading from:', MAP_DIR);

  const provImg = loadPng('province_id_map2.png');
  const W = provImg.width;
  const H = provImg.height;
  console.log(`Map dimensions: ${W}×${H}`);

  // -----------------------------------------------------------------------
  // Step 1: Quantize province_id_map
  // -----------------------------------------------------------------------
  console.log('\nStep 1: Quantizing colors...');

  const qBuf = new Int32Array(W * H);
  const rawColors = new Map<number, [number, number, number]>(); // qKey → original RGB sample

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = provImg.data[i];
      const g = provImg.data[i + 1];
      const b = provImg.data[i + 2];
      const key = quantizedKey(r, g, b);
      qBuf[y * W + x] = key;
      if (!rawColors.has(key)) {
        rawColors.set(key, [r, g, b]);
      }
    }
  }

  console.log(`  ${rawColors.size} unique quantized colors`);

  // -----------------------------------------------------------------------
  // Step 2: Connected component flood-fill
  // -----------------------------------------------------------------------
  console.log('\nStep 2: Flood-fill connected components...');

  const labels = new Int32Array(W * H).fill(-1);
  let nextLabel = 0;
  const regionPixels = new Map<number, Array<[number, number]>>();
  const regionQColor = new Map<number, number>();

  const dx4 = [1, -1, 0, 0];
  const dy4 = [0, 0, 1, -1];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (labels[idx] !== -1) continue;

      const color = qBuf[idx];
      const label = nextLabel++;
      const pixels: Array<[number, number]> = [];

      // BFS flood fill
      const queue: Array<[number, number]> = [[x, y]];
      labels[idx] = label;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        pixels.push([cx, cy]);

        for (let d = 0; d < 4; d++) {
          const nx = cx + dx4[d];
          const ny = cy + dy4[d];
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const nIdx = ny * W + nx;
          if (labels[nIdx] !== -1) continue;
          if (qBuf[nIdx] !== color) continue;
          labels[nIdx] = label;
          queue.push([nx, ny]);
        }
      }

      regionPixels.set(label, pixels);
      regionQColor.set(label, color);
    }
  }

  console.log(`  ${nextLabel} raw regions found`);

  // -----------------------------------------------------------------------
  // Step 3: Classify & filter regions
  // -----------------------------------------------------------------------
  console.log('\nStep 3: Classifying terrain & filtering...');

  const blackLabels = new Set<number>();
  const riverLabels = new Set<number>();
  const landLabels: number[] = [];
  const smallLabels: number[] = [];

  for (const [label, qColor] of regionQColor.entries()) {
    const raw = rawColors.get(qColor)!;
    const terrain = classifyTerrain(raw[0], raw[1], raw[2]);
    const pixels = regionPixels.get(label)!;

    if (terrain === 'black') {
      blackLabels.add(label);
      continue;
    }

    if (terrain === 'river') {
      riverLabels.add(label);
      continue;
    }

    if (pixels.length < MIN_REGION_PX) {
      smallLabels.push(label);
      continue;
    }

    landLabels.push(label);
  }

  console.log(`  Black/bg: ${blackLabels.size}, Rivers: ${riverLabels.size}, Small: ${smallLabels.length}, Land: ${landLabels.length}`);

  // -----------------------------------------------------------------------
  // Step 3b: Absorb small regions into nearest valid neighbor
  // -----------------------------------------------------------------------
  console.log('\nStep 3b: Absorbing small regions...');

  const validLabels = new Set(landLabels);

  for (const label of smallLabels) {
    const pixels = regionPixels.get(label)!;
    let bestNeighbor = -1;

    for (const [px, py] of pixels) {
      for (let d = 0; d < 4; d++) {
        const nx = px + dx4[d];
        const ny = py + dy4[d];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const nLabel = labels[ny * W + nx];
        if (nLabel !== label && validLabels.has(nLabel)) {
          bestNeighbor = nLabel;
          break;
        }
      }
      if (bestNeighbor !== -1) break;
    }

    if (bestNeighbor !== -1) {
      for (const [px, py] of pixels) {
        labels[py * W + px] = bestNeighbor;
      }
      regionPixels.get(bestNeighbor)!.push(...pixels);
      regionPixels.delete(label);
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Compute province data
  // -----------------------------------------------------------------------
  console.log('\nStep 4: Computing province data...');

  interface ProvinceRaw {
    id: string;
    label: number;
    color: [number, number, number];
    center: [number, number];
    bbox: { x: number; y: number; w: number; h: number };
    terrain: string;
    elevation: number;
    isLand: boolean;
    adjacentProvinces: string[];
    pixelCount: number;
  }

  const provinces: ProvinceRaw[] = [];
  const labelToProvId = new Map<number, string>();

  // Process land provinces
  let provIndex = 0;
  for (const label of landLabels) {
    const pixels = regionPixels.get(label);
    if (!pixels || pixels.length < MIN_REGION_PX) continue;

    const provId = `prov_${provIndex}`;
    labelToProvId.set(label, provId);
    provIndex++;

    // Centroid & bbox
    let sumX = 0, sumY = 0;
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (const [px, py] of pixels) {
      sumX += px; sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    // Terrain from province color
    const qColor = regionQColor.get(label)!;
    const raw = rawColors.get(qColor)!;
    const terrain = classifyTerrain(raw[0], raw[1], raw[2]) as string;

    const qr = (qColor >> 16) & 0xff;
    const qg = (qColor >> 8) & 0xff;
    const qb = qColor & 0xff;

    provinces.push({
      id: provId,
      label,
      color: [qr, qg, qb],
      center: [Math.round(sumX / pixels.length), Math.round(sumY / pixels.length)],
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      terrain: terrain === 'black' ? 'plains' : terrain, // safety fallback
      elevation: 100, // No heightmap in v2 — fixed value
      isLand: true,
      adjacentProvinces: [],
      pixelCount: pixels.length,
    });
  }

  // Also add river provinces (impassable but tracked for adjacency)
  for (const label of riverLabels) {
    const pixels = regionPixels.get(label);
    if (!pixels || pixels.length < 50) continue; // skip tiny river fragments

    const provId = `prov_${provIndex}`;
    labelToProvId.set(label, provId);
    provIndex++;

    let sumX = 0, sumY = 0;
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (const [px, py] of pixels) {
      sumX += px; sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    const qColor = regionQColor.get(label)!;
    const qr = (qColor >> 16) & 0xff;
    const qg = (qColor >> 8) & 0xff;
    const qb = qColor & 0xff;

    provinces.push({
      id: provId,
      label,
      color: [qr, qg, qb],
      center: [Math.round(sumX / pixels.length), Math.round(sumY / pixels.length)],
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      terrain: 'river',
      elevation: 0,
      isLand: false,
      adjacentProvinces: [],
      pixelCount: pixels.length,
    });
  }

  console.log(`  ${provinces.length} provinces (${landLabels.length} land + ${provinces.length - landLabels.length} river)`);

  // -----------------------------------------------------------------------
  // Step 5: Build adjacency graph (bridging black border lines)
  // -----------------------------------------------------------------------
  console.log('\nStep 5: Building adjacency graph (border-bridging)...');

  const adjacencySet = new Map<number, Set<number>>();
  for (const p of provinces) adjacencySet.set(p.label, new Set());

  // The province_id_map has black border lines between provinces.
  // Provinces don't physically touch, so we check within a radius of 4px
  // to find neighboring provinces across the border.
  const BRIDGE_RADIUS = 4;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const myLabel = labels[idx];
      if (!labelToProvId.has(myLabel)) continue;

      // Only check border pixels of each province (optimization)
      let isBorder = false;
      for (let d = 0; d < 4; d++) {
        const nx = x + dx4[d];
        const ny = y + dy4[d];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) { isBorder = true; break; }
        if (labels[ny * W + nx] !== myLabel) { isBorder = true; break; }
      }
      if (!isBorder) continue;

      // Search within bridge radius for other provinces
      for (let dy = -BRIDGE_RADIUS; dy <= BRIDGE_RADIUS; dy++) {
        for (let dx = -BRIDGE_RADIUS; dx <= BRIDGE_RADIUS; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const nLabel = labels[ny * W + nx];
          if (nLabel !== myLabel && labelToProvId.has(nLabel)) {
            adjacencySet.get(myLabel)!.add(nLabel);
          }
        }
      }
    }
  }

  for (const p of provinces) {
    const adj = adjacencySet.get(p.label);
    if (adj) {
      p.adjacentProvinces = [...adj].map(l => labelToProvId.get(l)!).filter(Boolean);
    }
  }

  const adjCounts = provinces.filter(p => p.isLand).map(p => p.adjacentProvinces.length);
  const avgAdj = (adjCounts.reduce((a, b) => a + b, 0) / adjCounts.length).toFixed(1);
  console.log(`  Avg adjacency (land): ${avgAdj} neighbors`);

  // -----------------------------------------------------------------------
  // Step 6: Output
  // -----------------------------------------------------------------------
  console.log('\nStep 6: Writing output...');

  // Build a label→provIndex mapping (1-based, 0 = background)
  const labelToProvIndex = new Map<number, number>();
  provinces.forEach((p, i) => labelToProvIndex.set(p.label, i + 1));

  // ── Output province_lookup.bin ──
  // Raw Uint8Array: each byte = 1-based province index (0 = background).
  // Loaded at runtime via fetch() + ArrayBuffer — NO image decoding, NO color management.
  // This avoids browser PNG color space conversion that can shift R values by ±1.
  const lookupBuffer = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const label = labels[idx];
      lookupBuffer[idx] = labelToProvIndex.get(label) || 0;
    }
  }
  const lookupBinPath = path.join(MAP_DIR, 'province_lookup.bin');
  fs.writeFileSync(lookupBinPath, lookupBuffer);
  console.log(`  Wrote ${lookupBinPath} (${lookupBuffer.length} bytes)`);

  // colorToProvinceId is kept for backward compat but no longer used at runtime
  const colorToProvinceId: Record<string, string> = {};
  for (const p of provinces) {
    const hex = ((p.color[0] << 16) | (p.color[1] << 8) | p.color[2])
      .toString(16)
      .padStart(6, '0');
    if (!colorToProvinceId[hex]) { // Only store first occurrence (collisions expected)
      colorToProvinceId[hex] = p.id;
    }
  }

  const output = {
    mapWidth: W,
    mapHeight: H,
    quantizationStep: Q,
    useLookupPng: true, // Signal to runtime: load province_lookup.png instead of re-parsing colors
    provinces: provinces.map(p => ({
      id: p.id,
      color: p.color,
      center: p.center,
      bbox: p.bbox,
      terrain: p.terrain,
      elevation: p.elevation,
      isLand: p.isLand,
      adjacentProvinces: p.adjacentProvinces,
      pixelCount: p.pixelCount,
    })),
    colorToProvinceId,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   ${provinces.filter(p => p.isLand).length} land provinces`);
  console.log(`   ${provinces.filter(p => !p.isLand).length} river zones`);

  // Terrain distribution
  const terrainCounts: Record<string, number> = {};
  for (const p of provinces) {
    terrainCounts[p.terrain] = (terrainCounts[p.terrain] || 0) + 1;
  }
  console.log('\nTerrain distribution:');
  for (const [t, c] of Object.entries(terrainCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${c}`);
  }

  // Size stats
  const sizes = provinces.map(p => p.pixelCount).sort((a, b) => a - b);
  console.log(`\nProvince size: min=${sizes[0]}, median=${sizes[Math.floor(sizes.length / 2)]}, max=${sizes[sizes.length - 1]}`);
}

main();
