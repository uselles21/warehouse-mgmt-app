
// state
const LEGACY_WH = { w: 400, h: 180, unit: 'ft' };
const DEFAULT_PALLET = { w: 4, h: 4 };
const API_BASE = '';
const SAVE_DEBOUNCE_MS = 2000;
const POLL_INTERVAL_MS = 3000;
const WH_CONFIGS = [
  { key: 'tent3', name: 'Tent-3', w: 400, h: 180, lw: 200, lh: 85, unit: 'ft' },
  { key: 'tent4', name: 'Tent-4', w: 800, h: 260, lw: 800, lh: 260, unit: 'ft' },
];
let WH = { ...WH_CONFIGS[0] };

/* Tent-4 structural columns config */
const T4_COL_ROWS_Y = [50, 130, 210, 260];
const T4_COL_SPACING_X = 26;
const T4_COL_SIZE = 2;
const T4_PALLET_SIZE = 4;
const T4_DOOR = { wall: 'top', x1: 26, x2: 52 }; // top wall, between 2nd and 3rd column

function getT4Columns() {
  const cols = [];
  for (const rowY of T4_COL_ROWS_Y) {
    for (let x = 0; x <= 800; x += T4_COL_SPACING_X) {
      cols.push({ x, y: rowY });
    }
  }
  return cols;
}

/* Pallet capacity calculator for Tent-4 zones */
function palletOverlapsColumn(px, py, pw, ph, columns) {
  const half = T4_COL_SIZE / 2;
  for (const col of columns) {
    if (px < col.x + half && px + pw > col.x - half &&
        py < col.y + half && py + ph > col.y - half) {
      return true;
    }
  }
  return false;
}

function getColumnsInRect(rx, ry, rw, rh) {
  if (currentWH !== 1) return [];
  const cols = getT4Columns();
  const half = T4_COL_SIZE / 2;
  const result = [];
  for (const col of cols) {
    if (col.x + half > rx && col.x - half < rx + rw &&
        col.y + half > ry && col.y - half < ry + rh) {
      result.push(col);
    }
  }
  return result;
}

function calcMaxPallets(zoneSegs) {
  if (currentWH !== 1) return { count: 0, positions: [], blocked: 0, columnsInZone: 0 };
  const cols = getT4Columns();
  const ps = T4_PALLET_SIZE;
  let totalCount = 0, totalBlocked = 0, totalCols = 0;
  const allPositions = [];
  for (const seg of zoneSegs) {
    const segCols = getColumnsInRect(seg.x, seg.y, seg.w, seg.h);
    totalCols += segCols.length;
    const gridW = Math.floor(seg.w / ps);
    const gridH = Math.floor(seg.h / ps);
    for (let iy = 0; iy < gridH; iy++) {
      for (let ix = 0; ix < gridW; ix++) {
        const px = seg.x + ix * ps;
        const py = seg.y + iy * ps;
        if (palletOverlapsColumn(px, py, ps, ps, segCols)) {
          totalBlocked++;
        } else {
          allPositions.push({ x: px, y: py });
          totalCount++;
        }
      }
    }
  }
  return { count: totalCount, positions: allPositions, blocked: totalBlocked, columnsInZone: totalCols };
}

let categories = [
  { id:'staging', name:'Staging', color:'#ec4899',
    subs:['Prestaging'] },
  { id:'dh', name:'Distribution Hub', color:'#22c997',
    subs:['DH11','DH9','DH9 Copper'] },
  { id:'aec', name:'AEC', color:'#8b5cf6',
    subs:['AEC-1','AEC-2'] },
  { id:'roce', name:'ROCE (R)', color:'#3b82f6',
    subs:['R T1-T2','R T2-T3'] },
  { id:'sis', name:'SIS (S)', color:'#f97316',
    subs:['S AS T-1','S T1-T2','S T2-T3'] },
  { id:'nvs', name:'NVS', color:'#eab308',
    subs:['NVS-NVM','NVS-NVB','NVS-KS'] },
  { id:'ops', name:'Operations', color:'#f472b6',
    subs:['TDS QC Area','TDS Labeling','Jeda Labeling','Leadership'] },
  { id:'infra', name:'Infrastructure', color:'#6b7280',
    subs:['Network Rack','Quad Outlet','Power Area'] },
  { id:'special', name:'Special', color:'#06b6d4',
    subs:['DEV-EM','GPU-MS','SPARES','IPMI CAT6'] },
];

let nextZId = 100;
let nextPId = 1000;
let nextCId = 50;

let gasLights = []; // array of { id, name, x, y, status: 'on'|'off', notes: '' }
let nextGLId = 1;
function glid() { return 'gl' + (nextGLId++); }

let hazards = []; // array of { id, name, x, y, color: 'red'|'yellow'|'green', notes: '' }
let nextHZId = 1;
function hzid() { return 'hz' + (nextHZId++); }

function zid() { return 'z' + (nextZId++); }
function pid() { return 'p' + (nextPId++); }
function round1(v) { return Math.round(v * 10) / 10; }
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function getSlotExtent(slot) {
  let maxX = 0;
  let maxY = 0;
  if (!slot) return { maxX, maxY };
  (slot.zones || []).forEach(z => {
    (z.segs || []).forEach(s => {
      maxX = Math.max(maxX, (s.x || 0) + (s.w || 0));
      maxY = Math.max(maxY, (s.y || 0) + (s.h || 0));
    });
    (z.pallets || []).forEach(p => {
      maxX = Math.max(maxX, (p.x || 0) + (p.w || DEFAULT_PALLET.w));
      maxY = Math.max(maxY, (p.y || 0) + (p.h || DEFAULT_PALLET.h));
    });
  });
  (slot.gasLights || []).forEach(gl => {
    maxX = Math.max(maxX, gl.x || 0);
    maxY = Math.max(maxY, gl.y || 0);
  });
  (slot.hazards || []).forEach(hz => {
    maxX = Math.max(maxX, hz.x || 0);
    maxY = Math.max(maxY, hz.y || 0);
  });
  return { maxX, maxY };
}

function inferWarehouseFromSlot(slot) {
  if (!slot) return WH_CONFIGS[0];
  if (slot.warehouse && slot.warehouse.w && slot.warehouse.h) return slot.warehouse;
  const extent = getSlotExtent(slot);
  if (extent.maxX > WH_CONFIGS[0].w + 20 || extent.maxY > WH_CONFIGS[0].h + 10) {
    return WH_CONFIGS[1];
  }
  return WH_CONFIGS[0];
}

function scaleSlotToWarehouse(slot, fromWH, toWH) {
  if (!slot) return slot;
  if (!fromWH || !toWH || !fromWH.w || !fromWH.h) return deepClone(slot);
  if (Math.abs(fromWH.w - toWH.w) < 0.1 && Math.abs(fromWH.h - toWH.h) < 0.1) {
    return deepClone(slot);
  }
  const sx = toWH.w / fromWH.w;
  const sy = toWH.h / fromWH.h;
  const scaled = deepClone(slot);
  (scaled.zones || []).forEach(z => {
    (z.segs || []).forEach(s => {
      s.x = round1((s.x || 0) * sx);
      s.y = round1((s.y || 0) * sy);
      s.w = round1((s.w || 0) * sx);
      s.h = round1((s.h || 0) * sy);
    });
    (z.pallets || []).forEach(p => {
      p.x = round1((p.x || 0) * sx);
      p.y = round1((p.y || 0) * sy);
      p.w = round1((p.w || DEFAULT_PALLET.w) * sx);
      p.h = round1((p.h || DEFAULT_PALLET.h) * sy);
    });
  });
  (scaled.gasLights || []).forEach(gl => {
    gl.x = round1((gl.x || 0) * sx);
    gl.y = round1((gl.y || 0) * sy);
  });
  (scaled.hazards || []).forEach(hz => {
    hz.x = round1((hz.x || 0) * sx);
    hz.y = round1((hz.y || 0) * sy);
  });
  return scaled;
}

function normalizeSlotToWarehouse(slot, targetWH, declaredWH = null) {
  if (!slot) return slot;
  const source = declaredWH || inferWarehouseFromSlot(slot);
  return scaleSlotToWarehouse(slot, source, targetWH);
}

function normalizeSlotToCurrentWarehouse(slot, declaredWH = null) {
  return normalizeSlotToWarehouse(slot, WH, declaredWH);
}

// Default zones empty — Tent-3 starts clean (saved data loads from IndexedDB)
let zones = [];

zones.forEach(z => { if (!z.tags) z.tags = []; if (z.parentId === undefined) z.parentId = null; if (!z.pallets) z.pallets = []; if (!z.segs) z.segs = []; });

function makePals(zx, zy, zw, zh, prefix, count) {
  const pals = [];
  const cols = Math.ceil(Math.sqrt(count * (zw / zh)));
  const rows = Math.ceil(count / cols);
  const pad = 3;
  const pw = Math.max(4, (zw - pad * 2 - (cols - 1) * 2) / cols);
  const ph = Math.max(4, (zh - 18 - pad - (rows - 1) * 2) / rows);
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    pals.push({
      id: pid(),
      label: prefix + (i + 1),
      x: zx + pad + c * (pw + 2),
      y: zy + 16 + r * (ph + 2),
      w: Math.round(pw * 10) / 10,
      h: Math.round(ph * 10) / 10
    });
  }
  return pals;
}

let sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: null, hazardId: null };
let multiSel = []; // {zid, pid}[]
let snap = true;
let heatMapOn = false;
const SNAP_GRID = 5;

/* =================================================================
   MULTI-WAREHOUSE SUPPORT
   ================================================================= */
let currentWH = Number(localStorage.getItem('whsims.currentWH') || '0');
if (![0, 1].includes(currentWH)) currentWH = 0;
const WH_THEMES = ['wh2', 'wh3']; // CSS class per warehouse (Tent-3=orange, Tent-4=green)
const WH_ACCENTS = ['#f59e0b', '#10b981']; // tab dot colors

function saveCurrentToSlot() {
  return {
    zones: JSON.parse(JSON.stringify(zones)),
    categories: JSON.parse(JSON.stringify(categories)),
    nextZId, nextPId, nextCId,
    gasLights: JSON.parse(JSON.stringify(gasLights || [])),
    nextGLId,
    hazards: JSON.parse(JSON.stringify(hazards || [])),
    nextHZId,
    warehouse: { ...WH_CONFIGS[currentWH] }
  };
}

function loadSlotToCurrent(slot) {
  zones = slot.zones || [];
  zones.forEach(z => { if (!z.tags) z.tags = []; if (z.parentId === undefined) z.parentId = null; if (!z.pallets) z.pallets = []; if (!z.segs) z.segs = []; });
  categories = slot.categories || categories;
  nextZId = slot.nextZId || nextZId;
  nextPId = slot.nextPId || nextPId;
  nextCId = slot.nextCId || nextCId;
  gasLights = slot.gasLights || []; nextGLId = slot.nextGLId || nextGLId;
  hazards = slot.hazards || []; nextHZId = slot.nextHZId || nextHZId;
}

let warehouseData = [null, null]; // filled in init (Tent-3, Tent-4)

function migrateLegacyWarehouses(warehouses) {
  if (!Array.isArray(warehouses)) return [null, null];
  const slots = warehouses.slice();
  const hasMetadata = slots.some(slot => slot && slot.warehouse && slot.warehouse.key);
  if (hasMetadata) return slots.slice(0, 2);
  if (slots.length === 2) return [slots[1] || null, null];
  if (slots.length >= 3) return [slots[1] || null, slots[2] || null];
  return [slots[0] || null, slots[1] || null];
}

function normalizeServerLayout(layout) {
  if (!layout || !Array.isArray(layout.warehouses)) return layout;
  const migrated = migrateLegacyWarehouses(layout.warehouses);
  return {
    warehouse: WH_CONFIGS[currentWH] || WH,
    warehouses: migrated.map((slot, idx) => {
      if (!slot) return slot;
      const declared = slot.warehouse && slot.warehouse.w && slot.warehouse.h
        ? slot.warehouse
        : (idx === 0 ? LEGACY_WH : WH_CONFIGS[idx]);
      const normalized = normalizeSlotToWarehouse(slot, WH_CONFIGS[idx], declared);
      normalized.warehouse = { ...WH_CONFIGS[idx] };
      if (!normalized.gasLights) normalized.gasLights = [];
      if (!normalized.nextGLId) normalized.nextGLId = 1;
      if (!normalized.hazards) normalized.hazards = [];
      if (!normalized.nextHZId) normalized.nextHZId = 1;
      return normalized;
    }),
    currentWH: 0
  };
}

function applyWarehouseTheme(idx) {
  WH_THEMES.forEach(t => { if (t) document.body.classList.remove(t); });
  if (WH_THEMES[idx]) document.body.classList.add(WH_THEMES[idx]);
  WH = { ...WH_CONFIGS[idx] };
  const label = document.getElementById('whDimsLabel');
  if (label) label.textContent = `${WH.lw || WH.w} × ${WH.lh || WH.h} ft`;
  document.querySelectorAll('.wh-tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === idx);
  });
}

function switchWarehouse(idx) {
  if (idx === currentWH) return;
  warehouseData[currentWH] = saveCurrentToSlot();
  currentWH = idx;
  try { localStorage.setItem('whsims.currentWH', String(currentWH)); } catch (e) {}
  if (warehouseData[idx]) {
    loadSlotToCurrent(warehouseData[idx]);
  } else {
    zones = [];
    gasLights = [];
    hazards = [];
    categories = JSON.parse(JSON.stringify((warehouseData[0] && warehouseData[0].categories) || categories));
    nextZId = 500; nextPId = 5000; nextCId = 100; nextGLId = 1; nextHZId = 1;
    warehouseData[idx] = saveCurrentToSlot();
  }
  applyWarehouseTheme(idx);
  sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: null, hazardId: null };
  closeEditor();
  renderAll();
  setTimeout(zoomFit, 50);
  toast('Switched to ' + (WH_CONFIGS[idx]?.name || ('Tent-' + (idx + 3))), 'inf');
}

/* =================================================================
   DARK / LIGHT
   ================================================================= */
// theme
let themeMode = 'dark';
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
  document.documentElement.classList.add('light');
  themeMode = 'light';
}
function toggleTheme() {
  themeMode = themeMode === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.toggle('light', themeMode === 'light');
  requestAnimationFrame(syncTopbarLayout);
}

/* =================================================================
   SVG PAN & ZOOM
   ================================================================= */
const svg = document.getElementById('svg');
const world = document.getElementById('world');
const cArea = document.getElementById('canvasArea');

let vb = { x: -20, y: -20, w: 440, h: 220 };
let zoom = 1;
let panning = false;
let panStart = { x: 0, y: 0 };

function applyVB() {
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  document.getElementById('zoomD').textContent = Math.round(zoom * 100) + '%';
}

function s2svg(sx, sy) {
  const r = svg.getBoundingClientRect();
  return { x: vb.x + (sx - r.left) / r.width * vb.w, y: vb.y + (sy - r.top) / r.height * vb.h };
}

function doSnap(v) { return snap ? Math.round(v / SNAP_GRID) * SNAP_GRID : Math.round(v); }

// Pointer pan
let interacting = false; // true when dragging zone/pallet/handle

cArea.addEventListener('pointerdown', e => {
  if (interacting) return;
  if (e.target.closest('.zr') || e.target.closest('.pr') || e.target.closest('.rh') || e.target.closest('.gl-obj')) return;
  if (e.target.closest('.sb-toggle') || e.target.closest('.ctb') || e.target.closest('.hm-legend') || e.target.closest('button')) return;
  panning = true;
  panStart = { x: e.clientX, y: e.clientY };
  cArea.classList.add('grabbing');
  cArea.setPointerCapture(e.pointerId);
});
cArea.addEventListener('pointermove', e => {
  if (!panning) return;
  const dx = (e.clientX - panStart.x) * (vb.w / svg.getBoundingClientRect().width);
  const dy = (e.clientY - panStart.y) * (vb.h / svg.getBoundingClientRect().height);
  vb.x -= dx; vb.y -= dy;
  panStart = { x: e.clientX, y: e.clientY };
  applyVB();
});
cArea.addEventListener('pointerup', () => { panning = false; cArea.classList.remove('grabbing'); });
cArea.addEventListener('pointercancel', () => { panning = false; cArea.classList.remove('grabbing'); });

// Wheel zoom
cArea.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY > 0 ? 1.1 : 0.9;
  const pt = s2svg(e.clientX, e.clientY);
  const r = svg.getBoundingClientRect();
  vb.w *= f; vb.h *= f;
  vb.x = pt.x - (e.clientX - r.left) / r.width * vb.w;
  vb.y = pt.y - (e.clientY - r.top) / r.height * vb.h;
  zoom /= f;
  applyVB();
}, { passive: false });

// Touch pinch
let tDist = 0;
cArea.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    tDist = Math.sqrt(dx * dx + dy * dy);
  }
}, { passive: true });
cArea.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && tDist > 0) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const d = Math.sqrt(dx * dx + dy * dy);
    const f = tDist / d;
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const pt = s2svg(cx, cy);
    const r = svg.getBoundingClientRect();
    vb.w *= f; vb.h *= f;
    vb.x = pt.x - (cx - r.left) / r.width * vb.w;
    vb.y = pt.y - (cy - r.top) / r.height * vb.h;
    zoom /= f;
    tDist = d;
    applyVB();
  }
}, { passive: false });
cArea.addEventListener('touchend', () => { tDist = 0; });

function zoomIn() {
  const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
  vb.w *= .8; vb.h *= .8; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
  zoom /= .8; applyVB();
}
function zoomOut() {
  const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
  vb.w *= 1.25; vb.h *= 1.25; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
  zoom /= 1.25; applyVB();
}
function zoomFit() {
  const pad = 20;
  vb = { x: -pad, y: -pad, w: WH.w + pad * 2, h: WH.h + pad * 2 };
  const r = svg.getBoundingClientRect();
  const asp = r.width / r.height;
  const vAsp = vb.w / vb.h;
  if (asp > vAsp) { const nw = vb.h * asp; vb.x -= (nw - vb.w) / 2; vb.w = nw; }
  else { const nh = vb.w / asp; vb.y -= (nh - vb.h) / 2; vb.h = nh; }
  zoom = r.width / vb.w;
  applyVB();
}

function toggleSnap() {
  snap = !snap;
  document.getElementById('snapBtn').classList.toggle('on', snap);
  toast(snap ? 'Snap to grid: ON' : 'Snap to grid: OFF', 'inf');
}

// render
function renderSVG() {
  // Warehouse border
  let borderSVG = '';
  const isT4 = currentWH === 1;

  if (isT4) {
    // Tent-4: solid walls with door gap on top wall
    // Top wall with door gap
    borderSVG += `<line x1="0" y1="0" x2="${T4_DOOR.x1}" y2="0" stroke="var(--text-3)" stroke-width="2"/>`;
    borderSVG += `<line x1="${T4_DOOR.x2}" y1="0" x2="${WH.w}" y2="0" stroke="var(--text-3)" stroke-width="2"/>`;
    // Bottom, left, right walls (full)
    borderSVG += `<line x1="0" y1="${WH.h}" x2="${WH.w}" y2="${WH.h}" stroke="var(--text-3)" stroke-width="2"/>`;
    borderSVG += `<line x1="0" y1="0" x2="0" y2="${WH.h}" stroke="var(--text-3)" stroke-width="2"/>`;
    borderSVG += `<line x1="${WH.w}" y1="0" x2="${WH.w}" y2="${WH.h}" stroke="var(--text-3)" stroke-width="2"/>`;
    // Door dashed green line on top wall
    borderSVG += `<line x1="${T4_DOOR.x1}" y1="0" x2="${T4_DOOR.x2}" y2="0" stroke="var(--green)" stroke-width="2.5" stroke-dasharray="6 4" opacity="0.8"/>`;
    // Door label
    const doorMidX = (T4_DOOR.x1 + T4_DOOR.x2) / 2;
    borderSVG += `<text x="${doorMidX}" y="-6" text-anchor="middle" font-family="IBM Plex Mono" font-size="5" font-weight="700" fill="var(--green)" opacity="0.8">ENTRANCE ↓</text>`;
    // Door highlight
    borderSVG += `<rect x="${T4_DOOR.x1}" y="-2" width="${T4_DOOR.x2 - T4_DOOR.x1}" height="20" fill="var(--green)" opacity="0.04"/>`;
  } else {
    // Tent-3: original dashed border
    borderSVG += `<rect x="0" y="0" width="${WH.w}" height="${WH.h}" fill="none" stroke="var(--text-3)" stroke-width="1.5" stroke-dasharray="6 3" rx="3"/>`;
  }

  // Labels (both tents)
  borderSVG += `
    <text x="-10" y="${WH.h/2}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="8" font-weight="700" fill="var(--text-3)" letter-spacing="3"
      transform="rotate(-90,-10,${WH.h/2})">◀ BACK</text>
    <text x="${WH.w+10}" y="${WH.h/2}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="8" font-weight="700" fill="var(--accent-h)" letter-spacing="3"
      transform="rotate(90,${WH.w+10},${WH.h/2})">FRONT ▶</text>
    <text x="${WH.w+20}" y="${WH.h/2}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="5" font-weight="700" fill="var(--green)" letter-spacing="2" opacity="0.7"
      transform="rotate(90,${WH.w+20},${WH.h/2})">ENTRANCE</text>
    <text x="${WH.w/2}" y="-6" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="6" font-weight="600" fill="var(--text-3)">${WH.lw||WH.w}ft</text>
    <text x="${WH.w/2}" y="${WH.h+12}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="6" font-weight="600" fill="var(--text-3)">${WH.lw||WH.w}ft</text>
    <text x="-20" y="${WH.h/2}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="5" font-weight="600" fill="var(--text-3)"
      transform="rotate(-90,-20,${WH.h/2})">${WH.lh||WH.h}ft</text>`;

  // Tent-4: structural columns
  if (isT4) {
    const cols = getT4Columns();
    const half = T4_COL_SIZE / 2;
    cols.forEach(c => {
      borderSVG += `<rect x="${c.x - half}" y="${c.y - half}" width="${T4_COL_SIZE}" height="${T4_COL_SIZE}" fill="var(--orange)" stroke="#c2410c" stroke-width="0.4" opacity="0.9"/>`;
    });
    // Dimension annotations: row distances
    const positions = [0, ...T4_COL_ROWS_Y];
    const labels = ['50ft', '80ft', '80ft', '50ft'];
    const annX = WH.w + 30;
    for (let i = 0; i < positions.length - 1; i++) {
      const y1 = positions[i], y2 = positions[i + 1];
      const midY = (y1 + y2) / 2;
      borderSVG += `<line x1="${annX}" y1="${y1}" x2="${annX}" y2="${y2}" stroke="var(--text-3)" stroke-width="0.4" stroke-dasharray="2 2" opacity="0.4"/>`;
      borderSVG += `<line x1="${annX-3}" y1="${y1}" x2="${annX+3}" y2="${y1}" stroke="var(--text-3)" stroke-width="0.4" opacity="0.4"/>`;
      borderSVG += `<line x1="${annX-3}" y1="${y2}" x2="${annX+3}" y2="${y2}" stroke="var(--text-3)" stroke-width="0.4" opacity="0.4"/>`;
      borderSVG += `<text x="${annX+8}" y="${midY}" font-family="IBM Plex Mono" font-size="4" fill="var(--text-3)" dominant-baseline="middle" opacity="0.5">${labels[i]}</text>`;
    }
    // Column spacing annotation
    borderSVG += `<line x1="0" y1="${T4_COL_ROWS_Y[0] - 8}" x2="${T4_COL_SPACING_X}" y2="${T4_COL_ROWS_Y[0] - 8}" stroke="var(--text-3)" stroke-width="0.4" stroke-dasharray="2 2" opacity="0.4"/>`;
    borderSVG += `<text x="${T4_COL_SPACING_X/2}" y="${T4_COL_ROWS_Y[0] - 10}" text-anchor="middle" font-family="IBM Plex Mono" font-size="3.5" fill="var(--text-3)" opacity="0.5">${T4_COL_SPACING_X}ft</text>`;
  }

  document.getElementById('whBorder').innerHTML = borderSVG;

  // Zones
  const zG = document.getElementById('zonesG');
  zG.innerHTML = '';
  const sortedZones = [...zones].sort((a, b) => {
    const aIsParent = zones.some(zz => zz.parentId === a.id);
    const bIsParent = zones.some(zz => zz.parentId === b.id);
    if (aIsParent && !bIsParent) return -1;
    if (!aIsParent && bIsParent) return 1;
    return 0;
  });
  sortedZones.forEach(z => {
    const g = makeNS('g');
    const isContainer = zones.some(zz => zz.parentId === z.id);
    const isLight = document.documentElement.classList.contains('light');
    const zAlpha = isLight ? '60' : '38';
    const cAlpha = isLight ? '30' : '18';
    const fillColor = heatMapOn ? getHeatColor(z) : isContainer ? z.color + cAlpha : z.color + zAlpha;
    const strokeColor = heatMapOn ? getHeatStroke(z) : z.color;
    z.segs.forEach((s, si) => {
      const r = makeNS('rect');
      setA(r, { x:s.x, y:s.y, width:s.w, height:s.h, rx:isContainer ? 4 : 2,
        fill:fillColor, stroke:strokeColor, 'stroke-width': isContainer ? 2 : 1.5 });
      if (isContainer) setA(r, { 'stroke-dasharray': '6 3' });
      r.classList.add('zr');
      if (z.id === sel.zoneId) r.classList.add('sel');
      r.dataset.zid = z.id;
      r.dataset.si = si;
      r.addEventListener('pointerdown', e => startZoneDrag(e, z.id, si));
      g.appendChild(r);

          if (si === 0 && s.w > 5 && s.h > 5) {
        const ZONE_HDR = 14;
        const hasHeader = !isContainer && s.h >= 24;

        if (isContainer) {
                  const t = makeNS('text');
          setA(t, { x:s.x + 4, y:s.y + 7,
            'text-anchor':'start', 'font-family':'Outfit', 'font-weight':'700',
            'font-size': Math.min(6, s.w / z.name.length * 1.2),
            fill: z.color, 'pointer-events':'none', opacity:'0.9' });
          t.textContent = z.name;
          g.appendChild(t);
          const childCount = zones.filter(zz => zz.parentId === z.id).length;
          if (childCount > 0) {
            const cc = makeNS('text');
            setA(cc, { x:s.x + 4, y:s.y + 13,
              'text-anchor':'start', 'font-family':'IBM Plex Mono',
              'font-size':'3.5', fill: cssVar('--zone-sub'), 'pointer-events':'none' });
            cc.textContent = childCount + ' zone' + (childCount > 1 ? 's' : '') + ' inside';
            g.appendChild(cc);
          }
        } else {
                  if (hasHeader) {
            const hLine = makeNS('line');
            setA(hLine, { x1: s.x + 1.5, y1: s.y + ZONE_HDR, x2: s.x + s.w - 1.5, y2: s.y + ZONE_HDR,
              stroke: cssVar('--hdr-line'), 'stroke-width': 0.5, 'pointer-events': 'none' });
            g.appendChild(hLine);
          }
                  const t = makeNS('text');
          const nameY = hasHeader ? s.y + ZONE_HDR / 2 + 2.5 : s.y + Math.min(12, s.h / 2);
          setA(t, { x: s.x + s.w / 2, y: nameY,
            'text-anchor':'middle', 'font-family':'Outfit', 'font-weight':'700',
            'font-size': Math.min(hasHeader ? 7 : 8, s.w / z.name.length * 1.3, hasHeader ? ZONE_HDR * 0.6 : s.h / 2.5),
            fill: cssVar('--zone-text'), 'pointer-events':'none' });
          t.textContent = z.name;
          g.appendChild(t);
        }
              if (s.h > 16 && !isContainer) {
          const cat = categories.find(c => c.id === z.cat);
          if (cat) {
            const sub = makeNS('text');
            setA(sub, { x: s.x + s.w / 2, y: hasHeader ? s.y + ZONE_HDR - 1.5 : s.y + Math.min(20, s.h / 2 + 6),
              'text-anchor':'middle', 'font-family':'IBM Plex Mono',
              'font-size': Math.min(hasHeader ? 3.5 : 5, s.w / 10),
              fill: cssVar('--zone-sub'), 'pointer-events':'none' });
            sub.textContent = cat.name;
            g.appendChild(sub);
          }
        }
              if (!isContainer && z.tags && z.tags.length > 0) {
          const tagFs = Math.min(3, s.w / 14, s.h / 10);
          if (tagFs >= 1.2) {
            const tagLineH = tagFs + 1;
            const tagStartY = hasHeader
              ? s.y + ZONE_HDR + tagFs + 1
              : (s.h > 22 ? s.y + Math.min(27, s.h/2 + 12) : s.y + Math.min(16, s.h/2 + 5));
            const rotate = s.w < 12 && s.h > s.w * 1.5;
            z.tags.forEach((tag, ti) => {
              const ty = tagStartY + ti * tagLineH;
              if (ty > s.y + s.h - 2) return;
              const tagT = makeNS('text');
              const tx = s.x + s.w / 2;
              setA(tagT, { x: tx, y: ty,
                'text-anchor':'middle', 'font-family':'IBM Plex Mono',
                'font-size': Math.max(1.5, tagFs),
                fill:'#06b6d4', 'pointer-events':'none', opacity:'0.85' });
              if (rotate) setA(tagT, { transform: 'rotate(-90,' + tx + ',' + ty + ')' });
              tagT.textContent = tag;
              g.appendChild(tagT);
            });
          }
        }
              if (heatMapOn && z.capacity > 0 && !isContainer) {
          const pct = Math.round(z.pallets.length / z.capacity * 100);
          if (hasHeader && s.w > 18) {
            const ht = makeNS('text');
            setA(ht, { x: s.x + 4, y: s.y + 5,
              'text-anchor':'start', 'font-family':'IBM Plex Mono', 'font-weight':'700',
              'font-size': Math.min(4.5, ZONE_HDR * 0.35),
              fill: cssVar('--zone-text'), 'pointer-events':'none', opacity:'0.8' });
            ht.textContent = pct + '%';
            g.appendChild(ht);
          } else if (s.h > 30) {
            const tagOffset = (z.tags && z.tags.length > 0) ? z.tags.length * 5 : 0;
            const ht = makeNS('text');
            setA(ht, { x:s.x + s.w/2, y:s.y + Math.min(32 + tagOffset, s.h - 4),
              'text-anchor':'middle', 'font-family':'IBM Plex Mono', 'font-weight':'700',
              'font-size': Math.min(7, s.w / 5),
              fill: cssVar('--zone-text'), 'pointer-events':'none', opacity:'0.9' });
            ht.textContent = pct + '%';
            g.appendChild(ht);
          }
        }
              if (z.notes && z.notes.trim()) {
          const ni = makeNS('circle');
          setA(ni, { cx: s.x + s.w - 5, cy: s.y + 5, r: 3,
            fill: 'var(--yellow)', 'pointer-events':'none' });
          g.appendChild(ni);
          const nt = makeNS('text');
          setA(nt, { x: s.x + s.w - 5, y: s.y + 6.5,
            'text-anchor':'middle', 'font-family':'IBM Plex Mono',
            'font-size':'4', 'font-weight':'700', fill:'#000', 'pointer-events':'none' });
          nt.textContent = '✎';
          g.appendChild(nt);
        }
      }
    });
    zG.appendChild(g);
  });

  const pG = document.getElementById('palletsG');
  pG.innerHTML = '';
  zones.forEach(z => {
    (z.pallets || []).forEach(p => {
      const r = makeNS('rect');
      setA(r, { x:p.x, y:p.y, width:p.w, height:p.h, rx:1 });
      r.classList.add('pr');
      if (sel.palletId === p.id) r.classList.add('sel');
      if (multiSel.some(m => m.zid === z.id && m.pid === p.id)) r.classList.add('msel');
      r.dataset.pid = p.id;
      r.dataset.zid = z.id;
      r.addEventListener('pointerdown', e => startPalletDrag(e, z.id, p.id));
      pG.appendChild(r);

      if (p.w >= 1 && p.h >= 1) {
        const t = makeNS('text');
        const cx = p.x + p.w / 2;
        const cy = p.y + p.h / 2;
        const narrow = p.w < 5;
        const fs = narrow ? Math.min(3, p.h / p.label.length * 1.4, p.w - 0.5) : Math.min(4, p.w / 2.5);
        setA(t, { x: cx, y: cy,
          'text-anchor':'middle', 'dominant-baseline':'middle',
          'font-family':'IBM Plex Mono', 'font-size': Math.max(1.5, fs),
          fill: cssVar('--pal-text'), 'pointer-events':'none' });
        if (narrow) setA(t, { transform: 'rotate(-90,' + cx + ',' + cy + ')' });
        t.textContent = p.label;
        pG.appendChild(t);
      }
    });
  });

  // Gas Lights
  const glG = document.getElementById('gasLightsG');
  if (glG) {
    glG.innerHTML = '';
    (gasLights || []).forEach(gl => {
      const r = 4;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'gl-obj' + (sel.gasLightId === gl.id ? ' sel' : ''));
      g.setAttribute('data-glid', gl.id);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', gl.x);
      circle.setAttribute('cy', gl.y);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', gl.status === 'on' ? '#f0b429' : '#6b7280');
      circle.setAttribute('stroke', gl.status === 'on' ? '#fbbf24' : '#4b5563');
      circle.setAttribute('stroke-width', '1');
      circle.setAttribute('opacity', gl.status === 'on' ? '0.9' : '0.6');
      g.appendChild(circle);

      // glow effect for ON lights
      if (gl.status === 'on') {
        const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        glow.setAttribute('cx', gl.x);
        glow.setAttribute('cy', gl.y);
        glow.setAttribute('r', r + 3);
        glow.setAttribute('fill', 'none');
        glow.setAttribute('stroke', '#fbbf24');
        glow.setAttribute('stroke-width', '0.5');
        glow.setAttribute('opacity', '0.4');
        g.appendChild(glow);
      }

      // label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', gl.x);
      label.setAttribute('y', gl.y + r + 5);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-family', 'IBM Plex Mono');
      label.setAttribute('font-size', '3.5');
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', cssVar('--text-2'));
      label.textContent = gl.name || 'Light';
      g.appendChild(label);

      g.addEventListener('pointerdown', (e) => startGasLightDrag(e, gl.id));
      glG.appendChild(g);
    });
  }

  // Hazard markers
  const hzG = document.getElementById('hazardsG');
  if (hzG) {
    hzG.innerHTML = '';
    const HZ_COLORS = { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' };
    const HZ_GLOWS = { red: '#fca5a5', yellow: '#fde68a', green: '#86efac' };
    (hazards || []).forEach(hz => {
      const r = 5;
      const color = HZ_COLORS[hz.color] || HZ_COLORS.red;
      const glow = HZ_GLOWS[hz.color] || HZ_GLOWS.red;
      const isSel = sel.hazardId === hz.id;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'hz-obj' + (isSel ? ' sel' : ''));
      g.setAttribute('data-hzid', hz.id);

      // triangle warning sign
      const triH = r * 2;
      const triW = r * 2;
      const cx = hz.x, cy = hz.y;
      const points = `${cx},${cy - triH * 0.6} ${cx - triW * 0.55},${cy + triH * 0.4} ${cx + triW * 0.55},${cy + triH * 0.4}`;
      const tri = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      tri.setAttribute('points', points);
      tri.setAttribute('fill', color);
      tri.setAttribute('stroke', isSel ? '#fff' : glow);
      tri.setAttribute('stroke-width', isSel ? '1.2' : '0.6');
      tri.setAttribute('opacity', '0.9');
      g.appendChild(tri);

      // exclamation mark inside
      const exc = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      exc.setAttribute('x', cx);
      exc.setAttribute('y', cy + triH * 0.15);
      exc.setAttribute('text-anchor', 'middle');
      exc.setAttribute('font-family', 'Arial, sans-serif');
      exc.setAttribute('font-size', r * 1.1);
      exc.setAttribute('font-weight', '900');
      exc.setAttribute('fill', hz.color === 'yellow' ? '#000' : '#fff');
      exc.textContent = '!';
      g.appendChild(exc);

      // glow ring when selected
      if (isSel) {
        const glowCirc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        glowCirc.setAttribute('cx', cx);
        glowCirc.setAttribute('cy', cy);
        glowCirc.setAttribute('r', r + 3);
        glowCirc.setAttribute('fill', 'none');
        glowCirc.setAttribute('stroke', color);
        glowCirc.setAttribute('stroke-width', '0.6');
        glowCirc.setAttribute('opacity', '0.5');
        glowCirc.setAttribute('stroke-dasharray', '2,1');
        g.appendChild(glowCirc);
      }

      // label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', cx);
      label.setAttribute('y', cy + triH * 0.4 + 5);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-family', 'IBM Plex Mono');
      label.setAttribute('font-size', '3.5');
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', color);
      label.textContent = hz.name || 'Hazard';
      g.appendChild(label);

      // notes indicator
      if (hz.notes && hz.notes.trim()) {
        const noteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        noteIcon.setAttribute('x', cx + triW * 0.55 + 1);
        noteIcon.setAttribute('y', cy - triH * 0.3);
        noteIcon.setAttribute('font-family', 'Font Awesome 6 Free');
        noteIcon.setAttribute('font-weight', '900');
        noteIcon.setAttribute('font-size', '3');
        noteIcon.setAttribute('fill', cssVar('--text-3'));
        noteIcon.textContent = '\uf249'; // sticky-note icon
        g.appendChild(noteIcon);
      }

      g.addEventListener('pointerdown', (e) => startHazardDrag(e, hz.id));
      hzG.appendChild(g);
    });
  }

  // Resize handles
  renderHandles();
}

function renderHandles() {
  const hG = document.getElementById('handlesG');
  hG.innerHTML = '';
  if (!sel.zoneId) return;
  const z = zones.find(zz => zz.id === sel.zoneId);
  if (!z) return;

  // Segment handles
  z.segs.forEach((s, si) => {
    const hs = 3 / Math.max(zoom, 0.3);
    const corners = [
      { cx: s.x, cy: s.y, dir: 'nw' },
      { cx: s.x + s.w, cy: s.y, dir: 'ne' },
      { cx: s.x, cy: s.y + s.h, dir: 'sw' },
      { cx: s.x + s.w, cy: s.y + s.h, dir: 'se' },
    ];
    corners.forEach(c => {
      const r = makeNS('rect');
      setA(r, { x: c.cx - hs, y: c.cy - hs, width: hs * 2, height: hs * 2, rx: 1 });
      r.classList.add('rh', 'vis', c.dir);
      r.addEventListener('pointerdown', e => startResize(e, z.id, si, c.dir));
      hG.appendChild(r);
    });
  });

  // Pallet handles
  if (sel.palletId) {
    const p = z.pallets.find(pp => pp.id === sel.palletId);
    if (p) {
      const hs = 2.5 / Math.max(zoom, 0.3);
      [
        { cx: p.x, cy: p.y, dir: 'nw' },
        { cx: p.x + p.w, cy: p.y, dir: 'ne' },
        { cx: p.x, cy: p.y + p.h, dir: 'sw' },
        { cx: p.x + p.w, cy: p.y + p.h, dir: 'se' },
      ].forEach(c => {
        const r = makeNS('rect');
        setA(r, { x: c.cx - hs, y: c.cy - hs, width: hs * 2, height: hs * 2, rx: 1,
          fill: 'var(--yellow)', stroke: '#fff' });
        r.classList.add('rh', 'vis', c.dir);
        r.addEventListener('pointerdown', e => startPalletResize(e, z.id, p.id, c.dir));
        hG.appendChild(r);
      });
    }
  }
}

/* =================================================================
   ZONE COLLISION DETECTION
   ================================================================= */
const ZONE_GAP = 1; // 1ft gap between zones

function checkZoneCollision(movedZone) {
  for (const other of zones) {
    if (other.id === movedZone.id) continue;
      if (movedZone.parentId === other.id || other.parentId === movedZone.id) continue;
      if (movedZone.parentId && movedZone.parentId === other.parentId) continue;
    for (const s1 of movedZone.segs) {
      for (const s2 of other.segs) {
              if (s1.w <= 0 || s1.h <= 0 || s2.w <= 0 || s2.h <= 0) continue;
        if (s1.x < s2.x + s2.w + ZONE_GAP &&
            s1.x + s1.w + ZONE_GAP > s2.x &&
            s1.y < s2.y + s2.h + ZONE_GAP &&
            s1.y + s1.h + ZONE_GAP > s2.y) {
          return true;
        }
      }
    }
  }
  return false;
}

/* =================================================================
   INTERACTION: ZONE DRAG
   ================================================================= */
function startZoneDrag(e, zid, si) {
  e.stopPropagation();
  interacting = true;
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  sel.zoneId = zid;
  sel.segIdx = si;
  if (!e.shiftKey) sel.palletId = null;
  const pt = s2svg(e.clientX, e.clientY);
  const offsets = z.segs.map(s => ({ dx: pt.x - s.x, dy: pt.y - s.y }));
  const palOffsets = z.pallets.map(p => ({ dx: pt.x - p.x, dy: pt.y - p.y }));

  // Collect child zones (zones whose parentId === this zone's id)
  const childZones = zones.filter(cz => cz.parentId === zid);
  const childData = childZones.map(cz => ({
    zone: cz,
    segOffsets: cz.segs.map(s => ({ dx: pt.x - s.x, dy: pt.y - s.y })),
    palOffsets: cz.pallets.map(p => ({ dx: pt.x - p.x, dy: pt.y - p.y }))
  }));

  const onMove = ev => {
    const mp = s2svg(ev.clientX, ev.clientY);

    const oldSegs = z.segs.map(s => ({ x: s.x, y: s.y }));
    const oldPals = z.pallets.map(p => ({ x: p.x, y: p.y }));
    const oldChildren = childData.map(cd => ({
      segs: cd.zone.segs.map(s => ({ x: s.x, y: s.y })),
      pals: cd.zone.pallets.map(p => ({ x: p.x, y: p.y }))
    }));

    z.segs.forEach((s, i) => {
      s.x = doSnap(mp.x - offsets[i].dx);
      s.y = doSnap(mp.y - offsets[i].dy);
    });
    z.pallets.forEach((p, i) => {
      p.x = doSnap(mp.x - palOffsets[i].dx);
      p.y = doSnap(mp.y - palOffsets[i].dy);
    });

    // Move child zones along with parent
    childData.forEach(cd => {
      cd.zone.segs.forEach((s, i) => {
        s.x = doSnap(mp.x - cd.segOffsets[i].dx);
        s.y = doSnap(mp.y - cd.segOffsets[i].dy);
      });
      cd.zone.pallets.forEach((p, i) => {
        p.x = doSnap(mp.x - cd.palOffsets[i].dx);
        p.y = doSnap(mp.y - cd.palOffsets[i].dy);
      });
    });

    if (checkZoneCollision(z)) {
      z.segs.forEach((s, i) => { s.x = oldSegs[i].x; s.y = oldSegs[i].y; });
      z.pallets.forEach((p, i) => { p.x = oldPals[i].x; p.y = oldPals[i].y; });
      childData.forEach((cd, ci) => {
        cd.zone.segs.forEach((s, i) => { s.x = oldChildren[ci].segs[i].x; s.y = oldChildren[ci].segs[i].y; });
        cd.zone.pallets.forEach((p, i) => { p.x = oldChildren[ci].pals[i].x; p.y = oldChildren[ci].pals[i].y; });
      });
    }

    renderSVG();
    showDimBadge(ev.clientX, ev.clientY, `${z.name} @ ${z.segs[0].x},${z.segs[0].y}`);
  };
  const onUp = () => {
    interacting = false;
    hideDimBadge();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    renderAll();
    openZoneEditor(zid);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  renderAll();
  openZoneEditor(zid);
}

/* =================================================================
   INTERACTION: RESIZE SEGMENT
   ================================================================= */
function startResize(e, zid, si, dir) {
  e.stopPropagation();
  interacting = true;
  const z = zones.find(zz => zz.id === zid);
  const s = z.segs[si];
  const orig = { ...s };
  const start = s2svg(e.clientX, e.clientY);

  const onMove = ev => {
    const mp = s2svg(ev.clientX, ev.clientY);
    const dx = mp.x - start.x;
    const dy = mp.y - start.y;

    if (dir.includes('w')) { s.x = doSnap(orig.x + dx); s.w = doSnap(Math.max(5, orig.w - dx)); }
    if (dir.includes('e')) { s.w = doSnap(Math.max(5, orig.w + dx)); }
    if (dir.includes('n')) { s.y = doSnap(orig.y + dy); s.h = doSnap(Math.max(5, orig.h - dy)); }
    if (dir.includes('s')) { s.h = doSnap(Math.max(5, orig.h + dy)); }

    renderSVG();
    showDimBadge(ev.clientX, ev.clientY, `${s.w} × ${s.h} ft`);
  };
  const onUp = () => {
    interacting = false;
    hideDimBadge();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    renderAll();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

/* =================================================================
   INTERACTION: PALLET DRAG
   ================================================================= */
function startPalletDrag(e, zid, palId) {
  e.stopPropagation();
  if (e.shiftKey) {
    toggleMultiSel(zid, palId);
    return;
  }
  if (multiSel.length > 0) { multiSel = []; updateBatchBar(); }
  interacting = true;
  sel.zoneId = zid;
  sel.palletId = palId;
  const z = zones.find(zz => zz.id === zid);
  const p = z.pallets.find(pp => pp.id === palId);
  const pt = s2svg(e.clientX, e.clientY);
  const off = { dx: pt.x - p.x, dy: pt.y - p.y };

  const onMove = ev => {
    const mp = s2svg(ev.clientX, ev.clientY);
    p.x = doSnap(mp.x - off.dx);
    p.y = doSnap(mp.y - off.dy);
    renderSVG();
    showDimBadge(ev.clientX, ev.clientY, `${p.label}: ${p.x},${p.y}`);
  };
  const onUp = () => {
    interacting = false;
    hideDimBadge();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    renderAll();
    openZoneEditor(zid);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  renderAll();
  openZoneEditor(zid);
}

/* =================================================================
   INTERACTION: PALLET RESIZE
   ================================================================= */
function startPalletResize(e, zid, palId, dir) {
  e.stopPropagation();
  interacting = true;
  const z = zones.find(zz => zz.id === zid);
  const p = z.pallets.find(pp => pp.id === palId);
  const orig = { ...p };
  const start = s2svg(e.clientX, e.clientY);

  const onMove = ev => {
    const mp = s2svg(ev.clientX, ev.clientY);
    const dx = mp.x - start.x;
    const dy = mp.y - start.y;
    if (dir.includes('w')) { p.x = doSnap(orig.x + dx); p.w = doSnap(Math.max(2, orig.w - dx)); }
    if (dir.includes('e')) { p.w = doSnap(Math.max(2, orig.w + dx)); }
    if (dir.includes('n')) { p.y = doSnap(orig.y + dy); p.h = doSnap(Math.max(2, orig.h - dy)); }
    if (dir.includes('s')) { p.h = doSnap(Math.max(2, orig.h + dy)); }
    renderSVG();
    showDimBadge(ev.clientX, ev.clientY, `${p.w.toFixed(0)} × ${p.h.toFixed(0)} ft`);
  };
  const onUp = () => {
    interacting = false;
    hideDimBadge();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    renderAll();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

/* =================================================================
   INTERACTION: GAS LIGHT DRAG
   ================================================================= */
function startGasLightDrag(e, glId) {
  e.stopPropagation();
  selectGasLight(glId);
  const gl = gasLights.find(g => g.id === glId);
  if (!gl) return;
  interacting = true;
  const pt = s2svg(e.clientX, e.clientY);
  const off = { dx: pt.x - gl.x, dy: pt.y - gl.y };

  const onMove = ev => {
    const mp = s2svg(ev.clientX, ev.clientY);
    gl.x = Math.max(0, Math.min(WH.w, mp.x - off.dx));
    gl.y = Math.max(0, Math.min(WH.h, mp.y - off.dy));
    if (snap) { gl.x = Math.round(gl.x / 5) * 5; gl.y = Math.round(gl.y / 5) * 5; }
    renderSVG();
    showDimBadge(ev.clientX, ev.clientY, `${gl.name}: ${Math.round(gl.x)},${Math.round(gl.y)}`);
  };
  const onUp = () => {
    interacting = false;
    hideDimBadge();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    renderAll();
    openGasLightEditor(glId);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

/* =================================================================
   DIM BADGE
   ================================================================= */
function showDimBadge(cx, cy, text) {
  const b = document.getElementById('dimBadge');
  b.textContent = text;
  b.style.left = (cx + 14) + 'px';
  b.style.top = (cy - 30) + 'px';
  b.classList.add('show');
}
function hideDimBadge() { document.getElementById('dimBadge').classList.remove('show'); }

/* =================================================================
   CLICK EMPTY — DESELECT
   ================================================================= */
svg.addEventListener('click', e => {
  if (!e.target.closest('.zr') && !e.target.closest('.pr') && !e.target.closest('.rh') && !e.target.closest('.gl-obj') && !e.target.closest('.hz-obj')) {
    sel.zoneId = null; sel.palletId = null; sel.segIdx = null; sel.gasLightId = null; sel.hazardId = null;
    if (multiSel.length > 0) { multiSel = []; updateBatchBar(); }
    closeEditor();
    renderAll();
  }
});

// sidebar
function renderSidebar() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const body = document.getElementById('sbBody');

  const grouped = {};
  categories.forEach(c => { grouped[c.id] = []; });
  grouped['_none'] = [];

  zones.forEach(z => {
    if (q && !z.name.toLowerCase().includes(q) && !(z.cat || '').toLowerCase().includes(q) && !(z.tags || []).some(t => t.toLowerCase().includes(q))) return;
    const key = z.cat && grouped[z.cat] ? z.cat : '_none';
    grouped[key].push(z);
  });

  function renderZI(z, indent) {
    const pct = z.capacity > 0 ? Math.round(z.pallets.length / z.capacity * 100) : 0;
    const fc = pct > 90 ? 'var(--red)' : pct > 60 ? 'var(--yellow)' : 'var(--green)';
    const ml = indent ? 'margin-left:16px;border-left:2px solid var(--orange);padding-left:6px' : '';
    const isParent = zones.some(zz => zz.parentId === z.id);
    const icon = isParent ? '<i class="fas fa-sitemap" style="font-size:8px;color:var(--orange);margin-right:2px"></i>' : '';
    let h = `<div class="zi ${z.id === sel.zoneId ? 'act' : ''}" onclick="selectZone('${z.id}')" style="${ml}">
      <div class="zi-c" style="background:${z.color}"></div>
      <div class="zi-info"><div class="zi-n">${icon}${z.name}</div>
        <div class="zi-m">${z.pallets.length}P · ${z.boxes}B · ${z.segs.length}seg${z.tags && z.tags.length ? ' · <span style="color:var(--cyan)">' + z.tags.join(', ') + '</span>' : ''}</div></div>
      ${pct > 0 ? '<div class="zi-bar"><div class="zi-fill" style="width:' + pct + '%;background:' + fc + '"></div></div>' : ''}
    </div>`;
      const children = zones.filter(zz => zz.parentId === z.id);
    children.forEach(ch => {
      if (q && !ch.name.toLowerCase().includes(q) && !(ch.cat || '').toLowerCase().includes(q) && !(ch.tags || []).some(t => t.toLowerCase().includes(q))) return;
      h += renderZI(ch, true);
    });
    return h;
  }

  let html = '';
  categories.forEach(cat => {
      const arr = (grouped[cat.id] || []).filter(z => !z.parentId);
    if (arr.length === 0) return;
    html += `<div class="cat-head"><span class="cat-dot" style="background:${cat.color}"></span>${cat.name} (${(grouped[cat.id] || []).length})</div>`;
    arr.forEach(z => { html += renderZI(z, false); });
  });

  if (grouped['_none'].length > 0) {
    const topNone = grouped['_none'].filter(z => !z.parentId);
    if (topNone.length > 0) {
      html += '<div class="cat-head">Uncategorized</div>';
      topNone.forEach(z => { html += renderZI(z, false); });
    }
  }

  // Gas Lights section in sidebar
  if (gasLights && gasLights.length > 0) {
    let glHtml = '<div class="cat-head"><div class="cat-dot" style="background:#f0b429"></div>GAS LIGHTS</div>';
    gasLights.forEach(gl => {
      const isAct = sel.gasLightId === gl.id;
      glHtml += '<div class="gl-item' + (isAct ? ' act' : '') + '" onclick="selectGasLight(\'' + gl.id + '\')">';
      glHtml += '<i class="fas fa-lightbulb gl-icon"></i>';
      glHtml += '<div class="gl-info"><div class="gl-name">' + esc(gl.name) + '</div>';
      glHtml += '<div class="gl-meta"><span class="gl-dot ' + gl.status + '"></span> ' + (gl.status === 'on' ? 'Working' : 'Not working') + '</div></div>';
      glHtml += '</div>';
    });
    html += glHtml;
  }

  // Hazards section in sidebar
  if (hazards && hazards.length > 0) {
    const HZ_SIDE_COLORS = { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' };
    let hzHtml = '<div class="cat-head"><div class="cat-dot" style="background:#ef4444"></div>HAZARDS</div>';
    hazards.forEach(hz => {
      const isAct = sel.hazardId === hz.id;
      const c = HZ_SIDE_COLORS[hz.color] || '#ef4444';
      hzHtml += '<div class="gl-item' + (isAct ? ' act' : '') + '" onclick="selectHazard(\'' + hz.id + '\')">';
      hzHtml += '<i class="fas fa-exclamation-triangle" style="color:' + c + ';font-size:12px;flex-shrink:0"></i>';
      hzHtml += '<div class="gl-info"><div class="gl-name">' + esc(hz.name) + '</div>';
      hzHtml += '<div class="gl-meta"><span class="gl-dot" style="background:' + c + '"></span> ' + (hz.color === 'red' ? 'Critical' : hz.color === 'yellow' ? 'Warning' : 'Info') + (hz.notes ? ' · 📝' : '') + '</div></div>';
      hzHtml += '</div>';
    });
    html += hzHtml;
  }

body.innerHTML = html || '<div style="text-align:center;padding:30px;color:var(--text-3)"><i class="fas fa-search" style="font-size:24px;display:block;margin-bottom:8px"></i>Nothing found</div>';
}

function syncTopbarLayout() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  document.body.classList.remove('topbar-compact', 'topbar-condensed');
  if (bar.scrollWidth <= bar.clientWidth + 4) return;
  document.body.classList.add('topbar-compact');
  if (bar.scrollWidth <= bar.clientWidth + 4) return;
  document.body.classList.add('topbar-condensed');
}

function updateStats() {
  const tP = zones.reduce((s, z) => s + z.pallets.length, 0);
  const tC = zones.reduce((s, z) => s + z.capacity, 0);
  const tB = zones.reduce((s, z) => s + z.boxes, 0);
  const pct = tC > 0 ? Math.round(tP / tC * 100) : 0;

  const colChip = currentWH === 1 ? '<div class="chip"><i class="fas fa-columns"></i> <b>' + getT4Columns().length + '</b> columns</div>' : '';
  document.getElementById('topChips').innerHTML = `
    <div class="chip"><i class="fas fa-layer-group"></i> <b>${zones.length}</b> zones</div>
    <div class="chip"><i class="fas fa-pallet"></i> <b>${tP}</b> pallets</div>
    <div class="chip"><i class="fas fa-box"></i> <b>${tB}</b> boxes</div>
    ${colChip}
    ${hazards.length > 0 ? '<div class="chip"><i class="fas fa-exclamation-triangle"></i> <b>' + hazards.length + '</b> hazards</div>' : ''}
    <div class="chip"><i class="fas fa-chart-pie"></i> <b>${pct}%</b></div>`;
  requestAnimationFrame(syncTopbarLayout);

  document.getElementById('sbStats').innerHTML = `
    <div class="st-grid">
      <div class="st-item"><div class="st-l">Pallets</div><div class="st-v">${tP}</div></div>
      <div class="st-item"><div class="st-l">Boxes</div><div class="st-v">${tB}</div></div>
      <div class="st-item"><div class="st-l">Capacity</div><div class="st-v">${tC}</div></div>
      <div class="st-item"><div class="st-l">Hazards</div><div class="st-v">${hazards.length}</div></div>
    </div>
    <div class="ov-bar"><div class="ov-head"><span>Occupancy</span><b>${pct}%</b></div>
      <div class="pbar"><div class="pfill" style="width:${pct}%"></div></div></div>`;
}

// zone editor
function selectZone(id) {
  sel.zoneId = id;
  sel.palletId = null;
  renderAll();
  openZoneEditor(id);
}

function openZoneEditor(id) {
  const z = zones.find(zz => zz.id === id);
  if (!z) return;
  const ed = document.getElementById('editor');
  document.getElementById('edTitle').textContent = z.name;

  let catOpts = '<option value="">— No category —</option>' + categories.map(c =>
    `<option value="${c.id}" ${z.cat === c.id ? 'selected' : ''}>${c.name}</option>`
  ).join('');

  const childIds = zones.filter(zz => zz.parentId === id).map(zz => zz.id);
  let parentOpts = '<option value="">— None (top-level) —</option>' + zones.filter(zz =>
    zz.id !== id && !childIds.includes(zz.id) && zz.parentId !== id
  ).map(zz =>
    `<option value="${zz.id}" ${z.parentId === zz.id ? 'selected' : ''}>${zz.name}</option>`
  ).join('');

  const activeCat = categories.find(c => c.id === z.cat);
  let subOpts = '<option value="">— None —</option>';
  if (activeCat && activeCat.subs) {
    subOpts += activeCat.subs.map(s =>
      `<option value="${s}" ${z.name === s ? 'selected' : ''}>${s}</option>`
    ).join('');
  }

  let segsHtml = z.segs.map((s, i) =>
    `<div class="seg-item ${sel.segIdx === i ? 'act' : ''}" onclick="sel.segIdx=${i};renderAll();">
      <span>Segment ${i + 1}</span>
      <span class="seg-dims">${s.w}×${s.h} @ ${s.x},${s.y}</span>
    </div>`
  ).join('');

  let palsHtml = z.pallets.map(p =>
    `<div class="pal-item ${sel.palletId === p.id ? 'act' : ''}" onclick="sel.palletId='${p.id}';renderAll();openZoneEditor('${id}');">
      <span><b>${p.label}</b></span>
      <span class="seg-dims">${Math.round(p.w)}×${Math.round(p.h)}</span>
    </div>`
  ).join('');

  document.getElementById('edBody').innerHTML = `
    <div class="fg"><label>Category</label>
      <select id="eCat" onchange="changeCatAndRefresh('${id}',this.value)">${catOpts}</select></div>
    <div class="fg"><label>Subcategory / Type</label>
      <select id="eSub" onchange="changeSubName('${id}',this.value)">${subOpts}</select></div>
    <div class="fg"><label>Name (editable)</label>
      <input type="text" id="eName" value="${esc(z.name)}" onchange="applyZoneField('${id}','name',this.value)"></div>
    <div class="fg"><label><i class="fas fa-sitemap" style="color:var(--orange)"></i> Parent Zone</label>
      <select id="eParent" onchange="changeParentZone('${id}',this.value)">${parentOpts}</select></div>
    <div class="fr">
      <div class="fg"><label>Color</label>
        <input type="color" id="eColor" value="${z.color}" onchange="applyZoneField('${id}','color',this.value)"></div>
      <div class="fg"><label>Capacity</label>
        <input type="number" id="eCap" min="0" value="${z.capacity}" onchange="applyZoneField('${id}','capacity',+this.value)"></div>
    </div>
    <div class="fg"><label>Boxes</label>
      <input type="number" id="eBox" min="0" value="${z.boxes}" onchange="applyZoneField('${id}','boxes',+this.value)"></div>
    ${currentWH === 1 ? (() => {
      const capResult = calcMaxPallets(z.segs);
      return '<div style="background:linear-gradient(135deg,var(--bg-3),var(--bg-2));border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:8px;text-align:center">' +
        '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-3);margin-bottom:6px">MAX PALLETS (4×4 ft)</div>' +
        '<div style="font-family:var(--mono);font-size:32px;font-weight:700;color:var(--orange);line-height:1">' + capResult.count + '</div>' +
        '<div style="font-size:11px;color:var(--text-2);margin-top:4px">pallets fit</div>' +
        '<div style="display:flex;justify-content:center;gap:14px;margin-top:8px;font-size:11px;font-family:var(--mono);color:var(--text-3)">' +
          '<span>Columns: ' + capResult.columnsInZone + '</span>' +
          '<span>Blocked: ' + capResult.blocked + '</span>' +
        '</div>' +
        '<button class="btn btn-g" style="margin-top:8px;width:100%;justify-content:center;font-size:11px" onclick="autoSetCapacity(\'' + id + '\',' + capResult.count + ')"><i class="fas fa-magic"></i> Set as Capacity</button>' +
      '</div>';
    })() : ''}
    <div class="fg"><label><i class="fas fa-sticky-note" style="color:var(--yellow)"></i> Notes</label>
      <textarea id="eNotes" rows="2" style="resize:vertical;min-height:40px;font-size:13px;padding:8px 10px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-1);font-family:var(--font);width:100%;outline:none"
        onchange="applyZoneField('${id}','notes',this.value)"
        placeholder="Add a note...">${esc(z.notes || '')}</textarea></div>

    <div class="fg"><label><i class="fas fa-tags" style="color:var(--cyan)"></i> Tags</label>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px" id="zTagsWrap">
        ${(z.tags || []).map((tag, ti) =>
          '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(6,182,212,0.15);border:1px solid rgba(6,182,212,0.35);border-radius:4px;font-size:11px;font-weight:600;color:var(--text-1)">' +
            esc(tag) +
            '<i class="fas fa-times" style="font-size:8px;cursor:pointer;opacity:.6;color:var(--red)" onclick="removeZoneTag(\'' + id + '\',' + ti + ')"></i>' +
          '</span>'
        ).join('')}
      </div>
      <div class="tp-toggle" id="tpToggle" onclick="toggleTagPicker()"><i class="fas fa-plus" style="font-size:9px"></i> Add tag...<span class="tp-toggle-arrow" id="tpArrowMain"><i class="fas fa-chevron-down" style="font-size:9px"></i></span></div>
      <div class="tp-panel" id="tpPanel">
        ${buildTagPickerHTML(id, z.tags || [])}
      </div>
    </div>

    <div class="seg-section">
      <div class="seg-title">
        <span><i class="fas fa-shapes"></i> Segments (${z.segs.length})</span>
        <button class="btn" style="padding:4px 8px;font-size:11px" onclick="addSegment('${id}')"><i class="fas fa-plus"></i> Block</button>
      </div>
      ${segsHtml}
      ${sel.segIdx != null && z.segs[sel.segIdx] ? renderSegEditor(z, sel.segIdx) : ''}
    </div>

    <div class="seg-section">
      <div class="seg-title">
        <span><i class="fas fa-pallet"></i> Pallets (${z.pallets.length})</span>
        <div style="display:flex;gap:4px">
          <button class="btn" style="padding:4px 8px;font-size:11px" onclick="addPallet('${id}')" title="Add one"><i class="fas fa-plus"></i></button>
          ${z.pallets.length > 0 ? '<button class="btn btn-d" style="padding:4px 8px;font-size:11px" onclick="clearAllPallets(\'' + id + '\')" title="Remove all"><i class="fas fa-trash"></i></button>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">
        <button class="btn btn-g" style="flex:1;justify-content:center;font-size:11px;padding:6px 8px" onclick="showQuickFillForm('${id}')"><i class="fas fa-th"></i> Quick Fill</button>
        <button class="btn" style="flex:1;justify-content:center;font-size:11px;padding:6px 8px;color:#f59e0b" onclick="showBatchAddForm('${id}')"><i class="fas fa-list"></i> Batch Add</button>
        <button class="btn" style="flex:1;justify-content:center;font-size:11px;padding:6px 8px;color:#a78bfa" onclick="showRowFillForm('${id}')"><i class="fas fa-equals"></i> Row Fill</button>
        ${z.pallets.length > 0 ? '<button class="btn" style="flex:1;justify-content:center;font-size:11px;padding:6px 8px;color:var(--cyan)" onclick="selectAllPalletsInZone(\'' + id + '\')"><i class="fas fa-check-double"></i> Select All</button>' : ''}
      </div>

      <div id="batchAddForm" style="display:none;padding:8px;background:var(--bg-3);border-radius:var(--radius-sm);margin-bottom:6px">
        <div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:6px"><i class="fas fa-list"></i> Batch Add — Named Pallets</div>
        <div class="fg" style="margin:0 0 6px 0"><label>Names (comma or newline separated)</label>
          <textarea id="batchNames" rows="3" style="font-size:13px;width:100%;resize:vertical;font-family:var(--mono);padding:6px 8px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-1)" placeholder="LU7, LU8, LU3, LU16&#10;or one per line" oninput="updateBatchPreview('${id}')"></textarea></div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Pallet W</label>
            <input type="number" id="batchPw" value="8" min="2" style="font-size:13px" oninput="updateBatchPreview('${id}')"></div>
          <div class="fg" style="margin:0"><label>Pallet H</label>
            <input type="number" id="batchPh" value="8" min="2" style="font-size:13px" oninput="updateBatchPreview('${id}')"></div>
          <div class="fg" style="margin:0"><label>Gap</label>
            <input type="number" id="batchGap" value="2" min="0" style="font-size:13px" oninput="updateBatchPreview('${id}')"></div>
        </div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0;flex:1"><label>Mode</label>
            <select id="batchMode" style="font-size:13px;padding:5px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-1)" oninput="updateBatchPreview('${id}')">
              <option value="append">Add to existing</option>
              <option value="replace">Replace all</option>
            </select></div>
        </div>
        <div class="qf-preview" id="batchPreview">—</div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-p" style="flex:1;justify-content:center;font-size:11px" onclick="doBatchAdd('${id}')"><i class="fas fa-check"></i> Create Pallets</button>
          <button class="btn" style="padding:4px 10px;font-size:11px" onclick="document.getElementById('batchAddForm').style.display='none'"><i class="fas fa-times"></i></button>
        </div>
      </div>

      <div id="rowFillForm" style="display:none;padding:8px;background:var(--bg-3);border-radius:var(--radius-sm);margin-bottom:6px">
        <div style="font-size:11px;font-weight:700;color:#a78bfa;margin-bottom:6px"><i class="fas fa-equals"></i> Row Fill — Rows of Named Pallets</div>
        <div id="rowFillRows"></div>
        <button class="btn" style="width:100%;justify-content:center;font-size:11px;padding:5px 8px;margin-bottom:6px" onclick="addRowFillRow('${id}')"><i class="fas fa-plus"></i> Add Row</button>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Pallet W</label>
            <input type="number" id="rfPw" value="8" min="2" style="font-size:13px" oninput="updateRowFillPreview('${id}')"></div>
          <div class="fg" style="margin:0"><label>Pallet H</label>
            <input type="number" id="rfPh" value="8" min="2" style="font-size:13px" oninput="updateRowFillPreview('${id}')"></div>
          <div class="fg" style="margin:0"><label>Gap</label>
            <input type="number" id="rfGap" value="2" min="0" style="font-size:13px" oninput="updateRowFillPreview('${id}')"></div>
        </div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0;flex:1"><label>Direction</label>
            <select id="rfDir" style="font-size:13px;padding:5px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-1)">
              <option value="h">Horizontal rows →</option>
              <option value="v">Vertical columns ↓</option>
            </select></div>
          <div class="fg" style="margin:0;flex:1"><label>Mode</label>
            <select id="rfMode" style="font-size:13px;padding:5px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-1)">
              <option value="append">Add to existing</option>
              <option value="replace">Replace all</option>
            </select></div>
        </div>
        <div class="qf-preview" id="rfPreview">—</div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-p" style="flex:1;justify-content:center;font-size:11px" onclick="doRowFill('${id}')"><i class="fas fa-check"></i> Create Rows</button>
          <button class="btn" style="padding:4px 10px;font-size:11px" onclick="document.getElementById('rowFillForm').style.display='none'"><i class="fas fa-times"></i></button>
        </div>
      </div>

      <div id="quickFillForm" style="display:none;padding:8px;background:var(--bg-3);border-radius:var(--radius-sm);margin-bottom:6px">
        <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:6px"><i class="fas fa-th"></i> Quick Fill — Auto Grid</div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Pallet W (ft)</label>
            <input type="number" id="qfPw" value="8" min="2" style="font-size:13px" oninput="updateQfPreview('${id}')"></div>
          <div class="fg" style="margin:0"><label>Pallet H (ft)</label>
            <input type="number" id="qfPh" value="8" min="2" style="font-size:13px" oninput="updateQfPreview('${id}')"></div>
        </div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Gap (ft)</label>
            <input type="number" id="qfGap" value="2" min="0" style="font-size:13px" oninput="updateQfPreview('${id}')"></div>
          <div class="fg" style="margin:0;flex:2"><label>Prefix</label>
            <input type="text" id="qfPrefix" value="P" style="font-size:13px"></div>
          <div class="fg" style="margin:0;flex:1"><label>Start #</label>
            <input type="number" id="qfStart" value="1" min="0" style="font-size:13px"></div>
        </div>
        <div class="qf-preview" id="qfPreview">—</div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-p" style="flex:1;justify-content:center;font-size:11px" onclick="doQuickFill('${id}')"><i class="fas fa-check"></i> Fill Zone</button>
          <button class="btn" style="padding:4px 10px;font-size:11px" onclick="document.getElementById('quickFillForm').style.display='none'"><i class="fas fa-times"></i></button>
        </div>
      </div>
      ${palsHtml}
      ${sel.palletId ? renderPalEditor(z) : ''}
    </div>
  `;

  document.getElementById('edFoot').innerHTML = `
    <button class="btn btn-d" onclick="deleteZone('${id}')"><i class="fas fa-trash"></i> Delete</button>
    <button class="btn btn-p" onclick="closeEditor()"><i class="fas fa-check"></i> Done</button>
  `;

  ed.classList.add('open');
}

function renderSegEditor(z, si) {
  const s = z.segs[si];
  if (!s) return '';
  return `<div style="padding:8px;background:var(--bg-3);border-radius:var(--radius-sm);margin-top:6px">
    <div class="fr" style="margin-bottom:8px">
      <div class="fg" style="margin:0"><label>X</label>
        <input type="number" value="${s.x}" onchange="editSeg('${z.id}',${si},'x',+this.value)"></div>
      <div class="fg" style="margin:0"><label>Y</label>
        <input type="number" value="${s.y}" onchange="editSeg('${z.id}',${si},'y',+this.value)"></div>
    </div>
    <div class="fr">
      <div class="fg" style="margin:0"><label>Width (ft)</label>
        <input type="number" value="${s.w}" min="5" onchange="editSeg('${z.id}',${si},'w',+this.value)"></div>
      <div class="fg" style="margin:0"><label>Height (ft)</label>
        <input type="number" value="${s.h}" min="5" onchange="editSeg('${z.id}',${si},'h',+this.value)"></div>
    </div>
    ${z.segs.length > 1 ? `<button class="btn btn-d" style="margin-top:8px;width:100%;justify-content:center;font-size:11px"
      onclick="removeSeg('${z.id}',${si})"><i class="fas fa-times"></i> Remove segment</button>` : ''}
  </div>`;
}

function renderPalEditor(z) {
  const p = z.pallets.find(pp => pp.id === sel.palletId);
  if (!p) return '';
  return `<div style="padding:8px;background:var(--bg-3);border-radius:var(--radius-sm);margin-top:6px">
    <div class="fg" style="margin-bottom:8px"><label>Label</label>
      <input type="text" value="${esc(p.label)}" onchange="editPal('${z.id}','${p.id}','label',this.value)"></div>
    <div class="fr" style="margin-bottom:8px">
      <div class="fg" style="margin:0"><label>X</label>
        <input type="number" value="${Math.round(p.x)}" onchange="editPal('${z.id}','${p.id}','x',+this.value)"></div>
      <div class="fg" style="margin:0"><label>Y</label>
        <input type="number" value="${Math.round(p.y)}" onchange="editPal('${z.id}','${p.id}','y',+this.value)"></div>
    </div>
    <div class="fr">
      <div class="fg" style="margin:0"><label>Width</label>
        <input type="number" value="${Math.round(p.w)}" min="1" onchange="editPal('${z.id}','${p.id}','w',+this.value)"></div>
      <div class="fg" style="margin:0"><label>Height</label>
        <input type="number" value="${Math.round(p.h)}" min="1" onchange="editPal('${z.id}','${p.id}','h',+this.value)"></div>
    </div>
    <button class="btn btn-d" style="margin-top:8px;width:100%;justify-content:center;font-size:11px"
      onclick="removePal('${z.id}','${p.id}')"><i class="fas fa-times"></i> Remove pallet</button>
  </div>`;
}

function applyZoneField(zid, field, val) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  z[field] = val;
  renderAll();
  if (field === 'name') document.getElementById('edTitle').textContent = val;
}

function autoSetCapacity(zid, count) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  z.capacity = count;
  renderAll();
  openZoneEditor(zid);
  toast('Capacity set to ' + count, 'ok');
}

function buildTagPickerHTML(zid, existingTags) {
  let html = '';
  categories.forEach((cat, ci) => {
    const subs = cat.subs || [];
    if (subs.length === 0) return;
    html += '<div class="tp-cat">';
    html += '<div class="tp-cat-head" onclick="toggleTpCategory(' + ci + ')">';
    html += '<span class="tp-dot" style="background:' + cat.color + '"></span>';
    html += '<span>' + esc(cat.name) + '</span>';
    html += '<span style="font-size:10px;color:var(--text-3);margin-left:4px">(' + subs.length + ')</span>';
    html += '<span class="tp-arrow" id="tpArrow' + ci + '"><i class="fas fa-chevron-right"></i></span>';
    html += '</div>';
    html += '<div class="tp-subs" id="tpSubs' + ci + '">';
    subs.forEach(sub => {
      const used = existingTags.includes(sub);
      html += '<div class="tp-item' + (used ? ' used' : '') + '" onclick="addTagFromPicker(\'' + zid + '\',\'' + esc(sub).replace(/'/g, "\\'") + '\')" style="border-color:' + cat.color + '44">' + esc(sub) + '</div>';
    });
    html += '</div></div>';
  });
  const allSubs = categories.flatMap(c => c.subs || []);
  const seen = new Set();
  const extras = zones.filter(z => {
    if (!z.name || allSubs.includes(z.name) || seen.has(z.name)) return false;
    seen.add(z.name);
    return true;
  });
  if (extras.length > 0) {
    html += '<div class="tp-cat">';
    html += '<div class="tp-cat-head" onclick="toggleTpCategory(\'other\')">';
    html += '<span class="tp-dot" style="background:var(--text-3)"></span>';
    html += '<span>Other zones</span>';
    html += '<span style="font-size:10px;color:var(--text-3);margin-left:4px">(' + extras.length + ')</span>';
    html += '<span class="tp-arrow" id="tpArrowother"><i class="fas fa-chevron-right"></i></span>';
    html += '</div>';
    html += '<div class="tp-subs" id="tpSubsother">';
    extras.forEach(z => {
      const used = existingTags.includes(z.name);
      html += '<div class="tp-item' + (used ? ' used' : '') + '" onclick="addTagFromPicker(\'' + zid + '\',\'' + esc(z.name).replace(/'/g, "\\'") + '\')" style="border-color:var(--text-3)">' + esc(z.name) + '</div>';
    });
    html += '</div></div>';
  }
  return html;
}

function toggleTagPicker() {
  const btn = document.getElementById('tpToggle');
  const panel = document.getElementById('tpPanel');
  if (!btn || !panel) return;
  btn.classList.toggle('open');
  panel.classList.toggle('open');
}

function toggleTpCategory(idx) {
  const subs = document.getElementById('tpSubs' + idx);
  const arrow = document.getElementById('tpArrow' + idx);
  if (!subs) return;
  if (subs.classList.contains('expanded')) {
    subs.classList.remove('expanded');
    if (arrow) arrow.classList.remove('rotated');
  } else {
    subs.classList.add('expanded');
    if (arrow) arrow.classList.add('rotated');
  }
}

function addTagFromPicker(zid, tagName) {
  if (!tagName) return;
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  if (!z.tags) z.tags = [];
  if (z.tags.includes(tagName)) { toast('Tag already added', 'err'); return; }
  z.tags.push(tagName);
  renderAll();
  openZoneEditor(zid);
  toast('Tag "' + tagName + '" added', 'ok');
}

function removeZoneTag(zid, tagIdx) {
  const z = zones.find(zz => zz.id === zid);
  if (!z || !z.tags) return;
  const removed = z.tags.splice(tagIdx, 1);
  renderAll();
  openZoneEditor(zid);
  toast('Tag "' + removed[0] + '" removed', 'inf');
}

function changeParentZone(zid, parentId) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  z.parentId = parentId || null;
  renderAll();
  openZoneEditor(zid);
}

function changeCatAndRefresh(zid, catId) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  z.cat = catId;
  const cat = categories.find(c => c.id === catId);
  if (cat) z.color = cat.color;
  renderAll();
  openZoneEditor(zid);
}

function changeSubName(zid, subName) {
  const z = zones.find(zz => zz.id === zid);
  if (!z || !subName) return;
  z.name = subName;
  renderAll();
  openZoneEditor(zid);
}

function editSeg(zid, si, field, val) {
  const z = zones.find(zz => zz.id === zid);
  if (z && z.segs[si]) { z.segs[si][field] = val; renderAll(); openZoneEditor(zid); }
}

function editPal(zid, palId, field, val) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const p = z.pallets.find(pp => pp.id === palId);
  if (p) { p[field] = val; renderAll(); openZoneEditor(zid); }
}

function addSegment(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const last = z.segs[z.segs.length - 1];
  z.segs.push({ x: last.x + last.w, y: last.y, w: Math.round(last.w / 2), h: last.h });
  sel.segIdx = z.segs.length - 1;
  renderAll();
  openZoneEditor(zid);
  toast('Segment added — drag to position', 'inf');
}

function removeSeg(zid, si) {
  const z = zones.find(zz => zz.id === zid);
  if (!z || z.segs.length <= 1) return;
  z.segs.splice(si, 1);
  sel.segIdx = null;
  renderAll();
  openZoneEditor(zid);
}

function addPallet(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const s = z.segs[0];
  const pId = pid();
  const pw = 8, ph = 8;
  const pad = 3;
  const headerH = 14;
  const gap = 2;

  const availW = s.w - pad * 2;
  const cols = Math.max(1, Math.floor((availW + gap) / (pw + gap)));

  const segCols = (currentWH === 1) ? getColumnsInRect(s.x, s.y, s.w, s.h) : [];
  let placed = false;
  for (let row = 0; row < 100 && !placed; row++) {
    for (let col = 0; col < cols && !placed; col++) {
      const px = s.x + pad + col * (pw + gap);
      const py = s.y + headerH + row * (ph + gap);
          if (py + ph > s.y + s.h) break;
          if (currentWH === 1 && palletOverlapsColumn(px, py, pw, ph, segCols)) continue;
          const overlaps = z.pallets.some(p =>
        px < p.x + p.w && px + pw > p.x &&
        py < p.y + p.h && py + ph > p.y
      );
      if (!overlaps) {
        z.pallets.push({ id: pId, label: 'P' + (z.pallets.length + 1), x: px, y: py, w: pw, h: ph });
        placed = true;
      }
    }
  }

  if (!placed) {
      z.pallets.push({ id: pId, label: 'P' + (z.pallets.length + 1), x: s.x + pad, y: s.y + headerH, w: pw, h: ph });
    toast('No free space — pallet overlapping', 'err');
  }

  sel.palletId = pId;
  renderAll();
  openZoneEditor(zid);
}

function clearAllPallets(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const count = z.pallets.length;
  if (count === 0) return;
  showModal('Remove all pallets?', count + ' pallets will be removed from this zone.', () => {
    z.pallets = [];
    sel.palletId = null;
    renderAll();
    openZoneEditor(zid);
    toast(count + ' pallets removed', 'inf');
  });
}

function removePal(zid, palId) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  z.pallets = z.pallets.filter(p => p.id !== palId);
  if (sel.palletId === palId) sel.palletId = null;
  renderAll();
  openZoneEditor(zid);
}

// quick fill
const QF_HEADER = 14;

function showQuickFillForm(zid) {
  const form = document.getElementById('quickFillForm');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    updateQfPreview(zid);
    setTimeout(() => { const inp = document.getElementById('qfPw'); if (inp) inp.focus(); }, 50);
  }
}

function updateQfPreview(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const s = z.segs[0];
  const pw = parseFloat(document.getElementById('qfPw').value) || 8;
  const ph = parseFloat(document.getElementById('qfPh').value) || 8;
  const gap = parseFloat(document.getElementById('qfGap').value) || 2;
  const pad = 2;
  const availW = s.w - pad * 2;
  const availH = s.h - QF_HEADER - 1 - pad;
  const cols = Math.max(0, Math.floor((availW + gap) / (pw + gap)));
  const rows = Math.max(0, Math.floor((availH + gap) / (ph + gap)));
  const total = cols * rows;
  const prefix = (document.getElementById('qfPrefix').value || '').trim() || 'P';
  const startNum = parseInt(document.getElementById('qfStart').value) || 1;
  const el = document.getElementById('qfPreview');
  if (el) {
    if (total > 0) {
      el.textContent = cols + '×' + rows + ' = ' + total + '  (' + prefix + startNum + '–' + prefix + (startNum + total - 1) + ')';
      el.style.color = 'var(--green)';
    } else {
      el.textContent = 'Zone too small';
      el.style.color = 'var(--red)';
    }
  }
}

function doQuickFill(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const s = z.segs[0];

  const pw = parseFloat(document.getElementById('qfPw').value) || 8;
  const ph = parseFloat(document.getElementById('qfPh').value) || 8;
  const gap = parseFloat(document.getElementById('qfGap').value) || 2;
  const prefix = (document.getElementById('qfPrefix').value || '').trim() || 'P';
  const startNum = parseInt(document.getElementById('qfStart').value) || 1;
  const pad = 2;

  const startX = s.x + pad;
  const startY = s.y + QF_HEADER + 1;
  const availW = s.w - pad * 2;
  const availH = s.h - QF_HEADER - 1 - pad;

  const cols = Math.max(0, Math.floor((availW + gap) / (pw + gap)));
  const rows = Math.max(0, Math.floor((availH + gap) / (ph + gap)));
  const total = cols * rows;

  if (total === 0) { toast('Zone too small for this pallet size', 'err'); return; }

  const doFill = () => {
    z.pallets = [];
    let count = 0;
    const segCols = (currentWH === 1) ? getColumnsInRect(s.x, s.y, s.w, s.h) : [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = startX + c * (pw + gap);
        const py = startY + r * (ph + gap);
        if (currentWH === 1 && palletOverlapsColumn(px, py, pw, ph, segCols)) continue;
        z.pallets.push({
          id: pid(), label: prefix + (startNum + count),
          x: px, y: py, w: pw, h: ph
        });
        count++;
      }
    }
    sel.palletId = null;
    renderAll();
    openZoneEditor(zid);
    toast(count + ' pallets: ' + prefix + startNum + '–' + prefix + (startNum + count - 1), 'ok');
    const form = document.getElementById('quickFillForm');
    if (form) form.style.display = 'none';
  };

  if (z.pallets.length > 0) {
    showModal('Replace ' + z.pallets.length + ' existing pallets?',
      'Quick Fill will remove current pallets and create ' + total + ' new ones in a ' + cols + '×' + rows + ' grid.',
      doFill);
  } else {
    doFill();
  }
}

// ===== BATCH ADD =====
function showBatchAddForm(zid) {
  // hide other forms
  const qf = document.getElementById('quickFillForm'); if (qf) qf.style.display = 'none';
  const rf = document.getElementById('rowFillForm'); if (rf) rf.style.display = 'none';
  const form = document.getElementById('batchAddForm');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    updateBatchPreview(zid);
    setTimeout(() => { const t = document.getElementById('batchNames'); if (t) t.focus(); }, 50);
  }
}

function parseBatchNames(raw) {
  return raw.split(/[,\n]+/).map(s => s.trim()).filter(s => s.length > 0);
}

function updateBatchPreview(zid) {
  const z = zones.find(zz => zz.id === zid); if (!z) return;
  const names = parseBatchNames((document.getElementById('batchNames')?.value) || '');
  const pw = parseFloat(document.getElementById('batchPw')?.value) || 8;
  const ph = parseFloat(document.getElementById('batchPh')?.value) || 8;
  const gap = parseFloat(document.getElementById('batchGap')?.value) || 2;
  const s = z.segs[0];
  const pad = 2;
  const availW = s.w - pad * 2;
  const cols = Math.max(1, Math.floor((availW + gap) / (pw + gap)));
  const rows = Math.ceil(names.length / cols);
  const el = document.getElementById('batchPreview');
  if (el) {
    if (names.length === 0) {
      el.textContent = 'Type pallet names above';
      el.style.color = 'var(--text-3)';
    } else {
      el.textContent = names.length + ' pallets → ' + cols + '×' + rows + ' grid  (' + names.slice(0, 3).join(', ') + (names.length > 3 ? '...' : '') + ')';
      el.style.color = '#f59e0b';
    }
  }
}

function doBatchAdd(zid) {
  const z = zones.find(zz => zz.id === zid); if (!z) return;
  const s = z.segs[0];
  const names = parseBatchNames((document.getElementById('batchNames')?.value) || '');
  if (names.length === 0) { toast('Enter pallet names first', 'err'); return; }

  const pw = parseFloat(document.getElementById('batchPw')?.value) || 8;
  const ph = parseFloat(document.getElementById('batchPh')?.value) || 8;
  const gap = parseFloat(document.getElementById('batchGap')?.value) || 2;
  const mode = document.getElementById('batchMode')?.value || 'append';
  const pad = 2;

  const startX = s.x + pad;
  const startY = s.y + QF_HEADER + 1;
  const availW = s.w - pad * 2;
  const cols = Math.max(1, Math.floor((availW + gap) / (pw + gap)));

  const doIt = () => {
    if (mode === 'replace') z.pallets = [];
    // Find offset Y if appending
    let offsetY = startY;
    if (mode === 'append' && z.pallets.length > 0) {
      const maxY = Math.max(...z.pallets.map(p => p.y + p.h));
      offsetY = maxY + gap;
    }
    const segCols = (currentWH === 1) ? getColumnsInRect(s.x, s.y, s.w, s.h) : [];
    names.forEach((name, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const px = startX + c * (pw + gap);
      const py = offsetY + r * (ph + gap);
      if (currentWH === 1 && palletOverlapsColumn(px, py, pw, ph, segCols)) return;
      z.pallets.push({
        id: pid(),
        label: name,
        x: px, y: py,
        w: pw, h: ph
      });
    });
    sel.palletId = null;
    renderAll();
    openZoneEditor(zid);
    toast(names.length + ' pallets created: ' + names[0] + '...' + names[names.length - 1], 'ok');
    const form = document.getElementById('batchAddForm'); if (form) form.style.display = 'none';
  };

  if (mode === 'replace' && z.pallets.length > 0) {
    showModal('Replace ' + z.pallets.length + ' existing pallets?',
      'Batch Add will remove current pallets and create ' + names.length + ' new ones.',
      doIt);
  } else {
    doIt();
  }
}

// ===== ROW FILL =====
let rowFillData = []; // [{names: 'LU4, LU7, LU9'}]

function showRowFillForm(zid) {
  // hide other forms
  const qf = document.getElementById('quickFillForm'); if (qf) qf.style.display = 'none';
  const bf = document.getElementById('batchAddForm'); if (bf) bf.style.display = 'none';
  const form = document.getElementById('rowFillForm');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    rowFillData = [{ names: '' }];
    renderRowFillRows(zid);
    updateRowFillPreview(zid);
  }
}

function renderRowFillRows(zid) {
  const container = document.getElementById('rowFillRows');
  if (!container) return;
  container.innerHTML = rowFillData.map((row, i) => `
    <div style="display:flex;gap:4px;align-items:center;margin-bottom:5px">
      <span style="font-size:10px;color:var(--text-3);font-family:var(--mono);width:18px;text-align:center;flex-shrink:0">R${i + 1}</span>
      <input type="text" value="${row.names}" placeholder="LU4, LU7, LU9..."
        style="flex:1;font-size:13px;font-family:var(--mono);padding:5px 8px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-1)"
        oninput="rowFillData[${i}].names=this.value;updateRowFillPreview('${zid}')">
      ${rowFillData.length > 1 ? '<button class="btn btn-d" style="padding:3px 6px;font-size:10px" onclick="rowFillData.splice(' + i + ',1);renderRowFillRows(\'' + zid + '\');updateRowFillPreview(\'' + zid + '\')"><i class="fas fa-times"></i></button>' : ''}
    </div>
  `).join('');
}

function addRowFillRow(zid) {
  rowFillData.push({ names: '' });
  renderRowFillRows(zid);
  updateRowFillPreview(zid);
  // focus the last input
  const container = document.getElementById('rowFillRows');
  if (container) {
    const inputs = container.querySelectorAll('input[type="text"]');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }
}

function updateRowFillPreview(zid) {
  let total = 0;
  let rowCount = 0;
  rowFillData.forEach(row => {
    const names = parseBatchNames(row.names);
    if (names.length > 0) { total += names.length; rowCount++; }
  });
  const el = document.getElementById('rfPreview');
  if (el) {
    if (total === 0) {
      el.textContent = 'Type pallet names in rows above';
      el.style.color = 'var(--text-3)';
    } else {
      el.textContent = total + ' pallets in ' + rowCount + ' row' + (rowCount !== 1 ? 's' : '');
      el.style.color = '#a78bfa';
    }
  }
}

function doRowFill(zid) {
  const z = zones.find(zz => zz.id === zid); if (!z) return;
  const s = z.segs[0];

  const pw = parseFloat(document.getElementById('rfPw')?.value) || 8;
  const ph = parseFloat(document.getElementById('rfPh')?.value) || 8;
  const gap = parseFloat(document.getElementById('rfGap')?.value) || 2;
  const dir = document.getElementById('rfDir')?.value || 'h';
  const mode = document.getElementById('rfMode')?.value || 'append';
  const pad = 2;

  // Collect all rows
  const rows = rowFillData.map(row => parseBatchNames(row.names)).filter(r => r.length > 0);
  const totalPallets = rows.reduce((sum, r) => sum + r.length, 0);
  if (totalPallets === 0) { toast('Enter pallet names first', 'err'); return; }

  const doIt = () => {
    if (mode === 'replace') z.pallets = [];

    const startX = s.x + pad;
    const startY = s.y + QF_HEADER + 1;

    // Find offset if appending
    let offsetX = startX;
    let offsetY = startY;
    if (mode === 'append' && z.pallets.length > 0) {
      if (dir === 'h') {
        const maxY = Math.max(...z.pallets.map(p => p.y + p.h));
        offsetY = maxY + gap;
      } else {
        const maxX = Math.max(...z.pallets.map(p => p.x + p.w));
        offsetX = maxX + gap;
      }
    }

    const segCols = (currentWH === 1) ? getColumnsInRect(s.x, s.y, s.w, s.h) : [];
    if (dir === 'h') {
      // Horizontal: each row is left to right, rows stack top to bottom
      rows.forEach((names, ri) => {
        names.forEach((name, ci) => {
          const px = startX + ci * (pw + gap);
          const py = offsetY + ri * (ph + gap);
          if (currentWH === 1 && palletOverlapsColumn(px, py, pw, ph, segCols)) return;
          z.pallets.push({
            id: pid(), label: name,
            x: px, y: py, w: pw, h: ph
          });
        });
      });
    } else {
      // Vertical: each "row" is top to bottom, columns stack left to right
      rows.forEach((names, ci) => {
        names.forEach((name, ri) => {
          const px = offsetX + ci * (pw + gap);
          const py = startY + ri * (ph + gap);
          if (currentWH === 1 && palletOverlapsColumn(px, py, pw, ph, segCols)) return;
          z.pallets.push({
            id: pid(), label: name,
            x: px, y: py, w: pw, h: ph
          });
        });
      });
    }

    sel.palletId = null;
    renderAll();
    openZoneEditor(zid);
    toast(totalPallets + ' pallets in ' + rows.length + ' rows created', 'ok');
    const form = document.getElementById('rowFillForm'); if (form) form.style.display = 'none';
  };

  if (mode === 'replace' && z.pallets.length > 0) {
    showModal('Replace ' + z.pallets.length + ' existing pallets?',
      'Row Fill will remove current pallets and create ' + totalPallets + ' new ones in ' + rows.length + ' rows.',
      doIt);
  } else {
    doIt();
  }
}

// Also hide other forms when Quick Fill is opened
const _origShowQuickFill = showQuickFillForm;
showQuickFillForm = function(zid) {
  const bf = document.getElementById('batchAddForm'); if (bf) bf.style.display = 'none';
  const rf = document.getElementById('rowFillForm'); if (rf) rf.style.display = 'none';
  _origShowQuickFill(zid);
};

// multi-select & batch
function toggleMultiSel(zid, palId) {
  const idx = multiSel.findIndex(m => m.zid === zid && m.pid === palId);
  if (idx >= 0) {
    multiSel.splice(idx, 1);
  } else {
    multiSel.push({ zid, pid: palId });
  }
  sel.zoneId = zid;
  renderAll();
  updateBatchBar();
}

function clearMultiSel() {
  multiSel = [];
  updateBatchBar();
  renderAll();
}

function updateBatchBar() {
  const bar = document.getElementById('batchBar');
  const cnt = document.getElementById('batchCount');
  if (!bar) return;
  if (multiSel.length > 0) {
    bar.classList.add('show');
    cnt.textContent = multiSel.length + ' selected';
  } else {
    bar.classList.remove('show');
  }
}

function selectAllPalletsInZone(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z || z.pallets.length === 0) { toast('No pallets in zone', 'err'); return; }
  multiSel = z.pallets.map(p => ({ zid, pid: p.id }));
  renderAll();
  updateBatchBar();
  toast(multiSel.length + ' pallets selected', 'inf');
}

function batchDelete() {
  if (multiSel.length === 0) return;
  showModal('Delete ' + multiSel.length + ' pallets?',
    'This will permanently remove all selected pallets.',
    () => {
      const count = multiSel.length;
      multiSel.forEach(({ zid: mzid, pid: mpid }) => {
        const z = zones.find(zz => zz.id === mzid);
        if (z) z.pallets = z.pallets.filter(p => p.id !== mpid);
      });
      multiSel = [];
      sel.palletId = null;
      updateBatchBar();
      renderAll();
      if (sel.zoneId) openZoneEditor(sel.zoneId);
      toast(count + ' pallets removed', 'ok');
    });
}

function batchMoveToZone() {
  if (multiSel.length === 0) return;
  let html = '<h3>Move ' + multiSel.length + ' pallets to:</h3>';
  html += '<div style="max-height:55vh;overflow-y:auto;margin:12px 0">';
  zones.forEach(z => {
    html += '<div class="seg-item" data-action="batchmove" data-zid="' + z.id + '">' +
      '<span style="display:flex;align-items:center;gap:6px">' +
      '<span style="width:10px;height:10px;border-radius:2px;background:' + z.color + '"></span>' +
      esc(z.name) + '</span>' +
      '<span class="seg-dims">' + z.pallets.length + 'P</span></div>';
  });
  html += '</div>';
  html += '<div class="modal-acts"><button class="btn" onclick="closeModal()">Cancel</button></div>';
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBg').classList.add('show');

  document.getElementById('modalContent').addEventListener('click', function handler(ev) {
    const item = ev.target.closest('[data-action="batchmove"]');
    if (!item) return;
    ev.stopPropagation();
    const targetZid = item.getAttribute('data-zid');
    doBatchMove(targetZid);
    document.getElementById('modalContent').removeEventListener('click', handler);
  });
}

function doBatchMove(targetZid) {
  const targetZone = zones.find(z => z.id === targetZid);
  if (!targetZone) return;
  closeModal();
  const s = targetZone.segs[0];
  const pad = 2, gap = 2;
  const availW = s.w - pad * 2;

  let placed = 0;
  multiSel.forEach(({ zid: mzid, pid: mpid }) => {
    const srcZone = zones.find(z => z.id === mzid);
    if (!srcZone) return;
    const palIdx = srcZone.pallets.findIndex(p => p.id === mpid);
    if (palIdx < 0) return;
    const pal = srcZone.pallets.splice(palIdx, 1)[0];

    const cols = Math.max(1, Math.floor((availW + gap) / (pal.w + gap)));
    let ok = false;
    for (let row = 0; row < 100 && !ok; row++) {
      for (let col = 0; col < cols && !ok; col++) {
        const px = s.x + pad + col * (pal.w + gap);
        const py = s.y + QF_HEADER + 1 + row * (pal.h + gap);
        if (py + pal.h > s.y + s.h) break;
        const overlaps = targetZone.pallets.some(p =>
          px < p.x + p.w && px + pal.w > p.x &&
          py < p.y + p.h && py + pal.h > p.y
        );
        if (!overlaps) {
          pal.x = px; pal.y = py;
          targetZone.pallets.push(pal);
          ok = true; placed++;
        }
      }
    }
    if (!ok) { srcZone.pallets.splice(palIdx, 0, pal); }
  });

  multiSel = [];
  sel.palletId = null;
  updateBatchBar();
  renderAll();
  if (placed > 0) toast(placed + ' pallets moved to ' + targetZone.name, 'ok');
  else toast('No space in target zone', 'err');
}

function closeEditor() {
  document.getElementById('editor').classList.remove('open');
}

/* =================================================================
   ADD / DELETE ZONES
   ================================================================= */
function addNewZone() {
  openZonePicker();
}

function openZonePicker() {
  let html = '<h3>Select Zone Type</h3><div class="zp-grid" id="zpGrid">';
  categories.forEach((cat, ci) => {
    html += `<div class="zp-cat" data-idx="${ci}">
      <div class="zp-cat-head" data-toggle="${ci}">
        <span class="zp-dot" style="background:${cat.color}"></span>
        <span>${cat.name}</span>
        <span style="font-size:10px;color:var(--text-3);margin-left:4px">(${(cat.subs||[]).length})</span>
        <span class="zp-arrow" id="zpArrow${ci}"><i class="fas fa-chevron-right"></i></span>
      </div>
      <div class="zp-subs" id="zpSubs${ci}">`;
    (cat.subs || []).forEach(sub => {
      html += `<div class="zp-sub" style="border-color:${cat.color}44"
        data-action="pick" data-cat="${cat.id}" data-sub="${esc(sub)}" data-color="${cat.color}">${sub}</div>`;
    });
    html += `<div class="zp-sub" style="opacity:.5;font-style:italic" data-action="addsub" data-ci="${ci}">+ add...</div>`;
    html += '</div></div>';
  });
  html += '</div>';
  html += '<div class="zp-blank" data-action="blank"><i class="fas fa-plus"></i> Blank zone (no category)</div>';
  html += '<div class="modal-acts" style="margin-top:12px"><button class="btn" onclick="closeModal()">Cancel</button></div>';
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBg').classList.add('show');

  const grid = document.getElementById('zpGrid');
  if (grid) {
    grid.addEventListener('click', function(e) {
          const head = e.target.closest('[data-toggle]');
      if (head) {
        e.stopPropagation();
        const idx = head.getAttribute('data-toggle');
        toggleZpCategory(idx);
        return;
      }
          const pickBtn = e.target.closest('[data-action="pick"]');
      if (pickBtn) {
        e.stopPropagation();
        const catId = pickBtn.getAttribute('data-cat');
        const sub = pickBtn.getAttribute('data-sub');
        const color = pickBtn.getAttribute('data-color');
        createZoneFromPicker(catId, sub, color);
        return;
      }
          const addBtn = e.target.closest('[data-action="addsub"]');
      if (addBtn) {
        e.stopPropagation();
        const ci = parseInt(addBtn.getAttribute('data-ci'));
        addSubToCatAndCreate(ci);
        return;
      }
    });
  }

  const blankBtn = document.querySelector('[data-action="blank"]');
  if (blankBtn) {
    blankBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      createBlankZone();
    });
  }
}

function toggleZpCategory(idx) {
  const subs = document.getElementById('zpSubs' + idx);
  const arrow = document.getElementById('zpArrow' + idx);
  if (!subs) return;
  const isExpanded = subs.classList.contains('expanded');
  if (isExpanded) {
    subs.classList.remove('expanded');
    if (arrow) arrow.classList.remove('rotated');
  } else {
    subs.classList.add('expanded');
    if (arrow) arrow.classList.add('rotated');
  }
}

function createZoneFromPicker(catId, subName, color) {
  closeModal();
  const id = zid();
  const cx = vb.x + vb.w / 2 - 25;
  const cy = vb.y + vb.h / 2 - 15;
  zones.push({
    id, name: subName, cat: catId, color: color,
    segs: [{ x: doSnap(cx), y: doSnap(cy), w: 50, h: 30 }],
    pallets: [], capacity: 0, boxes: 0, tags: [], parentId: null
  });
  sel.zoneId = id; sel.palletId = null; sel.segIdx = 0;
  renderAll();
  openZoneEditor(id);
  toast('Zone "' + subName + '" created', 'ok');
}

function createBlankZone() {
  closeModal();
  const id = zid();
  const cx = vb.x + vb.w / 2 - 25;
  const cy = vb.y + vb.h / 2 - 15;
  zones.push({
    id, name: 'New Zone', cat: '', color: randColor(),
    segs: [{ x: doSnap(cx), y: doSnap(cy), w: 50, h: 30 }],
    pallets: [], capacity: 0, boxes: 0, tags: [], parentId: null
  });
  sel.zoneId = id; sel.palletId = null; sel.segIdx = 0;
  renderAll();
  openZoneEditor(id);
  toast('Blank zone created', 'inf');
}

function addSubToCatAndCreate(catIdx) {
  const cat = categories[catIdx];
  if (!cat) return;
  const html = `<h3>New subcategory for ${cat.name}</h3>
    <div class="fg" style="margin-top:14px"><label>Name</label>
      <input type="text" id="newSubName" placeholder="e.g. R T3-T4" autofocus></div>
    <div class="modal-acts" style="margin-top:14px">
      <button class="btn" onclick="openZonePicker()">Back</button>
      <button class="btn btn-p" onclick="confirmAddSub(${catIdx})"><i class="fas fa-check"></i> Create</button>
    </div>`;
  document.getElementById('modalContent').innerHTML = html;
  setTimeout(() => { const inp = document.getElementById('newSubName'); if (inp) inp.focus(); }, 100);
}

function confirmAddSub(catIdx) {
  const cat = categories[catIdx];
  const inp = document.getElementById('newSubName');
  const name = inp ? inp.value.trim() : '';
  if (!name) { toast('Enter a name', 'err'); return; }
  if (!cat.subs) cat.subs = [];
  cat.subs.push(name);
  createZoneFromPicker(cat.id, name, cat.color);
}

function deleteZone(zid) {
  showModal('Delete zone?', 'The zone and all its pallets will be deleted.', () => {
    zones = zones.filter(z => z.id !== zid);
    sel.zoneId = null; sel.palletId = null;
    closeEditor();
    renderAll();
    toast('Zone deleted', 'err');
  });
}

/* =================================================================
   CATEGORIES
   ================================================================= */
function openCategoryModal() {
  let html = `<h3>Categories &amp; Subcategories</h3>
    <div style="max-height:55vh;overflow-y:auto;margin:12px 0">`;
  categories.forEach((c, i) => {
    html += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-3)">
        <input type="color" value="${c.color}" style="width:26px;height:26px;padding:2px;border:1px solid var(--border);border-radius:4px;background:var(--bg-2);cursor:pointer"
          onchange="categories[${i}].color=this.value">
        <input type="text" value="${esc(c.name)}" style="flex:1;padding:5px 8px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-1);font-family:var(--font);font-size:13px"
          onchange="categories[${i}].name=this.value">
        <button class="btn btn-i btn-d" style="width:28px;height:28px;font-size:11px" onclick="removeCat(${i})"><i class="fas fa-times"></i></button>
      </div>
      <div style="padding:6px 10px;display:flex;flex-wrap:wrap;gap:4px">`;
    (c.subs || []).forEach((sub, si) => {
      html += `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:${c.color}22;border:1px solid ${c.color}44;border-radius:4px;font-size:11px;font-weight:600;color:var(--text-1)">
        ${esc(sub)}
        <i class="fas fa-times" style="font-size:8px;cursor:pointer;opacity:.5;color:var(--red)"
          onclick="removeSub(${i},${si})"></i>
      </span>`;
    });
    html += `<span style="display:inline-flex;align-items:center;padding:3px 8px;border:1px dashed var(--border);border-radius:4px;font-size:11px;cursor:pointer;color:var(--text-3)"
      onclick="promptAddSub(${i})"><i class="fas fa-plus" style="font-size:8px"></i></span>`;
    html += '</div></div>';
  });
  html += `</div>
    <button class="btn btn-g" style="width:100%;justify-content:center;margin-bottom:12px" onclick="addCat()">
      <i class="fas fa-plus"></i> New Category
    </button>
    <div class="modal-acts">
      <button class="btn btn-p" onclick="closeModal();renderAll()">Done</button>
    </div>`;
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBg').classList.add('show');
}

function addCat() {
  categories.push({ id: 'cat' + (nextCId++), name: 'New', color: randColor(), subs: [] });
  openCategoryModal();
}

function removeCat(i) {
  const cid = categories[i].id;
  categories.splice(i, 1);
  zones.forEach(z => { if (z.cat === cid) z.cat = ''; });
  openCategoryModal();
}

function removeSub(catIdx, subIdx) {
  categories[catIdx].subs.splice(subIdx, 1);
  openCategoryModal();
}

function promptAddSub(catIdx) {
  const cat = categories[catIdx];
  const html = `<h3>New subcategory for ${esc(cat.name)}</h3>
    <div class="fg" style="margin-top:14px"><label>Name</label>
      <input type="text" id="newSubNameCat" placeholder="e.g. DH10" autofocus></div>
    <div class="modal-acts" style="margin-top:14px">
      <button class="btn" onclick="openCategoryModal()">Back</button>
      <button class="btn btn-p" onclick="confirmAddSubCat(${catIdx})"><i class="fas fa-check"></i> Add</button>
    </div>`;
  document.getElementById('modalContent').innerHTML = html;
  setTimeout(() => { const inp = document.getElementById('newSubNameCat'); if (inp) inp.focus(); }, 100);
}

function confirmAddSubCat(catIdx) {
  const inp = document.getElementById('newSubNameCat');
  const name = inp ? inp.value.trim() : '';
  if (!name) { toast('Enter a name', 'err'); return; }
  if (!categories[catIdx].subs) categories[catIdx].subs = [];
  categories[catIdx].subs.push(name);
  openCategoryModal();
  toast('Subcategory "' + name + '" added', 'ok');
}

/* =================================================================
   MODAL
   ================================================================= */
let modalCb = null;
function showModal(title, text, cb) {
  document.getElementById('modalContent').innerHTML = `
    <h3>${title}</h3><p>${text}</p>
    <div class="modal-acts">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-d" onclick="modalCb&&modalCb();closeModal()">Delete</button>
    </div>`;
  modalCb = cb;
  document.getElementById('modalBg').classList.add('show');
}
function closeModal() {
  document.getElementById('modalBg').classList.remove('show');
  modalCb = null;
}
function openModalRaw(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBg').classList.add('show');
}

/* =================================================================
   SAVE / LOAD
   ================================================================= */
function saveLayout() {
  warehouseData[currentWH] = saveCurrentToSlot();
  const data = JSON.stringify({ warehouse: WH, warehouses: warehouseData, currentWH }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'warehouse-layout.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Layout saved!', 'ok');
}

function loadLayout() {
  const fi = document.getElementById('fileInput');
  fi.onchange = () => {
    const f = fi.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const d = JSON.parse(e.target.result);
        if (d.warehouses) {
          const normalized = normalizeServerLayout(d);
          warehouseData = normalized.warehouses;
          const hasLegacyThreeSlotLayout = Array.isArray(d.warehouses)
            && d.warehouses.length >= 3
            && !d.warehouses.some(slot => slot && slot.warehouse && slot.warehouse.key);
          currentWH = Number(d.currentWH || 0);
          if (hasLegacyThreeSlotLayout) currentWH = Math.max(0, currentWH - 1);
          if (![0, 1].includes(currentWH) || !warehouseData[currentWH]) {
            currentWH = warehouseData[1] ? 1 : 0;
          }
          try { localStorage.setItem('whsims.currentWH', String(currentWH)); } catch (e2) {}
          if (warehouseData[currentWH]) loadSlotToCurrent(warehouseData[currentWH]);
        } else if (d.zones) {
          const normalizedSlot = normalizeSlotToCurrentWarehouse({
            zones: d.zones,
            categories: d.categories,
            nextZId: d.nextZId,
            nextPId: d.nextPId,
            nextCId: d.nextCId,
            gasLights: d.gasLights,
            nextGLId: d.nextGLId,
            hazards: d.hazards,
            nextHZId: d.nextHZId
          }, d.warehouse);
          zones = normalizedSlot.zones || [];
          zones.forEach(z => { if (!z.tags) z.tags = []; if (z.parentId === undefined) z.parentId = null; if (!z.pallets) z.pallets = []; if (!z.segs) z.segs = []; });
          if (normalizedSlot.categories) categories = normalizedSlot.categories;
          if (normalizedSlot.nextZId) nextZId = normalizedSlot.nextZId;
          if (normalizedSlot.nextPId) nextPId = normalizedSlot.nextPId;
          if (normalizedSlot.nextCId) nextCId = normalizedSlot.nextCId;
          gasLights = normalizedSlot.gasLights || [];
          nextGLId = normalizedSlot.nextGLId || nextGLId;
          hazards = normalizedSlot.hazards || [];
          nextHZId = normalizedSlot.nextHZId || nextHZId;
          warehouseData[currentWH] = saveCurrentToSlot();
        }
        applyWarehouseTheme(currentWH);
        sel = { zoneId: null, palletId: null, segIdx: null, gasLightId: null, hazardId: null };
        closeEditor();
        renderAll();
        toast('Layout loaded!', 'ok');
      } catch (err) {
        toast('File loading error', 'err');
      }
    };
    reader.readAsText(f);
    fi.value = '';
  };
  fi.click();
}

/* =================================================================
   SIDEBAR TOGGLE
   ================================================================= */
function toggleSB() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('hide');
  document.getElementById('sbToggle').style.display = sb.classList.contains('hide') ? 'flex' : 'none';
}

/* =================================================================
   TOAST
   ================================================================= */
function toast(msg, type) {
  const c = document.getElementById('toastC');
  const icons = { ok: 'fa-check-circle', err: 'fa-times-circle', inf: 'fa-info-circle' };
  const t = document.createElement('div');
  t.className = `toast ${type || 'inf'}`;
  t.innerHTML = `<i class="fas ${icons[type] || icons.inf}"></i> ${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = 'all .3s'; }, 2200);
  setTimeout(() => t.remove(), 2600);
}

/* =================================================================
   UTILITIES
   ================================================================= */
function makeNS(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function setA(el, attrs) { for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); }
function esc(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function randColor() {
  const p = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#f43f5e','#14b8a6','#a855f7','#6366f1'];
  return p[Math.floor(Math.random() * p.length)];
}

/* =================================================================
   KEYBOARD SHORTCUTS
   ================================================================= */
document.addEventListener('keydown', e => {
  if (TUT.active) return; // let tutorial handler manage keys
  if (e.key === 'Escape') {
    if (document.body.classList.contains('pres')) { togglePresentation(); return; }
    if (document.getElementById('modalBg').classList.contains('show')) closeModal();
    else if (document.getElementById('editor').classList.contains('open')) closeEditor();
    else { sel.zoneId = null; sel.palletId = null; renderAll(); }
  }
  if (e.key === 'Delete' && sel.zoneId && !e.target.closest('input,select,textarea')) {
    if (multiSel.length > 0) {
      batchDelete();
    } else if (sel.palletId) {
      removePal(sel.zoneId, sel.palletId);
    } else {
      deleteZone(sel.zoneId);
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && sel.zoneId && !e.target.closest('input,select,textarea')) {
    e.preventDefault();
    selectAllPalletsInZone(sel.zoneId);
  }
});

// heatmap
function getHeatColor(z) {
  if (!z.capacity || z.capacity <= 0) return 'rgba(107,114,128,0.2)';
  const ratio = z.pallets.length / z.capacity;
  if (ratio <= 0) return 'rgba(34,201,151,0.15)';
  if (ratio <= 0.5) return 'rgba(34,201,151,0.4)';
  if (ratio <= 0.8) return 'rgba(240,180,41,0.4)';
  return 'rgba(239,68,68,0.45)';
}
function getHeatStroke(z) {
  if (!z.capacity || z.capacity <= 0) return '#6b7280';
  const ratio = z.pallets.length / z.capacity;
  if (ratio <= 0.5) return '#22c997';
  if (ratio <= 0.8) return '#f0b429';
  return '#ef4444';
}
function toggleHeatMap() {
  heatMapOn = !heatMapOn;
  document.getElementById('heatBtn').classList.toggle('on', heatMapOn);
  document.getElementById('hmLegend').classList.toggle('show', heatMapOn);
  renderSVG();
  toast(heatMapOn ? 'Heat map: ON' : 'Heat map: OFF', 'inf');
}

/* =================================================================
   EXPORT PNG
   ================================================================= */
function exportPNG() {
  const scale = 4;
  const pad = 40;
  const cw = (WH.w + pad * 2) * scale;
  const ch = (WH.h + pad * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.translate(pad, pad);

  const expLight = document.documentElement.classList.contains('light');
  ctx.fillStyle = expLight ? '#b5b8c8' : '#0e1019';
  ctx.fillRect(-pad, -pad, WH.w + pad * 2, WH.h + pad * 2);

  // Grid
  ctx.strokeStyle = expLight ? 'rgba(0,0,30,0.06)' : 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 0.3;
  for (let x = 0; x <= WH.w; x += 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WH.h); ctx.stroke(); }
  for (let y = 0; y <= WH.h; y += 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WH.w, y); ctx.stroke(); }

  // Warehouse border
  ctx.strokeStyle = expLight ? '#8b8ea8' : '#5c6088';
  ctx.lineWidth = 1.5;
  if (currentWH === 1) {
    // Tent-4: solid walls with door gap on top
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(T4_DOOR.x1, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(T4_DOOR.x2, 0); ctx.lineTo(WH.w, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, WH.h); ctx.lineTo(WH.w, WH.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, WH.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(WH.w, 0); ctx.lineTo(WH.w, WH.h); ctx.stroke();
    // Door dashed green on top wall
    ctx.strokeStyle = '#22c997'; ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(T4_DOOR.x1, 0); ctx.lineTo(T4_DOOR.x2, 0); ctx.stroke();
    ctx.setLineDash([]);
    // Columns
    const cols = getT4Columns();
    const half = T4_COL_SIZE / 2;
    cols.forEach(c => {
      ctx.fillStyle = '#f97316';
      ctx.fillRect(c.x - half, c.y - half, T4_COL_SIZE, T4_COL_SIZE);
      ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 0.4;
      ctx.strokeRect(c.x - half, c.y - half, T4_COL_SIZE, T4_COL_SIZE);
    });
  } else {
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(0, 0, WH.w, WH.h);
    ctx.setLineDash([]);
  }

  // Zones
  zones.forEach(z => {
    const fc = heatMapOn ? getHeatColor(z) : hexToRgba(z.color, expLight ? 0.35 : 0.22);
    const sc = heatMapOn ? getHeatStroke(z) : z.color;
    z.segs.forEach(s => {
      ctx.fillStyle = fc;
      roundRect(ctx, s.x, s.y, s.w, s.h, 2);
      ctx.fill();
      ctx.strokeStyle = sc;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    // Label
    const s = z.segs[0];
    if (s && s.w > 12 && s.h > 10) {
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + Math.min(8, s.w / z.name.length * 1.3, s.h / 2.5) + 'px Outfit, sans-serif';
      ctx.fillText(z.name, s.x + s.w / 2, s.y + Math.min(12, s.h / 2));
      // Category sublabel
      if (s.h > 22) {
        const cat = categories.find(c => c.id === z.cat);
        if (cat) {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.font = Math.min(5, s.w / 10) + 'px IBM Plex Mono, monospace';
          ctx.fillText(cat.name, s.x + s.w / 2, s.y + Math.min(20, s.h / 2 + 6));
        }
      }
      // Tags
      if (z.tags && z.tags.length > 0 && s.h > 28 && s.w > 18) {
        ctx.fillStyle = '#06b6d4';
        ctx.globalAlpha = 0.85;
        ctx.font = Math.min(3.5, s.w / 14) + 'px IBM Plex Mono, monospace';
        ctx.fillText(z.tags.join(' · '), s.x + s.w / 2, s.y + Math.min(27, s.h / 2 + 12));
        ctx.globalAlpha = 1;
      }
      if (heatMapOn && z.capacity > 0 && s.h > 30) {
        const pct = Math.round(z.pallets.length / z.capacity * 100);
        ctx.font = 'bold ' + Math.min(7, s.w / 5) + 'px IBM Plex Mono, monospace';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(pct + '%', s.x + s.w / 2, s.y + Math.min(32, s.h / 2 + 18));
      }
    }
      z.pallets.forEach(p => {
      ctx.fillStyle = expLight ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = expLight ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.6;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      if (p.w > 5 && p.h > 4) {
        ctx.fillStyle = expLight ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.7)';
        ctx.font = Math.min(4, p.w / 2.5) + 'px IBM Plex Mono, monospace';
        ctx.fillText(p.label, p.x + p.w / 2, p.y + p.h / 2 + 1);
      }
    });
      if (z.notes && z.notes.trim() && s && s.w > 12) {
      ctx.fillStyle = '#f0b429';
      ctx.beginPath();
      ctx.arc(s.x + s.w - 5, s.y + 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Gas lights in export
  (gasLights || []).forEach(gl => {
    ctx.beginPath();
    ctx.arc(gl.x, gl.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = gl.status === 'on' ? '#f0b429' : '#6b7280';
    ctx.fill();
    ctx.fillStyle = expLight ? '#444' : '#ccc';
    ctx.font = '3.5px IBM Plex Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(gl.name, gl.x, gl.y + 9);
  });

  // Hazard markers in export
  const HZ_EXP_COLORS = { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' };
  (hazards || []).forEach(hz => {
    const c = HZ_EXP_COLORS[hz.color] || '#ef4444';
    const r = 5;
    // Triangle
    ctx.beginPath();
    ctx.moveTo(hz.x, hz.y - r * 0.6);
    ctx.lineTo(hz.x - r * 0.55, hz.y + r * 0.4);
    ctx.lineTo(hz.x + r * 0.55, hz.y + r * 0.4);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    // Exclamation
    ctx.fillStyle = hz.color === 'yellow' ? '#000' : '#fff';
    ctx.font = 'bold ' + (r * 0.6) + 'px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', hz.x, hz.y + r * 0.08);
    // Label
    ctx.fillStyle = c;
    ctx.font = '3.5px IBM Plex Mono, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(hz.name, hz.x, hz.y + r * 0.4 + 2);
    ctx.textBaseline = 'alphabetic';
  });

  // Side labels
  ctx.fillStyle = expLight ? '#8b8ea8' : '#5c6088';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 8px IBM Plex Mono, monospace';
  ctx.save();
  ctx.translate(-12, WH.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('◀  BACK', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = '#6c63ff';
  ctx.translate(WH.w + 12, WH.h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('FRONT  ▶', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = 'rgba(34,201,151,0.7)';
  ctx.font = 'bold 5px IBM Plex Mono, monospace';
  ctx.translate(WH.w + 22, WH.h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('ENTRANCE', 0, 0);
  ctx.restore();
  // Dimensions
  ctx.fillStyle = expLight ? '#8b8ea8' : '#5c6088';
  ctx.font = '6px IBM Plex Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText((WH.lw||WH.w) + 'ft', WH.w / 2, -10);
  ctx.fillText((WH.lw||WH.w) + 'ft', WH.w / 2, WH.h + 4);
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = expLight ? 'rgba(30,30,60,0.25)' : 'rgba(255,255,255,0.2)';
  ctx.font = '5px IBM Plex Mono, monospace';
  ctx.fillText('WH:Sims — ' + new Date().toLocaleDateString(), WH.w / 2, WH.h + pad - 4);

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'warehouse-' + new Date().toISOString().slice(0, 10) + '.png';
    a.click();
    URL.revokeObjectURL(url);
    toast('PNG exported!', 'ok');
  }, 'image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// presentation mode
function togglePresentation() {
  document.body.classList.toggle('pres');
  const isPres = document.body.classList.contains('pres');
  if (isPres) {
    document.getElementById('presDate').textContent = new Date().toLocaleDateString('en-US');
    setTimeout(zoomFit, 100);
  } else {
    setTimeout(zoomFit, 100);
  }
}

let saveTimer = null;
let pollTimer = null;
let suppressAutoSave = false;
let googleClientId = '';
let googleAuthReady = false;
let serverVersion = 0;
let lastSavedPayload = '';
let saveInFlight = false;

function setSyncStatus(text, color) {
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncLabel');
  if (dot) dot.style.background = color;
  if (label) label.textContent = text;
}

function buildServerLayoutPayload() {
  warehouseData[currentWH] = saveCurrentToSlot();
  return {
    warehouse: WH_CONFIGS[currentWH] || WH,
    warehouses: deepClone(warehouseData).map((slot, idx) => {
      if (!slot) return slot;
      slot.warehouse = { ...WH_CONFIGS[idx] };
      return slot;
    })
  };
}

function applyServerLayout(layout) {
  if (!layout || !Array.isArray(layout.warehouses)) return false;
  const normalized = normalizeServerLayout(layout);
  warehouseData = normalized.warehouses;
  if (!warehouseData[currentWH]) currentWH = warehouseData[1] ? 1 : 0;
  try { localStorage.setItem('whsims.currentWH', String(currentWH)); } catch (e) {}
  if (warehouseData[currentWH]) loadSlotToCurrent(warehouseData[currentWH]);
  applyWarehouseTheme(currentWH);
  suppressAutoSave = true;
  try {
    renderSVG();
    renderSidebar();
    updateStats();
  } finally {
    suppressAutoSave = false;
  }
  setTimeout(zoomFit, 80);
  return true;
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_BASE + path, Object.assign({
    credentials: 'same-origin',
    headers
  }, options));

  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    data = text ? { detail: text } : null;
  }

  if (!res.ok) {
    const err = new Error((data && data.detail) || 'Request failed');
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

async function saveLayoutToServer(force = false) {
  if (!currentUser || currentUser.role === 'viewer') return;
  const payload = buildServerLayoutPayload();
  const payloadJson = JSON.stringify(payload);
  if (!force && payloadJson === lastSavedPayload) return;
  if (saveInFlight) return;

  saveInFlight = true;
  setSyncStatus('Saving...', '#f0b429');
  try {
    const data = await apiFetch('/api/layout', {
      method: 'PUT',
      body: JSON.stringify({ layout: payload, base_version: serverVersion })
    });
    serverVersion = data.version || serverVersion;
    lastSavedPayload = payloadJson;
    setSyncStatus('Synced', '#22c997');
  } catch (e) {
    console.error(e);
    setSyncStatus('Save failed', '#ef4444');
    toast('Server save failed', 'err');
  } finally {
    saveInFlight = false;
  }
}

async function loadLayoutFromServer(opts = {}) {
  if (!currentUser) return false;
  const { silent = false, seedIfEmpty = false } = opts;
  setSyncStatus('Syncing...', '#f0b429');
  try {
    const data = await apiFetch('/api/layout');
    serverVersion = data.version || 0;
    const hasRemoteLayout = data.layout && Array.isArray(data.layout.warehouses) && data.layout.warehouses.some(Boolean);

    if (hasRemoteLayout) {
      applyServerLayout(data.layout);
      lastSavedPayload = JSON.stringify(buildServerLayoutPayload());
      setSyncStatus('Synced', '#22c997');
      if (!silent) toast('Layout loaded from server', 'ok');
      return true;
    }

    if (seedIfEmpty && currentUser.role !== 'viewer') {
      await saveLayoutToServer(true);
      return true;
    }

    setSyncStatus('No server layout yet', '#6b7280');
    return false;
  } catch (e) {
    console.error(e);
    setSyncStatus('Server offline', '#ef4444');
    if (!silent) toast('Could not load server layout', 'err');
    return false;
  }
}

async function checkForRemoteUpdates() {
  if (!currentUser) return;
  try {
    const data = await apiFetch('/api/layout/meta');
    if ((data.version || 0) > serverVersion) {
      const changedByOtherUser = data.updated_by_email && currentUser && data.updated_by_email !== currentUser.email;
      await loadLayoutFromServer({ silent: true });
      if (changedByOtherUser) {
        toast('Layout updated by ' + data.updated_by_email, 'inf');
      }
    }
  } catch (e) {
    console.error(e);
    setSyncStatus('Server offline', '#ef4444');
  }
}

function startServerPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(checkForRemoteUpdates, POLL_INTERVAL_MS);
}

function stopServerPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/* =================================================================
   GAS LIGHTS
   ================================================================= */
function addGasLight() {
  const gl = {
    id: glid(),
    name: 'Light ' + nextGLId,
    x: WH.w / 2 + Math.random() * 20 - 10,
    y: WH.h / 2 + Math.random() * 20 - 10,
    status: 'on',
    notes: ''
  };
  gasLights.push(gl);
  renderAll();
  selectGasLight(gl.id);
  toast('Gas Light added', 'ok');
}

function selectGasLight(id) {
  sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: id };
  openGasLightEditor(id);
  renderSVG();
}

function openGasLightEditor(id) {
  const gl = gasLights.find(g => g.id === id);
  if (!gl) return;
  const ed = document.getElementById('editor');
  document.getElementById('edTitle').innerHTML = '<i class="fas fa-lightbulb" style="color:#f0b429"></i>&ensp;Gas Light';
  const body = document.getElementById('edBody');
  body.innerHTML = `
    <div class="fg">
      <label>Name</label>
      <input type="text" id="glName" value="${esc(gl.name)}" oninput="updateGasLight('${gl.id}','name',this.value)">
    </div>
    <div class="fg">
      <label>Status</label>
      <select id="glStatus" onchange="updateGasLight('${gl.id}','status',this.value)">
        <option value="on"${gl.status === 'on' ? ' selected' : ''}>Working</option>
        <option value="off"${gl.status === 'off' ? ' selected' : ''}>Not Working</option>
      </select>
    </div>
    <div class="fg">
      <label>Position X (ft)</label>
      <input type="number" id="glX" value="${Math.round(gl.x)}" onchange="updateGasLight('${gl.id}','x',+this.value)">
    </div>
    <div class="fg">
      <label>Position Y (ft)</label>
      <input type="number" id="glY" value="${Math.round(gl.y)}" onchange="updateGasLight('${gl.id}','y',+this.value)">
    </div>
    <div class="fg">
      <label>Notes</label>
      <textarea rows="3" style="resize:vertical" oninput="updateGasLight('${gl.id}','notes',this.value)">${esc(gl.notes || '')}</textarea>
    </div>
    <div style="padding:8px 0;margin-top:8px;border-top:1px solid var(--border)">
      <div class="gl-status" style="font-size:12px">
        <span class="gl-dot ${gl.status}"></span>
        <span>${gl.status === 'on' ? 'Operational' : 'Offline'}</span>
      </div>
    </div>
  `;
  const foot = document.getElementById('edFoot');
  foot.innerHTML = `
    <button class="btn btn-d" onclick="deleteGasLight('${gl.id}')"><i class="fas fa-trash"></i> Delete</button>
    <button class="btn btn-p" onclick="closeEditor()"><i class="fas fa-check"></i> Done</button>
  `;
  ed.classList.add('open');
}

function updateGasLight(id, field, value) {
  const gl = gasLights.find(g => g.id === id);
  if (!gl) return;
  gl[field] = value;
  renderAll();
  // re-open editor to refresh status display
  if (field === 'status') openGasLightEditor(id);
}

function deleteGasLight(id) {
  gasLights = gasLights.filter(g => g.id !== id);
  sel.gasLightId = null;
  closeEditor();
  renderAll();
  toast('Gas Light removed', 'ok');
}

// ===== HAZARD MARKERS =====
function showAddHazardModal() {
  const id = 'hz-create-' + Date.now();
  const html = `
    <h3><i class="fas fa-exclamation-triangle" style="color:#ef4444"></i> New Hazard Marker</h3>
    <div class="fg" style="margin-top:12px">
      <label>Name</label>
      <input type="text" id="${id}_name" placeholder="e.g. Roof Leak, Wet Floor..." style="font-size:14px">
    </div>
    <div class="fg">
      <label>Severity</label>
      <div style="display:flex;gap:8px;margin-top:4px">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-2);flex:1;justify-content:center">
          <input type="radio" name="${id}_color" value="red" checked style="accent-color:#ef4444"> <span style="color:#ef4444;font-weight:600;font-size:13px">🔴 Red</span>
        </label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-2);flex:1;justify-content:center">
          <input type="radio" name="${id}_color" value="yellow" style="accent-color:#f59e0b"> <span style="color:#f59e0b;font-weight:600;font-size:13px">🟡 Yellow</span>
        </label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-2);flex:1;justify-content:center">
          <input type="radio" name="${id}_color" value="green" style="accent-color:#22c55e"> <span style="color:#22c55e;font-weight:600;font-size:13px">🟢 Green</span>
        </label>
      </div>
    </div>
    <div class="fg">
      <label>Notes (optional)</label>
      <textarea id="${id}_notes" rows="3" style="resize:vertical;font-size:13px" placeholder="Describe the issue..."></textarea>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
      <button class="btn btn-p" style="flex:1;justify-content:center" onclick="doAddHazard('${id}')"><i class="fas fa-plus"></i> Create</button>
    </div>
  `;
  openModalRaw(html);
  setTimeout(() => { const inp = document.getElementById(id + '_name'); if (inp) inp.focus(); }, 100);
}

function doAddHazard(formId) {
  const nameEl = document.getElementById(formId + '_name');
  const notesEl = document.getElementById(formId + '_notes');
  const colorEl = document.querySelector('input[name="' + formId + '_color"]:checked');
  const name = (nameEl?.value || '').trim();
  if (!name) { toast('Enter a name for the hazard', 'err'); nameEl?.focus(); return; }
  const color = colorEl?.value || 'red';
  const notes = (notesEl?.value || '').trim();

  const hz = {
    id: hzid(),
    name: name,
    x: WH.w / 2 + Math.random() * 30 - 15,
    y: WH.h / 2 + Math.random() * 30 - 15,
    color: color,
    notes: notes
  };
  hazards.push(hz);
  closeModal();
  renderAll();
  selectHazard(hz.id);
  toast('Hazard "' + name + '" added', 'ok');
}

function selectHazard(id) {
  sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: null, hazardId: id };
  openHazardEditor(id);
  renderSVG();
}

function openHazardEditor(id) {
  const hz = hazards.find(h => h.id === id);
  if (!hz) return;
  const ed = document.getElementById('editor');
  const HZ_COLOR_LABELS = { red: '🔴 Critical', yellow: '🟡 Warning', green: '🟢 Info' };
  document.getElementById('edTitle').innerHTML = '<i class="fas fa-exclamation-triangle" style="color:' + ({red:'#ef4444',yellow:'#f59e0b',green:'#22c55e'}[hz.color] || '#ef4444') + '"></i>&ensp;Hazard';
  const body = document.getElementById('edBody');
  body.innerHTML = `
    <div class="fg">
      <label>Name</label>
      <input type="text" id="hzName" value="${esc(hz.name)}" oninput="updateHazard('${hz.id}','name',this.value)">
    </div>
    <div class="fg">
      <label>Severity</label>
      <select id="hzColor" onchange="updateHazard('${hz.id}','color',this.value)">
        <option value="red"${hz.color === 'red' ? ' selected' : ''}>🔴 Critical (Red)</option>
        <option value="yellow"${hz.color === 'yellow' ? ' selected' : ''}>🟡 Warning (Yellow)</option>
        <option value="green"${hz.color === 'green' ? ' selected' : ''}>🟢 Info (Green)</option>
      </select>
    </div>
    <div class="fg">
      <label>Position X (ft)</label>
      <input type="number" id="hzX" value="${Math.round(hz.x)}" onchange="updateHazard('${hz.id}','x',+this.value)">
    </div>
    <div class="fg">
      <label>Position Y (ft)</label>
      <input type="number" id="hzY" value="${Math.round(hz.y)}" onchange="updateHazard('${hz.id}','y',+this.value)">
    </div>
    <div class="fg">
      <label>Notes</label>
      <textarea rows="4" style="resize:vertical" oninput="updateHazard('${hz.id}','notes',this.value)" placeholder="Describe the issue...">${esc(hz.notes || '')}</textarea>
    </div>
    <div style="padding:8px 0;margin-top:8px;border-top:1px solid var(--border)">
      <div style="font-size:12px;display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${{red:'#ef4444',yellow:'#f59e0b',green:'#22c55e'}[hz.color] || '#ef4444'}"></span>
        <span style="font-weight:600">${HZ_COLOR_LABELS[hz.color] || hz.color}</span>
      </div>
      ${hz.notes ? '<div style="font-size:11px;color:var(--text-3);margin-top:4px;white-space:pre-wrap;max-height:80px;overflow-y:auto">' + esc(hz.notes) + '</div>' : ''}
    </div>
  `;
  const foot = document.getElementById('edFoot');
  foot.innerHTML = `
    <button class="btn btn-d" onclick="deleteHazard('${hz.id}')"><i class="fas fa-trash"></i> Delete</button>
    <button class="btn btn-p" onclick="closeEditor()"><i class="fas fa-check"></i> Done</button>
  `;
  ed.classList.add('open');
}

function updateHazard(id, field, value) {
  const hz = hazards.find(h => h.id === id);
  if (!hz) return;
  hz[field] = value;
  renderAll();
  if (field === 'color') openHazardEditor(id);
}

function deleteHazard(id) {
  const hz = hazards.find(h => h.id === id);
  const name = hz ? hz.name : 'Hazard';
  showModal('Delete hazard?', 'Remove "' + name + '" from the floor plan.', () => {
    hazards = hazards.filter(h => h.id !== id);
    sel.hazardId = null;
    closeEditor();
    renderAll();
    toast('Hazard "' + name + '" removed', 'ok');
  });
}

function startHazardDrag(e, hzId) {
  e.stopPropagation();
  selectHazard(hzId);
  const hz = hazards.find(h => h.id === hzId);
  if (!hz) return;
  interacting = true;
  const pt = s2svg(e.clientX, e.clientY);
  const off = { dx: pt.x - hz.x, dy: pt.y - hz.y };

  const onMove = ev => {
    const mp = s2svg(ev.clientX, ev.clientY);
    hz.x = Math.max(0, Math.min(WH.w, mp.x - off.dx));
    hz.y = Math.max(0, Math.min(WH.h, mp.y - off.dy));
    if (snap) { hz.x = Math.round(hz.x / 5) * 5; hz.y = Math.round(hz.y / 5) * 5; }
    renderSVG();
    showDimBadge(ev.clientX, ev.clientY, `${hz.name}: ${Math.round(hz.x)},${Math.round(hz.y)}`);
  };
  const onUp = () => {
    interacting = false;
    hideDimBadge();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    renderAll();
    openHazardEditor(hzId);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function autoSave() {
  saveLayoutToServer(false);
}

function resetToDefaults() {
  showModal('Reset everything?', 'All zones, pallets, and categories will be reset to defaults. This cannot be undone.', async () => {
    stopServerPolling();
    serverVersion = 0;
    lastSavedPayload = '';
    location.reload();
  });
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  if (suppressAutoSave || !currentUser || currentUser.role === 'viewer') return;
  saveTimer = setTimeout(autoSave, SAVE_DEBOUNCE_MS);
}

function renderAll() {
  renderSVG();
  renderSidebar();
  updateStats();
  if (!suppressAutoSave) scheduleAutoSave();
}

// init
async function init() {
  renderSVG();
  renderSidebar();
  updateStats();
  document.getElementById('snapBtn').classList.add('on');
  applyWarehouseTheme(currentWH);
  setTimeout(zoomFit, 100);
  setSyncStatus('Sign in required', '#6b7280');
  requestAnimationFrame(syncTopbarLayout);
  initGoogleAuth();
  await restoreSession();
}
init();
window.addEventListener('resize', () => {
  setTimeout(zoomFit, 50);
  requestAnimationFrame(syncTopbarLayout);
});

// tutorial
const TUT = {
  active: false,
  step: 0,
  steps: [],
  savedVB: null,
  savedSB: null,
  savedWH: null,
  animFrame: null,
  pendingTimeout: null,
};

const tutSteps = [
  {
    target: null,
    type: 'splash',
  },
  // === CANVAS & NAVIGATION ===
  {
    target: '#canvasArea',
    icon: 'fa-map',
    title: 'Your Warehouse Canvas',
    text: 'This is the interactive floor plan. <strong>Pan</strong> by clicking and dragging, <strong>zoom</strong> with the scroll wheel. Everything is rendered in real-time on an SVG canvas.',
    spotlight: 'canvas',
    zoom: { x: -20, y: -20, w: 440, h: 220 },
    cardPos: 'center',
  },
  {
    target: '#whTabs',
    icon: 'fa-layer-group',
    title: 'Tent Tabs',
    text: 'Switch between <strong>Tent\u20113</strong> (200\u00d785 ft) and <strong>Tent\u20114</strong> (800\u00d7260 ft). Each tent has its own zones, pallets, and layout saved separately.',
    spotlight: 'el',
    cardPos: 'below',
  },
  // === TENT-4 FEATURES ===
  {
    target: '#canvasArea',
    icon: 'fa-columns',
    title: 'Structural Columns (Tent\u20114)',
    text: 'Tent\u20114 has <strong>structural columns</strong> placed every 26\u2009ft across the building in 4 rows (at 50, 130, 210, and 260\u2009ft from the top). These are <strong>orange squares</strong> on the map \u2014 zone tools automatically account for them.',
    spotlight: 'canvas',
    zoom: { x: 0, y: 30, w: 120, h: 100 },
    cardPos: 'center',
    action: () => { if (currentWH !== 1) switchWarehouse(1); },
  },
  {
    target: '#canvasArea',
    icon: 'fa-door-open',
    title: 'Entrance (Tent\u20114)',
    text: 'The <strong>entrance</strong> is on the top wall between the 2nd and 3rd column (green dashed line). Dimension annotations on the right show the exact spacing between column rows: 50\u2009ft, 80\u2009ft, 80\u2009ft, 50\u2009ft.',
    spotlight: 'canvas',
    zoom: { x: 10, y: -15, w: 80, h: 60 },
    cardPos: 'center',
    action: () => { if (currentWH !== 1) switchWarehouse(1); },
  },
  // === ZONE MANAGEMENT ===
  {
    target: '.top-right .btn-g',
    icon: 'fa-plus-circle',
    title: 'Create a Zone',
    text: 'Click here to add a new zone. Pick a <strong>category</strong> and <strong>subcategory</strong>, then the zone appears on the canvas ready to be positioned and resized.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: () => {
      const z = zones[0];
      if (!z || !z.segs || !z.segs[0]) return null;
      const s = z.segs[0];
      return svgToScreen(s.x, s.y, s.w, s.h);
    },
    icon: 'fa-vector-square',
    title: 'Zones on the Canvas',
    text: 'Each colored rectangle is a <strong>zone</strong>. Click to select \u2014 drag to <strong>move</strong>, use corner handles to <strong>resize</strong>. The zone editor opens on the right with all details.',
    spotlight: 'fn',
    zoom: () => {
      const z = zones[0];
      if (!z || !z.segs[0]) return null;
      const s = z.segs[0];
      return { x: s.x - 15, y: s.y - 15, w: Math.max(s.w + 30, 80), h: Math.max(s.h + 30, 60) };
    },
    miniAnim: 'drag',
    cardPos: 'right',
  },
  {
    target: '#canvasArea',
    icon: 'fa-sitemap',
    title: 'Parent & Child Zones',
    text: 'In the zone editor, assign a <strong>Parent Zone</strong> to nest zones inside containers. When you drag a parent zone, all its <strong>child zones move together</strong> \u2014 keeping your layout organized.',
    spotlight: 'canvas',
    cardPos: 'center',
  },
  // === PALLET TOOLS ===
  {
    target: '#canvasArea',
    icon: 'fa-pallet',
    title: 'Pallet Capacity Calculator',
    text: 'In Tent\u20114, the zone editor shows a <strong>MAX PALLETS</strong> box \u2014 how many 4\u00d74\u2009ft pallets fit, with columns automatically excluded. Hit <strong>Set as Capacity</strong> to use this number for heatmap tracking.',
    spotlight: 'canvas',
    cardPos: 'center',
  },
  {
    target: '#canvasArea',
    icon: 'fa-th',
    title: 'Quick Fill, Batch Add & Row Fill',
    text: 'Three ways to add pallets: <strong>Quick Fill</strong> auto-generates a grid, <strong>Batch Add</strong> lets you name each pallet, and <strong>Row Fill</strong> creates organized rows. In Tent\u20114, all three skip column positions automatically.',
    spotlight: 'canvas',
    cardPos: 'center',
  },
  // === SIDEBAR & STATS ===
  {
    target: '#sidebar',
    icon: 'fa-list',
    title: 'Zone Sidebar',
    text: 'All your zones listed by category. Click a zone name to <strong>fly to it</strong> on the canvas. Use the search bar to quickly find any zone.',
    spotlight: 'el',
    cardPos: 'right',
    action: () => {
      const sb = document.getElementById('sidebar');
      if (sb.classList.contains('hide')) toggleSB();
    },
  },
  {
    target: '#sbStats',
    icon: 'fa-chart-bar',
    title: 'Statistics Panel',
    text: 'Live stats at the bottom: <strong>total zones</strong>, <strong>pallets</strong>, <strong>capacity usage</strong>. In Tent\u20114, a <strong>columns</strong> chip in the top bar shows the total structural column count.',
    spotlight: 'el',
    cardPos: 'right',
    action: () => {
      const sb = document.getElementById('sidebar');
      if (sb.classList.contains('hide')) toggleSB();
    },
  },
  // === TOOLS & FEATURES ===
  {
    target: '.top-right .btn[title="Categories"]',
    icon: 'fa-tags',
    title: 'Category Manager',
    text: 'Organize zones into <strong>categories</strong> with custom colors. Add, edit, or remove categories and subcategories. Zones inherit their category\'s color scheme.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: '.ctb',
    icon: 'fa-tools',
    title: 'Canvas Toolbar',
    text: '<strong>Zoom in/out</strong>, <strong>fit to screen</strong>, toggle <strong>snap-to-grid</strong> for precise alignment, and activate the <strong>heat map</strong> to visualize capacity usage by color.',
    spotlight: 'el',
    cardPos: 'above',
  },
  {
    target: '#heatBtn',
    icon: 'fa-fire',
    title: 'Heat Map Mode',
    text: 'Toggle the heat map to see capacity at a glance: <span style="color:#22c997">\u25cf Green</span> = under 50%, <span style="color:#f0b429">\u25cf Yellow</span> = 51\u201380%, <span style="color:#ef4444">\u25cf Red</span> = over 80%.',
    spotlight: 'el',
    cardPos: 'above',
  },
  {
    target: '.top-right .btn[title="Export PNG"]',
    icon: 'fa-camera',
    title: 'Export as Image',
    text: 'Capture the entire layout as a <strong>high-resolution PNG</strong> \u2014 including columns and entrance for Tent\u20114. Perfect for sharing or printing.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: '.top-right .btn[title="Presentation"]',
    icon: 'fa-tv',
    title: 'Presentation Mode',
    text: 'Hides all UI for a <strong>clean, full-screen view</strong>. Great for meetings or warehouse monitors. Press <strong>Esc</strong> to exit.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: '.top-right .btn[title="Save"]',
    icon: 'fa-save',
    title: 'Save & Load',
    text: 'Download your layout as a <strong>JSON file</strong> for backup, or load a previously saved file. Data also auto-saves locally in your browser.',
    spotlight: 'el',
    cardPos: 'below',
  },
  // === KEYBOARD SHORTCUTS ===
  {
    target: '#canvasArea',
    icon: 'fa-keyboard',
    title: 'Keyboard Shortcuts',
    text: '<strong>Delete</strong> \u2014 remove selected zone or pallet<br><strong>Ctrl+A</strong> \u2014 select all pallets in a zone<br><strong>Escape</strong> \u2014 close editor / exit presentation<br><strong>\u2190 \u2192</strong> \u2014 navigate this tutorial',
    spotlight: 'canvas',
    cardPos: 'center',
  },
  {
    target: null,
    type: 'finish',
  },
];

function svgToScreen(sx, sy, sw, sh) {
  const svgEl = document.getElementById('svg');
  const r = svgEl.getBoundingClientRect();
  const scX = r.width / vb.w;
  const scY = r.height / vb.h;
  return {
    left: r.left + (sx - vb.x) * scX,
    top: r.top + (sy - vb.y) * scY,
    width: sw * scX,
    height: sh * scY,
  };
}

function animateVB(targetVB, duration, cb) {
  const start = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
  const t0 = performance.now();
  const dur = duration || 700;
  function frame(ts) {
    const p = Math.min(1, (ts - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
    vb.x = start.x + (targetVB.x - start.x) * e;
    vb.y = start.y + (targetVB.y - start.y) * e;
    vb.w = start.w + (targetVB.w - start.w) * e;
    vb.h = start.h + (targetVB.h - start.h) * e;
    const svgEl = document.getElementById('svg');
    const r = svgEl.getBoundingClientRect();
    zoom = r.width / vb.w;
    applyVB();
    if (p < 1) {
      TUT.animFrame = requestAnimationFrame(frame);
    } else {
      if (cb) cb();
    }
  }
  if (TUT.animFrame) cancelAnimationFrame(TUT.animFrame);
  TUT.animFrame = requestAnimationFrame(frame);
}

function fitVBToAspect(tvb) {
  const svgEl = document.getElementById('svg');
  const r = svgEl.getBoundingClientRect();
  const asp = r.width / r.height;
  const vAsp = tvb.w / tvb.h;
  const out = { ...tvb };
  if (asp > vAsp) {
    const nw = tvb.h * asp;
    out.x -= (nw - tvb.w) / 2; out.w = nw;
  } else {
    const nh = tvb.w / asp;
    out.y -= (nh - tvb.h) / 2; out.h = nh;
  }
  return out;
}

function positionSpotlight(rect) {
  const hole = document.getElementById('tutSpotlightHole');
  if (!rect) {
    hole.setAttribute('x', -9999);
    hole.setAttribute('y', -9999);
    hole.setAttribute('width', 0);
    hole.setAttribute('height', 0);
    return;
  }
  const pad = 6;
  hole.setAttribute('x', rect.left - pad);
  hole.setAttribute('y', rect.top - pad);
  hole.setAttribute('width', rect.width + pad * 2);
  hole.setAttribute('height', rect.height + pad * 2);
  hole.setAttribute('rx', 10);
  hole.setAttribute('ry', 10);
}

function positionPulse(rect) {
  const p = document.getElementById('tutPulse');
  if (!rect) { p.classList.remove('active'); return; }
  const pad = 6;
  p.style.left = (rect.left - pad) + 'px';
  p.style.top = (rect.top - pad) + 'px';
  p.style.width = (rect.width + pad * 2) + 'px';
  p.style.height = (rect.height + pad * 2) + 'px';
  p.classList.add('active');
}

function positionCard(rect, pos) {
  const card = document.getElementById('tutCard');
  const cw = 340;
  const ch = card.offsetHeight || 220;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left, top;

  if (!rect || pos === 'center') {
    left = Math.max(16, (vw - cw) / 2);
    top = Math.max(80, (vh - ch) / 2);
  } else if (pos === 'below') {
    left = Math.max(16, Math.min(vw - cw - 16, rect.left + rect.width / 2 - cw / 2));
    top = rect.top + rect.height + 16;
    if (top + ch > vh - 20) top = rect.top - ch - 16;
  } else if (pos === 'above') {
    left = Math.max(16, Math.min(vw - cw - 16, rect.left + rect.width / 2 - cw / 2));
    top = rect.top - ch - 16;
    if (top < 60) top = rect.top + rect.height + 16;
  } else if (pos === 'right') {
    left = rect.left + rect.width + 16;
    top = Math.max(60, rect.top + rect.height / 2 - ch / 2);
    if (left + cw > vw - 16) { left = rect.left - cw - 16; }
    if (left < 16) { left = 16; top = rect.top + rect.height + 16; }
  } else if (pos === 'left') {
    left = rect.left - cw - 16;
    top = Math.max(60, rect.top + rect.height / 2 - ch / 2);
    if (left < 16) { left = rect.left + rect.width + 16; }
  }

  left = Math.max(16, Math.min(vw - cw - 16, left));
  top = Math.max(60, Math.min(vh - ch - 16, top));

  card.style.left = left + 'px';
  card.style.top = top + 'px';
}

function renderDots() {
  const c = document.getElementById('tutDots');
  let h = '';
  for (let i = 0; i < tutSteps.length; i++) {
    if (tutSteps[i].type === 'splash' || tutSteps[i].type === 'finish') continue;
    const cls = (i < TUT.step) ? 'done' : (i === TUT.step) ? 'cur' : '';
    h += '<div class="tut-dot ' + cls + '"></div>';
  }
  c.innerHTML = h;
}

function hideMiniAnim() {
  const gz = document.getElementById('tutGhostZone');
  const gc = document.getElementById('tutGhostCursor');
  gz.classList.remove('animate'); gz.style.opacity = '0';
  gc.classList.remove('animate'); gc.style.opacity = '0';
}

function showDragAnim(rect) {
  if (!rect) return;
  const gz = document.getElementById('tutGhostZone');
  const gc = document.getElementById('tutGhostCursor');
  gz.style.left = (rect.left + 4) + 'px';
  gz.style.top = (rect.top + 4) + 'px';
  gz.style.width = Math.min(rect.width * 0.5, 60) + 'px';
  gz.style.height = Math.min(rect.height * 0.5, 40) + 'px';
  gc.style.left = (rect.left + Math.min(rect.width * 0.3, 40)) + 'px';
  gc.style.top = (rect.top + Math.min(rect.height * 0.3, 30)) + 'px';
  setTimeout(() => { gz.classList.add('animate'); gc.classList.add('animate'); }, 300);
}

function showStep(idx) {
  if (!TUT.active && idx !== 0) return; // guard against stale callbacks
  TUT.step = idx;
  const step = tutSteps[idx];
  if (!step) { endTutorial(); return; }

  const overlay = document.getElementById('tutOverlay');
  const card = document.getElementById('tutCard');
  const splash = document.getElementById('tutSplash');

  hideMiniAnim();

  if (step.type === 'splash') {
    card.classList.remove('show');
    overlay.classList.remove('active');
    document.getElementById('tutProgress').classList.remove('active');
    document.getElementById('tutCounter').classList.remove('active');
    document.getElementById('tutPulse').classList.remove('active');
    positionSpotlight(null);

    splash.querySelector('.tut-splash-box').innerHTML = '' +
      '<div class="tut-splash-icon"><i class="fas fa-graduation-cap"></i></div>' +
      '<h2>Welcome to WH:Sims</h2>' +
      '<p>Let\u2019s take a quick tour of your warehouse management tool. You\u2019ll learn how to create zones, manage pallets, and keep everything organized.</p>' +
      '<button class="tut-splash-start" onclick="tutNext()"><i class="fas fa-rocket"></i> Start Tour</button>' +
      '<br><button class="tut-nav-skip" onclick="endTutorial()" style="margin-top:12px">Skip tutorial</button>';
    splash.classList.add('active');
    return;
  }
  if (step.type === 'finish') {
    card.classList.remove('show');
    overlay.classList.remove('active');
    document.getElementById('tutPulse').classList.remove('active');
    document.getElementById('tutProgress').classList.remove('active');
    document.getElementById('tutCounter').classList.remove('active');
    positionSpotlight(null);
    hideMiniAnim();

    splash.querySelector('.tut-splash-box').innerHTML = '' +
      '<div class="tut-splash-icon"><i class="fas fa-check-circle"></i></div>' +
      '<h2>You\u2019re All Set!</h2>' +
      '<p>You now know the essentials of WH:Sims. Start building your layout \u2014 create zones, add pallets, and organize your warehouse.</p>' +
      '<p style="font-size:12px;color:var(--text-3);margin-top:8px">You can restart this tour anytime with the <i class="fas fa-graduation-cap" style="color:var(--cyan)"></i> button.</p>' +
      '<button class="tut-splash-start" onclick="endTutorial()"><i class="fas fa-warehouse"></i> Let\u2019s Go!</button>';
    splash.classList.add('active');
    return;
  }

  splash.classList.remove('active');

  overlay.classList.add('active');
  document.getElementById('tutProgress').classList.add('active');
  document.getElementById('tutCounter').classList.add('active');

  if (step.action) step.action();

  const realCount = tutSteps.filter(s => s.type !== 'splash' && s.type !== 'finish').length;
  const realIdx = tutSteps.slice(0, idx).filter(s => s.type !== 'splash' && s.type !== 'finish').length;
  const pct = ((realIdx + 1) / realCount * 100);
  document.getElementById('tutProgressFill').style.width = pct + '%';
  document.getElementById('tutCounter').textContent = (realIdx + 1) + ' / ' + realCount;

  renderDots();

  document.getElementById('tutBack').style.visibility = (idx <= 1) ? 'hidden' : 'visible';

  const isLast = (idx >= tutSteps.length - 2);
  document.getElementById('tutNext').innerHTML = isLast
    ? 'Finish <i class="fas fa-check"></i>'
    : 'Next <i class="fas fa-arrow-right"></i>';

  const doAfterZoom = () => {
    if (!TUT.active) return; // tutorial was ended during animation
    let rect = null;

    if (step.spotlight === 'el') {
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    } else if (step.spotlight === 'fn' && typeof step.target === 'function') {
      rect = step.target();
    } else if (step.spotlight === 'canvas') {
      const ca = document.getElementById('canvasArea');
      const r = ca.getBoundingClientRect();
      rect = { left: r.left + 20, top: r.top + 20, width: r.width - 40, height: r.height - 40 };
    }

    positionSpotlight(rect);
    positionPulse(rect);

    document.getElementById('tutCardIcon').innerHTML = '<i class="fas ' + step.icon + '"></i>';
    document.getElementById('tutCardTitle').textContent = step.title;
    document.getElementById('tutCardText').innerHTML = step.text;

    card.classList.remove('show');
    TUT.pendingTimeout = setTimeout(() => {
      if (!TUT.active) return;
      positionCard(rect, step.cardPos);
      card.classList.add('show');
    }, 80);

    if (step.miniAnim === 'drag' && rect) {
      setTimeout(() => { if (TUT.active) showDragAnim(rect); }, 500);
    }
  };

  if (step.zoom) {
    let targetVB = typeof step.zoom === 'function' ? step.zoom() : step.zoom;
    if (targetVB) {
      targetVB = fitVBToAspect(targetVB);
      card.classList.remove('show');
      positionSpotlight(null);
      positionPulse(null);
      animateVB(targetVB, 700, () => {
        TUT.pendingTimeout = setTimeout(doAfterZoom, 100);
      });
    } else {
      doAfterZoom();
    }
  } else {
    doAfterZoom();
  }
}

function tutNext() {
  if (TUT.step < tutSteps.length - 1) {
    showStep(TUT.step + 1);
  } else {
    endTutorial();
  }
}
function tutPrev() {
  if (TUT.step > 1) {
    showStep(TUT.step - 1);
  }
}

function startTutorial() {
  if (TUT.active) return;
  TUT.active = true;
  TUT.step = 0;
  TUT.savedVB = { ...vb };
  TUT.savedWH = currentWH;
  TUT.savedSB = !document.getElementById('sidebar').classList.contains('hide');
  closeEditor();
  showStep(0);
}

function endTutorial() {
  TUT.active = false;

  // cancel pending animations/timeouts
  if (TUT.animFrame) { cancelAnimationFrame(TUT.animFrame); TUT.animFrame = null; }
  if (TUT.pendingTimeout) { clearTimeout(TUT.pendingTimeout); TUT.pendingTimeout = null; }

  const overlay = document.getElementById('tutOverlay');
  const card = document.getElementById('tutCard');
  const splash = document.getElementById('tutSplash');
  const progress = document.getElementById('tutProgress');
  const counter = document.getElementById('tutCounter');
  const pulse = document.getElementById('tutPulse');

  card.classList.remove('show');
  overlay.classList.remove('active');
  splash.classList.remove('active');
  progress.classList.remove('active');
  counter.classList.remove('active');
  pulse.classList.remove('active');
  positionSpotlight(null);
  hideMiniAnim();

  // restore warehouse if changed
  if (TUT.savedWH !== null && TUT.savedWH !== currentWH) {
    switchWarehouse(TUT.savedWH);
  }
  // restore sidebar state
  const sbVisible = !document.getElementById('sidebar').classList.contains('hide');
  if (TUT.savedSB !== null && TUT.savedSB !== sbVisible) {
    toggleSB();
  }

  if (TUT.savedVB) {
    animateVB(fitVBToAspect(TUT.savedVB), 600);
  }
}

document.addEventListener('keydown', (e) => {
  if (!TUT.active) return;
  if (e.key === 'Escape') { endTutorial(); e.preventDefault(); }
  if (e.key === 'ArrowRight' || e.key === 'Enter') { tutNext(); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { tutPrev(); e.preventDefault(); }
});

/* =================================================================
   AUTH — Google Sign-In + Role System
   ================================================================= */

let currentUser = null; // { email, name, picture, role }
const ROLE_LABELS = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

function applyRole(role) {
  document.body.classList.remove('role-admin', 'role-editor', 'role-viewer');
  document.body.classList.add('role-' + role);
}

function updateUserUI() {
  if (!currentUser) return;
  const badge = document.getElementById('userBadge');
  const avatar = document.getElementById('userAvatar');
  const badgeName = document.getElementById('userBadgeName');
  badge.style.display = 'flex';

  const firstName = (currentUser.name || 'User').split(' ')[0];
  badgeName.textContent = firstName;

  if (currentUser.picture) {
    avatar.outerHTML = '<img id="userAvatar" src="' + currentUser.picture + '" referrerpolicy="no-referrer">';
  } else {
    avatar.textContent = (currentUser.name || 'U')[0].toUpperCase();
  }

  document.getElementById('umName').textContent = currentUser.name || 'User';
  document.getElementById('umEmail').textContent = currentUser.email || '';

  const roleTag = document.getElementById('umRole');
  roleTag.textContent = ROLE_LABELS[currentUser.role] || currentUser.role;
  roleTag.className = 'role-tag ' + currentUser.role;

  document.getElementById('umAdminBtn').style.display = currentUser.role === 'admin' ? 'flex' : 'none';

  applyRole(currentUser.role);
  requestAnimationFrame(syncTopbarLayout);
}

async function finalizeLogin(user, opts = {}) {
  currentUser = user;
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('loginWaiting').style.display = 'none';
  updateUserUI();
  await loadLayoutFromServer({ silent: !!opts.silent, seedIfEmpty: true });
  startServerPolling();
  if (!opts.silent) toast('Signed in as ' + currentUser.name, 'ok');
}

async function restoreSession() {
  try {
    const data = await apiFetch('/api/me');
    if (data && data.user) {
      await finalizeLogin(data.user, { silent: true });
      return true;
    }
  } catch (e) {
    if (e.status !== 401) {
      console.error(e);
      toast('Could not restore session', 'err');
    }
  }
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('loginWaiting').style.display = 'none';
  setSyncStatus('Sign in required', '#6b7280');
  return false;
}

async function handleGoogleCredential(response) {
  document.getElementById('loginWaiting').style.display = 'block';
  try {
    const data = await apiFetch('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: response.credential })
    });
    await finalizeLogin(data.user);
  } catch (e) {
    console.error(e);
    document.getElementById('loginWaiting').style.display = 'none';
    toast(e.message || 'Google login error', 'err');
  }
}

function doGoogleLogin() {
  if (!googleAuthReady || typeof google === 'undefined' || !google.accounts) {
    toast('Google login is not configured yet', 'err');
    return;
  }
  google.accounts.id.prompt();
}

function doDemoLogin() {
  toast('Demo mode is disabled in the server build', 'inf');
}

async function doLogout() {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (e) {
    console.error(e);
  }
  stopServerPolling();
  currentUser = null;
  serverVersion = 0;
  lastSavedPayload = '';
  document.getElementById('userBadge').style.display = 'none';
  document.getElementById('userMenu').classList.remove('open');
  document.body.classList.remove('role-admin', 'role-editor', 'role-viewer');
  document.getElementById('loginOverlay').style.display = 'flex';
  setSyncStatus('Signed out', '#6b7280');
  requestAnimationFrame(syncTopbarLayout);
  toast('Signed out', 'inf');
}

function toggleUserMenu() {
  const m = document.getElementById('userMenu');
  m.classList.toggle('open');
}

// close menu on outside click
document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  const badge = document.getElementById('userBadge');
  if (menu.classList.contains('open') && !menu.contains(e.target) && !badge.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// admin panel
async function openAdminPanel() {
  document.getElementById('userMenu').classList.remove('open');
  let users = [];
  try {
    const data = await apiFetch('/api/users');
    users = data.users || [];
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not load users', 'err');
    return;
  }
  let html = '<h3><i class="fas fa-users-cog"></i> User Management</h3>';
  html += '<p style="font-size:12px;color:var(--text-3);margin-bottom:12px">First registered user = Admin. Change roles below.</p>';
  html += '<div style="max-height:55vh;overflow-y:auto;margin:8px 0">';

  if (users.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-3)">No users yet</div>';
  }
  users.forEach(u => {
    const email = u.email;
    const initial = (u.name || email[0]).charAt(0).toUpperCase();
    const isCurrent = currentUser && currentUser.email === email;
    const avatarHtml = u.picture
      ? '<img src="' + u.picture + '" referrerpolicy="no-referrer" style="width:32px;height:32px;border-radius:50%">'
      : '<div class="ub-fallback">' + initial + '</div>';

    html += '<div class="admin-user-row">';
    html += avatarHtml;
    html += '<div class="aur-info"><div class="aur-name">' + esc(u.name || email) + (isCurrent ? ' <span style="color:var(--cyan);font-size:9px">(you)</span>' : '') + '</div>';
    html += '<div class="aur-email">' + esc(email) + '</div></div>';
    html += '<select data-email="' + esc(email) + '" onchange="changeUserRole(this.dataset.email, this.value)">';
    ['admin','editor','viewer'].forEach(r => {
      html += '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>';
    });
    html += '</select></div>';
  });

  html += '</div>';
  html += '<div class="modal-acts"><button class="btn btn-p" onclick="closeModal();renderAll()"><i class="fas fa-check"></i> Done</button></div>';

  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBg').classList.add('show');
}

async function changeUserRole(email, role) {
  try {
    const data = await apiFetch('/api/users/' + encodeURIComponent(email) + '/role', {
      method: 'PATCH',
      body: JSON.stringify({ role })
    });
    if (currentUser && currentUser.email === email) {
      currentUser.role = data.user.role;
      updateUserUI();
    }
    toast((data.user.name || email) + ' → ' + ROLE_LABELS[role], 'ok');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not change role', 'err');
  }
}

async function initGoogleAuth() {
  document.getElementById('loginDemoBtn').style.display = 'none';
  const loginBtnHost = document.getElementById('loginGoogleBtn');

  try {
    const cfg = await apiFetch('/api/config');
    googleClientId = cfg.google_client_id || '';
  } catch (e) {
    console.error(e);
    if (loginBtnHost) loginBtnHost.innerHTML = '<div style="font-size:12px;color:var(--text-3)">Backend config not reachable</div>';
    return;
  }

  if (!googleClientId) {
    if (loginBtnHost) loginBtnHost.innerHTML = '<div style="font-size:12px;color:var(--text-3)">Set GOOGLE_CLIENT_ID in .env first</div>';
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => {
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
      auto_select: false
    });
    let target = loginBtnHost;
    if (loginBtnHost && loginBtnHost.tagName === 'BUTTON') {
      const wrap = document.createElement('div');
      wrap.id = 'loginGoogleBtnWrap';
      wrap.style.display = 'inline-flex';
      loginBtnHost.replaceWith(wrap);
      target = wrap;
    }
    if (target) {
      google.accounts.id.renderButton(
        target,
        { theme: 'outline', size: 'large', width: 280, text: 'signin_with' }
      );
    }
    googleAuthReady = true;
  };
  script.onerror = () => {
    if (loginBtnHost) loginBtnHost.innerHTML = '<div style="font-size:12px;color:var(--text-3)">Google SDK failed to load</div>';
  };
  document.head.appendChild(script);
}
