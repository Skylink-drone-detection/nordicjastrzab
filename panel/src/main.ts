import { Map, Marker, NavigationControl, Popup } from 'maplibre-gl';

// ── TILE URLS ───────────────────────────────────────────────────────────

const useProxy = import.meta.env.DEV;

const osmTiles = useProxy
  ? ['/osm/{z}/{x}/{y}.png']
  : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];

const demTiles = useProxy
  ? ['/elevation/terrarium/{z}/{x}/{y}.png']
  : ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'];

const satTiles = useProxy
  ? ['/satellite/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']
  : ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];

// ── SYSTEM POSITION (center of detection zones) ─────────────────────────

const SYSTEM_LAT = 50.06490926668458;
const SYSTEM_LON = 19.95168864508277;

const ZONE_WARNING_RADIUS = 1000;   // meters
const ZONE_THREAT_RADIUS  = 100;    // meters

// ── MAP STYLE ───────────────────────────────────────────────────────────

const style = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: osmTiles,
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    },
    terrain: {
      type: 'raster-dem',
      tiles: demTiles,
      tileSize: 256,
      maxzoom: 14,
      encoding: 'terrarium'
    }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#dde3ea' } },
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.85 } }
  ],
} as const;

// ── GEO HELPERS ─────────────────────────────────────────────────────────

/** Haversine distance in meters */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Generate GeoJSON circle polygon (approximation with N points) */
function geoCircle(centerLat: number, centerLon: number, radiusMeters: number, points = 64): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const R = 6371000;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusMeters / R) * Math.cos(angle);
    const dLon = (radiusMeters / (R * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);
    coords.push([
      centerLon + dLon * (180 / Math.PI),
      centerLat + dLat * (180 / Math.PI)
    ]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] }
  };
}

/** Threat level based on distance from system */
function distanceThreat(lat: number, lon: number): 'safe' | 'warning' | 'threat' {
  const dist = haversineMeters(SYSTEM_LAT, SYSTEM_LON, lat, lon);
  if (dist <= ZONE_THREAT_RADIUS) return 'threat';
  if (dist <= ZONE_WARNING_RADIUS) return 'warning';
  return 'safe';
}

function threatColor(threat: string): string {
  if (threat === 'threat') return '#ff5c5c';
  if (threat === 'warning') return '#f5a623';
  return '#5cdb95';
}

function threatColorFromScore(score: number): string {
  // Legacy compat for timeline area chart
  if (score >= 0.9) return '#ff5c5c';
  if (score >= 0.6) return '#f5a623';
  return '#5cdb95';
}

function threatFilter(threat: string): string {
  if (threat === 'threat') return 'drop-shadow(0 0 8px rgba(255,92,92,0.8)) drop-shadow(0 0 3px rgba(255,92,92,1))';
  if (threat === 'warning') return 'drop-shadow(0 0 8px rgba(245,166,35,0.8)) drop-shadow(0 0 3px rgba(245,166,35,1))';
  return 'drop-shadow(0 0 8px rgba(92,219,149,0.7)) drop-shadow(0 0 3px rgba(92,219,149,1))';
}

// ── WEBGL ───────────────────────────────────────────────────────────────

function isWebGLSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

if (!isWebGLSupported()) {
  const el = document.getElementById('map');
  if (el) el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#333;background:#fafafa">WebGL not supported.</div>';
  throw new Error('WebGL not supported');
}

// ── CREATE MAP ──────────────────────────────────────────────────────────

const map = new Map({
  container: 'map',
  style: style as any,
  center: [SYSTEM_LON, SYSTEM_LAT],
  zoom: 14,
  pitch: 60,
  bearing: -17.6,
  antialias: true
});

map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
map.dragRotate.enable();
map.touchZoomRotate.enableRotation();

// ── ON LOAD ─────────────────────────────────────────────────────────────

let mapLoaded = false;

map.on('load', () => {
  mapLoaded = true;

  // Terrain + hillshade
  try {
    // @ts-expect-error maplibre typing
    map.setTerrain({ source: 'terrain', exaggeration: 1.8 });
    map.addLayer({
      id: 'hillshade', type: 'hillshade', source: 'terrain',
      layout: { visibility: 'visible' },
      paint: { 'hillshade-exaggeration': 0.6 }
    }, 'osm');
  } catch (e) { console.error('Terrain error:', e); }

  // Satellite (hidden)
  try {
    map.addSource('esri-satellite', {
      type: 'raster', tiles: satTiles, tileSize: 256, maxzoom: 18,
      attribution: '© Esri · Maxar · GeoEye'
    });
    map.addLayer({
      id: 'satellite-layer', type: 'raster', source: 'esri-satellite',
      layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.95 }
    }, map.getLayer('hillshade') ? 'hillshade' : 'osm');
  } catch (e) { console.error('Satellite error:', e); }

  // ── DETECTION ZONES ─────────────────────────────────────────────────
  // Warning zone (1km)
  map.addSource('zone-warning', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [geoCircle(SYSTEM_LAT, SYSTEM_LON, ZONE_WARNING_RADIUS)] }
  });
  map.addLayer({
    id: 'zone-warning-fill', type: 'fill', source: 'zone-warning',
    paint: { 'fill-color': '#f5a623', 'fill-opacity': 0.06 }
  });
  map.addLayer({
    id: 'zone-warning-line', type: 'line', source: 'zone-warning',
    paint: { 'line-color': '#f5a623', 'line-width': 1.5, 'line-opacity': 0.4, 'line-dasharray': [4, 4] }
  });

  // Threat zone (100m)
  map.addSource('zone-threat', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [geoCircle(SYSTEM_LAT, SYSTEM_LON, ZONE_THREAT_RADIUS)] }
  });
  map.addLayer({
    id: 'zone-threat-fill', type: 'fill', source: 'zone-threat',
    paint: { 'fill-color': '#ff5c5c', 'fill-opacity': 0.08 }
  });
  map.addLayer({
    id: 'zone-threat-line', type: 'line', source: 'zone-threat',
    paint: { 'line-color': '#ff5c5c', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [2, 3] }
  });

  // System center marker
  map.addSource('system-center', {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [SYSTEM_LON, SYSTEM_LAT] } }
  });
  map.addLayer({
    id: 'system-center-glow', type: 'circle', source: 'system-center',
    paint: { 'circle-radius': 12, 'circle-color': '#5cdb95', 'circle-opacity': 0.15, 'circle-blur': 1 }
  });
  map.addLayer({
    id: 'system-center-dot', type: 'circle', source: 'system-center',
    paint: { 'circle-radius': 4, 'circle-color': '#5cdb95', 'circle-opacity': 0.9, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' }
  });

  // Zone labels
  map.addSource('zone-labels', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { label: 'WARNING ZONE · 1km' },
          geometry: { type: 'Point', coordinates: [SYSTEM_LON, SYSTEM_LAT + (ZONE_WARNING_RADIUS / 111320) * 0.92] }
        },
        {
          type: 'Feature',
          properties: { label: 'THREAT · 100m' },
          geometry: { type: 'Point', coordinates: [SYSTEM_LON, SYSTEM_LAT + (ZONE_THREAT_RADIUS / 111320) * 0.85] }
        }
      ]
    }
  });
  map.addLayer({
    id: 'zone-labels-text', type: 'symbol', source: 'zone-labels',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Open Sans Bold'],
      'text-size': 10,
      'text-anchor': 'bottom',
      'text-allow-overlap': true
    },
    paint: { 'text-color': 'rgba(240,240,238,0.35)', 'text-halo-color': 'rgba(0,0,0,0.5)', 'text-halo-width': 1 }
  });

  // ── TRAIL SOURCES ───────────────────────────────────────────────────
  map.addSource('drone-trail', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'drone-trail-line', type: 'line', source: 'drone-trail',
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.7 }
  });
  map.addSource('drone-trail-dots', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'drone-trail-dots-layer', type: 'circle', source: 'drone-trail-dots',
    paint: { 'circle-radius': 3, 'circle-color': ['get', 'color'], 'circle-opacity': 0.5 }
  });
});

map.on('error', (e) => console.error('MapLibre error:', e?.error || e));

// ── SATELLITE TOGGLE ────────────────────────────────────────────────────

document.addEventListener('satellite-toggle', (e: Event) => {
  const active = (e as CustomEvent<{ active: boolean }>).detail.active;
  if (!map.getLayer('satellite-layer')) return;
  map.setLayoutProperty('satellite-layer', 'visibility', active ? 'visible' : 'none');
  map.setPaintProperty('osm', 'raster-opacity', active ? 0 : 0.85);
  if (map.getLayer('hillshade'))
    map.setLayoutProperty('hillshade', 'visibility', active ? 'none' : 'visible');
});

// ── TYPES ───────────────────────────────────────────────────────────────

type Drone = {
  id: string;
  type: string;
  brand: string;
  altitude: number;
  lat: number;
  lon: number;
  distance: number;          // meters from system
  threat: 'safe' | 'warning' | 'threat';
  timestamp: string;
};

type RawEntry = {
  timestamp: string;
  score: number;
  position: [number, number];
};

type HistorySnapshot = {
  time: number;
  timeLabel: string;
  entries: { lat: number; lon: number; threat: string; id: string; distance: number }[];
};

type MarkerRef = {
  marker: Marker;
  iconEl: HTMLElement;
  currentThreat: string;
};

let drones: Drone[] = [];
let markerRefs: Record<string, MarkerRef> = {};
let trackedDroneId: string | null = null;

// ── HISTORY ─────────────────────────────────────────────────────────────

const history: HistorySnapshot[] = [];
const MAX_HISTORY = 3600;
let isLive = true;
let scrubIndex = -1;
let ghostMarker: Marker | null = null;

// ── FETCH ───────────────────────────────────────────────────────────────

async function fetchPanelData(): Promise<RawEntry[]> {
  try {
    const resp = await fetch('/panel_data.json', { cache: 'no-store' });
    if (!resp.ok) return [];
    const raw = await resp.json();
    const arr: RawEntry[] = Array.isArray(raw) ? raw : [raw];
    return arr.filter(e =>
      e && Array.isArray(e.position) && e.position.length >= 2
      && typeof e.position[0] === 'number' && typeof e.position[1] === 'number'
    );
  } catch { return []; }
}

// ── HELPERS ─────────────────────────────────────────────────────────────

function droneId(i: number): string {
  return 'DR-' + String(i + 1).padStart(3, '0');
}

const DRONE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 40 40" fill="none">
  <line x1="20" y1="20" x2="9"  y2="9"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <line x1="20" y1="20" x2="31" y2="9"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <line x1="20" y1="20" x2="9"  y2="31" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <line x1="20" y1="20" x2="31" y2="31" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <circle cx="9"  cy="9"  r="5.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="31" cy="9"  r="5.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="9"  cy="31" r="5.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="31" cy="31" r="5.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="9"  cy="9"  r="1.8" fill="currentColor"/>
  <circle cx="31" cy="9"  r="1.8" fill="currentColor"/>
  <circle cx="9"  cy="31" r="1.8" fill="currentColor"/>
  <circle cx="31" cy="31" r="1.8" fill="currentColor"/>
  <rect x="15.5" y="15.5" width="9" height="9" rx="2" fill="currentColor" opacity="0.9"/>
  <circle cx="20" cy="20" r="2" fill="#0d0f10" opacity="0.8"/>
</svg>`;

// ── MARKER COLOR ────────────────────────────────────────────────────────

function updateMarkerColor(id: string, threat: string) {
  const ref = markerRefs[id];
  if (!ref || ref.currentThreat === threat) return;
  ref.currentThreat = threat;
  ref.iconEl.style.color = threatColor(threat);
  ref.iconEl.style.filter = threatFilter(threat);
}

// ── CREATE DRONE ────────────────────────────────────────────────────────

function createDrone(entry: RawEntry, index: number): Drone {
  const metersPerDegLat = 11120;
  const metersPerDegLon = 11120 * Math.cos(SYSTEM_LAT * Math.PI / 180);
  const lat = SYSTEM_LAT + entry.position[1] / metersPerDegLat;  // position[1] = y = north meters
  const lon = SYSTEM_LON + entry.position[0] / metersPerDegLon;  // position[0] = x = east meters
  const dist = haversineMeters(SYSTEM_LAT, SYSTEM_LON, lat, lon);
  const threat = distanceThreat(lat, lon);

  const drone: Drone = {
    id: droneId(index),
    type: ['FPV', 'Quadcopter', 'Survey'][index % 3],
    brand: ['DJI', 'Parrot', 'Autel'][index % 3],
    altitude: Math.floor(50 + entry.score * 100),
    lat, lon, distance: dist, threat,
    timestamp: entry.timestamp,
  };

  const el = document.createElement('div');
  el.className = 'droneMarker';
  const iconEl = document.createElement('div');
  iconEl.className = 'droneIcon';
  iconEl.innerHTML = DRONE_SVG;
  iconEl.style.color = threatColor(threat);
  iconEl.style.filter = threatFilter(threat);
  el.appendChild(iconEl);

  const marker = new Marker({ element: el, pitchAlignment: 'map', rotationAlignment: 'map' })
    .setLngLat([lon, lat]).addTo(map);

  const popup = new Popup({ offset: 12 }).setHTML(`
    <b>${drone.id}</b><br><br>
    Type: ${drone.type}<br>Brand: ${drone.brand}<br>
    Distance: ${dist.toFixed(0)} m<br>Alt: ${drone.altitude} m<br>
    Status: <span style="color:${threatColor(threat)}">${threat.toUpperCase()}</span>
  `);
  marker.setPopup(popup);
  el.addEventListener('click', () => marker.togglePopup());

  markerRefs[drone.id] = { marker, iconEl, currentThreat: threat };
  drones.push(drone);
  return drone;
}

// ── UPDATE DRONE ────────────────────────────────────────────────────────

function updateDrone(drone: Drone, entry: RawEntry) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(SYSTEM_LAT * Math.PI / 180);
  drone.lat = SYSTEM_LAT + entry.position[1] / metersPerDegLat;
  drone.lon = SYSTEM_LON + entry.position[0] / metersPerDegLon;
  drone.altitude = Math.floor(50 + entry.score * 100);
  drone.timestamp = entry.timestamp;
  drone.distance = haversineMeters(SYSTEM_LAT, SYSTEM_LON, drone.lat, drone.lon);
  drone.threat = distanceThreat(drone.lat, drone.lon);

  const ref = markerRefs[drone.id];
  if (ref) {
    ref.marker.setLngLat([drone.lon, drone.lat]);
    updateMarkerColor(drone.id, drone.threat);

    // Update popup content
    ref.marker.getPopup()?.setHTML(`
      <b>${drone.id}</b><br><br>
      Type: ${drone.type}<br>Brand: ${drone.brand}<br>
      Distance: ${drone.distance.toFixed(0)} m<br>Alt: ${drone.altitude} m<br>
      Status: <span style="color:${threatColor(drone.threat)}">${drone.threat.toUpperCase()}</span>
    `);
  }

  if (trackedDroneId === drone.id && isLive) {
    map.easeTo({ center: [drone.lon, drone.lat], duration: 800 });
  }
}

// ── GHOST MARKER ────────────────────────────────────────────────────────

function createGhostMarker(lat: number, lon: number) {
  ghostMarker?.remove();
  const el = document.createElement('div');
  el.className = 'droneMarker';
  el.style.opacity = '0.45';
  el.innerHTML = `<div class="droneIcon" style="color:#fff;filter:drop-shadow(0 0 12px rgba(255,255,255,0.9))">${DRONE_SVG}</div>`;
  ghostMarker = new Marker({ element: el, pitchAlignment: 'map', rotationAlignment: 'map' })
    .setLngLat([lon, lat]).addTo(map);
}
function removeGhostMarker() { ghostMarker?.remove(); ghostMarker = null; }

// ── PANEL LIST ──────────────────────────────────────────────────────────

function updatePanel() {
  const list = document.getElementById('droneList');
  if (!list) return;
  list.innerHTML = '';

  if (drones.length === 0) {
    list.innerHTML = '<div class="no-drones">Waiting for data…</div>';
    updateCounters(0, 0, 0);
    return;
  }

  let warns = 0, threats = 0;

  drones.forEach(d => {
    if (d.threat === 'warning') warns++;
    if (d.threat === 'threat') threats++;
    const isTracked = trackedDroneId === d.id;

    const div = document.createElement('div');
    div.className = `droneItem ${d.threat}${isTracked ? ' tracked' : ''}`;

    const icon = document.createElement('div');
    icon.className = 'droneIcon';
    icon.innerHTML = DRONE_SVG;

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    info.innerHTML = `<b>${d.id}</b><br>${d.type} · ${d.distance.toFixed(0)} m<br>Alt: ${d.altitude} m`;

    const trackBtn = document.createElement('button');
    trackBtn.className = 'btn-track';
    trackBtn.innerHTML = '◎';
    trackBtn.title = isTracked ? 'Stop tracking' : 'Track drone';
    trackBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      trackedDroneId = trackedDroneId === d.id ? null : d.id;
      if (trackedDroneId === d.id)
        map.easeTo({ center: [d.lon, d.lat], zoom: Math.max(map.getZoom(), 16), duration: 600 });
      updatePanel();
    });

    div.appendChild(icon);
    div.appendChild(info);
    div.appendChild(trackBtn);
    div.addEventListener('click', () => {
      map.easeTo({ center: [d.lon, d.lat], zoom: Math.max(map.getZoom(), 15) });
      markerRefs[d.id]?.marker.togglePopup();
    });
    list.appendChild(div);
  });

  updateCounters(drones.length, warns, threats);
}

function updateCounters(total: number, warns: number, threats: number) {
  const ct = document.getElementById('countTotal');
  const cw = document.getElementById('countWarn');
  const ch = document.getElementById('countThreat');
  if (ct) ct.textContent = String(total);
  if (cw) cw.textContent = String(warns);
  if (ch) ch.textContent = String(threats);
}

// ── SYNC ────────────────────────────────────────────────────────────────

function syncDrones(entries: RawEntry[]) {
  for (let i = 0; i < entries.length; i++) {
    if (i < drones.length) updateDrone(drones[i], entries[i]);
    else createDrone(entries[i], i);
  }

  while (drones.length > entries.length) {
    const removed = drones.pop()!;
    markerRefs[removed.id]?.marker.remove();
    delete markerRefs[removed.id];
    if (trackedDroneId === removed.id) trackedDroneId = null;
  }

  const now = new Date();
  history.push({
    time: now.getTime(),
    timeLabel: now.toLocaleTimeString('pl-PL', { hour12: false }),
    entries: drones.map(d => ({ lat: d.lat, lon: d.lon, threat: d.threat, id: d.id, distance: d.distance }))
  });
  if (history.length > MAX_HISTORY) history.shift();

  updatePanel();
  updateTrail();
  if (isLive) renderTimeline();
}

// ── MAP TRAIL ───────────────────────────────────────────────────────────

function updateTrail() {
  if (!mapLoaded) return;
  const trailSrc = map.getSource('drone-trail') as any;
  const dotsSrc = map.getSource('drone-trail-dots') as any;
  if (!trailSrc || !dotsSrc) return;

  const ids = new Set<string>();
  history.forEach(s => s.entries.forEach(e => ids.add(e.id)));

  const lines: any[] = [];
  const dots: any[] = [];
  const endIdx = isLive ? history.length : scrubIndex + 1;

  ids.forEach(id => {
    const coords: [number, number][] = [];
    let lastThreat = 'safe';

    for (let i = 0; i < endIdx && i < history.length; i++) {
      const entry = history[i].entries.find(e => e.id === id);
      if (entry) {
        coords.push([entry.lon, entry.lat]);
        lastThreat = entry.threat;
        if (i % 10 === 0) {
          dots.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [entry.lon, entry.lat] },
            properties: { color: threatColor(entry.threat) }
          });
        }
      }
    }

    if (coords.length >= 2) {
      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { color: threatColor(lastThreat) }
      });
    }
  });

  trailSrc.setData({ type: 'FeatureCollection', features: lines });
  dotsSrc.setData({ type: 'FeatureCollection', features: dots });
}

// ── TIMELINE ────────────────────────────────────────────────────────────

const tlCanvas = document.getElementById('timelineCanvas') as HTMLCanvasElement;
const tlTrack = document.getElementById('timelineTrack') as HTMLElement;
const tlPlayhead = document.getElementById('timelinePlayhead') as HTMLElement;
const tlClock = document.getElementById('timelineClock') as HTMLElement;
const btnLive = document.getElementById('btn-live') as HTMLButtonElement;

/** Map threat to a 0-1 score for timeline visualization */
function threatToScore(threat: string): number {
  if (threat === 'threat') return 1;
  if (threat === 'warning') return 0.65;
  return 0.2;
}

function renderTimeline() {
  if (!tlCanvas || history.length === 0) return;

  const rect = tlTrack.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const dpr = window.devicePixelRatio || 1;

  tlCanvas.width = w * dpr;
  tlCanvas.height = h * dpr;
  const ctx = tlCanvas.getContext('2d')!;
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const len = history.length;
  const midY = h * 0.45;
  const maxBarH = h * 0.7;

  // Score per point (max threat across drones)
  const scores: number[] = [];
  const colors: string[] = [];
  for (let i = 0; i < len; i++) {
    const snap = history[i];
    if (snap.entries.length === 0) {
      scores.push(0);
      colors.push('#5cdb95');
      continue;
    }
    // Highest threat level at this point
    let maxThreat = 'safe';
    for (const e of snap.entries) {
      if (e.threat === 'threat') { maxThreat = 'threat'; break; }
      if (e.threat === 'warning') maxThreat = 'warning';
    }
    scores.push(threatToScore(maxThreat));
    colors.push(threatColor(maxThreat));
  }

  // Area fill
  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = (i / Math.max(len - 1, 1)) * w;
    const barH = scores[i] * maxBarH;
    const y = midY + maxBarH / 2 - barH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, midY + maxBarH / 2);
  ctx.lineTo(0, midY + maxBarH / 2);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, midY - maxBarH / 2, 0, midY + maxBarH / 2);
  grad.addColorStop(0, colors[len - 1] || '#5cdb95');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.25;
  ctx.fill();

  // Edge line
  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = (i / Math.max(len - 1, 1)) * w;
    const barH = scores[i] * maxBarH;
    const y = midY + maxBarH / 2 - barH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = colors[len - 1] || '#5cdb95';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.8;
  ctx.stroke();

  // Glow
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.15;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Threat change markers
  for (let i = 1; i < len; i++) {
    if (colors[i] !== colors[i - 1]) {
      const x = (i / Math.max(len - 1, 1)) * w;
      ctx.beginPath();
      ctx.moveTo(x, midY - maxBarH / 2 - 2);
      ctx.lineTo(x, midY + maxBarH / 2 + 2);
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Status bar at bottom
  const segH = 3;
  const segY = h - segH - 2;
  for (let i = 0; i < len; i++) {
    const x = (i / Math.max(len - 1, 1)) * w;
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.6;
    ctx.fillRect(x, segY, Math.max(w / len, 1.5), segH);
  }
  ctx.globalAlpha = 1;

  // Time labels
  if (len > 1) {
    ctx.font = '9px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(240,240,238,0.2)';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(history[0].timeLabel, 2, h - 1);
    ctx.textAlign = 'right';
    ctx.fillText(history[len - 1].timeLabel, w - 2, h - 1);
    if (len > 20) {
      ctx.textAlign = 'center';
      ctx.fillText(history[Math.floor(len / 2)].timeLabel, w / 2, h - 1);
    }
  }

  // Playhead
  if (isLive) {
    tlPlayhead.style.left = '100%';
    tlClock.textContent = history[len - 1]?.timeLabel ?? '--:--:--';
  } else if (scrubIndex >= 0 && scrubIndex < len) {
    tlPlayhead.style.left = (scrubIndex / Math.max(len - 1, 1)) * 100 + '%';
    tlClock.textContent = history[scrubIndex]?.timeLabel ?? '--:--:--';
  }
}

// ── TIMELINE INTERACTION ────────────────────────────────────────────────

function scrubToPosition(clientX: number) {
  if (history.length === 0) return;
  const rect = tlTrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const idx = Math.round(pct * (history.length - 1));

  isLive = false;
  scrubIndex = idx;
  btnLive?.classList.remove('active');

  const snap = history[idx];
  if (snap?.entries.length > 0) {
    const e = snap.entries[0];
    createGhostMarker(e.lat, e.lon);
    map.easeTo({ center: [e.lon, e.lat], duration: 300 });
  }
  updateTrail();
  renderTimeline();
}

function goLive() {
  isLive = true;
  scrubIndex = -1;
  btnLive?.classList.add('active');
  removeGhostMarker();
  updateTrail();
  renderTimeline();
  if (drones.length > 0) {
    const d = trackedDroneId ? drones.find(dr => dr.id === trackedDroneId) : drones[0];
    if (d) map.easeTo({ center: [d.lon, d.lat], duration: 600 });
  }
}

let isDragging = false;
tlTrack?.addEventListener('mousedown', (e) => { isDragging = true; scrubToPosition(e.clientX); });
window.addEventListener('mousemove', (e) => { if (isDragging) scrubToPosition(e.clientX); });
window.addEventListener('mouseup', () => { isDragging = false; });
tlTrack?.addEventListener('touchstart', (e) => { isDragging = true; scrubToPosition(e.touches[0].clientX); }, { passive: true });
window.addEventListener('touchmove', (e) => { if (isDragging) scrubToPosition(e.touches[0].clientX); }, { passive: true });
window.addEventListener('touchend', () => { isDragging = false; });
btnLive?.addEventListener('click', goLive);

// ── INIT + POLL ─────────────────────────────────────────────────────────

async function init() {
  const entries = await fetchPanelData();
  if (entries.length > 0) {
    syncDrones(entries);
    // Start centered on system, not on drone
    map.easeTo({ center: [SYSTEM_LON, SYSTEM_LAT], zoom: 14, duration: 1000 });
  } else {
    console.warn('[SentiGuard] No data on init — retrying every second');
  }
}

init();

setInterval(async () => {
  const entries = await fetchPanelData();
  if (entries.length > 0) syncDrones(entries);
}, 1000);

window.addEventListener('resize', () => { if (isLive) renderTimeline(); });
