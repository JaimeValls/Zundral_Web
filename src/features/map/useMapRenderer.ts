/**
 * useMapRenderer — V2: Canvas rendering hook for the expedition map.
 *
 * Draws layers (bottom → top):
 *  1. Diffuse texture (diffuse_map.png — all visuals baked by artist)
 *  2. Province borders (edge-detected from province lookup buffer)
 *  3. Province highlight (hovered/selected)
 */

import { useRef, useEffect } from 'react';
import type { ProvinceData } from '../../types';
import type { MapAssets } from './useMapData';
import type { ViewTransform } from './mapUtils';

interface RendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  assets: MapAssets;
  lookup: Uint8Array;
  view: ViewTransform;
  hoveredProvince: ProvinceData | null;
  selectedProvince: ProvinceData | null;
  revealedProvinces?: Set<string>;
  fortressProvinceId?: string;
  deployableProvinces?: Set<string>;
  moveTargetProvinces?: Set<string>;
  combatMoveProvinces?: Set<string>;
  pendingMoveArrows?: Array<{ from: [number, number]; to: [number, number] }>;
  enemyProvinces?: Set<string>;
  enemyMoveArrows?: Array<{ from: [number, number]; to: [number, number] }>;
  battleProvinces?: Set<string>;
  battleAftermath?: Map<string, number>; // provinceId → turnsRemaining (3,2,1)
}

/**
 * Build the static layers offscreen (diffuse + province borders).
 * Runs once when assets load — not per frame.
 */
function buildStaticLayers(assets: MapAssets, lookup: Uint8Array): HTMLCanvasElement {
  const { mapWidth: W, mapHeight: H } = assets.provinceData;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // ── Layer 1: Diffuse texture (the whole visual) ──────────────────
  ctx.drawImage(assets.images.diffuse, 0, 0);

  // ── Layer 2: Province borders ────────────────────────────────────
  {
    const borderData = ctx.createImageData(W, H);
    const bd = borderData.data;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const myProv = lookup[idx];
        if (myProv === 0) continue; // background/unassigned

        // Check 4-connected neighbors for province boundary
        let isBorder = false;
        if (x > 0 && lookup[idx - 1] !== myProv && lookup[idx - 1] !== 0) isBorder = true;
        else if (x < W - 1 && lookup[idx + 1] !== myProv && lookup[idx + 1] !== 0) isBorder = true;
        else if (y > 0 && lookup[idx - W] !== myProv && lookup[idx - W] !== 0) isBorder = true;
        else if (y < H - 1 && lookup[idx + W] !== myProv && lookup[idx + W] !== 0) isBorder = true;

        if (isBorder) {
          const pi = idx * 4;
          bd[pi] = 0;
          bd[pi + 1] = 0;
          bd[pi + 2] = 0;
          bd[pi + 3] = 70; // subtle dark border
        }
      }
    }

    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    tmp.getContext('2d')!.putImageData(borderData, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }

  return canvas;
}

/**
 * Build fog of war layer — darkens unrevealed provinces.
 * Returns null if no fog needed (all revealed or no revealedProvinces set).
 */
function buildFogLayer(
  lookup: Uint8Array,
  mapW: number,
  mapH: number,
  revealedProvinces: Set<string>
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = mapW;
  canvas.height = mapH;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(mapW, mapH);
  const d = imgData.data;

  // Pre-compute revealed province indices for O(1) lookup
  const revealedIndices = new Set<number>();
  for (const provId of revealedProvinces) {
    const idx = parseInt(provId.replace('prov_', ''), 10) + 1;
    revealedIndices.add(idx);
  }

  for (let i = 0; i < lookup.length; i++) {
    const provIdx = lookup[i];
    if (provIdx === 0) continue; // background
    if (revealedIndices.has(provIdx)) continue; // revealed

    const pi = i * 4;
    d[pi] = 10;
    d[pi + 1] = 14;
    d[pi + 2] = 26;
    d[pi + 3] = 180;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export function useMapRenderer({
  canvasRef,
  assets,
  lookup,
  view,
  hoveredProvince,
  selectedProvince,
  revealedProvinces,
  deployableProvinces,
  moveTargetProvinces,
  combatMoveProvinces,
  pendingMoveArrows,
  enemyProvinces,
  enemyMoveArrows,
  battleProvinces,
  battleAftermath,
}: RendererOptions) {
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);

  // Build static layers once
  useEffect(() => {
    console.log('[MapRenderer] Building static layers...');
    const t0 = performance.now();
    staticCanvasRef.current = buildStaticLayers(assets, lookup);
    console.log(`[MapRenderer] Static layers built in ${(performance.now() - t0).toFixed(0)}ms`);
  }, [assets, lookup]);

  // Build fog layer when revealedProvinces changes
  useEffect(() => {
    if (!revealedProvinces || revealedProvinces.size === 0) {
      fogCanvasRef.current = null;
      return;
    }
    const { mapWidth: W, mapHeight: H } = assets.provinceData;
    const t0 = performance.now();
    fogCanvasRef.current = buildFogLayer(lookup, W, H, revealedProvinces);
    if (import.meta.env.DEV) {
      console.log(`[MapRenderer] Fog layer built in ${(performance.now() - t0).toFixed(0)}ms (${revealedProvinces.size} revealed)`);
    }
  }, [assets, lookup, revealedProvinces]);

  // Per-province highlight canvases (cached, bbox-only)
  const highlightCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  function getProvinceHighlight(
    prov: ProvinceData,
    color: [number, number, number, number],
    mapW: number
  ): HTMLCanvasElement {
    const cacheKey = `${prov.id}_${color.join(',')}`;
    const cached = highlightCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const { x, y, w, h } = prov.bbox;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(w, h);
    const d = imgData.data;

    // Deterministic index from province ID — matches process-map.ts assignment:
    // provinces.forEach((p, i) => labelToProvIndex.set(p.label, i + 1))
    // prov_0 → index 1, prov_1 → index 2, etc.
    const provIdx = parseInt(prov.id.replace('prov_', ''), 10) + 1;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const mapIdx = (y + py) * mapW + (x + px);
        if (lookup[mapIdx] === provIdx) {
          const pi = (py * w + px) * 4;
          d[pi] = color[0];
          d[pi + 1] = color[1];
          d[pi + 2] = color[2];
          d[pi + 3] = color[3];
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    highlightCacheRef.current.set(cacheKey, canvas);

    if (highlightCacheRef.current.size > 100) {
      const firstKey = highlightCacheRef.current.keys().next().value;
      if (firstKey) highlightCacheRef.current.delete(firstKey);
    }

    return canvas;
  }

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const staticCanvas = staticCanvasRef.current;
    if (!canvas || !staticCanvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function draw() {
      const W = canvas!.width;
      const H = canvas!.height;

      ctx!.clearRect(0, 0, W, H);

      // Dark background
      ctx!.fillStyle = '#0a0e1a';
      ctx!.fillRect(0, 0, W, H);

      ctx!.save();
      ctx!.translate(view.offsetX, view.offsetY);
      ctx!.scale(view.scale, view.scale);

      // Draw cached static layers (diffuse + borders)
      ctx!.drawImage(staticCanvas!, 0, 0);

      const mapW = assets.provinceData.mapWidth;

      // Deployable province highlights (green)
      if (deployableProvinces && deployableProvinces.size > 0) {
        for (const provId of deployableProvinces) {
          const prov = assets.provinceById.get(provId);
          if (prov) {
            const hl = getProvinceHighlight(prov, [34, 197, 94, 70], mapW);
            ctx!.drawImage(hl, prov.bbox.x, prov.bbox.y);
          }
        }
      }

      // Move-target province highlights (green = safe, orange = combat)
      if (moveTargetProvinces && moveTargetProvinces.size > 0) {
        for (const provId of moveTargetProvinces) {
          const prov = assets.provinceById.get(provId);
          if (prov) {
            const hl = getProvinceHighlight(prov, [34, 197, 94, 70], mapW); // green
            ctx!.drawImage(hl, prov.bbox.x, prov.bbox.y);
          }
        }
      }
      if (combatMoveProvinces && combatMoveProvinces.size > 0) {
        for (const provId of combatMoveProvinces) {
          const prov = assets.provinceById.get(provId);
          if (prov) {
            const hl = getProvinceHighlight(prov, [245, 158, 11, 90], mapW); // orange
            ctx!.drawImage(hl, prov.bbox.x, prov.bbox.y);
          }
        }
      }

      // Enemy province highlights (red)
      if (enemyProvinces && enemyProvinces.size > 0) {
        for (const provId of enemyProvinces) {
          const prov = assets.provinceById.get(provId);
          if (prov) {
            const hl = getProvinceHighlight(prov, [220, 38, 38, 70], mapW);
            ctx!.drawImage(hl, prov.bbox.x, prov.bbox.y);
          }
        }
      }

      // Battle province highlights (amber)
      if (battleProvinces && battleProvinces.size > 0) {
        for (const provId of battleProvinces) {
          const prov = assets.provinceById.get(provId);
          if (prov) {
            const hl = getProvinceHighlight(prov, [245, 158, 11, 90], mapW);
            ctx!.drawImage(hl, prov.bbox.x, prov.bbox.y);
          }
        }
      }

      // Battle aftermath VFX (scorched province tint, decays over 3 turns)
      if (battleAftermath && battleAftermath.size > 0) {
        for (const [provId, turnsLeft] of battleAftermath) {
          const prov = assets.provinceById.get(provId);
          if (!prov) continue;
          // Intensity: 3 turns = strong, 2 = medium, 1 = faint
          const alpha = turnsLeft >= 3 ? 100 : turnsLeft === 2 ? 65 : 35;
          const hl = getProvinceHighlight(prov, [139, 50, 10, alpha], mapW);
          ctx!.drawImage(hl, prov.bbox.x, prov.bbox.y);
        }
      }

      // Pending move arrows (dashed blue lines)
      if (pendingMoveArrows && pendingMoveArrows.length > 0) {
        ctx!.save();
        ctx!.strokeStyle = 'rgba(59, 130, 246, 0.7)';
        ctx!.lineWidth = 3 / view.scale;
        ctx!.setLineDash([10 / view.scale, 5 / view.scale]);
        for (const arrow of pendingMoveArrows) {
          const [fx, fy] = arrow.from;
          const [tx, ty] = arrow.to;
          ctx!.beginPath();
          ctx!.moveTo(fx, fy);
          ctx!.lineTo(tx, ty);
          ctx!.stroke();

          // Arrowhead
          const angle = Math.atan2(ty - fy, tx - fx);
          const headLen = 12 / view.scale;
          ctx!.setLineDash([]);
          ctx!.fillStyle = 'rgba(59, 130, 246, 0.8)';
          ctx!.beginPath();
          ctx!.moveTo(tx, ty);
          ctx!.lineTo(tx - headLen * Math.cos(angle - 0.4), ty - headLen * Math.sin(angle - 0.4));
          ctx!.lineTo(tx - headLen * Math.cos(angle + 0.4), ty - headLen * Math.sin(angle + 0.4));
          ctx!.closePath();
          ctx!.fill();
          ctx!.setLineDash([10 / view.scale, 5 / view.scale]);
        }
        ctx!.restore();
      }

      // Enemy move arrows (dashed red lines)
      if (enemyMoveArrows && enemyMoveArrows.length > 0) {
        ctx!.save();
        ctx!.strokeStyle = 'rgba(220, 38, 38, 0.7)';
        ctx!.lineWidth = 3 / view.scale;
        ctx!.setLineDash([10 / view.scale, 5 / view.scale]);
        for (const arrow of enemyMoveArrows) {
          const [fx, fy] = arrow.from;
          const [tx, ty] = arrow.to;
          ctx!.beginPath();
          ctx!.moveTo(fx, fy);
          ctx!.lineTo(tx, ty);
          ctx!.stroke();

          // Arrowhead
          const angle = Math.atan2(ty - fy, tx - fx);
          const headLen = 12 / view.scale;
          ctx!.setLineDash([]);
          ctx!.fillStyle = 'rgba(220, 38, 38, 0.8)';
          ctx!.beginPath();
          ctx!.moveTo(tx, ty);
          ctx!.lineTo(tx - headLen * Math.cos(angle - 0.4), ty - headLen * Math.sin(angle - 0.4));
          ctx!.lineTo(tx - headLen * Math.cos(angle + 0.4), ty - headLen * Math.sin(angle + 0.4));
          ctx!.closePath();
          ctx!.fill();
          ctx!.setLineDash([10 / view.scale, 5 / view.scale]);
        }
        ctx!.restore();
      }

      // Province highlight (hover + selected)
      if (selectedProvince) {
        const hl = getProvinceHighlight(selectedProvince, [232, 167, 53, 80], mapW);
        ctx!.drawImage(hl, selectedProvince.bbox.x, selectedProvince.bbox.y);
      }
      if (hoveredProvince && hoveredProvince.id !== selectedProvince?.id) {
        const hl = getProvinceHighlight(hoveredProvince, [255, 255, 255, 40], mapW);
        ctx!.drawImage(hl, hoveredProvince.bbox.x, hoveredProvince.bbox.y);
      }

      // Fog of war (draws after highlights — fog darkens everything)
      const fogCanvas = fogCanvasRef.current;
      if (fogCanvas) {
        ctx!.drawImage(fogCanvas, 0, 0);
      }

      ctx!.restore();

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [canvasRef, assets, lookup, view, hoveredProvince, selectedProvince, revealedProvinces, deployableProvinces, moveTargetProvinces, combatMoveProvinces, pendingMoveArrows, enemyProvinces, enemyMoveArrows, battleProvinces]);
}
