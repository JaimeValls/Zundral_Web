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

export function useMapRenderer({
  canvasRef,
  assets,
  lookup,
  view,
  hoveredProvince,
  selectedProvince,
  revealedProvinces,
}: RendererOptions) {
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);

  // Build static layers once
  useEffect(() => {
    console.log('[MapRenderer] Building static layers...');
    const t0 = performance.now();
    staticCanvasRef.current = buildStaticLayers(assets, lookup);
    console.log(`[MapRenderer] Static layers built in ${(performance.now() - t0).toFixed(0)}ms`);
  }, [assets, lookup]);

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

    // Sample the lookup buffer at the province center — same method detection uses.
    // Avoids indexOf reference-equality issues between React state and asset arrays.
    const centerX = Math.floor(prov.center[0]);
    const centerY = Math.floor(prov.center[1]);
    const provIdx = lookup[centerY * mapW + centerX];

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

    if (highlightCacheRef.current.size > 50) {
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

      // Province highlight (hover + selected)
      if (selectedProvince) {
        const hl = getProvinceHighlight(selectedProvince, [232, 167, 53, 80], mapW);
        ctx!.drawImage(hl, selectedProvince.bbox.x, selectedProvince.bbox.y);
      }
      if (hoveredProvince && hoveredProvince.id !== selectedProvince?.id) {
        const hl = getProvinceHighlight(hoveredProvince, [255, 255, 255, 40], mapW);
        ctx!.drawImage(hl, hoveredProvince.bbox.x, hoveredProvince.bbox.y);
      }

      ctx!.restore();

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [canvasRef, assets, lookup, view, hoveredProvince, selectedProvince, revealedProvinces]);
}
