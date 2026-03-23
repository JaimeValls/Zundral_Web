// ============================================================================
// Zundral — BattleChart Canvas Components
// Canvas-based visualisations for battle results and siege battles.
// Extracted from ResourceVillageUI.tsx — props-only, no game state.
// ============================================================================

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { BattleResult, SiegeRound, InnerBattleStep } from '../types';

function BattleChart({ timeline }: { timeline: BattleResult['timeline'] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: Array<{ label: string; value: number; color: string }>;
    tick: number;
  } | null>(null);
  const [hoveredTick, setHoveredTick] = useState<number | null>(null);
  const graphDataRef = useRef<{
    sx: (x: number) => number;
    syT: (y: number) => number;
    syM: (y: number) => number;
    W: number;
    H: number;
    tMin: number;
    tMax: number;
    mMin: number;
    mMax: number;
    A_morale: number[];
    B_morale: number[];
    A_troops: number[];
    B_troops: number[];
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !timeline.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = canvas.clientHeight * 2;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(48, 10);
    const W = w - 76;
    const H = h - 40;

    const N = timeline.length || 1;
    const sx = (x: number) => (x - 1) / (N - 1 || 1) * W;

    const troopsAll = [...timeline.map(t => t.A_troops), ...timeline.map(t => t.B_troops)].filter(Number.isFinite);
    const moraleAll = [...timeline.map(t => t.A_morale), ...timeline.map(t => t.B_morale)].filter(Number.isFinite);
    const tMin = Math.min(...troopsAll, 0);
    const tMax = Math.max(...troopsAll, 1);
    const mMin = Math.min(...moraleAll, 0);
    const mMax = Math.max(...moraleAll, 1);
    const syT = (y: number) => H - (y - tMin) / (tMax - tMin || 1) * H;
    const syM = (y: number) => H - (y - mMin) / (mMax - mMin || 1) * H;

    // Store graph data for tooltip calculations
    const A_morale = timeline.map(r => r.A_morale);
    const B_morale = timeline.map(r => r.B_morale);
    const A_troops = timeline.map(r => r.A_troops);
    const B_troops = timeline.map(r => r.B_troops);

    graphDataRef.current = {
      sx, syT, syM, W, H, tMin, tMax, mMin, mMax,
      A_morale, B_morale, A_troops, B_troops
    };

    // Background
    ctx.fillStyle = '#0f141b';
    ctx.fillRect(0, 0, W, H);

    // Phase bands
    if (timeline.length) {
      const bands: Array<{ ph: string; s: number; e: number }> = [];
      let s = 0;
      let cur = timeline[0].phase;
      for (let i = 1; i < timeline.length; i++) {
        if (timeline[i].phase !== cur) {
          bands.push({ ph: cur, s: s + 1, e: i });
          s = i;
          cur = timeline[i].phase;
        }
      }
      bands.push({ ph: cur, s: s + 1, e: timeline.length });

      for (const b of bands) {
        const x0 = sx(b.s);
        const x1 = sx(b.e);
        let c = 'rgba(154,163,178,0.14)';
        if (b.ph === 'skirmish') c = 'rgba(45,156,255,0.16)';
        else if (b.ph === 'pursuit') c = 'rgba(255,93,93,0.16)';
        ctx.fillStyle = c;
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H);
        ctx.fillStyle = '#cfd6e1';
        ctx.font = 'bold 16px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(b.ph.charAt(0).toUpperCase() + b.ph.slice(1), x0 + (x1 - x0) / 2, 6);
      }
    }

    // Grid
    ctx.strokeStyle = '#202733';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = i * (H / 5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const x = i * (W / 10);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.strokeStyle = '#2c3545';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, W, H);

    // Y labels
    ctx.fillStyle = '#a7b0bd';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = tMin + (tMax - tMin) * i / 4;
      const y = syT(v);
      ctx.fillText(Math.round(v).toString(), -6, y);
    }
    ctx.fillText('Troops', -6, -6);
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const v = mMin + (mMax - mMin) * i / 4;
      const y = syM(v);
      ctx.fillText(Math.round(v).toString(), W + 6, y);
    }
    ctx.fillText('Morale', W + 6, -6);

    // Lines
    const draw = (arr: number[], sy: (y: number) => number, col: string) => {
      if (!arr.length) return;
      ctx.beginPath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.moveTo(sx(1), sy(arr[0]));
      for (let i = 1; i < arr.length; i++) {
        ctx.lineTo(sx(i + 1), sy(arr[i]));
      }
      ctx.stroke();
    };

    draw(A_morale, syM, '#6fb3ff');
    draw(B_morale, syM, '#ff8c00'); // Enemy morale: Orange
    draw(A_troops, syT, '#2d9cff');
    draw(B_troops, syT, '#ff5d5d');

    // Draw vertical guideline at hovered tick
    if (hoveredTick !== null && hoveredTick >= 1 && hoveredTick <= timeline.length) {
      const guidelineX = sx(hoveredTick);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(guidelineX, 0);
      ctx.lineTo(guidelineX, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [timeline, hoveredTick]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const data = graphDataRef.current;
    if (!canvas || !container || !data || !timeline.length) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Account for canvas translation (48, 10)
    const mouseX = (e.clientX - rect.left) * scaleX - 48;
    const mouseY = (e.clientY - rect.top) * scaleY - 10;

    // Find closest data point
    let closestTick = 1;
    let minDist = Infinity;

    for (let i = 0; i < timeline.length; i++) {
      const tick = i + 1;
      const x = data.sx(tick);
      const dist = Math.abs(mouseX - x);
      if (dist < minDist) {
        minDist = dist;
        closestTick = tick;
      }
    }

    // Only show tooltip if close enough (within 30 pixels)
    if (minDist < 30 && mouseX >= 0 && mouseX <= data.W && mouseY >= 0 && mouseY <= data.H) {
      const index = closestTick - 1;
      const tooltipData: Array<{ label: string; value: number; color: string }> = [];

      if (index >= 0 && index < timeline.length) {
        tooltipData.push({
          label: 'Player Morale',
          value: data.A_morale[index],
          color: '#6fb3ff'
        });
        tooltipData.push({
          label: 'Enemy Morale',
          value: data.B_morale[index],
          color: '#ff8c00'
        });
        tooltipData.push({
          label: 'Player Troops',
          value: data.A_troops[index],
          color: '#2d9cff'
        });
        tooltipData.push({
          label: 'Enemy Troops',
          value: data.B_troops[index],
          color: '#ff5d5d'
        });
      }

      setHoveredTick(closestTick);
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        data: tooltipData,
        tick: closestTick
      });
    } else {
      setHoveredTick(null);
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredTick(null);
    setTooltip(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-[300px] bg-[#0b0e12] border border-slate-700 rounded-lg cursor-crosshair"
        style={{ imageRendering: 'pixelated' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && tooltip.visible && (
        <div
          className="absolute pointer-events-none z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-2 text-xs"
          style={{
            left: `${tooltip.x + 10}px`,
            top: `${tooltip.y - 10}px`,
            transform: 'translateY(-100%)'
          }}
        >
          <div className="font-semibold text-slate-300 mb-1">Tick {tooltip.tick}</div>
          {tooltip.data.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }}></div>
              <span className="text-slate-400">{item.label}:</span>
              <span className="text-white font-semibold">{item.value.toFixed(1)}</span>
            </div>
          ))}
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
