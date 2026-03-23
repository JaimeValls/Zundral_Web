/**
 * useMapData — V2: Loads province_data.json + diffuse PNG + lookup binary.
 *
 * Returns everything the renderer needs:
 *  - provinceData (JSON with centroids, adjacency, terrain)
 *  - diffuse image
 *  - lookup buffer (Uint8Array, loaded from raw .bin — no PNG color management)
 *  - provinceById lookup
 *  - loading / error state
 */

import { useState, useEffect, useRef } from 'react';
import type { MapData, ProvinceData } from '../../types';

const MAP_BASE = '/godonis/v2';

export interface MapAssets {
  provinceData: MapData;
  provinceById: Map<string, ProvinceData>;
  lookup: Uint8Array;
  images: {
    diffuse: HTMLImageElement;
  };
}

export type MapLoadState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; assets: MapAssets };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

export function useMapData(): MapLoadState {
  const [state, setState] = useState<MapLoadState>({ status: 'loading' });
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    async function load() {
      try {
        const [jsonRes, diffuse, lookupBuf] = await Promise.all([
          fetch(`${MAP_BASE}/province_data.json`).then(r => {
            if (!r.ok) throw new Error(`Failed to load province_data.json: ${r.status}`);
            return r.json() as Promise<MapData>;
          }),
          loadImage(`${MAP_BASE}/diffuse_map.png`),
          // Load lookup as raw binary — NO image decoding, NO color management
          fetch(`${MAP_BASE}/province_lookup.bin`).then(r => {
            if (!r.ok) throw new Error(`Failed to load province_lookup.bin: ${r.status}`);
            return r.arrayBuffer();
          }).then(ab => new Uint8Array(ab)),
        ]);

        const provinceById = new Map<string, ProvinceData>();
        for (const p of jsonRes.provinces) {
          provinceById.set(p.id, p);
        }

        // Verify lookup dimensions match province data
        const expectedSize = jsonRes.mapWidth * jsonRes.mapHeight;
        if (lookupBuf.length !== expectedSize) {
          throw new Error(
            `Lookup buffer size mismatch: got ${lookupBuf.length}, expected ${expectedSize} (${jsonRes.mapWidth}×${jsonRes.mapHeight})`
          );
        }

        console.log(`[MapData] Loaded: ${jsonRes.provinces.length} provinces, lookup ${lookupBuf.length} bytes`);

        setState({
          status: 'ready',
          assets: {
            provinceData: jsonRes,
            provinceById,
            lookup: lookupBuf,
            images: { diffuse },
          },
        });
      } catch (err) {
        console.error('Map load error:', err);
        setState({ status: 'error', error: String(err) });
      }
    }

    load();
  }, []);

  return state;
}
