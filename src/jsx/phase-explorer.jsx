import { useState, useEffect, useRef } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const CANVAS_SIZE = 480;
const BOX_WIDTH = 50;             // simulation units (matches Schroeder's default)
const PX_PER_UNIT = CANVAS_SIZE / BOX_WIDTH;
const FORCE_CUTOFF = 3.0;         // LJ cutoff in σ
const FC2 = FORCE_CUTOFF * FORCE_CUTOFF;
const PE_AT_CUTOFF = 4 * (Math.pow(FORCE_CUTOFF, -12) - Math.pow(FORCE_CUTOFF, -6));
const WALL_STIFFNESS = 50;
const WALL_DIST = 0.5;
const SAFETY_FACTOR = 4000;       // adaptive dt threshold
const DISPLAY_INTERVAL = 3;
const ROLLING_WINDOW = 80;
const BOND_DRAW_THRESHOLD = 1.5;

// ── Physics (matches Schroeder's Interactive MD) ─────────────────────────────

function computeAccelerations(x, y, ax, ay, N) {
  let pe = 0, wallForce = 0;

  // Reset accelerations
  for (let i = 0; i < N; i++) { ax[i] = 0; ay[i] = 0; }

  // Cell list for O(N) force computation
  const nCells = Math.max(1, Math.floor(BOX_WIDTH / FORCE_CUTOFF));
  const cellW = BOX_WIDTH / nCells;
  const header = new Int32Array(nCells * nCells).fill(-1);
  const linked = new Int32Array(N).fill(-1);

  for (let i = 0; i < N; i++) {
    const cx = Math.min(Math.floor(x[i] / cellW), nCells - 1);
    const cy = Math.min(Math.floor(y[i] / cellW), nCells - 1);
    const idx = cx + nCells * cy;
    linked[i] = header[idx];
    header[idx] = i;
  }

  // Neighbor offsets (check 5 neighbors to avoid double counting)
  const offsets = [[0,0],[1,0],[1,1],[0,1],[-1,1]];

  for (let cy = 0; cy < nCells; cy++) {
    for (let cx = 0; cx < nCells; cx++) {
      for (const [ox, oy] of offsets) {
        let nx = cx + ox, ny = cy + oy;
        if (nx < 0 || nx >= nCells || ny < 0 || ny >= nCells) continue;
        const sameCell = (ox === 0 && oy === 0);

        let i = header[cx + nCells * cy];
        while (i >= 0) {
          let j = sameCell ? linked[i] : header[nx + nCells * ny];
          while (j >= 0) {
            const dx = x[i] - x[j], dy = y[i] - y[j];
            const r2 = dx * dx + dy * dy;
            if (r2 < FC2 && r2 > 0.0001) {
              const r2inv = 1 / r2;
              const attract = r2inv * r2inv * r2inv;     // r^-6
              const repel = attract * attract;             // r^-12
              pe += 4 * (repel - attract) - PE_AT_CUTOFF;
              const fOverR = 24 * (2 * repel - attract) * r2inv;
              ax[i] += fOverR * dx; ay[i] += fOverR * dy;
              ax[j] -= fOverR * dx; ay[j] -= fOverR * dy;
            }
            j = linked[j];
          }
          i = linked[i];
        }
      }
    }
  }

  // Wall forces (spring potential)
  for (let i = 0; i < N; i++) {
    if (x[i] < WALL_DIST) {
      const d = WALL_DIST - x[i];
      ax[i] += WALL_STIFFNESS * d;
      pe += 0.5 * WALL_STIFFNESS * d * d;
      wallForce += WALL_STIFFNESS * d;
    } else if (x[i] > BOX_WIDTH - WALL_DIST) {
      const d = x[i] - (BOX_WIDTH - WALL_DIST);
      ax[i] -= WALL_STIFFNESS * d;
      pe += 0.5 * WALL_STIFFNESS * d * d;
      wallForce += WALL_STIFFNESS * d;
    }
    if (y[i] < WALL_DIST) {
      const d = WALL_DIST - y[i];
      ay[i] += WALL_STIFFNESS * d;
      pe += 0.5 * WALL_STIFFNESS * d * d;
      wallForce += WALL_STIFFNESS * d;
    } else if (y[i] > BOX_WIDTH - WALL_DIST) {
      const d = y[i] - (BOX_WIDTH - WALL_DIST);
      ay[i] -= WALL_STIFFNESS * d;
      pe += 0.5 * WALL_STIFFNESS * d * d;
      wallForce += WALL_STIFFNESS * d;
    }
  }

  return { pe, wallForce };
}

function doStep(sim, grav) {
  const { x, y, vx, vy, ax, ay, N } = sim;
  let dt = sim.dt;
  const halfDt = 0.5 * dt;
  const halfDtSq = halfDt * dt;

  // Position update + half-step velocity (ax/ay include gravity from prev step)
  for (let i = 0; i < N; i++) {
    x[i] += vx[i] * dt + ax[i] * halfDtSq;
    y[i] += vy[i] * dt + ay[i] * halfDtSq;
    vx[i] += ax[i] * halfDt;
    vy[i] += ay[i] * halfDt;
  }

  // Recompute LJ + wall forces (resets ax/ay)
  const { pe, wallForce } = computeAccelerations(x, y, ax, ay, N);

  // Add gravity (downward = negative y)
  for (let i = 0; i < N; i++) ay[i] -= grav;

  // Second half-step velocity with new accelerations
  let ke = 0;
  for (let i = 0; i < N; i++) {
    vx[i] += ax[i] * halfDt;
    vy[i] += ay[i] * halfDt;
    ke += 0.5 * (vx[i] * vx[i] + vy[i] * vy[i]);
  }

  // Adaptive timestep
  const T = N > 0 ? ke / N : 0;
  if (T > 1 / (SAFETY_FACTOR * dt * dt)) {
    sim.dt = Math.max(Math.sqrt(1 / (SAFETY_FACTOR * T)) - 0.001, 0.001);
  }

  return { ke, pe, wallForce, T };
}

function measureT(vx, vy, N) {
  if (N === 0) return 0;
  let ke = 0;
  for (let i = 0; i < N; i++) ke += vx[i] * vx[i] + vy[i] * vy[i];
  return 0.5 * ke / N;
}

function rescaleT(vx, vy, N, target) {
  if (N === 0) return;
  const cur = measureT(vx, vy, N);
  if (cur < 1e-12) {
    // Assign random velocities
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(2 * target);
      vx[i] = s * Math.cos(a); vy[i] = s * Math.sin(a);
    }
    return;
  }
  const sc = Math.sqrt(target / cur);
  for (let i = 0; i < N; i++) { vx[i] *= sc; vy[i] *= sc; }
}

// Berendsen thermostat (kept for future use, not called in main loop)
function berendsen(vx, vy, N, Ttarget, Tcurrent, dt, tau) {
  if (Tcurrent < 1e-10 || tau < 0.01) return;
  let lam = Math.sqrt(1 + (dt / tau) * (Ttarget / Tcurrent - 1));
  lam = Math.max(0.9, Math.min(1.1, lam));
  for (let i = 0; i < N; i++) { vx[i] *= lam; vy[i] *= lam; }
}

function createSim(N, T) {
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  const ax = new Float64Array(N);
  const ay = new Float64Array(N);

  // Grid placement at 1.3σ spacing (Schroeder's approach)
  const cellSize = 1.3;
  const nCells = Math.floor(BOX_WIDTH / cellSize);
  let placed = 0;
  for (let cy = 0; cy < nCells && placed < N; cy++) {
    for (let cx = 0; cx < nCells && placed < N; cx++) {
      x[placed] = (cx + 0.5) * cellSize + (Math.random() - 0.5) * 0.01;
      y[placed] = (cy + 0.5) * cellSize + (Math.random() - 0.5) * 0.01;
      placed++;
    }
  }

  // Set initial temperature
  rescaleT(vx, vy, N, T);
  // Zero net momentum
  let mvx = 0, mvy = 0;
  for (let i = 0; i < N; i++) { mvx += vx[i]; mvy += vy[i]; }
  mvx /= N; mvy /= N;
  for (let i = 0; i < N; i++) { vx[i] -= mvx; vy[i] -= mvy; }
  rescaleT(vx, vy, N, T);

  // Initial force computation
  computeAccelerations(x, y, ax, ay, N);

  return { x, y, vx, vy, ax, ay, N, dt: 0.02 };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function speedColor(speed, thermal) {
  const r = Math.min(speed / (thermal * 2.2 + 0.01), 1);
  if (r < 0.35) { const t = r / 0.35; return `rgba(${60+60*t},${140+80*t},255,0.95)`; }
  if (r < 0.65) { const t = (r-0.35)/0.3; return `rgba(${120+135*t},${220+35*t},${255-50*t},0.95)`; }
  const t = (r-0.65)/0.35;
  return `rgba(255,${255-200*t},${205-180*t},0.95)`;
}

function drawPhaseDiagram(ctx, w, h, curT, curX, xMax, xLabel, regions) {
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "#0c1222";
  ctx.fillRect(0,0,w,h);
  const pad = {l:30,r:8,t:10,b:24};
  const pw = w-pad.l-pad.r, ph = h-pad.t-pad.b;
  const toX = v => pad.l + (Math.min(v,xMax)/xMax)*pw;
  const toY = T => pad.t + (1-T/1.5)*ph;

  // Regions
  for (const {color, pts} of regions) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toX(pts[0][0]),toY(pts[0][1]));
    for (let i=1;i<pts.length;i++) ctx.lineTo(toX(pts[i][0]),toY(pts[i][1]));
    ctx.closePath(); ctx.fill();
  }

  // Labels
  ctx.font = "9px 'IBM Plex Mono',monospace";
  ctx.fillStyle = "#f97316"; ctx.fillText("Gas", toX(xMax*0.08), toY(0.9));
  ctx.fillStyle = "#60a5fa"; ctx.fillText("Liquid", toX(xMax*0.45), toY(0.46));
  ctx.fillStyle = "#a78bfa"; ctx.fillText("Solid", toX(xMax*0.82), toY(0.2));

  // Axes
  ctx.strokeStyle = "#475569"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l,pad.t); ctx.lineTo(pad.l,pad.t+ph); ctx.lineTo(pad.l+pw,pad.t+ph); ctx.stroke();
  ctx.fillStyle = "#64748b"; ctx.font = "8px 'IBM Plex Mono',monospace";
  ctx.textAlign = "center";
  for (let v=0;v<=xMax;v+=xMax/4) { ctx.fillText(v.toFixed(v>=1?0:2), toX(v), pad.t+ph+12); }
  ctx.textAlign = "right";
  for (let t=0;t<=1.5;t+=0.5) { ctx.fillText(t.toFixed(1), pad.l-4, toY(t)+3); }
  ctx.fillStyle = "#94a3b8"; ctx.font = "9px 'IBM Plex Mono',monospace";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, pad.l+pw/2, h-1);
  ctx.save(); ctx.translate(8,pad.t+ph/2); ctx.rotate(-Math.PI/2); ctx.fillText("T*",0,0); ctx.restore();

  // Current state dot
  const cx = toX(Math.max(0,Math.min(curX,xMax)));
  const cy = toY(Math.min(Math.max(curT,0),1.5));
  ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2);
  ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.shadowColor = "#fff"; ctx.shadowBlur = 8;
  ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
}

const TRHO_REGIONS = [
  {color:"rgba(249,115,22,0.12)", pts:[[0,0],[0.25,0],[0.35,0.51],[0.15,1.5],[0,1.5]]},
  {color:"rgba(96,165,250,0.12)", pts:[[0.35,0.35],[0.75,0.35],[0.65,0.55],[0.35,0.51]]},
  {color:"rgba(147,130,255,0.12)", pts:[[0.7,0],[1,0],[1,0.55],[0.75,0.55],[0.75,0.35],[0.7,0]]},
];
const TP_REGIONS = [
  {color:"rgba(147,130,255,0.12)", pts:[[0.5,0],[5,0],[5,1.5],[2,0.55],[0.8,0.42]]},
  {color:"rgba(96,165,250,0.12)", pts:[[0.8,0.42],[2,0.55],[1.5,0.51],[0.3,0.42]]},
  {color:"rgba(249,115,22,0.12)", pts:[[0,0],[0.3,0.42],[1.5,0.51],[0,1.5]]},
];

// ── UI ───────────────────────────────────────────────────────────────────────

function Slider({label,value,min,max,step,onChange,color}) {
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#94a3b8",marginBottom:4,fontFamily:"'IBM Plex Mono',monospace"}}>
        <span>{label}</span>
        <span style={{color:color||"#e2e8f0",fontWeight:600}}>{typeof value==="number"?(Number.isInteger(step)||step>=1?value:value.toFixed(2)):value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(parseFloat(e.target.value))}
        style={{width:"100%",height:6,appearance:"none",background:"#334155",borderRadius:3,outline:"none",cursor:"pointer",accentColor:color||"#60a5fa"}} />
    </div>
  );
}

function MRow({label,value,color}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'IBM Plex Mono',monospace",fontSize:12,marginBottom:4}}>
      <span style={{color:"#64748b"}}>{label}</span>
      <span style={{color:color||"#e2e8f0",fontWeight:600}}>{value}</span>
    </div>
  );
}

const PRESETS = [
  {label:"Cold Solid", T:0.10, N:500, gravity:false},
  {label:"Warm Liquid", T:0.45, N:500, gravity:false},
  {label:"Hot Gas", T:1.2, N:300, gravity:false},
  {label:"Triple Point", T:0.42, N:500, gravity:true},
  {label:"Boiling", T:0.55, N:500, gravity:true},
  {label:"Quench", T:0.20, N:500, gravity:false, initT:1.0},
];

// ── Main component ───────────────────────────────────────────────────────────

export default function PhaseExplorer() {
  const canvasRef = useRef(null);
  const trhoRef = useRef(null);
  const tpRef = useRef(null);
  const simRef = useRef(null);
  const rollingRef = useRef({T:[],P:[],KE:[],PE:[],frame:0});

  const [temperature, setTemperature] = useState(0.45);
  const [numParticles, setNumParticles] = useState(500);
  const [gravity, setGravity] = useState(false);
  const [paused, setPaused] = useState(false);
  const [meas, setMeas] = useState({T:0,P:0,KE:0,PE:0,E:0});
  const prevTRef = useRef(0.45);

  // Initialize
  useEffect(() => {
    simRef.current = createSim(numParticles, temperature);
    rollingRef.current = {T:[],P:[],KE:[],PE:[],frame:0};
  }, []);

  // Handle temperature slider
  useEffect(() => {
    if (simRef.current && prevTRef.current !== temperature) {
      rescaleT(simRef.current.vx, simRef.current.vy, simRef.current.N, temperature);
      rollingRef.current = {T:[],P:[],KE:[],PE:[],frame:0};
    }
    prevTRef.current = temperature;
  }, [temperature]);

  // Handle particle count
  useEffect(() => {
    if (simRef.current && simRef.current.N !== numParticles) {
      simRef.current = createSim(numParticles, temperature);
      rollingRef.current = {T:[],P:[],KE:[],PE:[],frame:0};
    }
  }, [numParticles]);

  const rollingAvg = arr => arr.length > 0 ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let rafId = null;

    const loop = () => {
      const sim = simRef.current;
      if (!sim) { rafId = requestAnimationFrame(loop); return; }
      const {x,y,vx,vy,N} = sim;
      const roll = rollingRef.current;
      const grav = gravity ? 0.02 : 0;

      if (!paused && N > 0) {
        // Multiple steps per frame for speed
        const stepsPerFrame = Math.max(1, Math.round(0.02 / sim.dt));
        let lastResult = null;
        for (let s = 0; s < stepsPerFrame; s++) {
          lastResult = doStep(sim, grav);
        }

        roll.frame++;
        if (lastResult && roll.frame % DISPLAY_INTERVAL === 0) {
          const P = lastResult.wallForce / (4 * BOX_WIDTH);
          roll.T.push(lastResult.T);
          roll.P.push(P);
          roll.KE.push(lastResult.ke);
          roll.PE.push(lastResult.pe);
          if (roll.T.length > ROLLING_WINDOW) {
            roll.T.shift(); roll.P.shift(); roll.KE.shift(); roll.PE.shift();
          }
          const aT = rollingAvg(roll.T), aP = rollingAvg(roll.P);
          const aKE = rollingAvg(roll.KE), aPE = rollingAvg(roll.PE);
          setMeas({T:aT,P:aP,KE:aKE,PE:aPE,E:aKE+aPE});

          if (trhoRef.current) {
            const c = trhoRef.current.getContext("2d");
            drawPhaseDiagram(c,trhoRef.current.width,trhoRef.current.height,aT,N/(BOX_WIDTH*BOX_WIDTH),1.0,"ρ*",TRHO_REGIONS);
          }
          if (tpRef.current) {
            const c = tpRef.current.getContext("2d");
            drawPhaseDiagram(c,tpRef.current.width,tpRef.current.height,aT,aP,5,"P*",TP_REGIONS);
          }
        }
      }

      // ── Render ──
      const dpr = canvas.width / CANVAS_SIZE;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
      ctx.fillStyle = "#0c1222";
      ctx.fillRect(0,0,CANVAS_SIZE,CANVAS_SIZE);

      // Grid
      ctx.strokeStyle = "#1a2744"; ctx.lineWidth = 0.5;
      const gs = BOX_WIDTH/10*PX_PER_UNIT;
      for (let g=gs;g<CANVAS_SIZE;g+=gs) {
        ctx.beginPath(); ctx.moveTo(g,0); ctx.lineTo(g,CANVAS_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,g); ctx.lineTo(CANVAS_SIZE,g); ctx.stroke();
      }

      // Walls
      ctx.strokeStyle = "#475569"; ctx.lineWidth = 2;
      ctx.strokeRect(1,1,CANVAS_SIZE-2,CANVAS_SIZE-2);
      ctx.shadowColor = "#60a5fa"; ctx.shadowBlur = 6;
      ctx.strokeStyle = "#334155"; ctx.lineWidth = 1;
      ctx.strokeRect(1,1,CANVAS_SIZE-2,CANVAS_SIZE-2);
      ctx.shadowBlur = 0;

      // Bond lines
      if (meas.T < 0.5 && N > 1) {
        ctx.globalAlpha = 0.1; ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 0.5;
        const bt2 = BOND_DRAW_THRESHOLD * BOND_DRAW_THRESHOLD;
        for (let i=0;i<N;i++) for (let j=i+1;j<N;j++) {
          const dx=x[i]-x[j], dy=y[i]-y[j];
          if (dx*dx+dy*dy < bt2) {
            ctx.beginPath();
            ctx.moveTo(x[i]*PX_PER_UNIT, CANVAS_SIZE-y[i]*PX_PER_UNIT);
            ctx.lineTo(x[j]*PX_PER_UNIT, CANVAS_SIZE-y[j]*PX_PER_UNIT);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      // Particles
      const thSpd = Math.sqrt(2*Math.max(temperature,0.01));
      const pr = Math.max(0.45*PX_PER_UNIT, 2);
      for (let i=0;i<N;i++) {
        const spd = Math.sqrt(vx[i]*vx[i]+vy[i]*vy[i]);
        const col = speedColor(spd,thSpd);
        const px = x[i]*PX_PER_UNIT;
        const py = CANVAS_SIZE - y[i]*PX_PER_UNIT; // Y-flip: physics Y-up → canvas Y-down
        ctx.beginPath(); ctx.arc(px,py,pr,0,Math.PI*2);
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = pr;
        ctx.fill(); ctx.shadowBlur = 0;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [paused, gravity, temperature, meas.T]);

  const handleReset = () => {
    simRef.current = createSim(numParticles, temperature);
    rollingRef.current = {T:[],P:[],KE:[],PE:[],frame:0};
  };

  const handlePreset = (p) => {
    setTemperature(p.T);
    setNumParticles(p.N);
    setGravity(p.gravity);
    const initT = p.initT || p.T;
    simRef.current = createSim(p.N, initT);
    if (p.initT && p.initT !== p.T) {
      // For quench: init hot, then immediately rescale to target
      // (thermostat-free, so system will cool naturally... but actually
      // let's let it start hot and the user sees it evolve)
    }
    rollingRef.current = {T:[],P:[],KE:[],PE:[],frame:0};
  };

  const rho = numParticles / (BOX_WIDTH * BOX_WIDTH);
  const errT = meas.T > 0 ? Math.abs(meas.T - temperature) / Math.max(temperature,0.01) : 0;

  return (
    <div style={{minHeight:"100vh",background:"#0a0f1e",fontFamily:"'IBM Plex Sans','Segoe UI',system-ui,sans-serif",color:"#e2e8f0",padding:"20px 16px"}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{maxWidth:960,margin:"0 auto 16px"}}>
        <h1 style={{fontSize:22,fontWeight:600,margin:"0 0 4px",background:"linear-gradient(135deg,#60a5fa,#a78bfa)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:"-0.02em"}}>
          Phase Explorer
        </h1>
        <p style={{fontSize:13,color:"#64748b",margin:0,fontFamily:"'IBM Plex Mono',monospace"}}>
          V(r) = 4ε[(σ/r)<sup>12</sup> − (σ/r)<sup>6</sup>] &nbsp;→&nbsp; solid · liquid · gas emerge from one simple potential
        </p>
      </div>

      <div style={{maxWidth:960,margin:"0 auto",display:"flex",gap:16,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 480px",minWidth:300}}>
          <canvas ref={canvasRef} width={CANVAS_SIZE*2} height={CANVAS_SIZE*2}
            style={{width:"100%",maxWidth:CANVAS_SIZE,aspectRatio:"1",borderRadius:8,border:"1px solid #1e293b",background:"#0c1222"}} />
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8,fontSize:11,color:"#64748b",fontFamily:"'IBM Plex Mono',monospace"}}>
            <span>slow</span>
            <div style={{flex:1,maxWidth:160,height:6,borderRadius:3,background:"linear-gradient(to right,#3c8cff,#78dcff,#fff,#ffb060,#ff3c19)"}} />
            <span>fast</span>
            <span style={{marginLeft:12,color:"#475569"}}>N={numParticles} T*={temperature.toFixed(2)} ρ*={rho.toFixed(3)}</span>
          </div>
        </div>

        <div style={{flex:"1 1 240px",minWidth:220,maxWidth:340}}>
          <div style={{background:"#111827",borderRadius:8,padding:16,border:"1px solid #1e293b"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <span style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em"}}>Controls</span>
              <button onClick={()=>setPaused(!paused)} style={{
                background:paused?"#22c55e33":"#ef444433",color:paused?"#4ade80":"#f87171",
                border:`1px solid ${paused?"#22c55e44":"#ef444444"}`,borderRadius:4,padding:"3px 10px",
                fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:500,
              }}>{paused?"▶ PLAY":"⏸ PAUSE"}</button>
            </div>
            <Slider label="Temperature T*" value={temperature} min={0.05} max={1.5} step={0.05} onChange={setTemperature} color="#f59e0b" />
            <Slider label={`Particles N (ρ*=${rho.toFixed(3)})`} value={numParticles} min={50} max={500} step={10} onChange={v=>setNumParticles(Math.round(v))} color="#60a5fa" />
            <div style={{display:"flex",gap:8,marginTop:4}}>
              <button onClick={()=>setGravity(!gravity)} style={{
                flex:1,background:gravity?"#22c55e22":"#1e293b",color:gravity?"#4ade80":"#64748b",
                border:`1px solid ${gravity?"#22c55e44":"#334155"}`,borderRadius:4,padding:"6px 0",
                fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:500,
              }}>{gravity?"⬇ GRAVITY ON":"GRAVITY OFF"}</button>
              <button onClick={handleReset} style={{
                flex:1,background:"#1e293b",border:"1px solid #334155",borderRadius:4,padding:"6px 0",
                color:"#94a3b8",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",
              }}>↺ RESET</button>
            </div>
          </div>

          <div style={{background:"#111827",borderRadius:8,padding:16,marginTop:12,border:"1px solid #1e293b"}}>
            <span style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em"}}>Phase Diagrams</span>
            <div style={{display:"flex",gap:8,marginTop:10}}>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:"#64748b",fontFamily:"'IBM Plex Mono',monospace",marginBottom:4,textAlign:"center"}}>T* vs ρ*</div>
                <canvas ref={trhoRef} width={320} height={240} style={{width:"100%",aspectRatio:"4/3",borderRadius:4,border:"1px solid #1e293b"}} />
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:"#64748b",fontFamily:"'IBM Plex Mono',monospace",marginBottom:4,textAlign:"center"}}>T* vs P*</div>
                <canvas ref={tpRef} width={320} height={240} style={{width:"100%",aspectRatio:"4/3",borderRadius:4,border:"1px solid #1e293b"}} />
              </div>
            </div>
          </div>

          <div style={{background:"#111827",borderRadius:8,padding:16,marginTop:12,border:"1px solid #1e293b"}}>
            <span style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:10}}>Measurements</span>
            <MRow label="T* (measured)" value={meas.T.toFixed(3)} color={errT<0.15?"#4ade80":"#f87171"} />
            <MRow label="P* (wall)" value={meas.P.toFixed(3)} color="#fbbf24" />
            <MRow label="KE" value={meas.KE.toFixed(1)} color="#60a5fa" />
            <MRow label="PE" value={meas.PE.toFixed(1)} color="#c084fc" />
            <MRow label="Total E" value={meas.E.toFixed(1)} color="#e2e8f0" />
          </div>

          <div style={{background:"#111827",borderRadius:8,padding:16,marginTop:12,border:"1px solid #1e293b"}}>
            <span style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:10}}>Presets</span>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {PRESETS.map((p,i) => (
                <button key={i} onClick={()=>handlePreset(p)} style={{
                  background:"#1e293b",color:"#c8ccd0",border:"1px solid #334155",borderRadius:4,
                  padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",
                  transition:"background 0.15s",
                }} onMouseEnter={e=>e.target.style.background="#2a3140"} onMouseLeave={e=>e.target.style.background="#1e293b"}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{maxWidth:960,margin:"16px auto 0"}}>
        <div style={{background:"#111827",borderRadius:8,padding:"14px 16px",border:"1px solid #1e293b",fontSize:12,color:"#94a3b8",lineHeight:1.7,fontFamily:"'IBM Plex Mono',monospace"}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:24}}>
            <div style={{flex:"1 1 280px"}}>
              <span style={{color:"#60a5fa",fontWeight:600}}>Lennard-Jones Potential:</span><br/>
              • Strong repulsion at close range (σ/r)¹²<br/>
              • Weak attraction at medium range (σ/r)⁶<br/>
              • Minimum energy at r ≈ 1.12σ<br/>
              • All three phases emerge from this alone
            </div>
            <div style={{flex:"1 1 280px"}}>
              <span style={{color:"#f59e0b",fontWeight:600}}>Phase Transitions:</span><br/>
              • Solid: particles locked in hexagonal lattice<br/>
              • Liquid: particles stay close but flow freely<br/>
              • Gas: particles fly independently<br/>
              • At the triple point, all three coexist
            </div>
            <div style={{flex:"1 1 280px"}}>
              <span style={{color:"#4ade80",fontWeight:600}}>Try This:</span><br/>
              {meas.T < 0.3
                ? "Notice the hexagonal crystal structure. Slowly raise T* to watch it melt."
                : meas.T < 0.55
                ? "You're in the liquid/transition regime. Try the Triple Point preset with gravity to see coexistence."
                : "Gas phase — particles move freely. Lower T* slowly to watch condensation and crystallization."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
