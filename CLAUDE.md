# dough-demos

Small in-browser demos (Vite + React 19), deployed to
https://cookiedoughtwist.github.io/dough-demos/ by `.github/workflows/deploy.yml`
on every push to `main`. There is no separate review step: pushing to `main` publishes.

## Adding a demo
- Drop one file in `src/jsx/<name>.jsx` with a default-exported component.
  `src/App.jsx` picks it up with `import.meta.glob`; the filename becomes the nav
  label and the route (`/#/<name>`, HashRouter).
- Each demo is self-contained: inline styles, its own dark page background, and its
  own Google Fonts link (IBM Plex Sans / Mono). No shared component library.
- `recharts` and `lucide-react` are available; the canvas demos draw by hand with
  `requestAnimationFrame` and keep simulation state in refs, not React state.

## Checks
- No tests or linter. `npm run build` is the check.
- Look at it at phone width (~390px) as well as desktop: the owner often views on a
  phone. Make sure there's no horizontal page scroll. Playwright works with the
  preinstalled Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  against `npx vite preview` (`http://localhost:4173/dough-demos/#/<name>`).
- Mobile patterns used so far: `flex-wrap` with real `flex-basis` values (not
  `flex: 1; minWidth: 0`, which lets a panel shrink to a sliver), chart first on narrow
  screens, and canvases sized to their CSS box at devicePixelRatio.

## Demo notes
- `yard-sale-model`: the bet is a fraction of the poorer player's wealth. Checked
  against a NumPy run of the original Reddit setup: 100 seeds all reach 50%, at
  31 / 61 / 114 years (min / median / max). Balances underflow to 0 after ~100+
  simulated years; the UI shows this as "≈$0".
- `pid-demo`, known nits not yet fixed: on desktop the chart panel stretches to the
  height of the controls column, leaving empty space; early time-axis ticks read
  "0s 0s 0s 1s" because the formatter rounds to whole seconds.
