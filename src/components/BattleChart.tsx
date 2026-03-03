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

// Graph drawing functions (defined outside component for reuse)
function drawSiegeGraph(canvas: HTMLCanvasElement, timeline: SiegeRound[], fortHPmax: number, graphDataRef?: React.MutableRefObject<any>, hoveredRound?: number | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, w, h);
  if (!timeline.length) return;

  const maxAttackers = Math.max(...timeline.map(r => r.attackers), 1);
  const rounds = timeline[timeline.length - 1].round;

  const mapX = (t: number) => (t / rounds) * (w - 40) + 20;
  const mapY = (v: number, max: number) => h - 20 - (v / max) * (h - 40);

  // Store graph data for tooltip calculations
  if (graphDataRef) {
    graphDataRef.current = {
      mapX,
      mapY,
      w,
      h,
      fortHPmax,
      maxAttackers,
      rounds,
      fortHP: timeline.map(r => r.fortHP),
      attackers: timeline.map(r => r.attackers),
      timeline
    };
  }

  // Draw axes
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 10);
  ctx.lineTo(20, h - 20);
  ctx.lineTo(w - 10, h - 20);
  ctx.stroke();

  // Draw lines
  function drawLine(values: number[], max: number, colour: string) {
    if (!ctx) return;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const t = timeline[i].round;
      const x = mapX(t);
      const y = mapY(v, max);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawLine(timeline.map(r => r.fortHP), fortHPmax, '#2d9cff');
  drawLine(timeline.map(r => r.attackers), maxAttackers, '#ff5d5d');

  // Draw vertical guideline at hovered round
  if (hoveredRound !== null && hoveredRound !== undefined && ctx) {
    const guidelineX = mapX(hoveredRound);
    if (guidelineX >= 20 && guidelineX <= w - 10) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(guidelineX, 10);
      ctx.lineTo(guidelineX, h - 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawInnerBattleGraph(canvas: HTMLCanvasElement, timeline: InnerBattleStep[], graphDataRef?: React.MutableRefObject<any>, hoveredStep?: number | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, w, h);
  if (!timeline.length) return;

  const maxDef = Math.max(...timeline.map(r => r.defenders), 1);
  const maxAtk = Math.max(...timeline.map(r => r.attackers), 1);
  const steps = timeline[timeline.length - 1].step;

  const mapX = (t: number) => (t / steps) * (w - 40) + 20;
  const mapY = (v: number, max: number) => h - 20 - (v / max) * (h - 40);

  // Store graph data for tooltip calculations
  if (graphDataRef) {
    graphDataRef.current = {
      mapX,
      mapY,
      w,
      h,
      maxDef,
      maxAtk,
      steps,
      defenders: timeline.map(r => r.defenders),
      attackers: timeline.map(r => r.attackers),
      timeline
    };
  }

  // Draw axes
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 10);
  ctx.lineTo(20, h - 20);
  ctx.lineTo(w - 10, h - 20);
  ctx.stroke();

  // Draw lines
  function drawLine(values: number[], max: number, colour: string) {
    if (!ctx) return;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const t = timeline[i].step;
      const x = mapX(t);
      const y = mapY(v, max);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawLine(timeline.map(r => r.defenders), maxDef, '#2d9cff');
  drawLine(timeline.map(r => r.attackers), maxAtk, '#ff5d5d');

  // Draw vertical guideline at hovered step
  if (hoveredStep !== null && hoveredStep !== undefined) {
    const guidelineX = mapX(hoveredStep);
    if (guidelineX >= 20 && guidelineX <= w - 10) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(guidelineX, 10);
      ctx.lineTo(guidelineX, h - 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// Graph canvas components
function SiegeGraphCanvas({ timeline, fortHPmax }: { timeline: SiegeRound[]; fortHPmax: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphDataRef = useRef<any>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: Array<{ label: string; value: number; color: string }>;
    round: number;
  } | null>(null);
  const [hoveredRound, setHoveredRound] = useState<number | null>(null);

  useEffect(() => {
    if (canvasRef.current && timeline.length > 0) {
      // Small delay to ensure canvas is properly sized
      const timer = setTimeout(() => {
        if (canvasRef.current) {
          drawSiegeGraph(canvasRef.current, timeline, fortHPmax, graphDataRef, hoveredRound);
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
      const tooltipData: Array<{ label: string; value: number; color: string }> = [];

      if (closestIndex >= 0 && closestIndex < timeline.length) {
        tooltipData.push({
          label: 'Fort HP',
          value: data.fortHP[closestIndex],
          color: '#2d9cff'
        });
        tooltipData.push({
          label: 'Remaining Attackers',
          value: data.attackers[closestIndex],
          color: '#ff5d5d'
        });
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
    <details className="mt-3 pt-3 border-t border-slate-700">
      <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
        Siege Graph
      </summary>
      <div ref={containerRef} className="mt-2 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-[220px] bg-slate-950 border border-slate-700 rounded-lg cursor-crosshair"
          style={{ imageRendering: 'crisp-edges' }}
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
            <div className="font-semibold text-slate-300 mb-1">Round {tooltip.round}</div>
            {tooltip.data.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }}></div>
                <span className="text-slate-400">{item.label}:</span>
                <span className="text-white font-semibold">{item.value.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-slate-400 mt-1">
          Blue line = Fort HP. Red line = remaining attackers.
        </div>
      </div>
    </details>
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
          label: 'Inner Defenders',
          value: data.defenders[closestIndex],
          color: '#2d9cff'
        });
        tooltipData.push({
          label: 'Inner Attackers',
          value: data.attackers[closestIndex],
          color: '#ff5d5d'
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
    <details className="mt-3 pt-3 border-t border-slate-700">
      <summary className="text-slate-400 cursor-pointer hover:text-slate-300 text-[11px] font-semibold">
        Inner Battle Graph
      </summary>
      <div ref={containerRef} className="mt-2 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-[220px] bg-slate-950 border border-slate-700 rounded-lg cursor-crosshair"
          style={{ imageRendering: 'crisp-edges' }}
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
            <div className="font-semibold text-slate-300 mb-1">Step {tooltip.step}</div>
            {tooltip.data.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }}></div>
                <span className="text-slate-400">{item.label}:</span>
                <span className="text-white font-semibold">{item.value.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] text-slate-400 mt-1">
          Blue line = inner defenders. Red line = inner attackers. Phases: skirmish → melee → pursuit
        </div>
      </div>
    </details>
  );
}

export { BattleChart, SiegeGraphCanvas, InnerBattleGraphCanvas };
