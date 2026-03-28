// ============================================================================
// Zundral — BattleChart Canvas Components
// Canvas-based visualisations for battle results and siege battles.
// Extracted from ResourceVillageUI.tsx — props-only, no game state.
// ============================================================================

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { BattleResult, SiegeRound, InnerBattleStep } from '../types';

function BattleChart({ timeline }: { timeline: BattleResult['timeline'] }) {
  const troopsCanvasRef = useRef<HTMLCanvasElement>(null);
  const moraleCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: Array<{ label: string; value: string; color: string }>;
    phase: string;
    tick: number;
  } | null>(null);
  const [hoveredTick, setHoveredTick] = useState<number | null>(null);
  const graphDataRef = useRef<{
    PAD: { top: number; left: number; right: number; bottom: number };
    plotW: number;
    plotH: number;
    N: number;
    mapX: (i: number) => number;
    A_morale: number[];
    B_morale: number[];
    A_troops: number[];
    B_troops: number[];
  } | null>(null);

  // ── Compute phase bands once ──
  const bands = useMemo(() => {
    if (!timeline.length) return [];
    const result: Array<{ phase: string; startIdx: number; endIdx: number }> = [];
    let start = 0;
    let cur = timeline[0].phase;
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].phase !== cur) {
        result.push({ phase: cur, startIdx: start, endIdx: i - 1 });
        start = i;
        cur = timeline[i].phase;
      }
    }
    result.push({ phase: cur, startIdx: start, endIdx: timeline.length - 1 });
    return result;
  }, [timeline]);

  // ── Per-phase stats — always show all 3 canonical phases ──
  // If timeline contains 'last_stand', show that instead of 'pursuit'
  const hasLastStand = useMemo(() => timeline.some(t => t.phase === 'last_stand'), [timeline]);
  const CANONICAL_PHASES = hasLastStand
    ? ['skirmish', 'melee', 'last_stand'] as const
    : ['skirmish', 'melee', 'pursuit'] as const;

  const phaseStats = useMemo(() => {
    if (!timeline.length) return [];

    // Build a map from actual bands
    const bandMap = new Map<string, { startIdx: number; endIdx: number }>();
    for (const b of bands) bandMap.set(b.phase, { startIdx: b.startIdx, endIdx: b.endIdx });

    return CANONICAL_PHASES.map(phase => {
      const band = bandMap.get(phase);
      if (band) {
        const sA = timeline[band.startIdx].A_troops;
        const eA = timeline[band.endIdx].A_troops;
        const sB = timeline[band.startIdx].B_troops;
        const eB = timeline[band.endIdx].B_troops;
        return {
          phase,
          ticks: band.endIdx - band.startIdx + 1,
          skipped: false,
          playerStart: Math.round(sA),
          playerEnd: Math.round(eA),
          playerLost: Math.round(sA - eA),
          enemyStart: Math.round(sB),
          enemyEnd: Math.round(eB),
          enemyLost: Math.round(sB - eB),
        };
      }
      // Phase didn't happen — skipped
      return {
        phase,
        ticks: 0,
        skipped: true,
        playerStart: 0, playerEnd: 0, playerLost: 0,
        enemyStart: 0, enemyEnd: 0, enemyLost: 0,
      };
    });
  }, [timeline, bands]);

  // ── Phase colors ──
  const phaseColor = (ph: string) => {
    if (ph === 'skirmish') return { bg: 'rgba(56,189,248,0.10)', border: 'rgba(56,189,248,0.3)', text: '#7dd3fc' };
    if (ph === 'pursuit') return { bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.3)', text: '#fca5a5' };
    if (ph === 'last_stand') return { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.3)', text: '#fbbf24' };
    return { bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)', text: '#94a3b8' };
  };

  const phaseIcon = (ph: string) => {
    if (ph === 'skirmish') return '\u2694'; // ⚔
    if (ph === 'melee') return '\u2694';
    if (ph === 'pursuit') return '\u{1F3C3}'; // 🏃
    if (ph === 'last_stand') return '\u{1F6E1}'; // 🛡
    return '';
  };

  // ── Draw troops chart ──
  useEffect(() => {
    const canvas = troopsCanvasRef.current;
    if (!canvas || !timeline.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = 2;
    const w = canvas.width = canvas.clientWidth * dpr;
    const h = canvas.height = canvas.clientHeight * dpr;
    ctx.clearRect(0, 0, w, h);

    const PAD = { top: 32, bottom: 8, left: 52, right: 16 };
    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const N = timeline.length;

    const A_troops = timeline.map(r => r.A_troops);
    const B_troops = timeline.map(r => r.B_troops);
    const tMax = Math.max(...A_troops, ...B_troops, 1);

    const mapX = (i: number) => PAD.left + (i / (N - 1 || 1)) * plotW;
    const mapY = (v: number) => PAD.top + plotH - (v / tMax) * plotH;

    // Store for tooltip
    graphDataRef.current = {
      PAD, plotW, plotH, N, mapX,
      A_morale: timeline.map(r => r.A_morale),
      B_morale: timeline.map(r => r.B_morale),
      A_troops, B_troops
    };

    // Background
    ctx.fillStyle = '#0c1018';
    ctx.fillRect(0, 0, w, h);

    // Phase bands
    for (const b of bands) {
      const x0 = mapX(b.startIdx);
      const x1 = mapX(b.endIdx);
      const pc = phaseColor(b.phase);
      ctx.fillStyle = pc.bg;
      ctx.fillRect(x0, PAD.top, Math.max(1, x1 - x0), plotH);
      // Phase separator
      if (b.startIdx > 0) {
        ctx.strokeStyle = pc.border;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x0, PAD.top);
        ctx.lineTo(x0, PAD.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Phase label at top
      const cx = x0 + (x1 - x0) / 2;
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = pc.text;
      ctx.globalAlpha = 0.7;
      ctx.fillText(b.phase.charAt(0).toUpperCase() + b.phase.slice(1), cx, PAD.top + 6);
      ctx.globalAlpha = 1;
    }

    // Grid lines (horizontal)
    const gridCount = 4;
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridCount; i++) {
      const v = Math.round(tMax * i / gridCount);
      const y = mapY(v);
      ctx.strokeStyle = 'rgba(148,163,184,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(shortNum(v), PAD.left - 8, y);
    }

    // Area fill helper
    const drawArea = (arr: number[], color: string, alpha: number) => {
      if (arr.length < 2) return;
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(arr[0]));
      for (let i = 1; i < arr.length; i++) ctx.lineTo(mapX(i), mapY(arr[i]));
      ctx.lineTo(mapX(arr.length - 1), PAD.top + plotH);
      ctx.lineTo(mapX(0), PAD.top + plotH);
      ctx.closePath();
      ctx.fill();
    };

    // Line helper
    const drawLine = (arr: number[], color: string, lw: number) => {
      if (arr.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(arr[0]));
      for (let i = 1; i < arr.length; i++) ctx.lineTo(mapX(i), mapY(arr[i]));
      ctx.stroke();
    };

    // Draw areas then lines
    drawArea(A_troops, '#38bdf8', 0.12);
    drawArea(B_troops, '#f87171', 0.12);
    drawLine(A_troops, '#38bdf8', 4);
    drawLine(B_troops, '#f87171', 4);

    // Hover guideline
    if (hoveredTick !== null && hoveredTick >= 0 && hoveredTick < N) {
      const gx = mapX(hoveredTick);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(gx, PAD.top);
      ctx.lineTo(gx, PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      // Dots
      const dotR = 6;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(gx, mapY(A_troops[hoveredTick]), dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0c1018';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.arc(gx, mapY(B_troops[hoveredTick]), dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0c1018';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD.left, PAD.top, plotW, plotH);

  }, [timeline, hoveredTick, bands]);

  // ── Draw morale chart ──
  useEffect(() => {
    const canvas = moraleCanvasRef.current;
    if (!canvas || !timeline.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = 2;
    const w = canvas.width = canvas.clientWidth * dpr;
    const h = canvas.height = canvas.clientHeight * dpr;
    ctx.clearRect(0, 0, w, h);

    const PAD = { top: 12, bottom: 8, left: 52, right: 16 };
    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const N = timeline.length;

    const A_morale = timeline.map(r => r.A_morale);
    const B_morale = timeline.map(r => r.B_morale);
    const mMax = Math.max(...A_morale, ...B_morale, 1);

    const mapX = (i: number) => PAD.left + (i / (N - 1 || 1)) * plotW;
    const mapY = (v: number) => PAD.top + plotH - (v / mMax) * plotH;

    // Background
    ctx.fillStyle = '#0c1018';
    ctx.fillRect(0, 0, w, h);

    // Phase bands (sync with troops chart)
    for (const b of bands) {
      const x0 = mapX(b.startIdx);
      const x1 = mapX(b.endIdx);
      const pc = phaseColor(b.phase);
      ctx.fillStyle = pc.bg;
      ctx.fillRect(x0, PAD.top, Math.max(1, x1 - x0), plotH);
      if (b.startIdx > 0) {
        ctx.strokeStyle = pc.border;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x0, PAD.top);
        ctx.lineTo(x0, PAD.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Grid
    const gridCount = 3;
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridCount; i++) {
      const v = Math.round(mMax * i / gridCount);
      const y = mapY(v);
      ctx.strokeStyle = 'rgba(148,163,184,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(shortNum(v), PAD.left - 8, y);
    }

    // Morale break threshold line (35% of initial morale)
    const initialPlayerMorale = A_morale[0] || 0;
    const initialEnemyMorale = B_morale[0] || 0;
    const breakThreshold = Math.min(initialPlayerMorale, initialEnemyMorale) * 0.35;
    if (breakThreshold > 0) {
      const by = mapY(breakThreshold);
      ctx.strokeStyle = 'rgba(251,191,36,0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, by);
      ctx.lineTo(PAD.left + plotW, by);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.fillText('BREAK', PAD.left + 6, by - 6);
    }

    // Line helper
    const drawLine = (arr: number[], color: string, lw: number, dashed?: boolean) => {
      if (arr.length < 2) return;
      if (dashed) ctx.setLineDash([6, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(arr[0]));
      for (let i = 1; i < arr.length; i++) ctx.lineTo(mapX(i), mapY(arr[i]));
      ctx.stroke();
      if (dashed) ctx.setLineDash([]);
    };

    drawLine(A_morale, '#7dd3fc', 3);
    drawLine(B_morale, '#fbbf24', 3);

    // Hover guideline
    if (hoveredTick !== null && hoveredTick >= 0 && hoveredTick < N) {
      const gx = mapX(hoveredTick);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(gx, PAD.top);
      ctx.lineTo(gx, PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      // Dots
      const dotR = 5;
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(gx, mapY(A_morale[hoveredTick]), dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0c1018';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(gx, mapY(B_morale[hoveredTick]), dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0c1018';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD.left, PAD.top, plotW, plotH);

  }, [timeline, hoveredTick, bands]);

  // ── Unified mouse handler (works on both canvases) ──
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const container = containerRef.current;
    const data = graphDataRef.current;
    if (!container || !data || !timeline.length) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const dpr = 2;

    // Convert to canvas coords using troops chart layout
    const canvasX = mouseX * dpr;
    const plotLeft = data.PAD.left;
    const plotRight = data.PAD.left + data.plotW;

    if (canvasX < plotLeft || canvasX > plotRight) {
      setHoveredTick(null);
      setTooltip(null);
      return;
    }

    // Find closest index
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < data.N; i++) {
      const x = data.mapX(i);
      const dist = Math.abs(canvasX - x);
      if (dist < minDist) { minDist = dist; closestIdx = i; }
    }

    if (minDist > 40) {
      setHoveredTick(null);
      setTooltip(null);
      return;
    }

    setHoveredTick(closestIdx);

    const phase = timeline[closestIdx].phase;
    const tooltipData: Array<{ label: string; value: string; color: string }> = [
      { label: 'Your Troops', value: Math.round(data.A_troops[closestIdx]).toString(), color: '#38bdf8' },
      { label: 'Enemy Troops', value: Math.round(data.B_troops[closestIdx]).toString(), color: '#f87171' },
      { label: 'Your Morale', value: Math.round(data.A_morale[closestIdx]).toString(), color: '#7dd3fc' },
      { label: 'Enemy Morale', value: Math.round(data.B_morale[closestIdx]).toString(), color: '#fbbf24' },
    ];

    // Position tooltip to the right of cursor, flip if near right edge
    let tx = mouseX + 14;
    if (tx + 180 > rect.width) tx = mouseX - 190;

    setTooltip({
      visible: true,
      x: tx,
      y: e.clientY - rect.top,
      data: tooltipData,
      phase,
      tick: closestIdx + 1
    });
  };

  const handleMouseLeave = () => {
    setHoveredTick(null);
    setTooltip(null);
  };

  // Summary stats
  const firstTick = timeline[0];
  const lastTick = timeline[timeline.length - 1];
  const playerLost = firstTick ? Math.round(firstTick.A_troops - lastTick.A_troops) : 0;
  const enemyLost = firstTick ? Math.round(firstTick.B_troops - lastTick.B_troops) : 0;

  return (
    <div ref={containerRef} className="relative space-y-0">
      {/* ── Phase Breakdown Header ── */}
      <div className="bg-slate-900/80 border border-slate-700/60 rounded-t-lg overflow-hidden">
        {/* Title row + total summary */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700/40">
          <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">Battle Timeline</span>
          <div className="flex items-center gap-4 text-[10px]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-sky-400 inline-block" />
              <span className="text-sky-300">You: {firstTick ? Math.round(firstTick.A_troops) : 0}</span>
              <span className="text-slate-500">{'\u2192'}</span>
              <span className="text-sky-300">{lastTick ? Math.round(lastTick.A_troops) : 0}</span>
              {playerLost > 0 && <span className="text-red-400 font-semibold">({'\u25BC'}{playerLost})</span>}
            </span>
            <span className="text-slate-700">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />
              <span className="text-red-300">Foe: {firstTick ? Math.round(firstTick.B_troops) : 0}</span>
              <span className="text-slate-500">{'\u2192'}</span>
              <span className="text-red-300">{lastTick ? Math.round(lastTick.B_troops) : 0}</span>
              {enemyLost > 0 && <span className="text-red-400 font-semibold">({'\u25BC'}{enemyLost})</span>}
            </span>
          </div>
        </div>
        {/* Phase cards row — always shows all 3 phases */}
        {phaseStats.length > 0 && (
          <div className="flex">
            {phaseStats.map((ps, i) => {
              const pc = phaseColor(ps.phase);
              const phaseName = ps.phase === 'melee' ? 'Battle' : ps.phase === 'last_stand' ? 'Last Stand' : ps.phase.charAt(0).toUpperCase() + ps.phase.slice(1);
              return (
                <div
                  key={i}
                  className="flex-1 px-2.5 py-1.5 text-[10px] leading-tight"
                  style={{
                    background: ps.skipped ? 'rgba(51,65,85,0.35)' : pc.bg,
                    borderRight: i < phaseStats.length - 1 ? `1px solid ${ps.skipped ? 'rgba(100,116,139,0.4)' : pc.border}` : undefined,
                  }}
                >
                  {/* Phase name + duration */}
                  <div className="flex items-center gap-1 mb-0.5">
                    <span style={{ color: ps.skipped ? '#94a3b8' : pc.text }} className="font-bold">
                      {phaseIcon(ps.phase)} {phaseName}
                    </span>
                    {ps.skipped
                      ? <span className="text-amber-400/80 font-semibold text-[9px]">-- DID NOT OCCUR --</span>
                      : <span className="text-slate-500">({ps.ticks})</span>
                    }
                  </div>
                  {ps.skipped ? (
                    <div className="text-slate-400 text-[9px] mt-0.5">Army morale broke before this phase</div>
                  ) : (
                    <>
                      {/* Player losses */}
                      <div className="flex items-center gap-1">
                        <span className="text-sky-400/70 w-[22px]">You:</span>
                        <span className="text-sky-300">{ps.playerStart}{'\u2192'}{ps.playerEnd}</span>
                        {ps.playerLost > 0
                          ? <span className="text-red-400 font-semibold">{'\u25BC'}{ps.playerLost}</span>
                          : <span className="text-slate-600">{'\u2014'}</span>
                        }
                      </div>
                      {/* Enemy losses */}
                      <div className="flex items-center gap-1">
                        <span className="text-red-400/70 w-[22px]">Foe:</span>
                        <span className="text-red-300">{ps.enemyStart}{'\u2192'}{ps.enemyEnd}</span>
                        {ps.enemyLost > 0
                          ? <span className="text-red-400 font-semibold">{'\u25BC'}{ps.enemyLost}</span>
                          : <span className="text-slate-600">{'\u2014'}</span>
                        }
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Troops canvas */}
      <canvas
        ref={troopsCanvasRef}
        className="w-full h-[180px] bg-[#0c1018] cursor-crosshair"
        style={{ imageRendering: 'auto', display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />

      {/* Morale label bar */}
      <div className="flex items-center gap-4 px-2 py-1 bg-slate-900/80 border-x border-slate-700/60 text-[11px]">
        <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">Morale</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-[3px] rounded-full bg-sky-300 inline-block" />
          <span className="text-sky-200">Your Morale</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-[3px] rounded-full bg-amber-400 inline-block" />
          <span className="text-amber-200">Enemy Morale</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-[2px] border-t border-dashed border-amber-500/60 inline-block" />
          <span className="text-amber-400/60">Break threshold</span>
        </span>
      </div>

      {/* Morale canvas */}
      <canvas
        ref={moraleCanvasRef}
        className="w-full h-[100px] bg-[#0c1018] rounded-b-lg cursor-crosshair"
        style={{ imageRendering: 'auto', display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />

      {/* Tooltip */}
      {tooltip && tooltip.visible && (
        <div
          className="absolute pointer-events-none z-50 bg-slate-900/95 border border-slate-600/80 rounded-lg shadow-2xl backdrop-blur-sm"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y - 8}px`,
            transform: 'translateY(-100%)',
            minWidth: 170
          }}
        >
          <div className="px-2.5 py-1.5 border-b border-slate-700/60 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tick {tooltip.tick}</span>
            <span className="text-[10px] font-semibold" style={{ color: phaseColor(tooltip.phase).text }}>
              {tooltip.phase.charAt(0).toUpperCase() + tooltip.phase.slice(1)}
            </span>
          </div>
          <div className="px-2.5 py-1.5 space-y-1">
            {tooltip.data.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span className="text-slate-400">{item.label}</span>
                </span>
                <span className="text-white font-bold tabular-nums">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared graph helpers ──────────────────────────────────────────────────

/** Format a number as short label: 1200 → "1.2K", 50 → "50" */
function shortNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toString();
}

/** Generate nice Y-axis tick values (0, max/4, max/2, 3max/4, max) */
function yTicks(max: number, count = 5): number[] {
  if (max <= 0) return [0];
  const step = max / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

/** Draw horizontal grid lines with Y-axis tick labels */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  ticks: number[],
  max: number,
  left: number, top: number, right: number, bottom: number,
  color: string,
  labelColor: string
) {
  const plotH = bottom - top;
  ctx.font = '18px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  ticks.forEach(v => {
    const y = bottom - (v / max) * plotH;
    // Grid line
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle = labelColor;
    ctx.fillText(shortNum(v), left - 6, y);
  });
}

/** Draw X-axis tick labels */
function drawXTicks(
  ctx: CanvasRenderingContext2D,
  values: number[],
  mapX: (v: number) => number,
  bottom: number,
  label: string,
  color: string,
  maxTicks = 10
) {
  const step = Math.max(1, Math.ceil(values.length / maxTicks));
  ctx.font = '18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;

  values.forEach((v, i) => {
    if (i % step === 0 || i === values.length - 1) {
      ctx.fillText(String(v), mapX(v), bottom + 4);
    }
  });

  // X-axis label
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(label, (mapX(values[0]) + mapX(values[values.length - 1])) / 2, bottom + 24);
}

/** Draw title centered at the top */
function drawTitle(ctx: CanvasRenderingContext2D, title: string, w: number, y: number) {
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#cbd5e1'; // slate-300
  ctx.fillText(title, w / 2, y);
}

/** Draw legend items horizontally centered */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  items: Array<{ label: string; color: string; dashed?: boolean }>,
  centerX: number, y: number
) {
  ctx.font = '18px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  // Measure total width
  const itemWidths = items.map(item => {
    return 20 + 6 + ctx.measureText(item.label).width + 16; // swatch + gap + text + spacing
  });
  const totalW = itemWidths.reduce((a, b) => a + b, 0) - 16;
  let x = centerX - totalW / 2;

  items.forEach((item, i) => {
    // Swatch
    if (item.dashed) {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 20, y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = item.color;
      ctx.fillRect(x, y - 5, 20, 10);
    }
    // Text
    ctx.fillStyle = '#94a3b8'; // slate-400
    ctx.textAlign = 'left';
    ctx.fillText(item.label, x + 26, y);
    x += itemWidths[i];
  });
}

/** Draw a data line with optional area fill and dot markers */
function drawDataLine(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  color: string,
  opts?: { fill?: boolean; dashed?: boolean; lineWidth?: number }
) {
  if (points.length === 0) return;
  const lw = opts?.lineWidth ?? 2.5;

  if (opts?.dashed) ctx.setLineDash([6, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
  ctx.stroke();
  if (opts?.dashed) ctx.setLineDash([]);

  // Area fill
  if (opts?.fill && points.length > 1) {
    const bottom = Math.max(...points.map(p => p.y)) + 50; // approximate bottom
    ctx.fillStyle = color.replace(')', ', 0.08)').replace('rgb(', 'rgba(');
    // Use hex to rgba
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.08)`;
    ctx.beginPath();
    points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
    ctx.lineTo(points[points.length - 1].x, bottom);
    ctx.lineTo(points[0].x, bottom);
    ctx.closePath();
    ctx.fill();
  }

  // Dot markers
  points.forEach(p => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}


// ── Siege Graph ───────────────────────────────────────────────────────────

function drawSiegeGraph(canvas: HTMLCanvasElement, timeline: SiegeRound[], fortHPmax: number, graphDataRef?: React.MutableRefObject<any>, hoveredRound?: number | null, initialGarrison?: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, w, h);
  if (!timeline.length) return;

  // Layout
  const PAD = { top: 58, bottom: 54, left: 70, right: 20 };
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;

  // Data ranges — use a unified max so both lines share the same scale
  const maxHP = fortHPmax;
  const maxAtk = Math.max(...timeline.map(r => r.attackers), 1);
  const yMax = Math.max(maxHP, maxAtk);
  const rounds = timeline.map(r => r.round);

  const mapX = (t: number) => PAD.left + ((t - rounds[0]) / (rounds[rounds.length - 1] - rounds[0] || 1)) * plotW;
  const mapY = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  // Store graph data for tooltip calculations
  if (graphDataRef) {
    graphDataRef.current = {
      mapX, mapY: (v: number, _max: number) => mapY(v), w, h,
      fortHPmax, maxAttackers: maxAtk, rounds: rounds[rounds.length - 1],
      fortHP: timeline.map(r => r.fortHP),
      attackers: timeline.map(r => r.attackers),
      initialGarrison: initialGarrison || 0,
      timeline
    };
  }

  // ── Background ──
  ctx.fillStyle = '#0f172a'; // slate-900
  ctx.fillRect(0, 0, w, h);

  // ── Title ──
  drawTitle(ctx, 'Wall Assault — Troops & Wall HP over Siege Rounds', w, 8);

  // ── Legend ──
  const legendItems: Array<{ label: string; color: string }> = [
    { label: 'Wall HP (Fortress)', color: '#e2e8f0' },
    { label: 'Attackers (Remaining)', color: '#f87171' },
  ];
  if (initialGarrison && initialGarrison > 0) {
    legendItems.push({ label: 'Defenders (Garrison)', color: '#38bdf8' });
  }
  drawLegend(ctx, legendItems, w / 2, 38);

  // ── Grid + axes ──
  const ticks = yTicks(yMax);
  drawGrid(ctx, ticks, yMax, PAD.left, PAD.top, w - PAD.right, PAD.top + plotH, '#334155', '#64748b');

  // Axes
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top);
  ctx.lineTo(PAD.left, PAD.top + plotH);
  ctx.lineTo(w - PAD.right, PAD.top + plotH);
  ctx.stroke();

  // X ticks
  drawXTicks(ctx, rounds, mapX, PAD.top + plotH, 'Siege Round', '#64748b');

  // Y-axis label (rotated)
  ctx.save();
  ctx.translate(14, PAD.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.fillText('Count / HP', 0, 0);
  ctx.restore();

  // ── Data lines ──
  const hpPoints = timeline.map(r => ({ x: mapX(r.round), y: mapY(r.fortHP) }));
  const atkPoints = timeline.map(r => ({ x: mapX(r.round), y: mapY(r.attackers) }));

  // Defenders line (constant during wall assault — garrison stays behind walls)
  if (initialGarrison && initialGarrison > 0) {
    const defPoints = timeline.map(r => ({ x: mapX(r.round), y: mapY(initialGarrison) }));
    drawDataLine(ctx, defPoints, '#38bdf8', { fill: false, dashed: true });
  }

  drawDataLine(ctx, hpPoints, '#e2e8f0', { fill: true });
  drawDataLine(ctx, atkPoints, '#f87171', { fill: true });

  // ── Breach marker ──
  const breachIdx = timeline.findIndex(r => r.fortHP <= 0);
  if (breachIdx >= 0) {
    const bx = mapX(timeline[breachIdx].round);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(bx, PAD.top);
    ctx.lineTo(bx, PAD.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.fillText('⚠ BREACH', bx, PAD.top - 4);
  }

  // ── Hover guideline + highlighted dots ──
  if (hoveredRound !== null && hoveredRound !== undefined) {
    const gx = mapX(hoveredRound);
    if (gx >= PAD.left && gx <= w - PAD.right) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(gx, PAD.top);
      ctx.lineTo(gx, PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Highlighted data points at hovered round
      const ri = timeline.findIndex(r => r.round === hoveredRound);
      if (ri >= 0) {
        // Wall HP dot (white)
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(gx, mapY(timeline[ri].fortHP), 8, 0, Math.PI * 2);
        ctx.fill();
        // Attackers dot (red)
        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.arc(gx, mapY(timeline[ri].attackers), 8, 0, Math.PI * 2);
        ctx.fill();
        // Defenders dot (blue)
        if (initialGarrison && initialGarrison > 0) {
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(gx, mapY(initialGarrison), 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}


// ── Inner Battle Graph ────────────────────────────────────────────────────

function drawInnerBattleGraph(canvas: HTMLCanvasElement, timeline: InnerBattleStep[], graphDataRef?: React.MutableRefObject<any>, hoveredStep?: number | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, w, h);
  if (!timeline.length) return;

  // Layout
  const PAD = { top: 58, bottom: 54, left: 70, right: 20 };
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;

  // Data ranges — unified Y max
  const maxDef = Math.max(...timeline.map(r => r.defenders), 1);
  const maxAtk = Math.max(...timeline.map(r => r.attackers), 1);
  const yMax = Math.max(maxDef, maxAtk);
  const steps = timeline.map(r => r.step);

  const mapX = (t: number) => PAD.left + ((t - steps[0]) / (steps[steps.length - 1] - steps[0] || 1)) * plotW;
  const mapY = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  // Store graph data for tooltip calculations
  if (graphDataRef) {
    graphDataRef.current = {
      mapX, mapY: (v: number, _max: number) => mapY(v), w, h,
      maxDef, maxAtk, steps: steps[steps.length - 1],
      defenders: timeline.map(r => r.defenders),
      attackers: timeline.map(r => r.attackers),
      timeline
    };
  }

  // ── Background ──
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  // ── Title ──
  drawTitle(ctx, 'Inner Defence Battle — Troops Remaining per Step', w, 8);

  // ── Legend ──
  drawLegend(ctx, [
    { label: 'Defenders (Garrison)', color: '#38bdf8' },
    { label: 'Attackers', color: '#f87171' },
  ], w / 2, 38);

  // ── Phase bands ──
  const phaseColors: Record<string, string> = {
    skirmish: 'rgba(251, 191, 36, 0.06)',
    melee:    'rgba(239, 68, 68, 0.06)',
    pursuit:  'rgba(168, 85, 247, 0.06)',
  };
  const phaseLabelColors: Record<string, string> = {
    skirmish: '#fbbf24',
    melee:    '#ef4444',
    pursuit:  '#a855f7',
  };
  let prevPhase = '';
  timeline.forEach((s, i) => {
    if (s.phase !== prevPhase) {
      // Find end of this phase
      let endIdx = i;
      while (endIdx < timeline.length - 1 && timeline[endIdx + 1].phase === s.phase) endIdx++;
      const x1 = mapX(s.step) - (plotW / steps.length) * 0.5;
      const x2 = mapX(timeline[endIdx].step) + (plotW / steps.length) * 0.5;
      // Band
      ctx.fillStyle = phaseColors[s.phase] || 'rgba(100,100,100,0.05)';
      ctx.fillRect(Math.max(x1, PAD.left), PAD.top, Math.min(x2, w - PAD.right) - Math.max(x1, PAD.left), plotH);
      // Phase label at top
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillStyle = phaseLabelColors[s.phase] || '#94a3b8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const cx = (Math.max(x1, PAD.left) + Math.min(x2, w - PAD.right)) / 2;
      ctx.fillText(s.phase.charAt(0).toUpperCase() + s.phase.slice(1), cx, PAD.top + plotH + 0);
      prevPhase = s.phase;
    }
  });

  // ── Grid + axes ──
  const ticks = yTicks(yMax);
  drawGrid(ctx, ticks, yMax, PAD.left, PAD.top, w - PAD.right, PAD.top + plotH, '#334155', '#64748b');

  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top);
  ctx.lineTo(PAD.left, PAD.top + plotH);
  ctx.lineTo(w - PAD.right, PAD.top + plotH);
  ctx.stroke();

  // X ticks
  drawXTicks(ctx, steps, mapX, PAD.top + plotH, 'Battle Step', '#64748b');

  // Y-axis label
  ctx.save();
  ctx.translate(14, PAD.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.fillText('Troops Remaining', 0, 0);
  ctx.restore();

  // ── Data lines ──
  const defPoints = timeline.map(r => ({ x: mapX(r.step), y: mapY(r.defenders) }));
  const atkPoints = timeline.map(r => ({ x: mapX(r.step), y: mapY(r.attackers) }));

  drawDataLine(ctx, defPoints, '#38bdf8', { fill: true });
  drawDataLine(ctx, atkPoints, '#f87171', { fill: true });

  // ── Hover guideline ──
  if (hoveredStep !== null && hoveredStep !== undefined) {
    const gx = mapX(hoveredStep);
    if (gx >= PAD.left && gx <= w - PAD.right) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(gx, PAD.top);
      ctx.lineTo(gx, PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// Graph canvas components
function SiegeGraphCanvas({ timeline, fortHPmax, initialGarrison }: { timeline: SiegeRound[]; fortHPmax: number; initialGarrison?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphDataRef = useRef<any>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: Array<{ label: string; value: number; color: string; delta?: number }>;
    round: number;
  } | null>(null);
  const [hoveredRound, setHoveredRound] = useState<number | null>(null);

  useEffect(() => {
    if (canvasRef.current && timeline.length > 0) {
      // Small delay to ensure canvas is properly sized
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawSiegeGraph(canvasRef.current, timeline, fortHPmax, graphDataRef, hoveredRound, initialGarrison);
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [timeline, fortHPmax, hoveredRound]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const data = graphDataRef.current;
    if (!canvas || !container || !data || !timeline.length) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Find closest data point
    let closestIndex = 0;
    let minDist = Infinity;

    for (let i = 0; i < timeline.length; i++) {
      const round = timeline[i].round;
      const x = data.mapX(round);
      const dist = Math.abs(mouseX - x);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }

    // Only show tooltip if close enough (within 30 pixels) and within bounds
    if (minDist < 30 && mouseX >= 20 && mouseX <= data.w - 10 && mouseY >= 10 && mouseY <= data.h - 20) {
      const tooltipData: Array<{ label: string; value: number; color: string; delta?: number }> = [];

      if (closestIndex >= 0 && closestIndex < timeline.length) {
        const prevHP = closestIndex > 0 ? data.fortHP[closestIndex - 1] : data.fortHPmax;
        const prevAtk = closestIndex > 0 ? data.attackers[closestIndex - 1] : timeline[0].attackers + timeline[0].killed;
        tooltipData.push({
          label: 'Wall HP',
          value: data.fortHP[closestIndex],
          color: '#e2e8f0',
          delta: prevHP - data.fortHP[closestIndex],
        });
        tooltipData.push({
          label: 'Attackers',
          value: data.attackers[closestIndex],
          color: '#f87171',
          delta: prevAtk - data.attackers[closestIndex],
        });
        if (data.initialGarrison && data.initialGarrison > 0) {
          tooltipData.push({
            label: 'Defenders',
            value: data.initialGarrison,
            color: '#38bdf8',
          });
        }
      }

      setHoveredRound(timeline[closestIndex].round);
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        data: tooltipData,
        round: timeline[closestIndex].round
      });
    } else {
      setHoveredRound(null);
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredRound(null);
    setTooltip(null);
  };

  if (timeline.length === 0) return null;

  return (
    <div ref={containerRef} className="mt-2 relative">
      <canvas
        ref={canvasRef}
        className="w-full h-[280px] rounded-lg cursor-crosshair"
        style={{ imageRendering: 'crisp-edges' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && tooltip.visible && (
        <div
          className="absolute pointer-events-none z-50 bg-slate-900/95 border border-slate-600 rounded-lg shadow-xl p-2 text-xs"
          style={{
            left: `${Math.min(tooltip.x + 10, (containerRef.current?.clientWidth || 400) - 180)}px`,
            top: `${tooltip.y - 10}px`,
            transform: 'translateY(-100%)'
          }}
        >
          <div className="font-semibold text-slate-200 mb-1">Round {tooltip.round}</div>
          {tooltip.data.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }}></div>
              <span className="text-slate-400">{item.label}:</span>
              <span className="text-white font-semibold">{Math.round(item.value).toLocaleString()}</span>
              {item.delta !== undefined && item.delta > 0 && (
                <span className="text-red-400 font-semibold">(-{Math.round(item.delta)})</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InnerBattleGraphCanvas({ timeline }: { timeline: InnerBattleStep[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphDataRef = useRef<any>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: Array<{ label: string; value: number; color: string }>;
    step: number;
  } | null>(null);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  useEffect(() => {
    if (canvasRef.current && timeline.length > 0) {
      // Small delay to ensure canvas is properly sized
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawInnerBattleGraph(canvasRef.current, timeline, graphDataRef, hoveredStep);
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [timeline, hoveredStep]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const data = graphDataRef.current;
    if (!canvas || !container || !data || !timeline.length) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Find closest data point
    let closestIndex = 0;
    let minDist = Infinity;

    for (let i = 0; i < timeline.length; i++) {
      const step = timeline[i].step;
      const x = data.mapX(step);
      const dist = Math.abs(mouseX - x);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    }

    // Only show tooltip if close enough (within 30 pixels) and within bounds
    if (minDist < 30 && mouseX >= 20 && mouseX <= data.w - 10 && mouseY >= 10 && mouseY <= data.h - 20) {
      const tooltipData: Array<{ label: string; value: number; color: string }> = [];

      if (closestIndex >= 0 && closestIndex < timeline.length) {
        tooltipData.push({
          label: 'Defenders',
          value: data.defenders[closestIndex],
          color: '#38bdf8'
        });
        tooltipData.push({
          label: 'Attackers',
          value: data.attackers[closestIndex],
          color: '#f87171'
        });
      }

      setHoveredStep(timeline[closestIndex].step);
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        data: tooltipData,
        step: timeline[closestIndex].step
      });
    } else {
      setHoveredStep(null);
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredStep(null);
    setTooltip(null);
  };

  if (timeline.length === 0) return null;

  return (
    <div ref={containerRef} className="mt-2 relative">
      <canvas
        ref={canvasRef}
        className="w-full h-[280px] rounded-lg cursor-crosshair"
        style={{ imageRendering: 'crisp-edges' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && tooltip.visible && (
        <div
          className="absolute pointer-events-none z-50 bg-slate-900/95 border border-slate-600 rounded-lg shadow-xl p-2 text-xs"
          style={{
            left: `${Math.min(tooltip.x + 10, (containerRef.current?.clientWidth || 400) - 180)}px`,
            top: `${tooltip.y - 10}px`,
            transform: 'translateY(-100%)'
          }}
        >
          <div className="font-semibold text-slate-200 mb-1">Step {tooltip.step} — <span className="capitalize">{timeline.find(s => s.step === tooltip!.step)?.phase}</span></div>
          {tooltip.data.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }}></div>
              <span className="text-slate-400">{item.label}:</span>
              <span className="text-white font-semibold">{Math.round(item.value).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { BattleChart, SiegeGraphCanvas, InnerBattleGraphCanvas };
