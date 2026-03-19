/**
 * ExpeditionMap — Main expedition map view component.
 *
 * Shows a 2D Canvas map with terrain, elevation shading, province borders,
 * hover/click interaction, fortress marker, and army positions.
 */

import React, { useRef, useEffect, useMemo } from 'react';
import type { Banner, Expedition } from '../../types';
import { useMapData, buildProvinceLookup } from './useMapData';
import { useMapRenderer } from './useMapRenderer';
import { useMapInteraction } from './useMapInteraction';
import { mapToScreen, TERRAIN_NAMES } from './mapUtils';
import { ProvinceTooltip } from './ProvinceTooltip';
import { FortressMarker } from './FortressMarker';
import { ArmyMarker } from './ArmyMarker';

interface Props {
  expedition: Expedition;
  banners: Banner[];
  onClose: () => void;
}

export const ExpeditionMap: React.FC<Props> = ({ expedition, banners, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapLoadState = useMapData();

  if (mapLoadState.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🗺️</div>
          <div className="text-amber-400 font-semibold">Loading Expedition Map...</div>
          <div className="text-slate-500 text-sm mt-1">Preparing terrain data</div>
        </div>
      </div>
    );
  }

  if (mapLoadState.status === 'error') {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="text-red-400 font-semibold">Map Load Error</div>
          <div className="text-slate-500 text-sm mt-2 max-w-md">{mapLoadState.error}</div>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
          >
            Close Map
          </button>
        </div>
      </div>
    );
  }

  return (
    <MapView
      assets={mapLoadState.assets}
      expedition={expedition}
      banners={banners}
      onClose={onClose}
      canvasRef={canvasRef}
      containerRef={containerRef}
    />
  );
};

// ---------------------------------------------------------------------------
// Inner component — only renders when assets are ready
// ---------------------------------------------------------------------------

interface MapViewProps {
  assets: NonNullable<Extract<ReturnType<typeof useMapData>, { status: 'ready' }>['assets']>;
  expedition: Expedition;
  banners: Banner[];
  onClose: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const MapView: React.FC<MapViewProps> = ({
  assets,
  expedition,
  banners,
  onClose,
  canvasRef,
  containerRef,
}) => {
  // Build the pixel → province lookup buffer (once)
  const lookup = useMemo(
    () => buildProvinceLookup(assets.images.provinceLookup, assets.provinceData),
    [assets]
  );

  // Map interaction (pan, zoom, hover, click)
  const {
    view,
    setView,
    hoveredProvince,
    selectedProvince,
    mouseMapPos,
  } = useMapInteraction({
    canvasRef,
    containerRef,
    mapData: assets.provinceData,
    provinces: assets.provinceData.provinces,
    lookup,
    enabled: true,
  });

  // Store setView in a ref so the resize effect doesn't re-run when setView changes
  const setViewRef = useRef(setView);
  setViewRef.current = setView;

  // Resize canvas + initial centering
  const viewInitializedRef = useRef(false);
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const mapW = assets.provinceData.mapWidth;
    const mapH = assets.provinceData.mapHeight;

    function resize() {
      const rect = container!.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w <= 0 || h <= 0) return;

      canvas!.width = w;
      canvas!.height = h;

      // Center the map on FIRST resize (same dimensions, zero race condition)
      if (!viewInitializedRef.current) {
        viewInitializedRef.current = true;
        const scaleX = w / mapW;
        const scaleY = h / mapH;
        const scale = Math.min(scaleX, scaleY) * 0.95;
        setViewRef.current({
          scale,
          offsetX: (w - mapW * scale) / 2,
          offsetY: (h - mapH * scale) / 2,
        });
      }
    }

    // Fire resize immediately (not on next frame — avoids Strict Mode cleanup race)
    resize();

    const observer = new ResizeObserver(() => resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [canvasRef, containerRef, assets.provinceData]);

  // Revealed provinces (for fog of war)
  const revealedProvinces = useMemo(() => {
    const mapState = expedition.mapState;
    if (!mapState) return undefined;
    return new Set(mapState.revealedProvinces);
  }, [expedition.mapState]);

  // Render the canvas
  useMapRenderer({
    canvasRef,
    assets,
    lookup,
    view,
    hoveredProvince,
    selectedProvince,
    revealedProvinces,
    fortressProvinceId: expedition.mapState?.fortressProvinceId,
  });

  // Calculate screen positions for markers
  const fortressScreen = useMemo(() => {
    const fpId = expedition.mapState?.fortressProvinceId;
    if (!fpId) return null;
    const prov = assets.provinceById.get(fpId);
    if (!prov) return null;
    const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
    return { x: sx, y: sy, prov };
  }, [expedition.mapState, assets.provinceById, view]);

  // Army markers
  const armyMarkers = useMemo(() => {
    const mapState = expedition.mapState;
    if (!mapState) return [];

    return Object.entries(mapState.armyPositions)
      .map(([bannerIdStr, provId]) => {
        const bannerId = parseInt(bannerIdStr);
        const banner = banners.find(b => b.id === bannerId);
        const prov = assets.provinceById.get(provId);
        if (!banner || !prov) return null;

        const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
        const totalTroops = banner.squads.reduce((s, sq) => s + sq.currentSize, 0);

        return {
          key: bannerId,
          screenX: sx,
          screenY: sy + 20, // Offset below fortress if overlapping
          name: banner.name,
          size: totalTroops,
        };
      })
      .filter(Boolean) as Array<{
        key: number;
        screenX: number;
        screenY: number;
        name: string;
        size: number;
      }>;
  }, [expedition.mapState, banners, assets.provinceById, view]);

  // Tooltip screen position
  const tooltipScreen = useMemo(() => {
    if (!hoveredProvince || !mouseMapPos) return null;
    // Use canvas-relative position for tooltip
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const [sx, sy] = mapToScreen(mouseMapPos[0], mouseMapPos[1], view);
    return { x: sx, y: sy };
  }, [hoveredProvince, mouseMapPos, view, canvasRef]);

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <span className="text-lg">🗺️</span>
          <span className="text-amber-300 font-bold">{expedition.title} — Map View</span>
          <span className="text-slate-500 text-sm">
            {assets.provinceData.provinces.length} provinces
          </span>
        </div>
        <div className="flex items-center gap-3">
          {selectedProvince && (
            <div className="text-sm text-slate-300 bg-slate-800 px-3 py-1 rounded">
              <span className="text-amber-400 font-semibold">
                {selectedProvince.id.replace('prov_', 'Province ')}
              </span>
              <span className="text-slate-500 mx-2">·</span>
              <span>{TERRAIN_NAMES[selectedProvince.terrain]}</span>
              <span className="text-slate-500 mx-2">·</span>
              <span className="text-slate-400">Elevation {selectedProvince.elevation}</span>
              <span className="text-slate-500 mx-2">·</span>
              <span className="text-slate-400">{selectedProvince.adjacentProvinces.length} neighbors</span>
            </div>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 text-sm border border-slate-600/50"
          >
            ✕ Close Map
          </button>
        </div>
      </div>

      {/* Map canvas — flat top-down */}
      <div ref={containerRef as React.RefObject<HTMLDivElement>} className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing">
        <canvas ref={canvasRef as React.RefObject<HTMLCanvasElement>} className="absolute inset-0" />

        {/* Fortress marker */}
        {fortressScreen && (
          <FortressMarker
            screenX={fortressScreen.x}
            screenY={fortressScreen.y}
            label="Fortress"
          />
        )}

        {/* Army markers */}
        {armyMarkers.map(m => (
          <ArmyMarker
            key={m.key}
            screenX={m.screenX}
            screenY={m.screenY}
            armyName={m.name}
            armySize={m.size}
          />
        ))}

        {/* Province tooltip */}
        {hoveredProvince && tooltipScreen && (
          <ProvinceTooltip
            province={hoveredProvince}
            screenX={tooltipScreen.x}
            screenY={tooltipScreen.y}
          />
        )}

        {/* Controls hint */}
        <div className="absolute bottom-3 left-3 text-xs text-slate-500 bg-slate-900/80 px-2 py-1 rounded">
          Scroll to zoom · Drag to pan · Click to select province
        </div>

      </div>
    </div>
  );
};
