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
