# Handoff: Orbital shield field toy

Reproduce the interactive "electron-orbital shield" widget from the 2026-08-02 Ballistics design session as a demo in this repo. Design context lives in the Ballistics repo: `ORBITAL_SHIELD_DESIGN.md` (deferred feature — this toy is the exploration/tuning sandbox for it).

## What it is

A canvas toy rendering a 2D signed implicit field built from "shield generators" that behave like atomic nuclei with electron-orbital kernels. Draggable nuclei, preset configurations showing s/p/d lobes and bonding/antibonding interference. The shield surface is the `|f| = threshold` isoline; nodal lines (zero-crossings) are real gaps.

## The field math (must match Ballistics `ShieldField` semantics)

Per generator `g` with center `(x, y)`, support radius `R`, weight `w`, phase `s ∈ {+1, −1}`, orbital order `m ∈ {0, 1, 2}`, facing angle `θ`:

```
d² = |p − c|²            contribution is 0 when d² ≥ R²  (finite support)
env = (1 − d²/R²)³       Wyvill envelope, C² at the boundary
x′ =  dx·cosθ + dy·sinθ  offset rotated into the generator's local frame
y′ = −dx·sinθ + dy·cosθ

A₀ = 1                   s orbital  (plain metaball)
A₁ = x′/R                p orbital  (two opposite-sign lobes)
A₂ = (x′² − y′²)/R²      d orbital  (four alternating lobes)

f(p) = Σ  s·w·A_m·env    signed sum over generators
surface: |f| ≥ T         both signs block; f = 0 nodal lines are gaps
```

Angular factors are `Re[(x′ + iy′)^m]` — harmonic polynomials, no trig per pixel (facing cos/sin hoisted per generator). Bonding/antibonding falls out of the signed sum (LCAO): in-phase generators bridge constructively, opposite-phase generators produce a nodal gap between them.

The reference implementation below multiplies A₁ by 3.3 and A₂ by 9 — pure display gain so p/d lobes reach the same visual size as s blobs at equal weight. Keep gains separate from `w`; they're render tuning, not model.

## Port target

Per this repo's conventions: single self-contained `src/jsx/OrbitalShieldToy.jsx`, default export, inline styles only, dark theme, auto-discovered by the router. No new dependencies.

Rendering approach (kept from the original): evaluate the field per pixel into an offscreen `ImageData` at half resolution (320×190), scale up onto the visible canvas with `imageSmoothingEnabled` — free antialiasing, and full-res per-pixel eval is wasteful for a field this smooth. Redraw through `requestAnimationFrame` while dragging.

## Reference implementation

Complete port, logic identical to the session widget (colors converted from the claude.ai palette to fixed dark-theme values).

```jsx
import { useEffect, useRef } from 'react';

const W = 320, H = 190, CW = 640, CH = 380, T = 0.11;

function G(x, y, m, th, s, R = 95, w = 1) { return { x, y, m, th, s, R, w }; }

const PRESETS = [
  { name: 's + s bond',       gens: [G(250, 190, 0, 0, 1), G(390, 190, 0, 0, 1)] },
  { name: 's + s antibond',   gens: [G(250, 190, 0, 0, 1), G(390, 190, 0, 0, -1)] },
  { name: 'single p',         gens: [G(320, 190, 1, 0, 1, 130)] },
  { name: 'p–p sigma bond',   gens: [G(230, 190, 1, 0, 1, 110), G(410, 190, 1, 0, 1, 110)] },
  { name: 'single d',         gens: [G(320, 190, 2, Math.PI / 4, 1, 140)] },
  { name: 'triatomic mix',    gens: [G(210, 230, 0, 0, 1, 85), G(320, 150, 1, Math.PI / 2, 1, 115), G(430, 230, 0, 0, -1, 85)] },
];

function fieldAt(gens, px, py) {
  let f = 0;
  for (const g of gens) {
    const dx = px - g.x, dy = py - g.y, r2 = g.R * g.R, d2 = dx * dx + dy * dy;
    if (d2 >= r2) continue;
    const t = 1 - d2 / r2, env = t * t * t;
    let ang = 1;
    if (g.m === 1) {
      ang = 3.3 * (dx * Math.cos(g.th) + dy * Math.sin(g.th)) / g.R;
    } else if (g.m === 2) {
      const c = Math.cos(g.th), s = Math.sin(g.th);
      const lx = (dx * c + dy * s) / g.R, ly = (-dx * s + dy * c) / g.R;
      ang = 9 * (lx * lx - ly * ly);
    }
    f += g.s * g.w * ang * env;
  }
  return f;
}

export default function OrbitalShieldToy() {
  const cvRef = useRef(null);
  const gensRef = useRef(PRESETS[3].gens.map(g => ({ ...g })));
  const dragRef = useRef(null);

  function draw() {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const octx = off.getContext('2d');
    const img = octx.createImageData(W, H);
    const d = img.data, sx = CW / W, sy = CH / H;
    const gens = gensRef.current;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const f = fieldAt(gens, i * sx, j * sy), a = Math.abs(f), k = (j * W + i) * 4;
      if (a >= T) {
        const pos = f > 0, edge = a < T * 1.35;
        d[k]     = pos ? (edge ? 93 : 29)   : (edge ? 240 : 216);
        d[k + 1] = pos ? (edge ? 202 : 158) : (edge ? 153 : 90);
        d[k + 2] = pos ? (edge ? 165 : 117) : (edge ? 123 : 48);
        d[k + 3] = edge ? 255 : 175;
      } else if (a >= T * 0.4) {
        const pos = f > 0;
        d[k] = pos ? 29 : 216; d[k + 1] = pos ? 158 : 90; d[k + 2] = pos ? 117 : 48;
        d[k + 3] = 28;
      } else d[k + 3] = 0;
    }
    octx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, CW, CH);
    for (const g of gens) {
      ctx.beginPath(); ctx.arc(g.x, g.y, 7, 0, 7); ctx.fillStyle = '#e8e6e3'; ctx.fill();
      ctx.beginPath(); ctx.arc(g.x, g.y, 3, 0, 7);
      ctx.fillStyle = g.s > 0 ? '#5DCAA5' : '#F0997B'; ctx.fill();
    }
  }

  useEffect(() => { draw(); }, []);

  function canvasPos(e) {
    const r = cvRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) * CW / r.width, y: (e.clientY - r.top) * CH / r.height };
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', fontFamily: "'IBM Plex Sans', sans-serif", color: '#e8e6e3' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>
        {PRESETS.map(p => (
          <button key={p.name}
            style={{ background: 'transparent', color: '#e8e6e3', border: '1px solid #555', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
            onClick={() => { gensRef.current = p.gens.map(g => ({ ...g })); draw(); }}>
            {p.name}
          </button>
        ))}
      </div>
      <canvas ref={cvRef} width={CW} height={CH}
        style={{ width: '100%', border: '1px solid #444', borderRadius: 12, touchAction: 'none', cursor: 'grab' }}
        onPointerDown={e => {
          const p = canvasPos(e);
          for (const g of gensRef.current) {
            const dx = p.x - g.x, dy = p.y - g.y;
            if (dx * dx + dy * dy < 900) { dragRef.current = g; e.target.setPointerCapture(e.pointerId); break; }
          }
        }}
        onPointerMove={e => {
          const g = dragRef.current;
          if (!g) return;
          const p = canvasPos(e);
          g.x = Math.max(20, Math.min(CW - 20, p.x));
          g.y = Math.max(20, Math.min(CH - 20, p.y));
          requestAnimationFrame(draw);
        }}
        onPointerUp={() => { dragRef.current = null; }} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 10, fontSize: 13, color: '#999' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#1D9E75', marginRight: 5 }} />positive phase</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#D85A30', marginRight: 5 }} />negative phase</span>
        <span style={{ marginLeft: 'auto' }}>drag the nuclei</span>
      </div>
    </div>
  );
}
```

Port notes:
- Generator state lives in refs, not React state — dragging redraws imperatively via rAF and re-render would fight the canvas. Fine for a toy; revisit if controls below need to reflect live generator state (then: state for the roster, ref only for the in-flight drag).
- The offscreen canvas is recreated per draw in the reference code; hoist it to a ref if profiling ever cares (it won't at 320×190).
- Colors: positive = teal `#1D9E75` family, negative = coral `#D85A30` family, bright rim at `T ≤ |f| < 1.35T`, faint halo at `0.4T ≤ |f| < T` showing sub-threshold field.

## Planned usability features (backlog for future sessions)

Owner intends to extend this demo. Candidates discussed or implied:

1. **Per-generator inspector** — click a nucleus to select; controls for `m` (s/p/d), phase flip, facing angle, weight `w`, radius `R`. This is the big one: presets stop being the only way to explore.
2. **Add / remove generators** — double-click empty space to add, key or button to delete selected.
3. **Threshold slider** — `T` is the main tuning knob in the real game (charge level maps to weight, which fights threshold); live-scrubbing it shows lobes growing/merging/pinching.
4. **Test projectile ray** — click-drag to cast a segment, mark where it first crosses `|f| = T` from outside (mirrors Ballistics `ShieldField.TryIntersectSegment` inbound-only semantics). Directly demonstrates that nodal gaps pass shots.
5. **Nodal line overlay** — trace `f = 0` within the support region (sign-change edge detection on the half-res grid is plenty) so the "gap" reads explicitly.
6. **Config export** — dump the generator list as JSON matching the eventual Ballistics config fields (`m`, `facing`, `phase`, `w`, `R`) so tuned layouts can be carried into the game later.
7. **Facing drag handle** — small stem on the selected nucleus to rotate lobes directly instead of a slider.
