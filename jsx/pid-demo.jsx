import { useState, useRef, useCallback, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

const HISTORY_SECONDS = 20;
const SAMPLES_PER_SECOND = 60;
const MAX_SAMPLES = HISTORY_SECONDS * SAMPLES_PER_SECOND;
const DT = 1 / SAMPLES_PER_SECOND;
const SUBSTEPS = 4;
const SUB_DT = DT / SUBSTEPS;

// Plant: second-order system  m*y'' + c*y' = u
// Chosen so response is interesting across a range of PID gains
const PLANT_MASS = 1.0;
const PLANT_DAMPING = 0.3;
const OUTPUT_CLAMP = 50;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function stepSim(state, setpoint, kp, ki, kd) {
  let { y, vy, integral, prevError } = state;
  for (let i = 0; i < SUBSTEPS; i++) {
    const error = setpoint - y;
    integral += error * SUB_DT;
    // Anti-windup: clamp integral
    integral = clamp(integral, -OUTPUT_CLAMP / Math.max(ki, 0.01), OUTPUT_CLAMP / Math.max(ki, 0.01));
    const derivative = (error - prevError) / SUB_DT;
    let u = kp * error + ki * integral + kd * derivative;
    u = clamp(u, -OUTPUT_CLAMP, OUTPUT_CLAMP);
    const ay = (u - PLANT_DAMPING * vy) / PLANT_MASS;
    vy += ay * SUB_DT;
    y += vy * SUB_DT;
    prevError = error;
  }
  return { y, vy, integral, prevError };
}

const PRESETS = [
  { label: "P only (underdamped)", kp: 8, ki: 0, kd: 0 },
  { label: "PI (overshoot + correct)", kp: 5, ki: 2, kd: 0 },
  { label: "PD (fast, no steady-state fix)", kp: 8, ki: 0, kd: 3 },
  { label: "Well-tuned PID", kp: 10, ki: 3, kd: 4 },
  { label: "Aggressive (unstable)", kp: 30, ki: 15, kd: 0.5 },
];

function Slider({ label, value, onChange, min, max, step, color }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: color || "#c8ccd0", letterSpacing: 0.5 }}>
          {label}
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: color || "#e0e0e0", fontWeight: 600 }}>
          {value.toFixed(1)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color || "#6cf", height: 6, cursor: "pointer" }}
      />
    </div>
  );
}

export default function PIDDemo() {
  const [kp, setKp] = useState(10);
  const [ki, setKi] = useState(3);
  const [kd, setKd] = useState(4);
  const [setpoint, setSetpoint] = useState(10);
  const [running, setRunning] = useState(true);
  const [data, setData] = useState([]);
  const [currentY, setCurrentY] = useState(0);

  const simRef = useRef({ y: 0, vy: 0, integral: 0, prevError: 0 });
  const timeRef = useRef(0);
  const dataRef = useRef([]);
  const gainsRef = useRef({ kp, ki, kd });
  const setpointRef = useRef(setpoint);
  const runningRef = useRef(running);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(null);

  gainsRef.current = { kp, ki, kd };
  setpointRef.current = setpoint;
  runningRef.current = running;

  const tick = useCallback(() => {
    if (!runningRef.current) {
      rafRef.current = requestAnimationFrame(tick);
      lastFrameRef.current = null;
      return;
    }
    const now = performance.now();
    if (lastFrameRef.current === null) {
      lastFrameRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    // Accumulate real elapsed time, step in fixed increments
    let elapsed = (now - lastFrameRef.current) / 1000;
    lastFrameRef.current = now;
    // Cap to avoid spiral of death
    elapsed = Math.min(elapsed, 0.1);

    const stepsNeeded = Math.floor(elapsed * SAMPLES_PER_SECOND);
    const { kp, ki, kd } = gainsRef.current;
    const sp = setpointRef.current;

    for (let s = 0; s < stepsNeeded; s++) {
      simRef.current = stepSim(simRef.current, sp, kp, ki, kd);
      timeRef.current += DT;
      const t = parseFloat(timeRef.current.toFixed(2));
      dataRef.current.push({ t, y: parseFloat(simRef.current.y.toFixed(4)), sp });
      if (dataRef.current.length > MAX_SAMPLES) {
        dataRef.current = dataRef.current.slice(-MAX_SAMPLES);
      }
    }

    if (stepsNeeded > 0) {
      setData([...dataRef.current]);
      setCurrentY(simRef.current.y);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [tick]);

  const handleReset = () => {
    simRef.current = { y: 0, vy: 0, integral: 0, prevError: 0 };
    timeRef.current = 0;
    dataRef.current = [];
    lastFrameRef.current = null;
    setData([]);
    setCurrentY(0);
  };

  const handlePreset = (p) => {
    setKp(p.kp); setKi(p.ki); setKd(p.kd);
    handleReset();
  };

  const error = setpoint - currentY;

  // Compute axis domain
  const allVals = data.length > 0
    ? data.flatMap(d => [d.y, d.sp])
    : [0, setpoint];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const pad = Math.max((maxVal - minVal) * 0.25, 2);
  const yMin = Math.floor(minVal - pad);
  const yMax = Math.ceil(maxVal + pad);

  // Thin data for chart performance
  const chartData = data.length > 600
    ? data.filter((_, i) => i % Math.ceil(data.length / 600) === 0 || i === data.length - 1)
    : data;

  return (
    <div style={{
      background: "#0e1117", color: "#c8ccd0", minHeight: "100vh",
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif", padding: "24px 20px",
      display: "flex", flexDirection: "column", gap: 16
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        input[type=range] { -webkit-appearance: none; appearance: none; background: #1e2430; border-radius: 3px; outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: currentColor; cursor: pointer; }
      `}</style>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{
          margin: 0, fontSize: 22, fontWeight: 600, color: "#e8eaed",
          fontFamily: "'IBM Plex Mono', monospace", letterSpacing: -0.5
        }}>
          PID Controller
        </h1>
        <span style={{ fontSize: 13, color: "#6b7280", fontFamily: "'IBM Plex Mono', monospace" }}>
          interactive demo
        </span>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {/* Left panel: controls */}
        <div style={{ flex: "0 0 260px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Gains */}
          <div style={{ background: "#161b22", borderRadius: 8, padding: 16, border: "1px solid #21262d" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "#6b7280", marginBottom: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
              Gains
            </div>
            <Slider label="Kp" value={kp} onChange={setKp} min={0} max={40} step={0.5} color="#f97066" />
            <Slider label="Ki" value={ki} onChange={setKi} min={0} max={20} step={0.5} color="#60d4a4" />
            <Slider label="Kd" value={kd} onChange={setKd} min={0} max={15} step={0.25} color="#6cb6ff" />
          </div>

          {/* Setpoint */}
          <div style={{ background: "#161b22", borderRadius: 8, padding: 16, border: "1px solid #21262d" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "#6b7280", marginBottom: 12, fontFamily: "'IBM Plex Mono', monospace" }}>
              Setpoint
            </div>
            <Slider label="Target" value={setpoint} onChange={setSetpoint} min={-20} max={20} step={0.5} color="#f0c060" />
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {[-10, 0, 5, 10, 15].map(v => (
                <button key={v} onClick={() => setSetpoint(v)} style={{
                  background: setpoint === v ? "#f0c060" : "#21262d",
                  color: setpoint === v ? "#0e1117" : "#c8ccd0",
                  border: "none", borderRadius: 4, padding: "4px 10px",
                  fontSize: 12, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: 500, transition: "all 0.15s"
                }}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div style={{ background: "#161b22", borderRadius: 8, padding: 16, border: "1px solid #21262d" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "#6b7280", marginBottom: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
              Status
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
              <span style={{ color: "#6b7280" }}>PV:</span>
              <span style={{ color: "#6cb6ff", textAlign: "right" }}>{currentY.toFixed(2)}</span>
              <span style={{ color: "#6b7280" }}>SP:</span>
              <span style={{ color: "#f0c060", textAlign: "right" }}>{setpoint.toFixed(1)}</span>
              <span style={{ color: "#6b7280" }}>Error:</span>
              <span style={{ color: Math.abs(error) < 0.5 ? "#60d4a4" : "#f97066", textAlign: "right" }}>{error.toFixed(2)}</span>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setRunning(r => !r)} style={{
              flex: 1, background: running ? "#21262d" : "#238636", color: "#e8eaed",
              border: "1px solid #30363d", borderRadius: 6, padding: "8px 0",
              fontSize: 13, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500
            }}>
              {running ? "⏸ Pause" : "▶ Run"}
            </button>
            <button onClick={handleReset} style={{
              flex: 1, background: "#21262d", color: "#e8eaed",
              border: "1px solid #30363d", borderRadius: 6, padding: "8px 0",
              fontSize: 13, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500
            }}>
              ↺ Reset
            </button>
          </div>

          {/* Presets */}
          <div style={{ background: "#161b22", borderRadius: 8, padding: 16, border: "1px solid #21262d" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "#6b7280", marginBottom: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
              Presets
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PRESETS.map((p, i) => (
                <button key={i} onClick={() => handlePreset(p)} style={{
                  background: "#21262d", color: "#c8ccd0", border: "1px solid #30363d",
                  borderRadius: 4, padding: "6px 10px", fontSize: 12, cursor: "pointer",
                  fontFamily: "'IBM Plex Mono', monospace", textAlign: "left",
                  transition: "background 0.15s"
                }}
                  onMouseEnter={e => e.target.style.background = "#2a3140"}
                  onMouseLeave={e => e.target.style.background = "#21262d"}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div style={{ flex: 1, minWidth: 0, background: "#161b22", borderRadius: 8, padding: "16px 12px 8px 0", border: "1px solid #21262d" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "#6b7280", marginBottom: 8, marginLeft: 16, fontFamily: "'IBM Plex Mono', monospace" }}>
            Response
            <span style={{ marginLeft: 16 }}>
              <span style={{ color: "#f0c060" }}>━</span> setpoint
              <span style={{ marginLeft: 12, color: "#6cb6ff" }}>━</span> process variable
            </span>
          </div>
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
              <XAxis
                dataKey="t" type="number" domain={["dataMin", "dataMax"]}
                tick={{ fill: "#484f58", fontSize: 11, fontFamily: "IBM Plex Mono" }}
                tickFormatter={v => v.toFixed(0) + "s"}
                stroke="#21262d"
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: "#484f58", fontSize: 11, fontFamily: "IBM Plex Mono" }}
                stroke="#21262d"
              />
              <Tooltip
                contentStyle={{ background: "#1c2128", border: "1px solid #30363d", borderRadius: 6, fontFamily: "IBM Plex Mono", fontSize: 12 }}
                labelFormatter={v => `t = ${parseFloat(v).toFixed(2)}s`}
                formatter={(v, name) => [parseFloat(v).toFixed(3), name === "sp" ? "Setpoint" : "PV"]}
              />
              <Line type="monotone" dataKey="sp" stroke="#f0c060" strokeWidth={2} dot={false} strokeDasharray="6 3" isAnimationActive={false} />
              <Line type="monotone" dataKey="y" stroke="#6cb6ff" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Info bar */}
      <div style={{
        background: "#161b22", borderRadius: 8, padding: "12px 16px",
        border: "1px solid #21262d", fontSize: 13, color: "#6b7280",
        fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.6
      }}>
        <strong style={{ color: "#c8ccd0" }}>Plant:</strong> second-order (m={PLANT_MASS}, damping={PLANT_DAMPING}) &nbsp;|&nbsp;
        <strong style={{ color: "#c8ccd0" }}>Try:</strong> Set high Kp with no Kd to see oscillation. Add Ki to eliminate steady-state error. Change setpoint mid-transient to see how the controller copes.
        Output clamped to ±{OUTPUT_CLAMP}.
      </div>
    </div>
  );
}
