/**
 * useMapInteraction — Pan, zoom, click, and hover handling for the expedition map.
 *
 * All mouse coordinates are computed as e.clientX/Y minus container.getBoundingClientRect(),
 * ensuring a single consistent coordinate source that matches the canvas buffer sizing.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ProvinceData, MapData } from '../../types';
import type { ViewTransform } from './mapUtils';
import { screenToMap, getProvinceAtPixel, clamp } from './mapUtils';

export interface MapInteractionState {
  view: ViewTransform;
  hoveredProvince: ProvinceData | null;
  selectedProvince: ProvinceData | null;
  mouseMapPos: [number, number] | null;
}

interface UseMapInteractionOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  mapData: MapData;
  provinces: ProvinceData[];
  lookup: Uint8Array;
  enabled: boolean;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 4.0;
const ZOOM_FACTOR = 0.1;

/** Get mouse position relative to the container (same coordinate space as canvas buffer) */
function getMousePos(e: MouseEvent | WheelEvent, container: HTMLElement): [number, number] {
  const rect = container.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

export function useMapInteraction({
  canvasRef,
  containerRef,
  mapData,
  provinces,
  lookup,
  enabled,
}: UseMapInteractionOptions) {
  const [view, setView] = useState<ViewTransform>({
    offsetX: 0,
    offsetY: 0,
    scale: 0.5,
  });
  const [hoveredProvince, setHoveredProvince] = useState<ProvinceData | null>(null);
  const [selectedProvince, setSelectedProvince] = useState<ProvinceData | null>(null);
  const [mouseMapPos, setMouseMapPos] = useState<[number, number] | null>(null);

  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Keep a ref to the current view so mousemove/click handlers can read it
  // without needing `view` in their dependency array (avoids stale closures)
  const viewRef = useRef(view);
  viewRef.current = view;

  // NOTE: Initial centering is handled by ExpeditionMap's resize callback
  // (same function that sets canvas.width/height, so dimensions are guaranteed to match)

  // Mouse wheel zoom (centered on cursor)
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const [mouseX, mouseY] = getMousePos(e, container);

      setView(prev => {
        const direction = e.deltaY > 0 ? -1 : 1;
        const newScale = clamp(prev.scale * (1 + direction * ZOOM_FACTOR), MIN_SCALE, MAX_SCALE);
        const ratio = newScale / prev.scale;

        return {
          scale: newScale,
          offsetX: mouseX - (mouseX - prev.offsetX) * ratio,
          offsetY: mouseY - (mouseY - prev.offsetY) * ratio,
        };
      });
    },
    [containerRef]
  );

  // Mouse down
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      isDragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  // Mouse move (drag + hover)
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (isDragging.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        setView(prev => ({
          ...prev,
          offsetX: prev.offsetX + dx,
          offsetY: prev.offsetY + dy,
        }));
        return;
      }

      // Hover detection — use viewRef to read current view without stale closure
      const [screenX, screenY] = getMousePos(e, container);
      const currentView = viewRef.current;
      const [mapX, mapY] = screenToMap(screenX, screenY, currentView);
      setMouseMapPos([mapX, mapY]);
      const prov = getProvinceAtPixel(
        mapX, mapY, lookup, mapData.mapWidth, mapData.mapHeight, provinces
      );
      setHoveredProvince(prov);
    },
    [containerRef, lookup, mapData, provinces]
  );

  // Mouse up
  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Click (select province)
  const handleClick = useCallback(
    (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const [screenX, screenY] = getMousePos(e, container);
      const currentView = viewRef.current;
      const [mapX, mapY] = screenToMap(screenX, screenY, currentView);
      const prov = getProvinceAtPixel(
        mapX, mapY, lookup, mapData.mapWidth, mapData.mapHeight, provinces
      );
      setSelectedProvince(prev => (prev?.id === prov?.id ? null : prov));
    },
    [containerRef, lookup, mapData, provinces]
  );

  // Attach event listeners to the CONTAINER (not canvas) — guarantees events fire
  // even when hovering over overlay elements (tooltips, markers with pointer-events-none)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseUp);
    container.addEventListener('click', handleClick);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseUp);
      container.removeEventListener('click', handleClick);
    };
  }, [containerRef, enabled, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp, handleClick]);

  return {
    view,
    setView,
    hoveredProvince,
    selectedProvince,
    setSelectedProvince,
    mouseMapPos,
  };
}
