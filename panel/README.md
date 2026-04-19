# web-ui (Bun + Vite)

Drone monitoring UI now built and served with Vite, using Bun to run scripts. Map is 3D with terrain via MapLibre GL.

## Prereqs

- Install Bun: https://bun.sh

## Develop

Runs Vite dev server on port 3000 with HMR:

```
bun run dev
```

Open http://localhost:3000

## Build

Outputs static files to `dist/`:

```
bun run build
```

## Preview (serve build)

Serve the built `dist/` on port 3000:

```
bun run preview
```

## Project layout

- `index.html` – Vite HTML entry (includes MapLibre GL CSS)
- `src/main.ts` – app entry (TypeScript, MapLibre GL 3D + terrain)
- `public/data.json` – example drone data (served at `/data.json`)
- `vite.config.ts` – Vite config (dev/preview on 3000)
- `server.js` – legacy static server (no longer used)
- `package.json` – Bun + Vite scripts

## 3D map details

- Uses MapLibre GL with raster OSM tiles and AWS Terrarium elevation tiles for terrain (no API key required).
- Dev server proxies tiles (`/osm` and `/elevation`) to avoid CORS; run via `bun run dev`.
- Camera starts pitched and bearing set; a sky layer renders atmospheric background.
- Drone markers are custom DOM elements, rotated to heading and positioned over terrain.

Leaflet is loaded via CDN in `index.html` and used as a global (`L`).
