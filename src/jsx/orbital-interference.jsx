import { useEffect, useRef, useState, useCallback } from "react";

// Field grid is evaluated at half resolution and scaled up — the field is smooth
// enough that bilinear upscaling reads as free antialiasing.
const W = 320, H = 190;
const CW = 640, CH = 380;
const SX = CW / W, SY = CH / H;

// Display gains: p and d lobes reach the same visual size as an s blob at equal
// weight. Render tuning only — deliberately kept separate from the weight w.
const GAIN_P = 3.3, GAIN_D = 9;

const TEAL_CORE = [29, 158, 117], TEAL_EDGE = [93, 202, 165];
const CORAL_CORE = [216, 90, 48], CORAL_EDGE = [240, 153, 123];

let nextId = 1;

function G(x, y, m = 0, thDeg = 0, s = 1, R = 95, w = 1) {
  return { x, y, m, th: (thDeg * Math.PI) / 180, s, R, w };
}

function withIds(gens) {
  return gens.map((g) => ({ ...g, id: nextId++ }));
}

const PRESETS = [
  { name: "s + s  σ", note: "Two s orbitals in phase. The field bridges the gap — that bridge is the bond.", gens: [G(250, 190, 0, 0, 1), G(390, 190, 0, 0, 1)] },
  { name: "s + s  σ*", note: "Same pair, opposite phase. Everything between the nuclei cancels to zero: a nodal plane.", gens: [G(250, 190, 0, 0, 1), G(390, 190, 0, 0, -1)] },
  { name: "p + p  σ", note: "Head-on p orbitals with their facing lobes in phase. Dense overlap along the axis.", gens: [G(235, 190, 1, 0, 1, 115), G(405, 190, 1, 0, -1, 115)] },
  { name: "p + p  σ*", note: "Head-on p orbitals with facing lobes out of phase — a node slices between them.", gens: [G(235, 190, 1, 0, 1, 115), G(405, 190, 1, 0, 1, 115)] },
  { name: "p + p  π", note: "Side-by-side p orbitals. Overlap happens above and below the axis, never on it.", gens: [G(250, 190, 1, 90, 1, 115), G(390, 190, 1, 90, 1, 115)] },
  { name: "p + p  π*", note: "Side-by-side but out of phase: four separate lobes, no bridge anywhere.", gens: [G(250, 190, 1, 90, 1, 115), G(390, 190, 1, 90, -1, 115)] },
  { name: "lone d", note: "One d orbital: four alternating lobes from (x′² − y′²). Its own nodes cross at the nucleus.", gens: [G(320, 190, 2, 45, 1, 140)] },
  { name: "d + s", note: "An s orbital meeting one lobe of a d. Slide it around the d to find the lobes that welcome it.", gens: [G(285, 190, 2, 45, 1, 140), G(440, 235, 0, 0, 1, 85)] },
  { name: "triatomic", note: "One s bonds to the p's lower lobe while the other cancels against it — the net overlap reads ~0 even though both sides are interacting hard. Drag one s away to break the tie.", gens: [G(210, 230, 0, 0, 1, 85), G(320, 150, 1, 90, 1, 115), G(430, 230, 0, 0, -1, 85)] },
];

function Slider({ label, value, min, max, step, onChange, format, color, disabled }) {
  return (
    <div style={{ marginBottom: 12, opacity: disabled ? 0.35 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
        <span>{label}</span>
        <span style={{ color: color || "#e2e8f0", fontWeight: 600 }}>{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", height: 6, appearance: "none", background: "#334155", borderRadius: 3, outline: "none", cursor: disabled ? "default" : "pointer", accentColor: color || "#60a5fa" }} />
    </div>
  );
}

function Chip({ active, onClick, children, color }) {
  return (
    <button onClick={onClick} style={{
      background: active ? `${color || "#60a5fa"}26` : "transparent",
      color: active ? color || "#60a5fa" : "#94a3b8",
      border: `1px solid ${active ? `${color || "#60a5fa"}66` : "#334155"}`,
      borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer",
      fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
    }}>{children}</button>
  );
}

export default function OrbitalInterference() {
  const cvRef = useRef(null);
  const offRef = useRef(null);
  const imgRef = useRef(null);
  const fRef = useRef(new Float32Array(W * H));
  const ampRef = useRef(new Float32Array(W * H));
  const drawRef = useRef(null);
  const rafRef = useRef(0);
  const dragRef = useRef(null);

  const [preset, setPreset] = useState(2);
  const [gens, setGens] = useState(() => withIds(PRESETS[2].gens));
  const [selectedId, setSelectedId] = useState(null);
  const [threshold, setThreshold] = useState(0.11);
  const [showNodes, setShowNodes] = useState(true);
  const [showHaze, setShowHaze] = useState(true);
  const [overlap, setOverlap] = useState(0);

  const gensRef = useRef(gens);
  useEffect(() => { gensRef.current = gens; }, [gens]);

  const draw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");

    if (!offRef.current) {
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      offRef.current = off;
      imgRef.current = off.getContext("2d").createImageData(W, H);
    }
    const off = offRef.current, octx = off.getContext("2d");
    const img = imgRef.current, d = img.data;
    const fBuf = fRef.current, ampBuf = ampRef.current;

    // Hoist per-generator trig and radius² out of the pixel loop.
    const P = gensRef.current.map((g) => ({
      x: g.x, y: g.y, m: g.m, s: g.s, w: g.w, R: g.R,
      r2: g.R * g.R, cs: Math.cos(g.th), sn: Math.sin(g.th),
    }));

    // Pass 1: signed field f, unsigned amplitude, and the interference integral
    // ∫(f² − Σf_g²) — positive means the generators reinforce, negative means
    // they cancel. That ratio is exactly what "bonding vs antibonding" means.
    let interf = 0, selfSum = 0;
    for (let j = 0; j < H; j++) {
      const py = (j + 0.5) * SY;
      for (let i = 0; i < W; i++) {
        const px = (i + 0.5) * SX;
        let f = 0, amp = 0, sq = 0;
        for (let n = 0; n < P.length; n++) {
          const g = P[n];
          const dx = px - g.x, dy = py - g.y, d2 = dx * dx + dy * dy;
          if (d2 >= g.r2) continue;
          const t = 1 - d2 / g.r2, env = t * t * t;
          let ang = 1;
          if (g.m === 1) {
            ang = (GAIN_P * (dx * g.cs + dy * g.sn)) / g.R;
          } else if (g.m === 2) {
            const lx = (dx * g.cs + dy * g.sn) / g.R, ly = (-dx * g.sn + dy * g.cs) / g.R;
            ang = GAIN_D * (lx * lx - ly * ly);
          }
          const c = g.s * g.w * ang * env;
          f += c; amp += Math.abs(c); sq += c * c;
        }
        const k = j * W + i;
        fBuf[k] = f; ampBuf[k] = amp;
        interf += f * f - sq; selfSum += sq;
      }
    }
    setOverlap(selfSum > 1e-9 ? interf / selfSum : 0);

    // Pass 2: shade the field, then mark zero-crossings that sit inside real
    // amplitude — the nodes where the orbitals wiped each other out.
    const T = threshold, hazeFloor = T * 0.4, rim = T * 1.35, nodeFull = T * 0.6;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i, k4 = k * 4;
        const f = fBuf[k], a = Math.abs(f), pos = f > 0;
        if (a >= T) {
          const c = a < rim ? (pos ? TEAL_EDGE : CORAL_EDGE) : (pos ? TEAL_CORE : CORAL_CORE);
          d[k4] = c[0]; d[k4 + 1] = c[1]; d[k4 + 2] = c[2];
          d[k4 + 3] = a < rim ? 255 : 175;
        } else if (showHaze && a >= hazeFloor) {
          const c = pos ? TEAL_CORE : CORAL_CORE;
          d[k4] = c[0]; d[k4 + 1] = c[1]; d[k4 + 2] = c[2];
          d[k4 + 3] = 28;
        } else {
          d[k4 + 3] = 0;
        }

        // A zero-crossing is a node whether it comes from one orbital's own
        // geometry or from two of them cancelling. Brightness tracks how much
        // field was annihilated, so interference nodes read louder than the
        // intrinsic ones without hiding them.
        if (showNodes) {
          const amp = ampBuf[k];
          let strength = -1;
          if (i + 1 < W && f * fBuf[k + 1] < 0) strength = Math.max(amp, ampBuf[k + 1]);
          if (j + 1 < H && f * fBuf[k + W] < 0) strength = Math.max(strength, amp, ampBuf[k + W]);
          if (strength >= 0) {
            d[k4] = 226; d[k4 + 1] = 232; d[k4 + 2] = 240;
            d[k4 + 3] = 60 + 165 * Math.min(strength / nodeFull, 1);
          }
        }
      }
    }
    octx.putImageData(img, 0, 0);

    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = "#0c1222";
    ctx.fillRect(0, 0, CW, CH);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, CW, CH);

    for (const g of gensRef.current) {
      const sel = g.id === selectedId;
      const phaseColor = g.s > 0 ? "#5DCAA5" : "#F0997B";

      if (sel) {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.R, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      if (g.m > 0) {
        // Facing handle — drag it to rotate the lobes.
        const hx = g.x + Math.cos(g.th) * 42, hy = g.y + Math.sin(g.th) * 42;
        ctx.strokeStyle = sel ? "#e2e8f0" : "#64748b";
        ctx.lineWidth = sel ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, hy, sel ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = sel ? "#e2e8f0" : "#64748b"; ctx.fill();
      }

      ctx.beginPath(); ctx.arc(g.x, g.y, sel ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = "#e8e6e3"; ctx.fill();
      if (sel) { ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(g.x, g.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = phaseColor; ctx.fill();
    }
  }, [threshold, showNodes, showHaze, selectedId, gens]);

  useEffect(() => { drawRef.current = draw; draw(); }, [draw]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  function schedule() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current?.();
    });
  }

  function canvasPos(e) {
    const r = cvRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * CW) / r.width, y: ((e.clientY - r.top) * CH) / r.height };
  }

  function commit() {
    setGens(gensRef.current.map((g) => ({ ...g })));
  }

  function loadPreset(i) {
    setPreset(i);
    setGens(withIds(PRESETS[i].gens));
    setSelectedId(null);
  }

  const selected = gens.find((g) => g.id === selectedId) || null;

  function patchSelected(patch) {
    setGens((gs) => gs.map((g) => (g.id === selectedId ? { ...g, ...patch } : g)));
  }

  function addGenerator(x = CW / 2, y = CH / 2) {
    const g = { ...G(x, y, 0, 0, 1), id: nextId++ };
    setGens((gs) => [...gs, g]);
    setSelectedId(g.id);
    setPreset(-1);
  }

  function deleteSelected() {
    setGens((gs) => gs.filter((g) => g.id !== selectedId));
    setSelectedId(null);
    setPreset(-1);
  }

  function onPointerDown(e) {
    const p = canvasPos(e);
    for (const g of gensRef.current) {
      if (g.m > 0) {
        const hx = g.x + Math.cos(g.th) * 42, hy = g.y + Math.sin(g.th) * 42;
        const dx = p.x - hx, dy = p.y - hy;
        if (dx * dx + dy * dy < 250) {
          dragRef.current = { g, mode: "rotate" };
          setSelectedId(g.id);
          e.target.setPointerCapture(e.pointerId);
          return;
        }
      }
      const dx = p.x - g.x, dy = p.y - g.y;
      if (dx * dx + dy * dy < 400) {
        dragRef.current = { g, mode: "move" };
        setSelectedId(g.id);
        e.target.setPointerCapture(e.pointerId);
        return;
      }
    }
    setSelectedId(null);
  }

  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = canvasPos(e);
    if (drag.mode === "rotate") {
      drag.g.th = Math.atan2(p.y - drag.g.y, p.x - drag.g.x);
    } else {
      drag.g.x = Math.max(20, Math.min(CW - 20, p.x));
      drag.g.y = Math.max(20, Math.min(CH - 20, p.y));
    }
    schedule();
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setPreset(-1);
    commit();
  }

  // Overlap is a fraction of total self-energy, so honest values are small (a few
  // percent at typical separations). Square-root the bar so the needle still moves.
  const DEAD = 0.0005;
  const bonding = overlap > DEAD ? "bonding" : overlap < -DEAD ? "antibonding" : "no net overlap";
  const bondColor = overlap > DEAD ? "#5DCAA5" : overlap < -DEAD ? "#F0997B" : "#64748b";
  const barPct = Math.min(Math.sqrt(Math.abs(overlap) / 0.05), 1) * 50;

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0f1e",
      fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
      color: "#e2e8f0", padding: "20px 16px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1040, margin: "0 auto 16px" }}>
        <h1 style={{
          fontSize: 22, fontWeight: 600, margin: "0 0 4px",
          background: "linear-gradient(135deg, #5DCAA5, #F0997B)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          letterSpacing: "-0.02em",
        }}>
          Orbital Interference
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0, fontFamily: "'IBM Plex Mono', monospace" }}>
          f(p) = Σ sᵢ·wᵢ·A<sub>m</sub>(x′, y′)·(1 − d²/R²)³ &nbsp;&nbsp;→&nbsp;&nbsp; surface at |f| = T, nodes at f = 0
        </p>
      </div>

      <div style={{ maxWidth: 1040, margin: "0 auto", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 620px", minWidth: 300 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {PRESETS.map((p, i) => (
              <Chip key={p.name} active={preset === i} onClick={() => loadPreset(i)} color="#60a5fa">
                {p.name}
              </Chip>
            ))}
          </div>

          <canvas ref={cvRef} width={CW} height={CH}
            style={{
              width: "100%", aspectRatio: `${CW} / ${CH}`, borderRadius: 8,
              border: "1px solid #1e293b", background: "#0c1222",
              touchAction: "none", cursor: "grab", display: "block",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              if (dragRef.current) return;
              const p = canvasPos(e);
              const onTop = gensRef.current.some((g) => (p.x - g.x) ** 2 + (p.y - g.y) ** 2 < 400);
              if (!onTop) addGenerator(p.x, p.y);
            }} />

          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 11, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#1D9E75", marginRight: 5 }} />positive phase</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#D85A30", marginRight: 5 }} />negative phase</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#e2e8f0", marginRight: 5 }} />node (f = 0)</span>
            <span style={{ marginLeft: "auto" }}>drag nuclei · drag the stem to rotate · double-click to add</span>
          </div>

          <div style={{
            marginTop: 10, padding: "10px 12px", background: "#111827", borderRadius: 8,
            border: "1px solid #1e293b", fontSize: 12, color: "#94a3b8", lineHeight: 1.6,
            fontFamily: "'IBM Plex Mono', monospace", minHeight: 40,
          }}>
            {preset >= 0
              ? PRESETS[preset].note
              : "Custom arrangement. Watch the overlap meter as you slide the nuclei together — reinforcement and cancellation are the same interference, just with a sign."}
          </div>
        </div>

        <div style={{ flex: "1 1 260px", minWidth: 240, maxWidth: 340 }}>
          <div style={{ background: "#111827", borderRadius: 8, padding: 16, border: "1px solid #1e293b" }}>
            <div style={{ fontSize: 10, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 500 }}>
              Interaction
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 5, fontFamily: "'IBM Plex Mono', monospace" }}>
              <span>overlap ∫(f² − Σf²)</span>
              <span style={{ color: bondColor, fontWeight: 600 }}>{overlap >= 0 ? "+" : ""}{(overlap * 100).toFixed(2)}%</span>
            </div>
            <div style={{ position: "relative", height: 10, background: "#1e293b", borderRadius: 5, border: "1px solid #334155", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#475569" }} />
              <div style={{
                position: "absolute", top: 0, bottom: 0,
                left: overlap >= 0 ? "50%" : `${50 - barPct}%`,
                width: `${barPct}%`, background: bondColor, opacity: 0.85,
              }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: bondColor }}>
              {bonding}
              <span style={{ color: "#475569" }}> · {gens.length} generator{gens.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div style={{ background: "#111827", borderRadius: 8, padding: 16, marginTop: 12, border: "1px solid #1e293b" }}>
            <div style={{ fontSize: 10, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 500 }}>
              Field
            </div>
            <Slider label="Threshold (T)" value={threshold} min={0.02} max={0.4} step={0.005}
              onChange={setThreshold} format={(v) => v.toFixed(3)} color="#60a5fa" />
            <div style={{ display: "flex", gap: 6 }}>
              <Chip active={showNodes} onClick={() => setShowNodes(!showNodes)} color="#e2e8f0">nodal lines</Chip>
              <Chip active={showHaze} onClick={() => setShowHaze(!showHaze)} color="#c084fc">sub-threshold haze</Chip>
            </div>
          </div>

          <div style={{ background: "#111827", borderRadius: 8, padding: 16, marginTop: 12, border: "1px solid #1e293b" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
                Selected generator
              </span>
              <button onClick={() => addGenerator()} style={{
                background: "#1e293b", border: "1px solid #334155", borderRadius: 4,
                color: "#94a3b8", fontSize: 11, padding: "3px 9px", cursor: "pointer",
                fontFamily: "'IBM Plex Mono', monospace",
              }}>+ add</button>
            </div>

            {!selected ? (
              <div style={{ fontSize: 12, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.6 }}>
                Click a nucleus to edit its orbital, phase, weight, and reach.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5, fontFamily: "'IBM Plex Mono', monospace" }}>orbital</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {[["s", 0], ["p", 1], ["d", 2]].map(([label, m]) => (
                    <Chip key={m} active={selected.m === m} onClick={() => patchSelected({ m })} color="#60a5fa">{label}</Chip>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5, fontFamily: "'IBM Plex Mono', monospace" }}>phase</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  <Chip active={selected.s > 0} onClick={() => patchSelected({ s: 1 })} color="#5DCAA5">+1</Chip>
                  <Chip active={selected.s < 0} onClick={() => patchSelected({ s: -1 })} color="#F0997B">−1</Chip>
                </div>

                <Slider label="Facing (θ)" value={Math.round((selected.th * 180) / Math.PI)} min={-180} max={180} step={1}
                  onChange={(v) => patchSelected({ th: (v * Math.PI) / 180 })}
                  format={(v) => `${v}°`} color="#60a5fa" disabled={selected.m === 0} />
                <Slider label="Weight (w)" value={selected.w} min={0.2} max={2} step={0.05}
                  onChange={(v) => patchSelected({ w: v })} format={(v) => v.toFixed(2)} color="#34d399" />
                <Slider label="Reach (R)" value={selected.R} min={40} max={190} step={1}
                  onChange={(v) => patchSelected({ R: v })} format={(v) => `${v}px`} color="#f59e0b" />

                <button onClick={deleteSelected} disabled={gens.length <= 1} style={{
                  width: "100%", padding: "6px 0", background: "#ef444422",
                  border: "1px solid #ef444444", borderRadius: 4, color: "#f87171",
                  fontSize: 11, cursor: gens.length <= 1 ? "default" : "pointer",
                  opacity: gens.length <= 1 ? 0.4 : 1,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}>✕ delete generator</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1040, margin: "16px auto 0" }}>
        <div style={{
          background: "#111827", borderRadius: 8, padding: "14px 16px", border: "1px solid #1e293b",
          fontSize: 12, color: "#94a3b8", lineHeight: 1.7, fontFamily: "'IBM Plex Mono', monospace",
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
            <div style={{ flex: "1 1 280px" }}>
              <span style={{ color: "#60a5fa", fontWeight: 600 }}>The kernels:</span>
              <br />• <span style={{ color: "#e2e8f0" }}>s</span> — A₀ = 1, a plain round blob
              <br />• <span style={{ color: "#e2e8f0" }}>p</span> — A₁ = x′/R, two opposite-sign lobes
              <br />• <span style={{ color: "#e2e8f0" }}>d</span> — A₂ = (x′² − y′²)/R², four alternating lobes
              <br />Each is Re[(x′ + iy′)<sup>m</sup>], multiplied by a (1 − d²/R²)³ envelope that reaches exactly zero at R.
            </div>
            <div style={{ flex: "1 1 280px" }}>
              <span style={{ color: "#5DCAA5", fontWeight: 600 }}>Why they interact:</span>
              <br />The generators are <span style={{ color: "#e2e8f0" }}>summed with sign</span>, not merged. Where two lobes of like sign overlap, the field grows and crosses the threshold — the surfaces fuse into one. Where opposite signs overlap they subtract to exactly zero, and a <span style={{ color: "#e2e8f0" }}>node</span> opens between nuclei that each carry plenty of field on their own. That is LCAO bonding and antibonding, with no quantum mechanics underneath — just a signed sum.
            </div>
            <div style={{ flex: "1 1 280px" }}>
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>Things to try:</span>
              <br />• Load <span style={{ color: "#e2e8f0" }}>s + s σ</span> and drag the nuclei apart — watch the bridge pinch off exactly when the reach circles stop overlapping.
              <br />• Flip one phase and the bridge inverts into a gap without either orbital changing size.
              <br />• On <span style={{ color: "#e2e8f0" }}>p + p π</span>, rotate one stem by 90° and watch a π bond degrade into nothing as the lobes stop matching.
              <br />• Drop the threshold: the node survives. It is a zero of the field, not a thin spot.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
