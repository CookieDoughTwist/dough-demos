import { useState, useEffect, useRef } from "react";

// Yard-sale model: random pairs flip a fair coin, loser pays the winner a
// fraction of (a) the poorer player's wealth or (b) the loser's own wealth.

const N = 1000;
const START = 100;
const TOTAL = N * START;
const DAYS_PER_YEAR = 365;
const LOG_FLOOR = 0.01; // $0.01: anything below sits on the baseline
const MAX_HISTORY = 3000;
const STATS_EVERY = 6; // frames between React stat updates

const C = {
  bg: "#0a0f1e",
  panel: "#111827",
  plot: "#0c1222",
  border: "#1e293b",
  grid: "#1a2744",
  text: "#e2e8f0",
  text2: "#94a3b8",
  muted: "#64748b",
  blue: "#3987e5",
  orange: "#d95926",
  violet: "#9085e9",
};
const MONO = "'IBM Plex Mono', monospace";

// Small seeded PRNG so a seed always replays the same history.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSim(seed) {
  const w = new Float64Array(N).fill(START);
  const perm = new Int32Array(N);
  for (let i = 0; i < N; i++) perm[i] = i;
  return {
    seed, rng: mulberry32(seed), w, perm,
    order: Array.from({ length: N }, (_, i) => i),
    day: 0, firstHalfDay: null,
    history: [{ day: 0, top: 1 / N, bottom: 0.5 }],
    sampleEvery: 1, lastSample: 0,
  };
}

function stepDay(sim, rule, frac, tax) {
  const { w, perm, rng } = sim;
  // Fisher-Yates shuffle, then pair neighbours.
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let k = 0; k < N; k += 2) {
    const a = perm[k], b = perm[k + 1];
    const aWins = rng() < 0.5;
    const win = aWins ? a : b, lose = aWins ? b : a;
    const stake = rule === "poorer"
      ? frac * Math.min(w[a], w[b])
      : frac * w[lose];
    w[win] += stake;
    w[lose] -= stake;
  }
  if (tax > 0) {
    let pot = 0;
    for (let i = 0; i < N; i++) { const t = w[i] * tax; w[i] -= t; pot += t; }
    const share = pot / N;
    for (let i = 0; i < N; i++) w[i] += share;
  }
  sim.day++;
  if (sim.firstHalfDay === null) {
    let max = 0;
    for (let i = 0; i < N; i++) if (w[i] > max) max = w[i];
    if (max >= TOTAL / 2) sim.firstHalfDay = sim.day;
  }
}

function sortAndSample(sim) {
  const { w, order } = sim;
  order.sort((a, b) => w[a] - w[b]);
  let bottom = 0;
  for (let r = 0; r < N / 2; r++) bottom += w[order[r]];
  const top = w[order[N - 1]];
  if (sim.day - sim.lastSample >= sim.sampleEvery) {
    sim.history.push({ day: sim.day, top: top / TOTAL, bottom: bottom / TOTAL });
    sim.lastSample = sim.day;
    if (sim.history.length > MAX_HISTORY) {
      sim.history = sim.history.filter((_, i) => i % 2 === 0 || i === sim.history.length - 1);
      sim.sampleEvery *= 2;
    }
  }
}

function computeStats(sim, rule, frac) {
  const { w, order } = sim;
  const sorted = order.map(i => w[i]);
  let gNum = 0, under1 = 0;
  for (let r = 0; r < N; r++) {
    gNum += (2 * (r + 1) - N - 1) * sorted[r];
    if (sorted[r] < 1) under1++;
  }
  // What fraction of your own money is on the line if you lose a flip,
  // averaged over every possible partner.
  const riskOf = (i) => {
    if (rule === "loser") return frac;
    const wi = w[i];
    if (wi <= 0) return frac;
    let s = 0;
    for (let j = 0; j < N; j++) if (j !== i) s += w[j] >= wi ? 1 : w[j] / wi;
    return (frac * s) / (N - 1);
  };
  const richest = order[N - 1];
  const median = order[N / 2];
  return {
    years: sim.day / DAYS_PER_YEAR,
    topShare: sorted[N - 1] / TOTAL,
    median: (sorted[N / 2 - 1] + sorted[N / 2]) / 2,
    under1,
    gini: gNum / (N * TOTAL),
    riskRichest: riskOf(richest),
    riskMedian: riskOf(median),
    firstHalfYear: sim.firstHalfDay === null ? null : sim.firstHalfDay / DAYS_PER_YEAR,
    you: w[0],
  };
}

function fmtMoney(v) {
  if (v === 0) return "$0";
  if (v < 1e-300) return "≈$0";
  if (v < 0.01) return "$" + v.toExponential(0);
  if (v < 10) return "$" + v.toFixed(2);
  if (v < 1000) return "$" + Math.round(v);
  return "$" + +(v / 1000).toFixed(v < 10000 ? 2 : 1) + "k";
}
function fmtPct(p) {
  if (p >= 0.1) return (p * 100).toFixed(1) + "%";
  if (p >= 0.001) return (p * 100).toFixed(2) + "%";
  return (p * 100).toPrecision(2) + "%";
}

// Size a canvas to its CSS box at device pixel ratio; return CSS dimensions.
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  const W = Math.round(width * dpr), H = Math.round(height * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawTooltip(ctx, x, y, lines, width) {
  ctx.font = `11px ${MONO}`;
  const pad = 6, lh = 15;
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
  const th = lines.length * lh + pad;
  let tx = x + 10; if (tx + tw > width - 4) tx = x - tw - 10;
  let ty = Math.max(4, y - th - 8);
  ctx.fillStyle = "rgba(17,24,39,0.95)";
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, tx + pad, ty + pad / 2 + 2 + i * lh));
}

function drawWealth(canvas, sim, logScale, hover) {
  const { ctx, width, height } = fitCanvas(canvas);
  const m = { l: 52, r: 12, t: 14, b: 30 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const { w, order } = sim;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = C.plot; ctx.fillRect(0, 0, width, height);

  let yOf, ticks;
  if (logScale) {
    const lo = Math.log10(LOG_FLOOR), hi = Math.log10(TOTAL);
    yOf = v => m.t + ph * (1 - (Math.log10(Math.max(v, LOG_FLOOR)) - lo) / (hi - lo));
    ticks = [0.01, 1, 100, 10000].map(v => [v, v < 1 ? "1¢" : fmtMoney(v)]);
  } else {
    const top = w[order[N - 1]];
    const step = niceStep(top / 4);
    const hi = Math.max(step * Math.ceil((top * 1.05) / step), step);
    yOf = v => m.t + ph * (1 - v / hi);
    ticks = [];
    for (let v = 0; v <= hi + 1e-9; v += step) ticks.push([v, fmtMoney(v)]);
  }
  const xOf = r => m.l + (r / N) * pw;

  // Grid + y labels
  ctx.font = `10px ${MONO}`; ctx.textBaseline = "middle"; ctx.textAlign = "right";
  for (const [v, label] of ticks) {
    const y = yOf(v);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.fillText(label, m.l - 6, y);
  }

  // Area for everyone, poorest to richest
  const base = m.t + ph;
  ctx.beginPath(); ctx.moveTo(xOf(0), base);
  for (let r = 0; r < N; r++) {
    const y = yOf(w[order[r]]);
    ctx.lineTo(xOf(r), y); ctx.lineTo(xOf(r + 1), y);
  }
  ctx.lineTo(xOf(N), base); ctx.closePath();
  ctx.fillStyle = "rgba(57,135,229,0.35)"; ctx.fill();
  ctx.beginPath();
  for (let r = 0; r < N; r++) {
    const y = yOf(w[order[r]]);
    if (r === 0) ctx.moveTo(xOf(r), y); else ctx.lineTo(xOf(r), y);
    ctx.lineTo(xOf(r + 1), y);
  }
  ctx.strokeStyle = C.blue; ctx.lineWidth = 2; ctx.stroke();

  // Average line ($100, never changes)
  const ya = yOf(START);
  ctx.setLineDash([4, 4]); ctx.strokeStyle = C.text2; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(m.l, ya); ctx.lineTo(m.l + pw, ya); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.text2; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  ctx.fillText("average $100", m.l + 6, ya - 3);

  // "You" = person #0, tracked through the ranks
  const youRank = order.indexOf(0);
  const yx = xOf(youRank + 0.5), yy = yOf(w[0]);
  ctx.fillStyle = C.violet; ctx.strokeStyle = C.plot; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(yx, yy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.text; ctx.textBaseline = "bottom"; ctx.font = `10px ${MONO}`;
  const youLabel = "you " + fmtMoney(w[0]);
  const flip = yx + 8 + ctx.measureText(youLabel).width > m.l + pw;
  ctx.textAlign = flip ? "right" : "left";
  ctx.fillText(youLabel, yx + (flip ? -8 : 8), yy - 6);

  // X axis
  ctx.fillStyle = C.muted; ctx.textBaseline = "top"; ctx.font = `10px ${MONO}`;
  ctx.textAlign = "left"; ctx.fillText("poorest", m.l, base + 8);
  ctx.textAlign = "center"; ctx.fillText("1,000 people, sorted", m.l + pw / 2, base + 8);
  ctx.textAlign = "right"; ctx.fillText("richest", m.l + pw, base + 8);

  // Hover
  if (hover && hover.x >= m.l && hover.x <= m.l + pw) {
    const r = Math.min(N - 1, Math.max(0, Math.floor(((hover.x - m.l) / pw) * N)));
    const v = w[order[r]];
    const hx = xOf(r + 0.5);
    ctx.strokeStyle = "#475569"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, m.t); ctx.lineTo(hx, base); ctx.stroke();
    ctx.fillStyle = C.blue; ctx.strokeStyle = C.plot; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx, yOf(v), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawTooltip(ctx, hx, yOf(v), [
      `rank ${N - r} of ${N}${order[r] === 0 ? " (you)" : ""}`,
      `wealth ${fmtMoney(v)}`,
      `share ${fmtPct(v / TOTAL)}`,
    ], width);
  }
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function drawHistory(canvas, sim, hover) {
  const { ctx, width, height } = fitCanvas(canvas);
  const m = { l: 40, r: 12, t: 12, b: 26 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const years = sim.day / DAYS_PER_YEAR;
  let xmax = 20; while (xmax < years) xmax *= 2;
  const xOf = y => m.l + (y / xmax) * pw;
  const yOf = s => m.t + ph * (1 - s);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = C.plot; ctx.fillRect(0, 0, width, height);

  ctx.font = `10px ${MONO}`;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const s of [0, 0.25, 0.5, 0.75, 1]) {
    ctx.strokeStyle = s === 0.5 ? "#334155" : C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(m.l, yOf(s)); ctx.lineTo(m.l + pw, yOf(s)); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.fillText(Math.round(s * 100) + "%", m.l - 6, yOf(s));
  }
  ctx.textBaseline = "top";
  for (let i = 0; i <= 4; i++) {
    const y = (xmax / 4) * i;
    ctx.textAlign = i === 4 ? "right" : "center";
    ctx.fillText(i === 4 ? `${y} yr` : `${y}`, xOf(y), m.t + ph + 8);
  }

  const h = sim.history;
  const line = (key, color) => {
    ctx.beginPath();
    h.forEach((p, i) => {
      const x = xOf(p.day / DAYS_PER_YEAR), y = yOf(p[key]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  };
  line("bottom", C.orange);
  line("top", C.blue);

  // Direct labels at the line ends
  const last = h[h.length - 1];
  ctx.font = `10px ${MONO}`; ctx.fillStyle = C.text2; ctx.textBaseline = "middle";
  const lx = xOf(last.day / DAYS_PER_YEAR);
  const floorY = m.t + ph - 7; // keep labels clear of the x-axis numbers
  const ly1 = Math.min(yOf(last.top), floorY), ly2 = Math.min(yOf(last.bottom), floorY);
  const apart = Math.abs(ly1 - ly2) > 12;
  const labelX = lx > m.l + pw - 90 ? lx - 6 : lx + 6;
  ctx.textAlign = lx > m.l + pw - 90 ? "right" : "left";
  const mid = Math.min((ly1 + ly2) / 2, floorY - 7);
  const topFirst = ly1 <= ly2;
  ctx.fillText("richest person", labelX, apart ? ly1 : mid + (topFirst ? -7 : 7));
  ctx.fillText("bottom half", labelX, apart ? ly2 : mid + (topFirst ? 7 : -7));

  if (sim.firstHalfDay !== null) {
    const fy = sim.firstHalfDay / DAYS_PER_YEAR;
    const x = xOf(fy), y = yOf(0.5);
    ctx.fillStyle = C.text; ctx.strokeStyle = C.plot; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.text; ctx.textBaseline = "top";
    ctx.textAlign = x > m.l + pw * 0.6 ? "right" : "left";
    ctx.fillText(`50% in year ${fy.toFixed(1)}`, x + (ctx.textAlign === "left" ? 8 : -8), y + 6);
  }

  if (hover && hover.x >= m.l && hover.x <= m.l + pw && h.length > 1) {
    const yr = ((hover.x - m.l) / pw) * xmax;
    const target = yr * DAYS_PER_YEAR;
    let best = h[0];
    for (const p of h) if (Math.abs(p.day - target) < Math.abs(best.day - target)) best = p;
    const hx = xOf(best.day / DAYS_PER_YEAR);
    ctx.strokeStyle = "#475569"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, m.t); ctx.lineTo(hx, m.t + ph); ctx.stroke();
    for (const [k, col] of [["top", C.blue], ["bottom", C.orange]]) {
      ctx.fillStyle = col; ctx.strokeStyle = C.plot; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, yOf(best[k]), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    drawTooltip(ctx, hx, Math.min(yOf(best.top), yOf(best.bottom)), [
      `year ${(best.day / DAYS_PER_YEAR).toFixed(1)}`,
      `richest   ${fmtPct(best.top)}`,
      `bottom ½  ${fmtPct(best.bottom)}`,
    ], width);
  }
}

function Panel({ children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, ...style }}>
      {children}
    </div>
  );
}

function Label({ children, color = C.text2 }) {
  return (
    <div style={{ fontSize: 11, color, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {options.map(([v, label]) => (
        <button key={String(v)} onClick={() => onChange(v)} style={{
          flex: "1 1 0", minWidth: 0, padding: "6px 6px", fontSize: 11, cursor: "pointer",
          fontFamily: MONO, borderRadius: 4,
          background: value === v ? "#1e3a5f" : "#0c1222",
          color: value === v ? C.text : C.text2,
          border: `1px solid ${value === v ? C.blue : "#334155"}`,
        }}>{label}</button>
      ))}
    </div>
  );
}

function Slider({ label, value, display, min, max, step, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.text2, marginBottom: 4, fontFamily: MONO }}>
        <span>{label}</span>
        <span style={{ color: C.text, fontWeight: 600 }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: C.blue, cursor: "pointer" }} />
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ flex: "1 1 120px", background: C.plot, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 18, color: C.text, fontFamily: MONO, fontWeight: 500, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const btn = {
  padding: "7px 10px", fontSize: 11, cursor: "pointer", fontFamily: MONO,
  background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: C.text2,
};

export default function YardSaleModel() {
  const wealthRef = useRef(null);
  const histRef = useRef(null);
  const simRef = useRef(null);
  if (simRef.current === null) { simRef.current = makeSim(1); sortAndSample(simRef.current); }
  const hoverRef = useRef({ wealth: null, hist: null });

  const [rule, setRule] = useState("poorer");
  const [frac, setFrac] = useState(0.2);
  const [tax, setTax] = useState(0);
  const [speed, setSpeed] = useState(20);
  const [logScale, setLogScale] = useState(true);
  const [paused, setPaused] = useState(false);
  const [seed, setSeed] = useState(1);
  const [stats, setStats] = useState(() => computeStats(simRef.current, "poorer", 0.2));

  const params = useRef({});
  params.current = { rule, frac, tax, speed, logScale, paused };

  useEffect(() => {
    let raf, frame = 0;
    const loop = () => {
      const p = params.current, sim = simRef.current;
      if (!p.paused) {
        for (let d = 0; d < p.speed; d++) stepDay(sim, p.rule, p.frac, p.tax);
        sortAndSample(sim);
      }
      if (wealthRef.current) drawWealth(wealthRef.current, sim, p.logScale, hoverRef.current.wealth);
      if (histRef.current) drawHistory(histRef.current, sim, hoverRef.current.hist);
      if (frame++ % STATS_EVERY === 0) setStats(computeStats(sim, p.rule, p.frac));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const reset = (s) => {
    simRef.current = makeSim(s);
    sortAndSample(simRef.current);
    setSeed(s);
    setStats(computeStats(simRef.current, rule, frac));
  };

  const stepOnce = () => {
    const sim = simRef.current;
    stepDay(sim, rule, frac, tax);
    sortAndSample(sim);
    setStats(computeStats(sim, rule, frac));
  };

  const hoverHandlers = (key) => ({
    onPointerMove: e => {
      const r = e.currentTarget.getBoundingClientRect();
      hoverRef.current[key] = { x: e.clientX - r.left, y: e.clientY - r.top };
    },
    onPointerDown: e => {
      const r = e.currentTarget.getBoundingClientRect();
      hoverRef.current[key] = { x: e.clientX - r.left, y: e.clientY - r.top };
    },
    onPointerLeave: () => { hoverRef.current[key] = null; },
  });

  const canvasStyle = { width: "100%", display: "block", borderRadius: 6, border: `1px solid ${C.border}`, touchAction: "pan-y" };
  const pctBet = Math.round(frac * 100);

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
      padding: "20px 12px", boxSizing: "border-box",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1000, margin: "0 auto 14px" }}>
        <h1 style={{
          fontSize: 22, fontWeight: 600, margin: "0 0 6px",
          background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          The Fair-Coin Casino
        </h1>
        <p style={{ fontSize: 13, color: C.text2, margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
          1,000 people start with $100. Each day everyone is paired at random and flips a fair coin.
          The loser pays the winner {pctBet}% of {rule === "poorer" ? <b style={{ color: C.text }}>whichever of the two has less money</b> : <b style={{ color: C.text }}>the loser's own money</b>}.
          {tax > 0 && <> At the end of each day everyone pays {(tax * 100).toFixed(2)}% of their wealth into a pot that is split evenly.</>}
          {" "}No money is created or destroyed. The coin is fair. Watch where the money goes.
        </p>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <Label>Everyone's wealth, sorted</Label>
              <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
                {logScale ? "log scale · below 1¢ sits on the floor" : "linear scale"}
              </span>
            </div>
            <canvas ref={wealthRef} style={{ ...canvasStyle, height: 280 }} {...hoverHandlers("wealth")} />
          </Panel>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Stat label="Year" value={stats.years.toFixed(1)}
              sub={stats.firstHalfYear !== null ? `50% hit at yr ${stats.firstHalfYear.toFixed(1)}` : "nobody at 50% yet"} />
            <Stat label="Richest holds" value={fmtPct(stats.topShare)} sub={`Gini ${stats.gini.toFixed(2)}`} />
            <Stat label="Median person" value={fmtMoney(stats.median)} sub="average is always $100" />
            <Stat label="Under $1" value={`${stats.under1}`} sub={`of ${N} people`} />
          </div>

          <Panel>
            <Label>Share of all money over time</Label>
            <div style={{ display: "flex", gap: 14, fontSize: 11, color: C.text2, fontFamily: MONO, marginBottom: 8 }}>
              <span><span style={{ display: "inline-block", width: 12, height: 2, background: C.blue, verticalAlign: "middle", marginRight: 6 }} />richest person</span>
              <span><span style={{ display: "inline-block", width: 12, height: 2, background: C.orange, verticalAlign: "middle", marginRight: 6 }} />bottom 500 combined</span>
            </div>
            <canvas ref={histRef} style={{ ...canvasStyle, height: 200 }} {...hoverHandlers("hist")} />
          </Panel>
        </div>

        <div style={{ flex: "1 1 260px", minWidth: 0, maxWidth: 420, display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <button onClick={() => setPaused(!paused)} style={{
                ...btn, flex: 2,
                background: paused ? "#22c55e22" : "#ef444422",
                color: paused ? "#4ade80" : "#f87171",
                border: `1px solid ${paused ? "#22c55e55" : "#ef444455"}`,
              }}>{paused ? "▶ PLAY" : "⏸ PAUSE"}</button>
              <button onClick={stepOnce} disabled={!paused} style={{ ...btn, flex: 1, opacity: paused ? 1 : 0.4 }}>+1 DAY</button>
            </div>

            <Label color="#60a5fa">Who sets the bet?</Label>
            <Segmented value={rule} onChange={setRule} options={[["poorer", "poorer player"], ["loser", "loser"]]} />
            <div style={{ height: 14 }} />

            <Slider label="Bet size" value={pctBet} display={`${pctBet}%`} min={1} max={50} step={1}
              onChange={v => setFrac(v / 100)} />
            <Slider label="Daily wealth tax, shared equally" value={tax * 100}
              display={tax === 0 ? "off" : `${(tax * 100).toFixed(2)}%`} min={0} max={1} step={0.01}
              onChange={v => setTax(v / 100)} />

            <Label>Days per frame</Label>
            <Segmented value={speed} onChange={setSpeed} options={[[1, "1"], [5, "5"], [20, "20"], [100, "100"], [500, "500"]]} />
            <div style={{ height: 14 }} />

            <Label>Wealth axis</Label>
            <Segmented value={logScale} onChange={setLogScale} options={[[true, "log"], [false, "linear"]]} />

            <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
              <button onClick={() => reset(seed)} style={{ ...btn, flex: 1 }}>↺ RESTART</button>
              <button onClick={() => reset(Math.floor(Math.random() * 1e9))} style={{ ...btn, flex: 1 }}>🎲 NEW SEED</button>
            </div>
            <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO, marginTop: 6 }}>
              seed {seed} · rule changes apply live, mid-run
            </div>
          </Panel>

          <Panel>
            <Label>Money on the line per flip</Label>
            <div style={{ fontSize: 12, fontFamily: MONO, lineHeight: 1.8, color: C.text2 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>richest person</span><span style={{ color: C.text }}>{fmtPct(stats.riskRichest)} of their money</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>median person</span><span style={{ color: C.text }}>{fmtPct(stats.riskMedian)} of their money</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span><span style={{ color: C.violet }}>●</span> you (person #1)</span><span style={{ color: C.text }}>{fmtMoney(stats.you)}</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
              Averaged over every possible partner. Under the poorer-player rule the rich
              barely risk anything, while the poorest (almost always the poorer player) stake the full {pctBet}%.
            </div>
          </Panel>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "14px auto 0" }}>
        <Panel style={{ fontSize: 13, color: C.text2, lineHeight: 1.7 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
            <div style={{ flex: "1 1 280px" }}>
              <div style={{ color: "#60a5fa", fontWeight: 600, marginBottom: 4 }}>Why a fair coin does this</div>
              Bets are a percentage, so wins and losses don't cancel: $100 → win 20% → $120 → lose 20% → <b style={{ color: C.text }}>$96</b>.
              The typical person drifts down even though the coin is fair. Money doesn't vanish. The average stays at $100 because
              a few lucky people hold what everyone else lost.
            </div>
            <div style={{ flex: "1 1 280px" }}>
              <div style={{ color: "#60a5fa", fontWeight: 600, marginBottom: 4 }}>Why it doesn't reverse</div>
              Capping the bet at the poorer player's money protects whoever is ahead. Someone holding $50,000 who flips against
              someone with $5 risks $1, so a losing streak can't knock them back down. Switch the rule to <i>loser</i> and the rich
              stake their own {pctBet}%, and the concentration falls apart within months.
            </div>
            <div style={{ flex: "1 1 280px" }}>
              <div style={{ color: "#4ade80", fontWeight: 600, marginBottom: 4 }}>Try this</div>
              • Run to 50%, then flip the rule to <i>loser</i> mid-run.<br />
              • Leave the rule alone and nudge the wealth tax to 0.05%.<br />
              • Switch to the linear axis to see why the log axis is needed.<br />
              • Drop the bet to 5% at 500 days per frame: about 1,000 years instead of about 60, same ending.
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
            Known in econophysics as the "yard-sale model." Each day is 500 coin flips. One year is 365 days.
            Balances below about 10⁻³⁰⁰ dollars round to zero in the browser's arithmetic and show as ≈$0.
          </div>
        </Panel>
      </div>
    </div>
  );
}
