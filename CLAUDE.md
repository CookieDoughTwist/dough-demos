# dough-demos

Small in-browser demos (Vite + React 19), deployed to
https://cookiedoughtwist.github.io/dough-demos/ by `.github/workflows/deploy.yml`
on every push to `main`. There is no separate review step: pushing to `main` publishes.

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

## Adding a demo

- Drop one file in `src/jsx/<name>.jsx` with a default-exported component.
  `src/App.jsx` picks it up with `import.meta.glob`; the filename becomes the nav
  label and the route (`/#/<name>`). Routing is HashRouter and the Vite base path is
  `/dough-demos/` — both required by GitHub Pages, which has no server-side routing.
- Each demo is self-contained: inline styles only (no CSS files, no CSS-in-JS), its own
  dark page background, and its own Google Fonts link (IBM Plex Sans / Mono). No shared
  component library.
- `recharts` and `lucide-react` are available; the canvas demos draw by hand with
  `requestAnimationFrame` and keep simulation state in refs, not React state.
- All dependencies (vite and the React plugin included) are in `dependencies`, not
  `devDependencies`, and package.json is `type: "commonjs"`.

## Checks

- No tests or linter. `npm run build` is the check.
- Look at it at phone width (~390px) as well as desktop: the owner often views on a
  phone. Make sure there's no horizontal page scroll. Playwright works with the
  preinstalled Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  against `npx vite preview` (`http://localhost:4173/dough-demos/#/<name>`).
- Mobile patterns used so far: `flex-wrap` with real `flex-basis` values (not
  `flex: 1; minWidth: 0`, which lets a panel shrink to a sliver), chart first on narrow
  screens, and canvases sized to their CSS box at devicePixelRatio.

## Design principles

- **Model the cause, not the symptom.** When something needs to stop, limit or
  escalate, implement what physically causes it rather than adding a counter
  and a threshold. A rule that fires on a number reads as arbitrary the moment
  the player notices it, and it caps the fun at whatever the number is. If a
  threshold is already there, keep it as a tunable set to "off" rather than
  deleting it, so the old behaviour can come back.
- **Rare branches need a debug button.** Anything behind a low random chance
  (giant sheep, cow, short jumps) gets a button in a corner debug panel, or it
  cannot be tuned by playing.
- **Measure, don't assert.** Finish a change by driving the running demo in the
  browser and reporting the actual numbers.

## Working in rounds

Each demo is iterated roughly one design pass per session, and scope is stated
explicitly ("don't have to resolve this round, but can we think about..."). A
deferred item is thinking to deliver in writing, not work to start.

Per-demo notes live in a `*_NOTES.md` at the repo root beside the demo
(`TOO_MANY_SHEEP_NOTES.md`, `ORBITAL_SHIELD_TOY_HANDOFF.md`): what changed this
round, what was measured, and the plan for the next one. Read the notes file
for a demo before touching it, and update it at the end of a round.

## Demo notes

- `yard-sale-model`: the bet is a fraction of the poorer player's wealth. Checked
  against a NumPy run of the original Reddit setup: 100 seeds all reach 50%, at
  31 / 61 / 114 years (min / median / max). Balances underflow to 0 after ~100+
  simulated years; the UI shows this as "≈$0".
- `pid-demo`, known nits not yet fixed: on desktop the chart panel stretches to the
  height of the controls column, leaving empty space; early time-axis ticks read
  "0s 0s 0s 1s" because the formatter rounds to whole seconds.

## Memory

All project memory lives in this repo — in this file and in the `*_NOTES.md`
files. This project is worked on from several machines and from cloud
environments that have no access to a local memory directory, so never persist
project context to `~/.claude` memory. Put it here and commit it.
