/**
 * ExpeditionMap — Main expedition map view component.
 *
 * Shows a 2D Canvas map with terrain, elevation shading, province borders,
 * hover/click interaction, fortress marker, and army positions.
 */

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import type { Banner, Expedition, Mission, ArmyOrder, ProvinceData, ExpeditionLogEntry } from '../../types';
import { useMapData } from './useMapData';
import { useMapRenderer } from './useMapRenderer';
import { useMapInteraction } from './useMapInteraction';
import { mapToScreen, findPath, TERRAIN_NAMES } from './mapUtils';
import { ProvinceTooltip } from './ProvinceTooltip';
import { FortressMarker } from './FortressMarker';
import { ArmyMarker } from './ArmyMarker';
import { MissionMarker } from './MissionMarker';

interface Props {
  expedition: Expedition;
  banners: Banner[];
  missions: Mission[];
  onClose?: () => void;
  onDeployArmy?: (bannerId: number, provinceId: string) => void;
  onSetArmyOrder?: (bannerId: number, order: ArmyOrder) => void;
  onClearArmyOrder?: (bannerId: number) => void;
  onExecuteTurn?: () => void;
  onClaimExpeditionReward?: (missionId: number) => void;
}

export const ExpeditionMap: React.FC<Props> = ({ expedition, banners, missions, onClose, onDeployArmy, onSetArmyOrder, onClearArmyOrder, onExecuteTurn, onClaimExpeditionReward }) => {
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
          {onClose && (
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
            >
              Close Map
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <MapView
      assets={mapLoadState.assets}
      expedition={expedition}
      banners={banners}
      missions={missions}
      onClose={onClose}
      onDeployArmy={onDeployArmy}
      onSetArmyOrder={onSetArmyOrder}
      onClearArmyOrder={onClearArmyOrder}
      onExecuteTurn={onExecuteTurn}
      onClaimExpeditionReward={onClaimExpeditionReward}
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
  missions: Mission[];
  onClose?: () => void;
  onDeployArmy?: (bannerId: number, provinceId: string) => void;
  onSetArmyOrder?: (bannerId: number, order: ArmyOrder) => void;
  onClearArmyOrder?: (bannerId: number) => void;
  onExecuteTurn?: () => void;
  onClaimExpeditionReward?: (missionId: number) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const MapView: React.FC<MapViewProps> = ({
  assets,
  expedition,
  banners,
  missions,
  onClose,
  onDeployArmy,
  onSetArmyOrder,
  onClearArmyOrder,
  onExecuteTurn,
  onClaimExpeditionReward,
  canvasRef,
  containerRef,
}) => {
  // Province lookup buffer — loaded directly from .bin (no PNG color management)
  const lookup = assets.lookup;

  // ── State declarations (before click handler) ──────────────────────
  const [deployingBannerId, setDeployingBannerId] = useState<number | null>(null);
  const [orderingBannerId, setOrderingBannerId] = useState<number | null>(null);
  const [orderMode, setOrderMode] = useState<'idle' | 'selectingMoveTarget'>('idle');
  const [rewardPopupMissionId, setRewardPopupMissionId] = useState<number | null>(null);

  // ── Refs for click handler (populated after memos, read via ref) ──
  const deployingBannerIdRef = useRef<number | null>(null);
  const orderModeRef = useRef<'idle' | 'selectingMoveTarget'>('idle');
  const orderingBannerIdRef = useRef<number | null>(null);
  const validDeployProvincesRef = useRef(new Set<string>());
  const validMoveProvincesRef = useRef(new Set<string>());
  const armyAtProvinceRef = useRef(new Map<string, number>());

  // Province click callback — fires on every real canvas click (not toggled)
  const handleProvinceClick = useCallback((prov: ProvinceData | null) => {
    if (!prov) return;

    // Deployment mode takes priority
    if (deployingBannerIdRef.current !== null) {
      if (validDeployProvincesRef.current.has(prov.id)) {
        onDeployArmy?.(deployingBannerIdRef.current, prov.id);
        setDeployingBannerId(null);
      }
      return;
    }

    // Move-target selection mode
    if (orderModeRef.current === 'selectingMoveTarget' && orderingBannerIdRef.current !== null) {
      if (validMoveProvincesRef.current.has(prov.id)) {
        onSetArmyOrder?.(orderingBannerIdRef.current, {
          bannerId: orderingBannerIdRef.current,
          type: 'move',
          targetProvinceId: prov.id,
        });
        setOrderMode('idle');
      }
      return;
    }

    // Normal click: check if province has a deployed army
    const armyBid = armyAtProvinceRef.current.get(prov.id);
    if (armyBid !== undefined) {
      setOrderingBannerId(armyBid);
      setOrderMode('idle');
    } else {
      setOrderingBannerId(null);
      setOrderMode('idle');
    }
  }, [onDeployArmy, onSetArmyOrder]);

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
    onProvinceClick: handleProvinceClick,
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

  // ── Army deployment mode ──────────────────────────────────────
  const garrisonedBanners = useMemo(() => {
    const ids = expedition.fortress?.garrison || [];
    return banners.filter(b => ids.includes(b.id));
  }, [expedition.fortress?.garrison, banners]);

  const validDeployProvinces = useMemo(() => {
    if (deployingBannerId === null) return new Set<string>();
    const fortId = expedition.mapState?.fortressProvinceId;
    const fortProv = fortId ? assets.provinceById.get(fortId) : null;
    if (!fortProv) return new Set<string>();
    const valid = new Set<string>();
    for (const adjId of fortProv.adjacentProvinces) {
      const adj = assets.provinceById.get(adjId);
      if (adj?.isLand) valid.add(adjId);
    }
    return valid;
  }, [deployingBannerId, expedition.mapState, assets.provinceById]);

  // Sync deployment ref
  deployingBannerIdRef.current = deployingBannerId;
  validDeployProvincesRef.current = validDeployProvinces;

  // ── Turn-based order system ──────────────────────────────────
  const pendingOrders = expedition.mapState?.pendingOrders || {};
  const turnNumber = expedition.mapState?.turnNumber || 1;

  // Inverted map: provinceId → bannerId (for click detection)
  const armyAtProvince = useMemo(() => {
    const map = new Map<string, number>();
    const positions = expedition.mapState?.armyPositions || {};
    for (const [bid, pid] of Object.entries(positions)) {
      map.set(pid, Number(bid));
    }
    return map;
  }, [expedition.mapState?.armyPositions]);

  // Valid move targets when in move-selection mode
  const validMoveProvinces = useMemo(() => {
    if (orderMode !== 'selectingMoveTarget' || orderingBannerId === null) return new Set<string>();
    const currentProvId = expedition.mapState?.armyPositions[orderingBannerId];
    if (!currentProvId) return new Set<string>();
    const currentProv = assets.provinceById.get(currentProvId);
    if (!currentProv) return new Set<string>();
    const valid = new Set<string>();
    for (const adjId of currentProv.adjacentProvinces) {
      const adj = assets.provinceById.get(adjId);
      if (adj?.isLand) valid.add(adjId);
    }
    return valid;
  }, [orderMode, orderingBannerId, expedition.mapState?.armyPositions, assets.provinceById]);

  // Pending move arrows for renderer
  const pendingMoveArrows = useMemo(() => {
    const arrows: Array<{ from: [number, number]; to: [number, number] }> = [];
    const positions = expedition.mapState?.armyPositions || {};
    for (const [bidStr, order] of Object.entries(pendingOrders)) {
      if (order.type === 'move' && order.targetProvinceId) {
        const fromProvId = positions[Number(bidStr)];
        if (!fromProvId) continue;
        const fromProv = assets.provinceById.get(fromProvId);
        const toProv = assets.provinceById.get(order.targetProvinceId);
        if (fromProv && toProv) {
          arrows.push({
            from: fromProv.center as [number, number],
            to: toProv.center as [number, number],
          });
        }
      }
    }
    return arrows;
  }, [pendingOrders, expedition.mapState?.armyPositions, assets.provinceById]);

  // Sync order system refs (read by handleProvinceClick via ref)
  orderModeRef.current = orderMode;
  orderingBannerIdRef.current = orderingBannerId;
  validMoveProvincesRef.current = validMoveProvinces;
  armyAtProvinceRef.current = armyAtProvince;

  // ── Enemy army rendering data ──────────────────────────────────
  const enemyArmies = expedition.mapState?.enemyArmies ?? [];
  const marchingEnemies = useMemo(() =>
    enemyArmies.filter(e => e.status === 'marching'),
    [enemyArmies]
  );

  // Enemy provinces visible through fog (for red canvas highlights)
  const enemyProvinces = useMemo(() => {
    const set = new Set<string>();
    const revealed = revealedProvinces;
    for (const enemy of marchingEnemies) {
      if (!revealed || revealed.has(enemy.provinceId)) {
        set.add(enemy.provinceId);
      }
    }
    return set;
  }, [marchingEnemies, revealedProvinces]);

  // Battle provinces (amber highlights for provinces where battles occurred this turn)
  const battleProvinceSet = useMemo(() => {
    const provs = expedition.mapState?.battleProvinces;
    return provs ? new Set(provs) : new Set<string>();
  }, [expedition.mapState?.battleProvinces]);

  // Enemy move direction arrows (show next step toward fortress)
  const enemyMoveArrows = useMemo(() => {
    const arrows: Array<{ from: [number, number]; to: [number, number] }> = [];
    const fortId = expedition.mapState?.fortressProvinceId;
    if (!fortId) return arrows;
    const revealed = revealedProvinces;
    for (const enemy of marchingEnemies) {
      if (revealed && !revealed.has(enemy.provinceId)) continue; // hidden in fog
      const fromProv = assets.provinceById.get(enemy.provinceId);
      if (!fromProv) continue;
      const pathResult = findPath(enemy.provinceId, fortId, assets.provinceById);
      if (pathResult && pathResult.path.length > 1) {
        const nextProv = assets.provinceById.get(pathResult.path[1]);
        if (nextProv) {
          arrows.push({
            from: fromProv.center as [number, number],
            to: nextProv.center as [number, number],
          });
        }
      }
    }
    return arrows;
  }, [marchingEnemies, expedition.mapState?.fortressProvinceId, assets.provinceById, revealedProvinces]);

  // Cheat menu state
  const [cheatMenuOpen, setCheatMenuOpen] = useState(false);
  const [cheatFogEnabled, setCheatFogEnabled] = useState(true);
  const [cheatShowDebug, setCheatShowDebug] = useState(false);

  // Render the canvas (fog disabled via cheat → pass undefined)
  useMapRenderer({
    canvasRef,
    assets,
    lookup,
    view,
    hoveredProvince,
    selectedProvince,
    revealedProvinces: cheatFogEnabled ? revealedProvinces : undefined,
    fortressProvinceId: expedition.mapState?.fortressProvinceId,
    deployableProvinces: validDeployProvinces.size > 0 ? validDeployProvinces : undefined,
    moveTargetProvinces: validMoveProvinces.size > 0 ? validMoveProvinces : undefined,
    pendingMoveArrows: pendingMoveArrows.length > 0 ? pendingMoveArrows : undefined,
    enemyProvinces: enemyProvinces.size > 0 ? enemyProvinces : undefined,
    enemyMoveArrows: enemyMoveArrows.length > 0 ? enemyMoveArrows : undefined,
    battleProvinces: battleProvinceSet.size > 0 ? battleProvinceSet : undefined,
    battleAftermath: (() => {
      const am = expedition.mapState?.battleAftermath;
      if (!am || Object.keys(am).length === 0) return undefined;
      return new Map(Object.entries(am));
    })(),
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

        const order = pendingOrders[bannerId];
        return {
          key: bannerId,
          screenX: sx,
          screenY: sy + 20, // Offset below fortress if overlapping
          name: banner.name,
          size: totalTroops,
          order,
          isSelected: orderingBannerId === bannerId,
        };
      })
      .filter(Boolean) as Array<{
        key: number;
        screenX: number;
        screenY: number;
        name: string;
        size: number;
        order?: ArmyOrder;
        isSelected: boolean;
      }>;
  }, [expedition.mapState, banners, assets.provinceById, view, pendingOrders, orderingBannerId]);

  // Enemy army markers (only visible if in revealed provinces)
  const enemyMarkers = useMemo(() => {
    const revealed = revealedProvinces;
    return marchingEnemies
      .filter(enemy => !revealed || revealed.has(enemy.provinceId))
      .map(enemy => {
        const prov = assets.provinceById.get(enemy.provinceId);
        if (!prov) return null;
        const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
        return {
          key: `enemy_${enemy.id}`,
          screenX: sx,
          screenY: sy - 15, // Offset above center to avoid overlap
          name: enemy.name,
          size: enemy.totalTroops,
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        screenX: number;
        screenY: number;
        name: string;
        size: number;
      }>;
  }, [marchingEnemies, assets.provinceById, view, revealedProvinces]);

  // Mission markers (list missions: available/running; expedition missions: all statuses including completed)
  const missionMarkers = useMemo(() => {
    const mapState = expedition.mapState;
    if (!mapState?.missionPositions) return [];

    const pos = mapState.missionPositions as Record<string, string>;
    const results: Array<{
      key: string;
      screenX: number;
      screenY: number;
      name: string;
      terrain?: string;
      provinceName?: string;
      status: string;
      isExpedition: boolean;
    }> = [];

    // Expedition missions only — all statuses (available + completed stay visible on map)
    const expMissions = mapState.expeditionMissions || [];
    for (const m of expMissions) {
      if (m.status === 'archived') continue; // skip archived
      const provId = pos[m.id] || pos[String(m.id)];
      if (!provId) continue;
      const prov = assets.provinceById.get(provId);
      if (!prov) continue;
      const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
      results.push({ key: `exp_${m.id}`, screenX: sx, screenY: sy, name: m.name, terrain: m.terrain, provinceName: `Province ${provId}`, status: m.status, isExpedition: true });
    }

    return results;
  }, [expedition.mapState, missions, assets.provinceById, view]);

  // Auto-show reward popup when expedition missions complete this turn
  const completedIds = expedition.mapState?.completedExpeditionMissionIds;
  useEffect(() => {
    if (completedIds && completedIds.length > 0 && rewardPopupMissionId === null) {
      setRewardPopupMissionId(completedIds[0]);
    }
  }, [completedIds, rewardPopupMissionId]);

  // Resolve the mission object for the reward popup
  const rewardPopupMission = useMemo(() => {
    if (rewardPopupMissionId === null) return null;
    return (expedition.mapState?.expeditionMissions || []).find(m => m.id === rewardPopupMissionId) || null;
  }, [rewardPopupMissionId, expedition.mapState?.expeditionMissions]);

  // Battle aftermath markers (fire/smoke VFX on provinces)
  const aftermathMarkers = useMemo(() => {
    const am = expedition.mapState?.battleAftermath;
    if (!am || Object.keys(am).length === 0) return [];
    return Object.entries(am).map(([provId, turnsLeft]) => {
      const prov = assets.provinceById.get(provId);
      if (!prov) return null;
      const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
      const opacity = turnsLeft >= 3 ? 1 : turnsLeft === 2 ? 0.6 : 0.4;
      const emoji = turnsLeft >= 2 ? '🔥' : '💨';
      return { provId, sx, sy, opacity, emoji, turnsLeft };
    }).filter(Boolean) as { provId: string; sx: number; sy: number; opacity: number; emoji: string; turnsLeft: number }[];
  }, [expedition.mapState?.battleAftermath, assets.provinceById, view]);

  // Expedition log (newest first, already sorted)
  const expeditionLog = expedition.mapState?.expeditionLog || [];

  // Camera focus helper
  const focusProvince = useCallback((provinceId: string) => {
    const prov = assets.provinceById.get(provinceId);
    if (!prov) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    // Set view to center on province
    setView(v => ({
      ...v,
      offsetX: cw / 2 - prov.center[0] * v.scale,
      offsetY: ch / 2 - prov.center[1] * v.scale,
    }));
  }, [assets.provinceById, canvasRef]);

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
          {expedition.mapState && (
            <span className="bg-amber-900/60 text-amber-300 font-bold text-xs px-2.5 py-1 rounded border border-amber-700/50">
              Turn {turnNumber}
            </span>
          )}
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
          {marchingEnemies.length > 0 && (
            <span className="bg-red-900/60 text-red-300 font-bold text-xs px-2.5 py-1 rounded border border-red-700/50">
              ☠️ {marchingEnemies.length} Hostile {marchingEnemies.length === 1 ? 'Army' : 'Armies'}
            </span>
          )}
          {expedition.mapState && !expedition.mapState.expeditionFailed && (
            <button
              onClick={onExecuteTurn}
              className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 text-amber-100 font-bold rounded text-sm border border-amber-500/50 transition-colors"
            >
              Next Turn →
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 text-sm border border-slate-600/50"
            >
              ✕ Close Map
            </button>
          )}
        </div>
      </div>

      {/* Map canvas — flat top-down */}
      <div ref={containerRef as React.RefObject<HTMLDivElement>} className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing">
        <canvas ref={canvasRef as React.RefObject<HTMLCanvasElement>} className="absolute inset-0" />

        {/* Fortress marker with status */}
        {fortressScreen && (() => {
          const fort = expedition.fortress;
          const currentHP = fort?.lastBattle?.finalFortHP ?? fort?.stats?.fortHP ?? 0;
          const maxHP = fort?.stats?.fortHP ?? 0;
          const garrisonCount = (fort?.garrison || []).reduce((sum: number, bid: number) => {
            const banner = banners.find(b => b.id === bid);
            return sum + (banner ? banner.squads.reduce((s, sq) => s + (sq.currentSize || 0), 0) : 0);
          }, 0);
          return (
            <FortressMarker
              screenX={fortressScreen.x}
              screenY={fortressScreen.y}
              label="Fortress"
              fortHP={currentHP}
              maxFortHP={maxHP}
              garrisonCount={garrisonCount}
              wasAttacked={!!fort?.lastBattle}
            />
          );
        })()}

        {/* Army markers */}
        {armyMarkers.map(m => (
          <ArmyMarker
            key={m.key}
            screenX={m.screenX}
            screenY={m.screenY}
            armyName={m.name}
            armySize={m.size}
            order={m.order}
            isSelected={m.isSelected}
          />
        ))}

        {/* Enemy army markers (red hostile) */}
        {enemyMarkers.map(m => (
          <ArmyMarker
            key={m.key}
            screenX={m.screenX}
            screenY={m.screenY}
            armyName={m.name}
            armySize={m.size}
            hostile
          />
        ))}

        {/* Battle markers (crossed swords at battle provinces) */}
        {[...battleProvinceSet].map(provId => {
          const prov = assets.provinceById.get(provId);
          if (!prov) return null;
          const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
          return (
            <div
              key={`battle-${provId}`}
              className="absolute pointer-events-none"
              style={{ left: sx - 14, top: sy - 30, zIndex: 80 }}
            >
              <div className="text-2xl animate-pulse drop-shadow-lg">⚔️</div>
            </div>
          );
        })}

        {/* Battle aftermath VFX (fire/smoke) */}
        {aftermathMarkers.map(m => (
          <div
            key={`aftermath-${m.provId}`}
            className="absolute pointer-events-none"
            style={{ left: m.sx, top: m.sy, transform: 'translate(-50%, -50%)', opacity: m.opacity, zIndex: 10 }}
          >
            <span className="text-2xl drop-shadow-lg">{m.emoji}</span>
          </div>
        ))}

        {/* Mission markers */}
        {missionMarkers.map(m => (
          <MissionMarker
            key={m.key}
            screenX={m.screenX}
            screenY={m.screenY}
            missionName={m.name}
            terrain={m.terrain}
            provinceName={m.provinceName}
            isActive={m.status === 'running'}
            isCompleted={m.status === 'completedRewardsPending' || m.status === 'completedRewardsClaimed'}
            isExpedition={m.isExpedition}
          />
        ))}

        {/* Deploy target markers on valid provinces */}
        {deployingBannerId !== null && [...validDeployProvinces].map(provId => {
          const prov = assets.provinceById.get(provId);
          if (!prov) return null;
          const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
          return (
            <div key={provId} className="absolute pointer-events-none z-15"
              style={{ left: sx, top: sy, transform: 'translate(-50%, -50%)' }}>
              <div className="text-lg animate-pulse opacity-80 drop-shadow-lg">🚩</div>
            </div>
          );
        })}

        {/* Move target markers on valid provinces */}
        {orderMode === 'selectingMoveTarget' && [...validMoveProvinces].map(provId => {
          const prov = assets.provinceById.get(provId);
          if (!prov) return null;
          const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
          return (
            <div key={`move-${provId}`} className="absolute pointer-events-none z-15"
              style={{ left: sx, top: sy, transform: 'translate(-50%, -50%)' }}>
              <div className="text-sm animate-pulse opacity-90 drop-shadow-lg">➡️</div>
            </div>
          );
        })}

        {/* Army Order Panel (right side) */}
        {orderingBannerId !== null && expedition.mapState && (() => {
          const banner = banners.find(b => b.id === orderingBannerId);
          if (!banner) return null;
          const troops = banner.squads.reduce((s, sq) => s + sq.currentSize, 0);
          const currentOrder = pendingOrders[orderingBannerId];
          const orderType = currentOrder?.type || 'hold';
          const targetProvId = currentOrder?.targetProvinceId;

          return (
            <div
              className="absolute top-16 right-3 bg-slate-900/95 border border-slate-600/50 rounded-lg p-3 z-40 min-w-[220px] max-w-[260px] backdrop-blur-sm"
              style={{ pointerEvents: 'auto' }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onMouseMove={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
            >
              <div className="text-amber-400 font-bold text-xs mb-2 border-b border-slate-700 pb-1">
                📋 Army Orders
              </div>
              <div className="text-sm text-slate-200 font-semibold mb-1">{banner.name}</div>
              <div className="text-xs text-slate-500 mb-2">{troops} troops</div>

              {orderMode === 'selectingMoveTarget' ? (
                <div>
                  <div className="text-sm text-blue-300 mb-2">
                    Select destination province
                  </div>
                  <div className="text-xs text-slate-500 mb-2">
                    ➡️ Click a blue highlighted province
                  </div>
                  <button
                    onClick={() => setOrderMode('idle')}
                    className="w-full px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs border border-slate-500/50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <button
                    onClick={() => {
                      onClearArmyOrder?.(orderingBannerId);
                      setOrderMode('idle');
                    }}
                    className={`w-full px-3 py-1.5 rounded text-xs border transition-colors flex items-center gap-2 ${
                      orderType === 'hold'
                        ? 'bg-emerald-800/80 text-emerald-200 border-emerald-500/50'
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-500/50'
                    }`}
                  >
                    🛡️ Hold Position
                    {orderType === 'hold' && <span className="ml-auto text-emerald-400 text-[10px]">ACTIVE</span>}
                  </button>
                  <button
                    onClick={() => setOrderMode('selectingMoveTarget')}
                    className={`w-full px-3 py-1.5 rounded text-xs border transition-colors flex items-center gap-2 ${
                      orderType === 'move'
                        ? 'bg-blue-800/80 text-blue-200 border-blue-500/50'
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-500/50'
                    }`}
                  >
                    ➡️ Move
                    {orderType === 'move' && <span className="ml-auto text-blue-400 text-[10px]">ACTIVE</span>}
                  </button>
                  {orderType === 'move' && targetProvId && (
                    <div className="text-xs text-blue-300 bg-blue-900/30 rounded px-2 py-1 border border-blue-700/30 mt-1">
                      → {targetProvId.replace('prov_', 'Province ')}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => { setOrderingBannerId(null); setOrderMode('idle'); }}
                className="w-full mt-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-xs border border-slate-600/50"
              >
                Close
              </button>
            </div>
          );
        })()}

        {/* Province tooltip */}
        {hoveredProvince && tooltipScreen && (
          <ProvinceTooltip
            province={hoveredProvince}
            screenX={tooltipScreen.x}
            screenY={tooltipScreen.y}
          />
        )}

        {/* Deploy Army Panel */}
        {expedition.mapState && (
          <div
            className="absolute top-16 left-3 bg-slate-900/95 border border-slate-600/50 rounded-lg p-3 z-40 min-w-[220px] max-w-[260px] backdrop-blur-sm"
            style={{ pointerEvents: 'auto' }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onMouseMove={e => e.stopPropagation()}
            onWheel={e => e.stopPropagation()}
          >
            <div className="text-amber-400 font-bold text-xs mb-2 border-b border-slate-700 pb-1">
              ⚔️ Deploy Army
            </div>
            {deployingBannerId !== null ? (
              <div>
                <div className="text-sm text-slate-300 mb-2">
                  Select a highlighted province for{' '}
                  <span className="text-amber-300 font-semibold">
                    {banners.find(b => b.id === deployingBannerId)?.name || 'Army'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mb-2">
                  🚩 Click a green province adjacent to the fortress
                </div>
                <button
                  onClick={() => setDeployingBannerId(null)}
                  className="w-full px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs border border-slate-500/50"
                >
                  Cancel
                </button>
              </div>
            ) : garrisonedBanners.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-1">
                No armies garrisoned in fortress.
              </div>
            ) : (
              <div className="space-y-1.5">
                {garrisonedBanners.map(b => {
                  const troops = b.squads.reduce((s, sq) => s + sq.currentSize, 0);
                  return (
                    <div key={b.id} className="flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-200 truncate flex-1">
                        {b.name}
                        <span className="text-slate-500 ml-1">({troops})</span>
                      </div>
                      <button
                        onClick={() => setDeployingBannerId(b.id)}
                        className="px-2 py-1 bg-emerald-700/80 hover:bg-emerald-600 text-emerald-100 rounded text-xs border border-emerald-500/50 whitespace-nowrap"
                      >
                        Deploy
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Pending Orders Summary — left side, below deploy panel */}
        {expedition.mapState && Object.keys(expedition.mapState.armyPositions).length > 0 && (() => {
          const positions = expedition.mapState!.armyPositions;
          const deployedBannerIds = Object.keys(positions).map(Number);
          if (deployedBannerIds.length === 0) return null;

          return (
            <div
              className="absolute left-3 bg-slate-900/95 border border-slate-600/50 rounded-lg p-3 z-30 min-w-[220px] max-w-[260px] backdrop-blur-sm"
              style={{
                pointerEvents: 'auto',
                top: `${(garrisonedBanners.length > 0 || deployingBannerId !== null)
                  ? 64 + 16 + Math.max(garrisonedBanners.length * 32 + 48, 80)
                  : 64 + 16 + 60}px`,
              }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onMouseMove={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
            >
              <div className="text-amber-400 font-bold text-xs mb-2 border-b border-slate-700 pb-1">
                📋 Orders (Turn {turnNumber})
              </div>
              <div className="space-y-1">
                {deployedBannerIds.map(bid => {
                  const banner = banners.find(b => b.id === bid);
                  if (!banner) return null;
                  const order = pendingOrders[bid];
                  const orderType = order?.type || 'hold';
                  return (
                    <div key={bid} className="flex items-center justify-between gap-1 text-xs">
                      <div className="truncate flex-1 text-slate-200">
                        {banner.name}
                      </div>
                      {orderType === 'move' ? (
                        <span className="text-blue-400 flex items-center gap-1 whitespace-nowrap">
                          → {order?.targetProvinceId?.replace('prov_', 'P') || '?'}
                          <button
                            onClick={() => onClearArmyOrder?.(bid)}
                            className="text-slate-500 hover:text-red-400 ml-0.5"
                            title="Cancel order"
                          >✕</button>
                        </span>
                      ) : (
                        <span className="text-emerald-500 whitespace-nowrap">🛡️ Hold</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Recent events toast (last 3 entries, compact) */}
        {expeditionLog.length > 0 && (
          <div
            className="absolute left-3 bottom-10 bg-slate-900/90 border border-slate-600/40 rounded-lg px-2 py-1.5 z-30 max-w-[260px] backdrop-blur-sm"
            style={{ pointerEvents: 'auto' }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          >
            {expeditionLog.slice(0, 3).map(entry => {
              const icon: Record<string, string> = { hostile_detected: '👁️', battle_resolved: '⚔️', army_destroyed: '💀', mission_completed: '⭐', fortress_attacked: '🏰', fortress_damaged: '🏚️' };
              const color: Record<string, string> = { hostile_detected: 'text-red-400', battle_resolved: 'text-amber-300', army_destroyed: 'text-red-500', mission_completed: 'text-emerald-400', fortress_attacked: 'text-red-400', fortress_damaged: 'text-red-500' };
              return (
                <div key={entry.id} className="flex items-center gap-1 text-[9px] leading-snug">
                  <span className="text-slate-600">T{entry.turn}</span>
                  <span>{icon[entry.type] || '•'}</span>
                  <span className={`truncate ${color[entry.type] || 'text-slate-400'}`}>{entry.text}</span>
                  {entry.provinceId && (
                    <button onClick={() => focusProvince(entry.provinceId!)} className="text-blue-400 hover:text-blue-300 shrink-0" title="Go to province">📍</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Controls hint */}
        <div className="absolute bottom-3 left-3 text-xs text-slate-500 bg-slate-900/80 px-2 py-1 rounded">
          Scroll to zoom · Drag to pan · Click army to give orders
        </div>

        {/* Cheat menu toggle — stopPropagation prevents map click/drag */}
        <button
          className="absolute bottom-3 right-3 w-8 h-8 bg-slate-800/90 hover:bg-slate-700 text-slate-400 rounded border border-slate-600/50 flex items-center justify-center text-sm z-40"
          style={{ pointerEvents: 'auto' }}
          onClick={(e) => { e.stopPropagation(); setCheatMenuOpen(prev => !prev); }}
          onMouseDown={e => e.stopPropagation()}
          title="Debug/Cheat Menu"
        >
          🔧
        </button>

        {/* Cheat menu panel — all events stopped so map doesn't react */}
        {cheatMenuOpen && (
          <div
            className="absolute bottom-14 right-3 bg-slate-900/95 border border-slate-600/50 rounded-lg p-3 z-40 min-w-[180px] backdrop-blur-sm"
            style={{ pointerEvents: 'auto' }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onMouseMove={e => e.stopPropagation()}
            onWheel={e => e.stopPropagation()}
          >
            <div className="text-amber-400 font-bold text-xs mb-2 border-b border-slate-700 pb-1">
              🔧 Debug Menu
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300 mb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cheatFogEnabled}
                onChange={e => setCheatFogEnabled(e.target.checked)}
                className="rounded"
              />
              Fog of War
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 mb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cheatShowDebug}
                onChange={e => setCheatShowDebug(e.target.checked)}
                className="rounded"
              />
              Debug Info
            </label>
          </div>
        )}

        {/* Expedition Mission Reward Popup */}
        {rewardPopupMission && rewardPopupMission.rewards && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none">
            <div
              className="bg-slate-900/95 border-2 border-purple-500 rounded-xl p-6 text-center max-w-sm pointer-events-auto shadow-2xl backdrop-blur-sm"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="text-4xl mb-3">⭐</div>
              <div className="text-purple-300 font-bold text-xl mb-1">Mission Complete!</div>
              <div className="text-slate-300 text-sm mb-4">&ldquo;{rewardPopupMission.name}&rdquo;</div>

              {/* Rewards grid */}
              <div className="flex flex-wrap justify-center gap-3 mb-5">
                {(rewardPopupMission.rewards.gold ?? 0) > 0 && (
                  <div className="bg-amber-900/50 border border-amber-700/50 rounded px-3 py-1.5 text-sm">
                    <span className="text-amber-400">🪙</span> <span className="text-amber-200 font-semibold">{rewardPopupMission.rewards.gold}</span>
                  </div>
                )}
                {(rewardPopupMission.rewards.wood ?? 0) > 0 && (
                  <div className="bg-emerald-900/50 border border-emerald-700/50 rounded px-3 py-1.5 text-sm">
                    <span className="text-emerald-400">🪵</span> <span className="text-emerald-200 font-semibold">{rewardPopupMission.rewards.wood}</span>
                  </div>
                )}
                {(rewardPopupMission.rewards.stone ?? 0) > 0 && (
                  <div className="bg-slate-700/50 border border-slate-500/50 rounded px-3 py-1.5 text-sm">
                    <span className="text-slate-300">🪨</span> <span className="text-slate-200 font-semibold">{rewardPopupMission.rewards.stone}</span>
                  </div>
                )}
                {(rewardPopupMission.rewards.food ?? 0) > 0 && (
                  <div className="bg-lime-900/50 border border-lime-700/50 rounded px-3 py-1.5 text-sm">
                    <span className="text-lime-400">🌾</span> <span className="text-lime-200 font-semibold">{rewardPopupMission.rewards.food}</span>
                  </div>
                )}
                {(rewardPopupMission.rewards.iron ?? 0) > 0 && (
                  <div className="bg-zinc-700/50 border border-zinc-500/50 rounded px-3 py-1.5 text-sm">
                    <span className="text-zinc-300">⚒️</span> <span className="text-zinc-200 font-semibold">{rewardPopupMission.rewards.iron}</span>
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  onClaimExpeditionReward?.(rewardPopupMission.id);
                  setRewardPopupMissionId(null);
                }}
                className="px-6 py-2 bg-purple-700 hover:bg-purple-600 text-purple-100 font-bold rounded border border-purple-400/50 transition-colors"
              >
                Collect Rewards
              </button>
            </div>
          </div>
        )}

        {/* Expedition Failed overlay */}
        {expedition.mapState?.expeditionFailed && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 pointer-events-none">
            <div className="bg-red-950/95 border-2 border-red-600 rounded-xl p-8 text-center max-w-md pointer-events-auto shadow-2xl">
              <div className="text-5xl mb-4">💀</div>
              <div className="text-red-300 font-bold text-2xl mb-2">The Fortress Has Fallen!</div>
              <div className="text-red-200/70 text-sm mb-4">
                An enemy army has breached your defenses and captured the fortress.
                The expedition has ended in defeat.
              </div>
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-red-800 hover:bg-red-700 text-red-100 font-bold rounded border border-red-500/50 transition-colors"
                >
                  Return to Village
                </button>
              )}
            </div>
          </div>
        )}

        {/* Debug overlay (toggled via cheat menu) */}
        {cheatShowDebug && (
          <>
            {mouseMapPos && (
              <div
                className="absolute pointer-events-none z-50"
                style={{
                  left: mouseMapPos[0] * view.scale + view.offsetX,
                  top: mouseMapPos[1] * view.scale + view.offsetY,
                  width: 12, height: 12,
                  borderRadius: '50%',
                  background: 'red',
                  border: '2px solid yellow',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            )}
            <div className="absolute top-2 right-2 bg-black/80 text-green-400 font-mono text-xs p-2 rounded z-50 pointer-events-none">
              <div>map: {mouseMapPos?.[0]?.toFixed(0) ?? '—'}, {mouseMapPos?.[1]?.toFixed(0) ?? '—'}</div>
              <div>view: off={view.offsetX.toFixed(0)},{view.offsetY.toFixed(0)} s={view.scale.toFixed(3)}</div>
              <div>canvas: {canvasRef.current?.width}×{canvasRef.current?.height}</div>
              <div>hover: {hoveredProvince?.id?.replace('prov_', 'P') || '—'}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
