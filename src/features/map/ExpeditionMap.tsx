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
import { EXPEDITION_MISSIONS } from '../../expeditionMissions';

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
  onRequestReinforcement?: (bannerId: number) => void;
  onCancelReinforcement?: (bannerId: number) => void;
}

export const ExpeditionMap: React.FC<Props> = ({ expedition, banners, missions, onClose, onDeployArmy, onSetArmyOrder, onClearArmyOrder, onExecuteTurn, onClaimExpeditionReward, onRequestReinforcement, onCancelReinforcement }) => {
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
      onRequestReinforcement={onRequestReinforcement}
      onCancelReinforcement={onCancelReinforcement}
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
  onRequestReinforcement?: (bannerId: number) => void;
  onCancelReinforcement?: (bannerId: number) => void;
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
  onRequestReinforcement,
  onCancelReinforcement,
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
  const [showCancelReinforce, setShowCancelReinforce] = useState(false);
  type BattleEvent = { type: 'field'; battleId: string } | { type: 'siege'; siegeData: any };
  const [battlePopupQueue, setBattlePopupQueue] = useState<BattleEvent[]>([]);
  const prevBattleCountRef = useRef((expedition.mapState?.fieldBattleResults || []).length);
  const prevSiegeTurnRef = useRef<number>(expedition.mapState?.turnNumber || 0);
  const [turnBanner, setTurnBanner] = useState<number | null>(null);
  const prevTurnRef = useRef<number>(expedition.mapState?.turnNumber || 1);

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
      setShowCancelReinforce(false);
    } else {
      setOrderingBannerId(null);
      setOrderMode('idle');
      setShowCancelReinforce(false);
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
        if (!banner || !prov || banner.status === 'destroyed') return null;

        const [sx, sy] = mapToScreen(prov.center[0], prov.center[1], view);
        const totalTroops = banner.squads.reduce((s, sq) => s + sq.currentSize, 0);
        if (totalTroops <= 0) return null; // safety: skip 0-troop armies

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
      difficulty?: string;
      enemyTotal?: number;
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
      const mDef = EXPEDITION_MISSIONS.find(d => d.id === m.id);
      const enemyTotal = mDef ? mDef.enemySquads.reduce((s, sq) => s + sq.count, 0) : undefined;
      const difficulty = mDef?.difficulty;
      results.push({ key: `exp_${m.id}`, screenX: sx, screenY: sy, name: m.name, terrain: m.terrain, provinceName: `Province ${provId}`, status: m.status, isExpedition: true, difficulty, enemyTotal });
    }

    return results;
  }, [expedition.mapState, missions, assets.provinceById, view]);

  // Auto-show battle outcome popup when new battles occur (field + siege)
  useEffect(() => {
    const newEvents: BattleEvent[] = [];

    // Detect new siege battle
    const siege = expedition.mapState?.pendingSiegeBattle;
    const currentTurn = expedition.mapState?.turnNumber || 0;
    if (siege && currentTurn > prevSiegeTurnRef.current) {
      newEvents.push({ type: 'siege', siegeData: siege });
      prevSiegeTurnRef.current = currentTurn;
    }

    // Detect new field battles
    const results = expedition.mapState?.fieldBattleResults || [];
    if (results.length > prevBattleCountRef.current) {
      const newBattles = results.slice(prevBattleCountRef.current);
      newEvents.push(...newBattles.map(b => ({ type: 'field' as const, battleId: b.id })));
    }
    prevBattleCountRef.current = results.length;

    if (newEvents.length > 0) {
      setBattlePopupQueue(prev => [...prev, ...newEvents]);
    }
  }, [expedition.mapState?.fieldBattleResults, expedition.mapState?.pendingSiegeBattle, expedition.mapState?.turnNumber]);

  // Turn transition banner
  useEffect(() => {
    const currentTurn = expedition.mapState?.turnNumber || 1;
    if (currentTurn > prevTurnRef.current) {
      setTurnBanner(currentTurn);
      prevTurnRef.current = currentTurn;
      const timer = setTimeout(() => setTurnBanner(null), 2200);
      return () => clearTimeout(timer);
    }
  }, [expedition.mapState?.turnNumber]);

  // Resolve current battle popup data
  const currentBattleEvent = battlePopupQueue[0] || null;
  const currentBattlePopup = useMemo(() => {
    if (!currentBattleEvent) return null;
    if (currentBattleEvent.type === 'field') {
      return (expedition.mapState?.fieldBattleResults || []).find(b => b.id === currentBattleEvent.battleId) || null;
    }
    return null; // siege handled separately
  }, [currentBattleEvent, expedition.mapState?.fieldBattleResults]);
  const currentSiegePopup = currentBattleEvent?.type === 'siege' ? currentBattleEvent.siegeData : null;

  // Auto-show reward popup when expedition missions complete (AFTER battle popups clear)
  const completedIds = expedition.mapState?.completedExpeditionMissionIds;
  useEffect(() => {
    if (completedIds && completedIds.length > 0 && rewardPopupMissionId === null && battlePopupQueue.length === 0) {
      setRewardPopupMissionId(completedIds[0]);
    }
  }, [completedIds, rewardPopupMissionId, battlePopupQueue.length]);

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
      <style>{`
        @keyframes turnBannerIn {
          0% { opacity: 0; transform: scale(0.8) translateY(10px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes turnBannerOut {
          0% { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(1.05) translateY(-10px); }
        }
      `}</style>
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
          const fortProvId = expedition.mapState?.fortressProvinceId;
          const deployedAtFort = fortProvId ? Object.entries(expedition.mapState?.armyPositions || {})
            .filter(([, prov]) => prov === fortProvId)
            .reduce((sum, [bidStr]) => {
              const b = banners.find(bn => bn.id === Number(bidStr));
              return sum + (b ? b.squads.reduce((s, sq) => s + (sq.currentSize || 0), 0) : 0);
            }, 0) : 0;
          return (
            <FortressMarker
              screenX={fortressScreen.x}
              screenY={fortressScreen.y}
              label="Fortress"
              fortHP={currentHP}
              maxFortHP={maxHP}
              garrisonCount={deployedAtFort}
              deployedCount={0}
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
            difficulty={m.difficulty}
            enemyTotal={m.enemyTotal}
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
              <div className="text-lg animate-pulse opacity-80 drop-shadow-lg">🚩</div>
            </div>
          );
        })}

        {/* Army Order Panel (right side) */}
        {orderingBannerId !== null && expedition.mapState && (() => {
          const banner = banners.find(b => b.id === orderingBannerId);
          if (!banner) return null;
          const troops = banner.squads.reduce((s, sq) => s + sq.currentSize, 0);
          // Don't show orders for destroyed armies
          if (troops <= 0 || banner.status === 'destroyed') return null;
          const maxTroops = banner.squads.reduce((s, sq) => s + sq.maxSize, 0);
          const isDamaged = troops < maxTroops;
          const missingTroops = maxTroops - troops;
          const isTraining = banner.status === 'training';
          const isPaused = !!banner.trainingPaused;
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
                <div className="space-y-1.5">
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
                  {/* Reinforce button — visible even during move selection */}
                  {isDamaged && (
                    <>
                      <button
                        onClick={() => {
                          if (isTraining) { setShowCancelReinforce(v => !v); }
                          else { onRequestReinforcement?.(orderingBannerId); }
                        }}
                        title={
                          isTraining && isPaused ? 'Reinforcement paused'
                          : isTraining ? `Reinforcing: ${banner.recruited ?? 0}/${banner.reqPop ?? missingTroops} — click to cancel`
                          : `Reinforce ${missingTroops} missing troops`
                        }
                        className={`w-full px-3 py-1.5 rounded text-xs border transition-colors flex items-center gap-2 ${
                          isTraining
                            ? isPaused
                              ? 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-600/50'
                              : 'bg-amber-900/40 text-amber-300 border-amber-600/50 hover:bg-amber-800/50'
                            : 'bg-emerald-800/60 hover:bg-emerald-700/80 text-emerald-200 border-emerald-500/50'
                        }`}
                      >
                        {isTraining && isPaused ? '⏸' : '🔄'}{' '}
                        {isTraining && isPaused
                          ? 'Paused'
                          : isTraining
                            ? `Reinforcing... ${banner.recruited ?? 0}/${banner.reqPop ?? missingTroops}`
                            : `Reinforce (${missingTroops} missing)`}
                        {isTraining && !isPaused && (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        )}
                      </button>
                      {showCancelReinforce && isTraining && (
                        <div className="bg-slate-800 border border-amber-600/50 rounded p-2 text-xs space-y-2">
                          <p className="text-amber-300">⚠ Cancel reinforcement? Progress will be lost.</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setShowCancelReinforce(false)}
                              className="flex-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-500/50"
                            >
                              Keep Going
                            </button>
                            <button
                              onClick={() => {
                                onCancelReinforcement?.(orderingBannerId);
                                setShowCancelReinforce(false);
                              }}
                              className="flex-1 px-2 py-1 bg-red-900/60 hover:bg-red-800/80 text-red-200 rounded border border-red-600/50"
                            >
                              Cancel Reinforcement
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
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
                    onClick={() => {
                      onSetArmyOrder?.(orderingBannerId, {
                        bannerId: orderingBannerId,
                        type: 'defend',
                      });
                      setOrderMode('idle');
                    }}
                    className={`w-full px-3 py-1.5 rounded text-xs border transition-colors flex items-center gap-2 ${
                      orderType === 'defend'
                        ? 'bg-amber-800/80 text-amber-200 border-amber-500/50'
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-500/50'
                    }`}
                  >
                    🛡 Defend (Last Stand)
                    {orderType === 'defend' && <span className="ml-auto text-amber-400 text-[10px]">ACTIVE</span>}
                  </button>
                  {orderType === 'defend' && (
                    <div className="text-[10px] text-amber-400/80 bg-amber-900/20 rounded px-2 py-0.5 border border-amber-700/20">
                      Army will fight to the death — no retreat
                    </div>
                  )}
                  <button
                    onClick={() => { if (!isTraining) setOrderMode('selectingMoveTarget'); }}
                    disabled={isTraining}
                    title={isTraining ? 'Cannot move while reinforcing' : undefined}
                    className={`w-full px-3 py-1.5 rounded text-xs border transition-colors flex items-center gap-2 ${
                      isTraining
                        ? 'bg-slate-700/50 text-slate-500 border-slate-600/50 cursor-not-allowed'
                        : orderType === 'move'
                          ? 'bg-blue-800/80 text-blue-200 border-blue-500/50'
                          : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-500/50'
                    }`}
                  >
                    ➡️ Move
                    {isTraining && <span className="ml-auto text-amber-400 text-[10px]">🔒</span>}
                    {!isTraining && orderType === 'move' && <span className="ml-auto text-blue-400 text-[10px]">ACTIVE</span>}
                  </button>
                  {isTraining && (
                    <div className="text-[10px] text-amber-400/80 bg-amber-900/20 rounded px-2 py-0.5 border border-amber-700/20">
                      ⚠ Cannot move while reinforcing
                    </div>
                  )}
                  {orderType === 'move' && targetProvId && !isTraining && (
                    <div className="text-xs text-blue-300 bg-blue-900/30 rounded px-2 py-1 border border-blue-700/30 mt-1">
                      → {targetProvId.replace('prov_', 'Province ')}
                    </div>
                  )}
                  {/* Reinforce button — only shown when army is damaged */}
                  {isDamaged && (
                    <>
                      <button
                        onClick={() => {
                          if (isTraining) { setShowCancelReinforce(v => !v); }
                          else { onRequestReinforcement?.(orderingBannerId); }
                        }}
                        title={
                          isTraining && isPaused ? 'Reinforcement paused'
                          : isTraining ? `Reinforcing: ${banner.recruited ?? 0}/${banner.reqPop ?? missingTroops} — click to cancel`
                          : `Reinforce ${missingTroops} missing troops`
                        }
                        className={`w-full px-3 py-1.5 rounded text-xs border transition-colors flex items-center gap-2 ${
                          isTraining
                            ? isPaused
                              ? 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-600/50'
                              : 'bg-amber-900/40 text-amber-300 border-amber-600/50 hover:bg-amber-800/50'
                            : 'bg-emerald-800/60 hover:bg-emerald-700/80 text-emerald-200 border-emerald-500/50'
                        }`}
                      >
                        {isTraining && isPaused ? '⏸' : '🔄'}{' '}
                        {isTraining && isPaused
                          ? 'Paused'
                          : isTraining
                            ? `Reinforcing... ${banner.recruited ?? 0}/${banner.reqPop ?? missingTroops}`
                            : `Reinforce (${missingTroops} missing)`}
                        {isTraining && !isPaused && (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        )}
                      </button>
                      {showCancelReinforce && isTraining && (
                        <div className="bg-slate-800 border border-amber-600/50 rounded p-2 text-xs space-y-2">
                          <p className="text-amber-300">⚠ Cancel reinforcement? Progress will be lost.</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setShowCancelReinforce(false)}
                              className="flex-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-500/50"
                            >
                              Keep Going
                            </button>
                            <button
                              onClick={() => {
                                onCancelReinforcement?.(orderingBannerId);
                                setShowCancelReinforce(false);
                              }}
                              className="flex-1 px-2 py-1 bg-red-900/60 hover:bg-red-800/80 text-red-200 rounded border border-red-600/50"
                            >
                              Cancel Reinforcement
                            </button>
                          </div>
                        </div>
                      )}
                    </>
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

        {/* ══ Army Roster Panel (Paradox-style) ══ */}
        {expedition.mapState && (() => {
          // Deploying mode — show deployment instructions
          if (deployingBannerId !== null) {
            return (
              <div
                className="absolute top-16 left-3 bg-slate-900/95 border border-amber-600/50 rounded-lg p-3 z-40 min-w-[230px] max-w-[270px] backdrop-blur-sm"
                style={{ pointerEvents: 'auto' }}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                onMouseMove={e => e.stopPropagation()}
                onWheel={e => e.stopPropagation()}
              >
                <div className="text-amber-400 font-bold text-xs mb-2">
                  🚩 Deploying: {banners.find(b => b.id === deployingBannerId)?.name || 'Army'}
                </div>
                <div className="text-xs text-slate-400 mb-2">Click a green province adjacent to fortress</div>
                <button
                  onClick={() => setDeployingBannerId(null)}
                  className="w-full px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs border border-slate-500/50"
                >
                  Cancel
                </button>
              </div>
            );
          }

          const positions = expedition.mapState!.armyPositions || {};
          const deployedBannerIds = Object.keys(positions).map(Number);
          const deployedBanners = deployedBannerIds
            .map(bid => banners.find(b => b.id === bid))
            .filter((b): b is Banner => !!b && b.status !== 'destroyed');

          return (
            <div
              className="absolute top-16 left-3 bg-slate-900/95 border border-slate-600/50 rounded-lg z-40 min-w-[240px] max-w-[280px] backdrop-blur-sm overflow-hidden"
              style={{ pointerEvents: 'auto', maxHeight: 'calc(100% - 140px)' }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onMouseMove={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-3 pt-2.5 pb-1.5 border-b border-slate-700/60 flex items-center justify-between">
                <span className="text-amber-400 font-bold text-xs tracking-wide uppercase">⚔ Armies</span>
                <span className="text-[9px] text-slate-500">Turn {turnNumber}</span>
              </div>

              <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                {/* ── Deployed Armies ── */}
                {deployedBanners.length > 0 && (
                  <div className="px-2 pt-1.5 pb-1">
                    {deployedBanners.map(b => {
                      const bid = b.id;
                      const order = pendingOrders[bid];
                      const orderType = order?.type || 'hold';
                      const totalTroops = b.squads.reduce((s, sq) => s + sq.currentSize, 0);
                      const maxTroops = b.squads.reduce((s, sq) => s + sq.maxSize, 0);
                      const isDamaged = totalTroops < maxTroops;
                      const hpPct = maxTroops > 0 ? (totalTroops / maxTroops) * 100 : 100;
                      const isSelected = orderingBannerId === bid;
                      const meleeCount = b.squads.filter(sq => ['warrior', 'militia', 'pikemen', 'longsword', 'heavy_cavalry', 'light_cavalry'].includes(sq.type)).reduce((s, sq) => s + sq.currentSize, 0);
                      const rangedCount = b.squads.filter(sq => ['archer', 'skirmisher', 'crossbowman'].includes(sq.type)).reduce((s, sq) => s + sq.currentSize, 0);

                      // Reinforcement status
                      const isTraining = b.status === 'training';
                      const isPaused = !!b.trainingPaused;
                      const needsReinforcement = isDamaged && !isTraining;
                      const recruitIcon = isTraining && isPaused ? '⏸' : isTraining ? '🔄' : needsReinforcement ? '⚠' : null;
                      const recruitColor = isTraining && isPaused ? 'text-slate-400' : isTraining ? 'text-amber-400' : needsReinforcement ? 'text-red-400' : '';
                      const recruitTooltip = isTraining && isPaused ? 'Reinforcement paused'
                        : isTraining ? `Reinforcing: ${b.recruited}/${b.reqPop}`
                        : needsReinforcement ? `Needs reinforcement (${maxTroops - totalTroops} missing)`
                        : '';

                      return (
                        <div
                          key={bid}
                          className={`rounded px-2 py-1.5 mb-1 cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-amber-900/40 border border-amber-500/60 shadow-sm shadow-amber-500/10'
                              : 'bg-slate-800/40 border border-slate-700/30 hover:bg-slate-800/70 hover:border-slate-600/50'
                          }`}
                          onClick={() => {
                            setOrderingBannerId(isSelected ? null : bid);
                            setOrderMode(isSelected ? 'idle' : 'selectingMoveTarget');
                          }}
                        >
                          {/* Row 1: Status dot + Name + Troops + Recruit icon */}
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${
                              orderType === 'move' ? 'bg-blue-400' : 'bg-emerald-400'
                            }`} />
                            <span className="text-[11px] text-slate-200 font-semibold truncate flex-1">{b.name}</span>
                            {recruitIcon && (
                              <span
                                className={`text-[10px] shrink-0 cursor-help ${recruitColor} ${isTraining && !isPaused ? 'animate-pulse' : ''}`}
                                title={recruitTooltip}
                              >
                                {recruitIcon}
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400 font-mono shrink-0">{totalTroops}</span>
                          </div>

                          {/* Row 2: Order + Composition */}
                          <div className="flex items-center justify-between mt-0.5 pl-3.5">
                            {orderType === 'move' ? (
                              <span className="text-[9px] text-blue-400 flex items-center gap-0.5">
                                → {order?.targetProvinceId?.replace('prov_', 'P') || '?'}
                                <button
                                  onClick={(e) => { e.stopPropagation(); onClearArmyOrder?.(bid); }}
                                  className="text-slate-600 hover:text-red-400 ml-0.5"
                                  title="Cancel move"
                                >✕</button>
                              </span>
                            ) : (
                              <span className="text-[9px] text-emerald-500/80">🛡 Hold</span>
                            )}
                            <div className="flex items-center gap-1.5 text-[9px]">
                              {meleeCount > 0 && <span className="text-slate-400">⚔{meleeCount}</span>}
                              {rangedCount > 0 && <span className="text-slate-400">🏹{rangedCount}</span>}
                            </div>
                          </div>

                          {/* HP bar (only if damaged) */}
                          {isDamaged && (
                            <div className="mt-1 ml-3.5 h-[2px] rounded-full bg-slate-700 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  hpPct > 60 ? 'bg-emerald-500' : hpPct > 30 ? 'bg-amber-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${hpPct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Garrison armies are auto-deployed and appear in the deployed list above */}

                {/* Empty state */}
                {deployedBanners.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-500 italic">No armies available</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Recent events toast (last 3 entries, compact) */}
        {expeditionLog.length > 0 && (
          <div
            className="absolute left-3 bottom-10 bg-slate-900/90 border border-slate-600/40 rounded-lg px-2 py-1.5 z-30 max-w-[260px] backdrop-blur-sm"
            style={{ pointerEvents: 'none' }}
          >
            {expeditionLog.slice(0, 3).map(entry => {
              const icon: Record<string, string> = { hostile_detected: '👁️', battle_resolved: '⚔️', army_destroyed: '💀', mission_completed: '⭐', mission_failed: '❌', fortress_attacked: '🏰', fortress_damaged: '🏚️' };
              const color: Record<string, string> = { hostile_detected: 'text-red-400', battle_resolved: 'text-amber-300', army_destroyed: 'text-red-500', mission_completed: 'text-emerald-400', mission_failed: 'text-orange-400', fortress_attacked: 'text-red-400', fortress_damaged: 'text-red-500' };
              return (
                <div key={entry.id} className="flex items-center gap-1 text-[9px] leading-snug">
                  <span className="text-slate-600">T{entry.turn}</span>
                  <span>{icon[entry.type] || '•'}</span>
                  <span className={`truncate ${color[entry.type] || 'text-slate-400'}`}>{entry.text}</span>
                  {entry.provinceId && (
                    <button onClick={(e) => { e.stopPropagation(); focusProvince(entry.provinceId!); }} style={{ pointerEvents: 'auto' }} className="text-blue-400 hover:text-blue-300 shrink-0" title="Go to province">📍</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Controls hint */}
        <div className="absolute bottom-3 left-3 text-xs text-slate-500 bg-slate-900/80 px-2 py-1 rounded pointer-events-none">
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

        {/* ══ Turn Transition Banner ══ */}
        {turnBanner !== null && (
          <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center">
            <div
              className="flex flex-col items-center"
              style={{
                animation: 'turnBannerIn 0.4s ease-out forwards, turnBannerOut 0.6s ease-in 1.6s forwards',
              }}
            >
              {/* Horizontal rule left */}
              <div className="flex items-center gap-4 mb-1">
                <div className="w-24 h-px bg-gradient-to-r from-transparent via-amber-500/60 to-amber-500/80" />
                <span className="text-amber-500/70 text-xs tracking-[0.3em] uppercase font-semibold">
                  ⚔
                </span>
                <div className="w-24 h-px bg-gradient-to-l from-transparent via-amber-500/60 to-amber-500/80" />
              </div>
              {/* Main turn text */}
              <div
                className="text-3xl font-bold tracking-widest uppercase"
                style={{
                  color: '#E8D44D',
                  textShadow: '0 0 20px rgba(232,212,77,0.4), 0 2px 8px rgba(0,0,0,0.8)',
                  fontFamily: 'Georgia, serif',
                  letterSpacing: '0.15em',
                }}
              >
                Turn {turnBanner}
              </div>
              {/* Horizontal rule right */}
              <div className="flex items-center gap-4 mt-1">
                <div className="w-24 h-px bg-gradient-to-r from-transparent via-amber-500/60 to-amber-500/80" />
                <span className="text-amber-500/70 text-xs tracking-[0.3em] uppercase font-semibold">
                  ⚔
                </span>
                <div className="w-24 h-px bg-gradient-to-l from-transparent via-amber-500/60 to-amber-500/80" />
              </div>
            </div>
          </div>
        )}

        {/* ══ Battle Outcome Popup ══ */}
        {currentBattlePopup && (() => {
          const fb = currentBattlePopup;
          const isVictory = fb.outcome === 'player_wins';
          const isDefeat = fb.outcome === 'enemy_wins';
          const pAll = (fb as any).playerArmies || [(fb as any).playerArmy];
          const eAll = (fb as any).enemyArmies || [(fb as any).enemyArmy];
          const pInit = pAll.reduce((s: number, a: any) => s + (a?.initialTroops || 0), 0);
          const pFinal = pAll.reduce((s: number, a: any) => s + (a?.finalTroops || 0), 0);
          const eInit = eAll.reduce((s: number, a: any) => s + (a?.initialTroops || 0), 0);
          const eFinal = eAll.reduce((s: number, a: any) => s + (a?.finalTroops || 0), 0);
          const pLost = pInit - pFinal;
          const eLost = eInit - eFinal;
          const pPct = pInit > 0 ? pLost / pInit : 0;
          const ePct = eInit > 0 ? eLost / eInit : 0;
          const sevClass = (pct: number, dead: boolean) => dead ? 'text-red-500' : pct > 0.3 ? 'text-red-400' : pct > 0.1 ? 'text-amber-400' : 'text-emerald-400';

          // Theme
          const icon = isVictory ? '⚔️' : isDefeat ? '💀' : '⚖️';
          const title = isVictory ? 'V I C T O R Y' : isDefeat ? 'D E F E A T' : 'S T A L E M A T E';
          const titleColor = isVictory ? 'text-amber-400' : isDefeat ? 'text-red-400' : 'text-amber-500';
          const borderColor = isVictory ? 'border-amber-500/70' : isDefeat ? 'border-red-600/70' : 'border-amber-600/70';
          const bgGradient = isVictory
            ? 'bg-gradient-to-b from-emerald-950/95 via-slate-900/95 to-slate-900/95'
            : isDefeat
            ? 'bg-gradient-to-b from-red-950/95 via-slate-900/95 to-slate-900/95'
            : 'bg-gradient-to-b from-amber-950/95 via-slate-900/95 to-slate-900/95';
          const btnClass = isVictory
            ? 'bg-amber-600 hover:bg-amber-500 text-amber-950 border-amber-400/50'
            : isDefeat
            ? 'bg-red-700 hover:bg-red-600 text-red-100 border-red-500/50'
            : 'bg-amber-700 hover:bg-amber-600 text-amber-100 border-amber-500/50';
          const shadowStyle = isVictory
            ? { boxShadow: '0 0 40px rgba(234,179,8,0.3)' }
            : isDefeat
            ? { boxShadow: '0 0 40px rgba(239,68,68,0.3)' }
            : { boxShadow: '0 0 30px rgba(245,158,11,0.2)' };

          // Battle name — use enemy name or province
          const battleName = eAll[0]?.enemyName || `Province ${fb.provinceId?.replace('prov_', '')}`;

          return (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 pointer-events-none">
              <div
                className={`${bgGradient} border-2 ${borderColor} rounded-xl p-6 text-center max-w-md pointer-events-auto backdrop-blur-sm`}
                style={shadowStyle}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
              >
                {/* Icon */}
                <div className="text-5xl mb-2">{icon}</div>

                {/* Title */}
                <div className={`${titleColor} font-bold text-2xl tracking-[0.25em] uppercase mb-1`}>{title}</div>

                {/* Battle name */}
                <div className="text-slate-400 text-sm italic mb-4">&ldquo;{battleName}&rdquo;</div>

                {/* Force summary — 2 columns */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-blue-950/30 border border-blue-900/40 rounded-lg p-3">
                    <div className="text-[9px] text-blue-400 uppercase font-bold mb-1">Your Forces</div>
                    <div className="text-lg font-bold text-slate-200">{Math.round(pInit)} → {Math.round(pFinal)}</div>
                    <div className={`text-sm font-semibold ${sevClass(pPct, pFinal <= 0)}`}>
                      (-{Math.round(pLost)}) {pFinal <= 0 && '💀'}
                    </div>
                    <div className={`text-[10px] mt-0.5 ${sevClass(pPct, pFinal <= 0)}`}>
                      {pFinal <= 0 ? 'Annihilated' : `${Math.round(pPct * 100)}% losses`}
                    </div>
                  </div>
                  <div className="bg-red-950/30 border border-red-900/40 rounded-lg p-3">
                    <div className="text-[9px] text-red-400 uppercase font-bold mb-1">Enemy Forces</div>
                    <div className="text-lg font-bold text-slate-200">{Math.round(eInit)} → {Math.round(eFinal)}</div>
                    <div className={`text-sm font-semibold ${sevClass(ePct, eFinal <= 0)}`}>
                      (-{Math.round(eLost)}) {eFinal <= 0 && '💀'}
                    </div>
                    <div className={`text-[10px] mt-0.5 ${sevClass(ePct, eFinal <= 0)}`}>
                      {eFinal <= 0 ? 'Eliminated' : `${Math.round(ePct * 100)}% losses`}
                    </div>
                  </div>
                </div>

                {/* Per-army rows (if multi-army) */}
                {pAll.length > 1 && (
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded px-3 py-2 mb-3 text-[10px]">
                    {pAll.map((a: any, i: number) => {
                      const aLost = (a?.initialTroops || 0) - (a?.finalTroops || 0);
                      const aPct = a?.initialTroops > 0 ? aLost / a.initialTroops : 0;
                      return (
                        <div key={i} className="flex justify-between py-0.5">
                          <span className="text-slate-300 truncate">⚔️ {a?.bannerName || `Army ${i + 1}`}</span>
                          <span className={sevClass(aPct, a?.finalTroops <= 0)}>
                            {Math.round(a?.initialTroops || 0)} → {Math.round(a?.finalTroops || 0)} (-{Math.round(aLost)})
                            {a?.finalTroops <= 0 && ' 💀'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Destroyed army callouts */}
                {pAll.filter((a: any) => a?.finalTroops <= 0).map((a: any, i: number) => (
                  <div key={`d${i}`} className="inline-block mb-2 mr-1 text-[10px] px-2 py-1 bg-red-950/60 border border-red-800 rounded text-red-400 font-bold">
                    💀 {a?.bannerName || 'Army'} destroyed
                  </div>
                ))}

                {/* Continue button */}
                <div className="mt-3">
                  <button
                    onClick={() => setBattlePopupQueue(prev => prev.slice(1))}
                    className={`px-8 py-2.5 ${btnClass} font-bold rounded-lg border transition-colors text-sm tracking-wide`}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ══ Siege Battle Outcome Popup ══ */}
        {currentSiegePopup && (() => {
          const s = currentSiegePopup;
          const isHeld = s.outcome === 'fortress_holds_walls' || s.outcome === 'fortress_holds_inner';
          const isFallen = s.outcome === 'fortress_falls';
          const totalDef = (s.initialGarrison?.warriors || 0) + (s.initialGarrison?.archers || 0);
          const defLost = totalDef - (s.finalDefenders || 0);
          const atkLost = (s.initialAttackers || 0) - (s.finalAttackers || 0);
          const defPct = totalDef > 0 ? defLost / totalDef : 0;
          const atkPct = s.initialAttackers > 0 ? atkLost / s.initialAttackers : 0;
          const sevClass = (pct: number, dead: boolean) => dead ? 'text-red-500' : pct > 0.3 ? 'text-red-400' : pct > 0.1 ? 'text-amber-400' : 'text-emerald-400';

          const icon = isHeld ? '🏰' : '💀';
          const title = isHeld ? 'V I C T O R Y' : isFallen ? 'D E F E A T' : 'D R A W';
          const titleColor = isHeld ? 'text-emerald-400' : 'text-red-400';
          const borderColor = isHeld ? 'border-emerald-500/70' : 'border-red-600/70';
          const bgGradient = isHeld
            ? 'bg-gradient-to-b from-emerald-950/95 via-slate-900/95 to-slate-900/95'
            : 'bg-gradient-to-b from-red-950/95 via-slate-900/95 to-slate-900/95';
          const btnClass = isHeld
            ? 'bg-emerald-600 hover:bg-emerald-500 text-emerald-950 border-emerald-400/50'
            : 'bg-red-700 hover:bg-red-600 text-red-100 border-red-500/50';
          const shadowStyle = isHeld
            ? { boxShadow: '0 0 40px rgba(16,185,129,0.3)' }
            : { boxShadow: '0 0 40px rgba(239,68,68,0.3)' };

          return (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 pointer-events-none">
              <div
                className={`${bgGradient} border-2 ${borderColor} rounded-xl p-6 text-center max-w-md pointer-events-auto backdrop-blur-sm`}
                style={shadowStyle}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
              >
                <div className="text-5xl mb-2">{icon}</div>
                <div className={`${titleColor} font-bold text-2xl tracking-[0.2em] uppercase mb-1`}>{title}</div>
                <div className="text-slate-400 text-sm italic mb-4">Attacked by &ldquo;{s.enemyName}&rdquo;</div>

                {/* Force summary */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-red-950/30 border border-red-900/40 rounded-lg p-3">
                    <div className="text-[9px] text-red-400 uppercase font-bold mb-1">Attackers</div>
                    <div className="text-lg font-bold text-slate-200">{Math.round(s.initialAttackers)} → {Math.round(s.finalAttackers)}</div>
                    <div className={`text-sm font-semibold ${sevClass(atkPct, s.finalAttackers <= 0)}`}>
                      (-{Math.round(atkLost)}) {s.finalAttackers <= 0 && '💀'}
                    </div>
                  </div>
                  <div className="bg-blue-950/30 border border-blue-900/40 rounded-lg p-3">
                    <div className="text-[9px] text-blue-400 uppercase font-bold mb-1">Garrison</div>
                    <div className="text-lg font-bold text-slate-200">{Math.round(totalDef)} → {Math.round(s.finalDefenders)}</div>
                    <div className={`text-sm font-semibold ${sevClass(defPct, s.finalDefenders <= 0)}`}>
                      (-{Math.round(defLost)}) {s.finalDefenders <= 0 && '💀'}
                    </div>
                  </div>
                </div>

                {/* Wall HP */}
                <div className="bg-slate-800/40 border border-slate-700/40 rounded px-3 py-2 mb-3 text-[11px]">
                  <span className="text-slate-400">🧱 Wall HP: </span>
                  <span className="text-white font-semibold">{s.initialFortHP}</span>
                  <span className="text-slate-500"> → </span>
                  <span className={s.finalFortHP <= 0 ? 'text-red-400 font-semibold' : 'text-white font-semibold'}>{s.finalFortHP}</span>
                  {s.finalFortHP <= 0 && <span className="text-red-400 ml-1">(breached)</span>}
                  <span className="text-slate-500 ml-2">· {s.siegeRounds} rounds</span>
                </div>

                {/* Per-garrison army rows */}
                {s.garrisonArmies && s.garrisonArmies.length > 1 && (
                  <div className="bg-blue-950/30 border border-blue-800/30 rounded px-3 py-2 mb-3 text-[10px]">
                    <div className="text-[9px] text-blue-300 uppercase font-bold mb-1">Garrison Armies</div>
                    {s.garrisonArmies.map((a: any, i: number) => {
                      const lost = a.initialTroops - a.finalTroops;
                      const pct = a.initialTroops > 0 ? lost / a.initialTroops : 0;
                      return (
                        <div key={i} className="flex justify-between py-0.5">
                          <span className="text-slate-300 truncate">⚔️ {a.bannerName}</span>
                          <span className={sevClass(pct, a.finalTroops <= 0)}>
                            {Math.round(a.initialTroops)} → {Math.round(a.finalTroops)} (-{Math.round(lost)})
                            {a.finalTroops <= 0 && ' 💀'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {s.finalAttackers <= 0 && (
                  <div className="inline-block mb-2 text-[10px] px-2 py-1 bg-emerald-950/60 border border-emerald-800 rounded text-emerald-400 font-bold">
                    ☠ Siege force eliminated
                  </div>
                )}

                <div className="mt-3">
                  <button
                    onClick={() => setBattlePopupQueue(prev => prev.slice(1))}
                    className={`px-8 py-2.5 ${btnClass} font-bold rounded-lg border transition-colors text-sm tracking-wide`}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Expedition Mission Reward Popup */}
        {rewardPopupMission && rewardPopupMission.rewards && battlePopupQueue.length === 0 && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none">
            <div
              className="bg-slate-900/95 border-2 border-purple-500 rounded-xl p-6 text-center max-w-sm pointer-events-auto shadow-2xl backdrop-blur-sm"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="text-4xl mb-3">⭐</div>
              <div className="text-purple-300 font-bold text-xl mb-1">Mission Complete!</div>
              <div className="text-slate-300 text-sm mb-2">&ldquo;{rewardPopupMission.name}&rdquo;</div>
              {rewardPopupMission.fieldBattleResult && (() => {
                const fb = rewardPopupMission.fieldBattleResult;
                const pInit = (fb.playerArmies || [fb.playerArmy]).reduce((s: number, a: any) => s + a.initialTroops, 0);
                const pFinal = (fb.playerArmies || [fb.playerArmy]).reduce((s: number, a: any) => s + a.finalTroops, 0);
                const eInit = (fb.enemyArmies || [fb.enemyArmy]).reduce((s: number, a: any) => s + a.initialTroops, 0);
                return (
                  <div className="bg-emerald-950/40 border border-emerald-800/40 rounded px-3 py-2 mb-3 text-[11px]">
                    <div className="text-emerald-400 font-bold mb-1">⚔️ Battle Victory</div>
                    <div className="text-slate-300">Your forces: {Math.round(pInit)} → {Math.round(pFinal)} <span className="text-red-400">(-{Math.round(pInit - pFinal)})</span></div>
                    <div className="text-slate-300">Enemy forces: {Math.round(eInit)} → 0 <span className="text-red-400">(-{Math.round(eInit)})</span></div>
                  </div>
                );
              })()}

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
