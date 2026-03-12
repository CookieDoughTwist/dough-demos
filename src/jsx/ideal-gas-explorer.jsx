import { useState, useEffect, useRef, useCallback } from "react";

const CANVAS_SIZE = 480;
const DT = 0.25;
const SUBSTEPS = 2;
const FORCE_CUTOFF = 55;
const PRESSURE_WINDOW = 600;
const DISPLAY_INTERVAL = 6;
const THERMOSTAT_INTERVAL = 30;
const THERMOSTAT_STRENGTH = 0.03;

function speedColor(speed, thermal) {
  const r = Math.min(speed / (thermal * 2.2 + 0.01), 1);
  if (r < 0.35) {
    const t = r / 0.35;
    return `rgba(${60 + 60 * t}, ${140 + 80 * t}, 255, 0.95)`;
  } else if (r < 0.65) {
    const t = (r - 0.35) / 0.3;
    return `rgba(${120 + 135 * t}, ${220 + 35 * t}, ${255 - 50 * t}, 0.95)`;
  } else {
    const t = (r - 0.65) / 0.35;
    return `rgba(255, ${255 - 200 * t}, ${205 - 180 * t}, 0.95)`;
  }
}

function initParticles(n, temp, boxSize, radius) {
  const particles = [];
  const margin = Math.max(radius, 3) + 4;
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.sqrt(Math.max(0.1, -2 * temp * Math.log(Math.random() + 1e-10)));
    let x, y, ok = false;
    for (let a = 0; a < 40; a++) {
      x = margin + Math.random() * (boxSize - 2 * margin);
      y = margin + Math.random() * (boxSize - 2 * margin);
      ok = true;
      for (const p of particles) {
        const dx = x - p.x, dy = y - p.y;
        if (Math.sqrt(dx * dx + dy * dy) < 2 * radius + 2) { ok = false; break; }
      }
      if (ok) break;
    }
    if (!ok) {
      x = margin + Math.random() * (boxSize - 2 * margin);
      y = margin + Math.random() * (boxSize - 2 * margin);
    }
    particles.push({ x, y, vx: speed * Math.cos(angle), vy: speed * Math.sin(angle) });
  }
  return particles;
}

function rescaleTemp(particles, temp) {
  if (particles.length === 0) return;
  let sumV2 = 0;
  for (const p of particles) sumV2 += p.vx * p.vx + p.vy * p.vy;
  const mean = sumV2 / particles.length;
  if (mean < 1e-8) {
    for (const p of particles) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(2 * temp);
      p.vx = s * Math.cos(a);
      p.vy = s * Math.sin(a);
    }
    return;
  }
  const scale = Math.sqrt(2 * temp / mean);
  for (const p of particles) { p.vx *= scale; p.vy *= scale; }
}

// Gentle thermostat: nudge velocities toward target temperature without hard reset
function gentleThermostat(particles, temp) {
  if (particles.length === 0) return;
  let sumV2 = 0;
  for (const p of particles) sumV2 += p.vx * p.vx + p.vy * p.vy;
  const currentTemp = sumV2 / (2 * particles.length);
  if (currentTemp < 1e-8) return;
  // Blend toward target
  const targetScale = Math.sqrt(temp / currentTemp);
  const scale = 1 + (targetScale - 1) * THERMOSTAT_STRENGTH;
  for (const p of particles) { p.vx *= scale; p.vy *= scale; }
}

function simStep(particles, boxSize, radius, attraction) {
  const n = particles.length;

  // Inter-particle attraction/repulsion forces
  if (Math.abs(attraction) > 0.001 && n > 1) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const pi = particles[i], pj = particles[j];
        const dx = pj.x - pi.x, dy = pj.y - pi.y;
        const dist2 = dx * dx + dy * dy;
        const dist = Math.sqrt(dist2);
        const minD = 2 * radius + 1;
        if (dist > minD && dist < FORCE_CUTOFF) {
          const fMag = Math.min(Math.abs(attraction) * 0.4 / dist2, 0.8) * Math.sign(attraction);
          const fx = -fMag * dx / dist * DT;
          const fy = -fMag * dy / dist * DT;
          pi.vx += fx; pi.vy += fy;
          pj.vx -= fx; pj.vy -= fy;
        }
      }
    }
  }

  // Hard-sphere collisions
  if (radius > 1) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const pi = particles[i], pj = particles[j];
        const dx = pj.x - pi.x, dy = pj.y - pi.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = 2 * radius;
        if (dist < minD && dist > 0.01) {
          const nx = dx / dist, ny = dy / dist;
          const dvn = (pi.vx - pj.vx) * nx + (pi.vy - pj.vy) * ny;
          if (dvn > 0) {
            pi.vx -= dvn * nx; pi.vy -= dvn * ny;
            pj.vx += dvn * nx; pj.vy += dvn * ny;
            const overlap = (minD - dist) / 2 + 0.5;
            pi.x -= overlap * nx; pi.y -= overlap * ny;
            pj.x += overlap * nx; pj.y += overlap * ny;
          }
        }
      }
    }
  }

  // Move + wall collisions, accumulate impulse
  let impulse = 0;
  for (const p of particles) {
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    if (p.x < radius + 0.5) { p.x = radius + 0.5; impulse += 2 * Math.abs(p.vx); p.vx = Math.abs(p.vx); }
    if (p.x > boxSize - radius - 0.5) { p.x = boxSize - radius - 0.5; impulse += 2 * Math.abs(p.vx); p.vx = -Math.abs(p.vx); }
    if (p.y < radius + 0.5) { p.y = radius + 0.5; impulse += 2 * Math.abs(p.vy); p.vy = Math.abs(p.vy); }
    if (p.y > boxSize - radius - 0.5) { p.y = boxSize - radius - 0.5; impulse += 2 * Math.abs(p.vy); p.vy = -Math.abs(p.vy); }
  }
  return impulse;
}

function PressureBar({ label, value, max, color, textColor }) {
  const pct = max > 0 ? Math.min(Math.max(value / max, 0), 1) * 100 : 0;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: textColor || "#94a3b8", marginBottom: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
        <span>{label}</span>
        <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{value.toFixed(4)}</span>
      </div>
      <div style={{ height: 10, background: "#1e293b", borderRadius: 5, overflow: "hidden", border: "1px solid #334155" }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: color,
          borderRadius: 5, transition: "width 0.15s ease-out",
          boxShadow: `0 0 8px ${color}44`
        }} />
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, unit, color }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
        <span>{label}</span>
        <span style={{ color: color || "#e2e8f0", fontWeight: 600 }}>{typeof value === 'number' ? (Number.isInteger(step) || step >= 1 ? value : value.toFixed(1)) : value}{unit || ""}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%", height: 6, appearance: "none", background: "#334155",
          borderRadius: 3, outline: "none", cursor: "pointer",
          accentColor: color || "#60a5fa",
        }}
      />
    </div>
  );
}

export default function IdealGasExplorer() {
  const canvasRef = useRef(null);
  const simRef = useRef({ particles: [], pressureAccum: [], frame: 0 });
  const rafRef = useRef(null);
  const prevParamsRef = useRef({});

  const [temperature, setTemperature] = useState(6);
  const [numParticles, setNumParticles] = useState(50);
  const [boxSize, setBoxSize] = useState(340);
  const [particleRadius, setParticleRadius] = useState(3);
  const [attraction, setAttraction] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pressures, setPressures] = useState({ measured: 0, ideal: 0, vdw: 0, measuredTemp: 0 });

  // Initialize
  useEffect(() => {
    simRef.current.particles = initParticles(numParticles, temperature, boxSize, particleRadius);
    simRef.current.pressureAccum = [];
    simRef.current.frame = 0;
    prevParamsRef.current = { numParticles, temperature, boxSize, particleRadius, attraction };
  }, []);

  // Handle parameter changes
  useEffect(() => {
    const prev = prevParamsRef.current;
    const sim = simRef.current;

    if (prev.temperature !== undefined && prev.temperature !== temperature) {
      rescaleTemp(sim.particles, temperature);
      sim.pressureAccum = [];
    }

    if (prev.numParticles !== undefined && prev.numParticles !== numParticles) {
      const diff = numParticles - sim.particles.length;
      if (diff > 0) {
        const newP = initParticles(diff, temperature, boxSize, particleRadius);
        sim.particles.push(...newP);
      } else if (diff < 0) {
        sim.particles.splice(numParticles);
      }
      sim.pressureAccum = [];
    }

    if (prev.boxSize !== undefined && prev.boxSize !== boxSize) {
      for (const p of sim.particles) {
        p.x = Math.min(Math.max(p.x, particleRadius + 1), boxSize - particleRadius - 1);
        p.y = Math.min(Math.max(p.y, particleRadius + 1), boxSize - particleRadius - 1);
      }
      sim.pressureAccum = [];
    }

    if (prev.particleRadius !== undefined && prev.particleRadius !== particleRadius) {
      sim.pressureAccum = [];
    }
    if (prev.attraction !== undefined && prev.attraction !== attraction) {
      sim.pressureAccum = [];
    }

    prevParamsRef.current = { numParticles, temperature, boxSize, particleRadius, attraction };
  }, [temperature, numParticles, boxSize, particleRadius, attraction]);

  // Compute theoretical pressures
  const computePressures = useCallback((measured) => {
    const N = numParticles;
    const A = boxSize * boxSize;
    const T = temperature;

    const idealP = N * T / A;

    // Van der Waals in 2D: P = NkT/(A - Nb) - a(N/A)^2
    // b = excluded area per particle for hard disks = 2πr² (half of pair excluded area π(2r)²)
    const r = particleRadius;
    const b = 2 * Math.PI * r * r;
    // a from pair potential: force = attraction*0.4/r², potential ~ -attraction*0.4*ln(r)
    // integrated over attractive shell gives a ≈ π * attraction * 0.4 * (R_cut - 2r)
    const a = Math.PI * attraction * 0.4 * Math.max(FORCE_CUTOFF - 2 * r, 0);
    const effectiveA = A - N * b;
    let vdwP = 0;
    if (effectiveA > A * 0.05) {
      vdwP = N * T / effectiveA - a * (N / A) * (N / A);
    } else {
      vdwP = N * T / (A * 0.05) - a * (N / A) * (N / A);
    }
    vdwP = Math.max(0, vdwP);

    return { measured, ideal: idealP, vdw: vdwP };
  }, [numParticles, boxSize, temperature, particleRadius, attraction]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const loop = () => {
      const sim = simRef.current;

      if (!paused) {
        let frameImpulse = 0;
        for (let sub = 0; sub < SUBSTEPS; sub++) {
          frameImpulse += simStep(sim.particles, boxSize, particleRadius, attraction);
        }
        sim.pressureAccum.push(frameImpulse);
        if (sim.pressureAccum.length > PRESSURE_WINDOW) sim.pressureAccum.shift();
        sim.frame++;

        // Gentle thermostat to prevent temperature drift
        if (sim.frame % THERMOSTAT_INTERVAL === 0) {
          gentleThermostat(sim.particles, temperature);
        }

        if (sim.frame % DISPLAY_INTERVAL === 0) {
          const totalImpulse = sim.pressureAccum.reduce((a, b) => a + b, 0);
          const perimeter = 4 * boxSize;
          const time = sim.pressureAccum.length * SUBSTEPS * DT;
          const mP = time > 0 ? totalImpulse / (perimeter * time) : 0;
          // Measured temperature: T = <v²>/2 in 2D
          let sumV2 = 0;
          for (const p of sim.particles) sumV2 += p.vx * p.vx + p.vy * p.vy;
          const mT = sim.particles.length > 0 ? sumV2 / (2 * sim.particles.length) : 0;
          setPressures({ ...computePressures(mP), measuredTemp: mT });
        }
      }

      // Render
      const scale = canvas.width / CANVAS_SIZE;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Background
      ctx.fillStyle = "#0c1222";
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Box offset to center
      const off = (CANVAS_SIZE - boxSize) / 2;

      // Subtle grid inside box
      ctx.save();
      ctx.translate(off, off);
      ctx.strokeStyle = "#1a2744";
      ctx.lineWidth = 0.5;
      const gridStep = 40;
      for (let gx = gridStep; gx < boxSize; gx += gridStep) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, boxSize); ctx.stroke();
      }
      for (let gy = gridStep; gy < boxSize; gy += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(boxSize, gy); ctx.stroke();
      }

      // Box walls
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, boxSize, boxSize);

      // Glow on walls
      ctx.shadowColor = "#60a5fa";
      ctx.shadowBlur = 6;
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, boxSize, boxSize);
      ctx.shadowBlur = 0;

      // Particles
      const thermalSpeed = Math.sqrt(2 * temperature);
      for (const p of sim.particles) {
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const col = speedColor(speed, thermalSpeed);
        const r = Math.max(particleRadius, 2);

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = r * 1.5;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw force lines when attraction is strong
      if (Math.abs(attraction) > 1.5 && sim.particles.length > 1) {
        ctx.globalAlpha = Math.min(Math.abs(attraction) / 10, 0.15);
        for (let i = 0; i < sim.particles.length; i++) {
          for (let j = i + 1; j < sim.particles.length; j++) {
            const pi = sim.particles[i], pj = sim.particles[j];
            const dx = pj.x - pi.x, dy = pj.y - pi.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < FORCE_CUTOFF * 0.7) {
              ctx.strokeStyle = attraction > 0 ? "#60a5fa" : "#f87171";
              ctx.lineWidth = 0.5;
              ctx.beginPath(); ctx.moveTo(pi.x, pi.y); ctx.lineTo(pj.x, pj.y); ctx.stroke();
            }
          }
        }
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [paused, boxSize, particleRadius, attraction, temperature, computePressures]);

  const maxP = Math.max(pressures.measured, pressures.ideal, pressures.vdw, 0.001) * 1.3;

  // Whether non-ideal effects are active
  const hasSize = particleRadius > 3;
  const hasAttraction = attraction > 0.5;
  const isIdeal = !hasSize && !hasAttraction;

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0f1e",
      fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
      color: "#e2e8f0", padding: "20px 16px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ maxWidth: 960, margin: "0 auto 16px" }}>
        <h1 style={{
          fontSize: 22, fontWeight: 600, margin: "0 0 4px",
          background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          letterSpacing: "-0.02em",
        }}>
          Ideal Gas Law Explorer
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0, fontFamily: "'IBM Plex Mono', monospace" }}>
          PV = NkT&nbsp;&nbsp;→&nbsp;&nbsp;(P + a(N/V)²)(V − Nb) = NkT
        </p>
      </div>

      {/* Main layout */}
      <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", gap: 16, flexWrap: "wrap" }}>

        {/* Canvas */}
        <div style={{ flex: "1 1 480px", minWidth: 300 }}>
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE * 2}
            height={CANVAS_SIZE * 2}
            style={{
              width: "100%", maxWidth: CANVAS_SIZE, aspectRatio: "1",
              borderRadius: 8, border: "1px solid #1e293b",
              background: "#0c1222",
            }}
          />

          {/* Speed legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>
            <span>slow</span>
            <div style={{
              flex: 1, maxWidth: 160, height: 6, borderRadius: 3,
              background: "linear-gradient(to right, #3c8cff, #78dcff, #fff, #ffb060, #ff3c19)",
            }} />
            <span>fast</span>
            <span style={{ marginLeft: 12, color: "#475569" }}>
              N={numParticles} &nbsp;T={temperature} &nbsp;V={boxSize}²
            </span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ flex: "1 1 240px", minWidth: 220, maxWidth: 340 }}>
          <div style={{
            background: "#111827", borderRadius: 8, padding: 16,
            border: "1px solid #1e293b",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Controls</span>
              <button onClick={() => setPaused(!paused)} style={{
                background: paused ? "#22c55e33" : "#ef444433",
                color: paused ? "#4ade80" : "#f87171",
                border: `1px solid ${paused ? "#22c55e44" : "#ef444444"}`,
                borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: "pointer",
                fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
              }}>
                {paused ? "▶ PLAY" : "⏸ PAUSE"}
              </button>
            </div>

            <div style={{ borderBottom: "1px solid #1e293b", paddingBottom: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 500 }}>
                Ideal Gas Parameters
              </div>
              <Slider label="Temperature (T)" value={temperature} min={0.5} max={25} step={0.5}
                onChange={setTemperature} color="#f59e0b" />
              <Slider label="Particles (N)" value={numParticles} min={1} max={150} step={1}
                onChange={v => setNumParticles(Math.round(v))} color="#60a5fa" />
              <Slider label="Box Size (√V)" value={boxSize} min={120} max={440} step={10}
                onChange={setBoxSize} color="#34d399" unit="px" />
            </div>

            <div>
              <div style={{ fontSize: 10, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 500 }}>
                Non-Ideal (Breaking Assumptions)
              </div>
              <Slider label="Particle Radius (→ b)" value={particleRadius} min={2} max={16} step={0.5}
                onChange={setParticleRadius} color="#f87171" unit="px" />
              <Slider label="Attraction (→ a)" value={attraction} min={0} max={12} step={0.5}
                onChange={setAttraction} color="#c084fc" />
            </div>

            <button onClick={() => {
              simRef.current.particles = initParticles(numParticles, temperature, boxSize, particleRadius);
              simRef.current.pressureAccum = [];
              simRef.current.frame = 0;
            }} style={{
              width: "100%", marginTop: 12, padding: "7px 0",
              background: "#1e293b", border: "1px solid #334155",
              borderRadius: 4, color: "#94a3b8", fontSize: 11, cursor: "pointer",
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              ↺ RESET PARTICLES
            </button>
          </div>

          {/* Pressure comparison */}
          <div style={{
            background: "#111827", borderRadius: 8, padding: 16, marginTop: 12,
            border: "1px solid #1e293b",
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Pressure Comparison
            </span>
            <div style={{ marginTop: 12 }}>
              <PressureBar label="Measured (sim)" value={pressures.measured} max={maxP} color="#22c55e" textColor="#4ade80" />
              <PressureBar label="Ideal: P = NkT/V" value={pressures.ideal} max={maxP} color="#3b82f6" textColor="#60a5fa" />
              <PressureBar label="Van der Waals" value={pressures.vdw} max={maxP} color="#f59e0b" textColor="#fbbf24" />
            </div>

            {/* Delta display */}
            <div style={{
              marginTop: 10, padding: "8px 10px", background: "#0c1222",
              borderRadius: 6, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
              border: "1px solid #1e293b",
            }}>
              <div style={{ color: "#64748b", marginBottom: 4 }}>Error vs Measured:</div>
              <div style={{ display: "flex", gap: 16 }}>
                <span>
                  <span style={{ color: "#3b82f6" }}>Ideal: </span>
                  <span style={{ color: pressures.measured > 0 ? "#e2e8f0" : "#475569" }}>
                    {pressures.measured > 0
                      ? `${(((pressures.ideal - pressures.measured) / pressures.measured) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </span>
                <span>
                  <span style={{ color: "#f59e0b" }}>VdW: </span>
                  <span style={{ color: pressures.measured > 0 ? "#e2e8f0" : "#475569" }}>
                    {pressures.measured > 0
                      ? `${(((pressures.vdw - pressures.measured) / pressures.measured) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </span>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                <span>
                  <span style={{ color: "#64748b" }}>T<sub>set</sub>: </span>
                  <span style={{ color: "#f59e0b" }}>{temperature.toFixed(1)}</span>
                </span>
                <span>
                  <span style={{ color: "#64748b" }}>T<sub>meas</sub>: </span>
                  <span style={{ color: Math.abs(pressures.measuredTemp - temperature) < temperature * 0.1 ? "#4ade80" : "#f87171" }}>
                    {pressures.measuredTemp.toFixed(2)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Educational notes */}
      <div style={{ maxWidth: 960, margin: "16px auto 0" }}>
        <div style={{
          background: "#111827", borderRadius: 8, padding: "14px 16px",
          border: "1px solid #1e293b", fontSize: 12, color: "#94a3b8",
          lineHeight: 1.7, fontFamily: "'IBM Plex Mono', monospace",
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
            <div style={{ flex: "1 1 280px" }}>
              <span style={{ color: "#60a5fa", fontWeight: 600 }}>Ideal Gas Assumptions:</span>
              <br />
              • Particles are point masses (zero volume)
              <br />
              • No inter-particle forces
              <br />
              • Elastic wall collisions only
            </div>
            <div style={{ flex: "1 1 280px" }}>
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>Van der Waals Corrections:</span>
              <br />
              • <span style={{ color: "#f87171" }}>b term</span>: finite particle size → excluded volume → <span style={{ color: "#e2e8f0" }}>P increases</span>
              <br />
              • <span style={{ color: "#c084fc" }}>a term</span>: attraction → particles hit walls softer → <span style={{ color: "#e2e8f0" }}>P decreases</span>
            </div>
            <div style={{ flex: "1 1 280px" }}>
              <span style={{ color: "#4ade80", fontWeight: 600 }}>Try This:</span>
              <br />
              {isIdeal ? "↑ Crank up particle radius and attraction to see ideal assumptions break down"
                : hasSize && hasAttraction ? "Notice VdW tracks measured pressure better than ideal — the corrections work"
                : hasSize ? "Large particles → excluded volume → measured P > ideal P. Now try adding attraction"
                : "Attraction pulls particles inward → fewer wall hits → measured P < ideal P"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
