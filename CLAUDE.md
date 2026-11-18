# CLAUDE.md

## Project Overview

Collection of interactive browser demos built with React + Vite, deployed to GitHub Pages.

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview production build
- No test framework is configured.

## Architecture

- **Demo auto-discovery**: Drop a `.jsx` file into `src/jsx/` with a default export component and it's automatically routed via `import.meta.glob` in `App.jsx`.
- **Routing**: HashRouter (required for GitHub Pages — no server-side routing).
- **Vite base path**: `/dough-demos/` (matches the GitHub Pages subpath).
- **Deployment**: Pushes to `main` trigger `.github/workflows/deploy.yml` which builds and deploys to GitHub Pages.

## Conventions

- All styling is inline (no CSS files or CSS-in-JS libraries). Dark theme with IBM Plex fonts.
- Each demo is a single self-contained `.jsx` file in `src/jsx/`.
- All dependencies (including vite and the React plugin) are in `dependencies` (no `devDependencies`).
- `type: "commonjs"` in package.json.

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

## Memory

All project memory lives in this repo — in this file and in the `*_NOTES.md`
files. This project is worked on from several machines and from cloud
environments that have no access to a local memory directory, so never persist
project context to `~/.claude` memory. Put it here and commit it.
