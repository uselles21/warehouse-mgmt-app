// state
const LEGACY_WH = { w: 400, h: 180, unit: 'ft' };
const WH_CONFIGS = [
  { key: 'tent3', name: 'Tent-3', w: 400, h: 180, lw: 200, lh: 85, unit: 'ft' },
  { key: 'tent4', name: 'Tent-4', w: 800, h: 360, lw: 400, lh: 170, unit: 'ft' },
];
let WH = { ...WH_CONFIGS[0] };
const LABEL_WH = { w: 200, h: 85 };
const DEFAULT_PALLET = { w: 4, h: 4 };
const API_BASE = '';
const SAVE_DEBOUNCE_MS = 2000;
const POLL_INTERVAL_MS = 3000;

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

let gasLights = [];
let nextGLId = 1;
function glid() { return 'gl' + (nextGLId++); }

let notes = [];
let nextNoteId = 1;
let addingNote = false;
function nid() { return 'n' + (nextNoteId++); }

function zid() { return 'z' + (nextZId++); }
function pid() { return 'p' + (nextPId++); }

function round1(v) { return Math.round(v * 10) / 10; }

function scaleSlotToWarehouse(slot, fromWH, toWH) {
  if (!slot) return slot;
  if (!fromWH || !toWH || !fromWH.w || !fromWH.h || (fromWH.w === toWH.w && fromWH.h === toWH.h)) {
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
  (scaled.notes || []).forEach(n => {
    n.x = round1((n.x || 0) * sx);
    n.y = round1((n.y || 0) * sy);
  });
  return scaled;
}

function getSlotExtent(slot) {
  let maxX = 0, maxY = 0;
  if (!slot || !slot.zones) return { maxX, maxY };
  (slot.zones || []).forEach(z => {
    (z.segs || []).forEach(s => {
      maxX = Math.max(maxX, s.x + s.w);
      maxY = Math.max(maxY, s.y + s.h);
    });
    (z.pallets || []).forEach(p => {
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    });
  });
  return { maxX, maxY };
}

function normalizeSlotForCurrentWarehouse(slot, srcWarehouse) {
  if (!slot) return slot;
  const source = (srcWarehouse && srcWarehouse.w && srcWarehouse.h) ? srcWarehouse : null;
  if (source && (Math.abs(source.w - WH.w) > 0.1 || Math.abs(source.h - WH.h) > 0.1)) {
    return scaleSlotToWarehouse(slot, source, WH);
  }
  const extent = getSlotExtent(slot);
  if (extent.maxX > WH.w + 20 || extent.maxY > WH.h + 10) {
    return scaleSlotToWarehouse(slot, LEGACY_WH, WH);
  }
  return JSON.parse(JSON.stringify(slot));
}

let zones = [
  { id:zid(), name:'Prestaging', cat:'staging', color:'#ec4899',
    segs:[{x:5,y:5,w:35,h:170}], pallets:[], capacity:12, boxes:0 },
  { id:zid(), name:'DH11', cat:'dh', color:'#22c997',
    segs:[{x:45,y:5,w:80,h:80}], pallets:makePals(45,5,80,80,'L',9), capacity:12, boxes:0 },
  { id:zid(), name:'DH9', cat:'dh', color:'#10b981',
    segs:[{x:45,y:90,w:60,h:85},{x:105,y:120,w:30,h:55}], pallets:makePals(45,90,60,85,'L',8), capacity:12, boxes:0 },
  { id:zid(), name:'AEC-1', cat:'aec', color:'#8b5cf6',
    segs:[{x:130,y:5,w:50,h:50}], pallets:makePals(130,5,50,50,'A',4), capacity:8, boxes:0 },
  { id:zid(), name:'AEC-2', cat:'aec', color:'#a78bfa',
    segs:[{x:130,y:60,w:50,h:50}], pallets:makePals(130,60,50,50,'A',4), capacity:8, boxes:0 },
  { id:zid(), name:'DH9 Copper', cat:'dh', color:'#f59e0b',
    segs:[{x:130,y:115,w:50,h:60}], pallets:makePals(130,115,50,60,'C',3), capacity:6, boxes:0 },
  { id:zid(), name:'R T1-T2', cat:'roce', color:'#3b82f6',
    segs:[{x:185,y:5,w:50,h:42}], pallets:[], capacity:6, boxes:0 },
  { id:zid(), name:'R T2-T3', cat:'roce', color:'#60a5fa',
    segs:[{x:185,y:52,w:50,h:42}], pallets:[], capacity:6, boxes:0 },
  { id:zid(), name:'S AS T-1', cat:'sis', color:'#f97316',
    segs:[{x:185,y:99,w:50,h:38}], pallets:[], capacity:6, boxes:0 },
  { id:zid(), name:'S T1-T2', cat:'sis', color:'#fb923c',
    segs:[{x:185,y:142,w:50,h:33}], pallets:[], capacity:6, boxes:0 },
  { id:zid(), name:'S T2-T3', cat:'sis', color:'#fdba74',
    segs:[{x:240,y:5,w:50,h:42}], pallets:[], capacity:6, boxes:0 },
  { id:zid(), name:'NVS-NVM', cat:'nvs', color:'#eab308',
    segs:[{x:240,y:52,w:50,h:38}], pallets:[], capacity:6, boxes:0 },
  { id:zid(), name:'NVS-NVB', cat:'nvs', color:'#facc15',
    segs:[{x:240,y:95,w:50,h:38}], pallets:[], capacity:6, boxes:0 },
  { id:zid(), name:'NVS-KS', cat:'nvs', color:'#fde047',
    segs:[{x:240,y:138,w:50,h:37}], pallets:[], capacity:6, boxes:0 },
  { id:zid(), name:'DEV-EM', cat:'special', color:'#06b6d4',
    segs:[{x:295,y:5,w:50,h:42}], pallets:[], capacity:4, boxes:0 },
  { id:zid(), name:'GPU-MS', cat:'special', color:'#22d3ee',
    segs:[{x:295,y:52,w:50,h:42}], pallets:[], capacity:4, boxes:0 },
  { id:zid(), name:'SPARES', cat:'special', color:'#67e8f9',
    segs:[{x:295,y:99,w:50,h:38}], pallets:[], capacity:8, boxes:0 },
  { id:zid(), name:'IPMI CAT6', cat:'special', color:'#a5f3fc',
    segs:[{x:295,y:142,w:50,h:33}], pallets:[], capacity:4, boxes:0 },
  { id:zid(), name:'TDS QC Area', cat:'ops', color:'#f472b6',
    segs:[{x:350,y:5,w:45,h:42}], pallets:[], capacity:4, boxes:0 },
  { id:zid(), name:'TDS Labeling', cat:'ops', color:'#f9a8d4',
    segs:[{x:350,y:52,w:45,h:38}], pallets:[], capacity:4, boxes:0 },
  { id:zid(), name:'Jeda Labeling', cat:'ops', color:'#fbcfe8',
    segs:[{x:350,y:95,w:45,h:38}], pallets:[], capacity:4, boxes:0 },
  { id:zid(), name:'Leadership', cat:'ops', color:'#e879f9',
    segs:[{x:350,y:138,w:45,h:37}], pallets:[], capacity:0, boxes:0 },
  { id:zid(), name:'Network Rack', cat:'infra', color:'#6b7280',
    segs:[{x:185,y:142,w:0,h:0}], pallets:[], capacity:2, boxes:0 },
  { id:zid(), name:'Quad Outlet', cat:'infra', color:'#9ca3af',
    segs:[{x:0,y:0,w:0,h:0}], pallets:[], capacity:0, boxes:0 },
  { id:zid(), name:'Power Area', cat:'infra', color:'#ef4444',
    segs:[{x:0,y:0,w:0,h:0}], pallets:[], capacity:0, boxes:0 },
];

zones[zones.length - 3].segs = [{x:350,y:5,w:0,h:0}]; // Will be placed by user
zones[zones.length - 2].segs = [{x:350,y:5,w:0,h:0}];
zones[zones.length - 1].segs = [{x:350,y:5,w:0,h:0}];

zones.forEach((z, i) => {
  z.segs.forEach(s => {
    if (s.w === 0) {
      s.x = 185 + Math.floor(i % 3) * 55;
      s.y = 142;
      s.w = 45;
      s.h = 33;
    }
  });
});

const infraZones = zones.filter(z => z.cat === 'infra');
infraZones.forEach((z, i) => {
  z.segs[0] = { x: 5, y: 5, w: 30, h: 25 }; // Will overlap with prestaging, user repositions
});
if (infraZones.length >= 1) infraZones[0].segs[0] = {x:295, y:142, w:50, h:33};
if (infraZones.length >= 2) infraZones[1].segs[0] = {x:130, y:142, w:50, h:33};
if (infraZones.length >= 3) infraZones[2].segs[0] = {x:65, y:142, w:55, h:33};

({ zones } = normalizeSlotToCurrentWarehouse({ zones }, LEGACY_WH));

zones.forEach(z => { if (!z.tags) z.tags = []; if (z.parentId === undefined) z.parentId = null; if (!z.pallets) z.pallets = []; if (!z.segs) z.segs = []; });

if (WH.w !== LEGACY_WH.w || WH.h !== LEGACY_WH.h) {
  const scaledDefaults = normalizeSlotForCurrentWarehouse({ zones, categories, nextZId, nextPId, nextCId }, LEGACY_WH);
  zones = scaledDefaults.zones || zones;
  categories = scaledDefaults.categories || categories;
  nextZId = scaledDefaults.nextZId || nextZId;
  nextPId = scaledDefaults.nextPId || nextPId;
  nextCId = scaledDefaults.nextCId || nextCId;
}

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

function round1(v) { return Math.round(v * 10) / 10; }

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function inferWarehouseFromSlot(slot) {
  if (!slot || !Array.isArray(slot.zones) || slot.zones.length === 0) return WH;
  let maxX = 0, maxY = 0;
  slot.zones.forEach(z => {
    (z.segs || []).forEach(s => {
      maxX = Math.max(maxX, (s.x || 0) + (s.w || 0));
      maxY = Math.max(maxY, (s.y || 0) + (s.h || 0));
    });
    (z.pallets || []).forEach(p => {
      maxX = Math.max(maxX, (p.x || 0) + (p.w || 0));
      maxY = Math.max(maxY, (p.y || 0) + (p.h || 0));
    });
  });
  if (maxX > WH.w * 1.15 || maxY > WH.h * 1.15) return LEGACY_WH;
  return WH;
}

function scaleSlotToWarehouse(slot, fromWH, toWH) {
  if (!slot) return slot;
  if (!fromWH || !toWH || !fromWH.w || !fromWH.h || (fromWH.w === toWH.w && fromWH.h === toWH.h)) {
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
  (scaled.notes || []).forEach(n => {
    n.x = round1((n.x || 0) * sx);
    n.y = round1((n.y || 0) * sy);
  });
  return scaled;
}

function normalizeSlotToCurrentWarehouse(slot, declaredWH = null) {
  if (!slot) return slot;
  const fromWH = declaredWH || inferWarehouseFromSlot(slot);
  return scaleSlotToWarehouse(slot, fromWH, WH);
}

function normalizeServerLayout(layout) {
  if (!layout || !Array.isArray(layout.warehouses)) return layout;
  const migrated = migrateLegacyWarehouses(layout.warehouses);
  return {
    warehouse: WH_CONFIGS[currentWH] || WH,
    warehouses: migrated.map((slot, idx) => {
      if (!slot) return slot;
      const declared = slot.warehouse && slot.warehouse.w && slot.warehouse.h ? slot.warehouse : (idx === 0 ? LEGACY_WH : WH_CONFIGS[idx]);
      const normalized = normalizeSlotToCurrentWarehouse(slot, declared);
      normalized.warehouse = { ...WH_CONFIGS[idx] };
      if (!normalized.gasLights) normalized.gasLights = [];
      if (!normalized.nextGLId) normalized.nextGLId = 1;
      return normalized;
    }),
    currentWH: 0
  };
}

function getSegmentInnerBounds(z, segIdx = 0, pad = 2) {
  const s = (z.segs || [])[segIdx] || z.segs[0];
  if (!s) return null;
  const headerPad = segIdx === 0 ? QF_HEADER + 1 : 2;
  return {
    x: round1(s.x + pad),
    y: round1(s.y + headerPad),
    w: round1(Math.max(0, s.w - pad * 2)),
    h: round1(Math.max(0, s.h - headerPad - pad)),
    seg: s,
    segIdx
  };
}

function formatSeqLabel(prefix, num) {
  const base = (prefix || 'P').trim() || 'P';
  return base + num;
}

function rectsIntersect(ax, ay, aw, ah, bx, by, bw, bh, eps = 0.001) {
  return ax < bx + bw - eps && ax + aw > bx + eps && ay < by + bh - eps && ay + ah > by + eps;
}

function getPalletsInSegment(z, segIdx = 0) {
  const inner = getSegmentInnerBounds(z, segIdx, 0);
  if (!inner) return [];
  return (z.pallets || []).filter(p => rectsIntersect(
    p.x || 0,
    p.y || 0,
    p.w || DEFAULT_PALLET.w,
    p.h || DEFAULT_PALLET.h,
    inner.x,
    inner.y,
    inner.w,
    inner.h
  ));
}

function getRowFillPlacement(z, segIdx, dir, pw, ph, gap) {
  const inner = getSegmentInnerBounds(z, segIdx);
  if (!inner) return null;
  const segPallets = getPalletsInSegment(z, segIdx);
  if (dir === 'h') {
    const nextY = segPallets.length
      ? Math.max(...segPallets.map(p => (p.y || 0) + (p.h || ph))) + gap
      : inner.y;
    const availableBand = inner.y + inner.h - nextY;
    const maxCount = availableBand + 0.001 >= ph
      ? Math.max(0, Math.floor((inner.w + gap) / (pw + gap)))
      : 0;
    return { inner, segPallets, x: inner.x, y: round1(nextY), maxCount };
  }
  const nextX = segPallets.length
    ? Math.max(...segPallets.map(p => (p.x || 0) + (p.w || pw))) + gap
    : inner.x;
  const availableBand = inner.x + inner.w - nextX;
  const maxCount = availableBand + 0.001 >= pw
    ? Math.max(0, Math.floor((inner.h + gap) / (ph + gap)))
    : 0;
  return { inner, segPallets, x: round1(nextX), y: inner.y, maxCount };
}

let sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: null, noteId: null };
let multiSel = []; // {zid, pid}[]
let snap = true;
let heatMapOn = false;
const SNAP_GRID = 5;

/* =================================================================
   MULTI-WAREHOUSE SUPPORT
   ================================================================= */
let currentWH = Number(localStorage.getItem('whsims.currentWH') || '0');
if (![0, 1].includes(currentWH)) currentWH = 0;
const WH_THEMES = ['wh2', 'wh3']; // Tent-3 orange, Tent-4 green
const WH_ACCENTS = ['#f59e0b', '#10b981'];

function saveCurrentToSlot() {
  return {
    zones: JSON.parse(JSON.stringify(zones)),
    categories: JSON.parse(JSON.stringify(categories)),
    nextZId, nextPId, nextCId,
    gasLights: JSON.parse(JSON.stringify(gasLights || [])),
    nextGLId,
    notes: JSON.parse(JSON.stringify(notes || [])),
    nextNoteId,
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
  gasLights = slot.gasLights || [];
  nextGLId = slot.nextGLId || nextGLId;
  notes = slot.notes || [];
  nextNoteId = slot.nextNoteId || nextNoteId;
}

let warehouseData = [null, null]; // filled in init

function migrateLegacyWarehouses(warehouses) {
  if (!Array.isArray(warehouses)) return [null, null];
  const slots = warehouses.slice();
  const hasMetadata = slots.some(slot => slot && slot.warehouse && slot.warehouse.key);
  if (hasMetadata) return slots.slice(0, 2);
  // Legacy 2-slot layout was Tent-2 / Tent-3. New UI is Tent-3 / Tent-4.
  if (slots.length === 2) {
    return [slots[1] || null, null];
  }
  // Legacy 3-slot layout was Tent-2 / Tent-3 / Tent-4.
  if (slots.length >= 3) {
    return [slots[1] || null, slots[2] || null];
  }
  return [slots[0] || null, slots[1] || null];
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
    notes = [];
    categories = JSON.parse(JSON.stringify((warehouseData[0] && warehouseData[0].categories) || categories));
    nextZId = 500; nextPId = 5000; nextCId = 100; nextGLId = 1; nextNoteId = 1;
    warehouseData[idx] = saveCurrentToSlot();
  }
  applyWarehouseTheme(idx);
  sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: null, noteId: null };
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
}

/* =================================================================
   SVG PAN & ZOOM
   ================================================================= */
const svg = document.getElementById('svg');
const world = document.getElementById('world');
const cArea = document.getElementById('canvasArea');

let vb = { x: -10, y: -8, w: WH.w + 20, h: WH.h + 16 };
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
  if (addingNote) return;
  if (interacting) return;
  if (e.target.closest('.zr') || e.target.closest('.pr') || e.target.closest('.rh') || e.target.closest('.gl-obj') || e.target.closest('.note-obj')) return;
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
  const padX = 8;
  const padY = 6;
  vb = { x: -padX, y: -padY, w: WH.w + padX * 2, h: WH.h + padY * 2 };
  const r = svg.getBoundingClientRect();
  const asp = r.width / r.height;
  const vAsp = vb.w / vb.h;
  if (asp > vAsp) {
    const nw = vb.h * asp;
    vb.x -= (nw - vb.w) / 2;
    vb.w = nw;
  } else {
    const nh = vb.w / asp;
    vb.y -= (nh - vb.h) / 2;
    vb.h = nh;
  }
  const boost = 1.08;
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  vb.w /= boost;
  vb.h /= boost;
  vb.x = cx - vb.w / 2;
  vb.y = cy - vb.h / 2;
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
  document.getElementById('whBorder').innerHTML = `
    <rect x="0" y="0" width="${WH.w}" height="${WH.h}" fill="none"
      stroke="var(--text-3)" stroke-width="1.5" stroke-dasharray="6 3" rx="3"/>
    <!-- BACK = left side -->
    <text x="-10" y="${WH.h/2}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="8" font-weight="700" fill="var(--text-3)" letter-spacing="3"
      transform="rotate(-90,-10,${WH.h/2})">◀ BACK</text>
    <!-- FRONT = right side -->
    <text x="${WH.w+10}" y="${WH.h/2}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="8" font-weight="700" fill="var(--accent-h)" letter-spacing="3"
      transform="rotate(90,${WH.w+10},${WH.h/2})">FRONT ▶</text>
    <!-- Entrance label behind FRONT (further from warehouse) -->
    <text x="${WH.w+20}" y="${WH.h/2}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="5" font-weight="700" fill="var(--green)" letter-spacing="2" opacity="0.7"
      transform="rotate(90,${WH.w+20},${WH.h/2})">ENTRANCE</text>
    <!-- Dimension labels -->
    <text x="${WH.w/2}" y="-6" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="6" font-weight="600" fill="var(--text-3)">${WH.lw || WH.w}ft</text>
    <text x="${WH.w/2}" y="${WH.h+12}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="6" font-weight="600" fill="var(--text-3)">${WH.lw || WH.w}ft</text>
    <text x="-20" y="${WH.h/2}" text-anchor="middle" font-family="IBM Plex Mono"
      font-size="5" font-weight="600" fill="var(--text-3)"
      transform="rotate(-90,-20,${WH.h/2})">${WH.lh || WH.h}ft</text>
  `;

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

      g.addEventListener('pointerdown', e => startGasLightDrag(e, gl.id));
      glG.appendChild(g);
    });
  }

  renderNotes();

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

  const onMove = ev => {
    const mp = s2svg(ev.clientX, ev.clientY);

      const oldSegs = z.segs.map(s => ({ x: s.x, y: s.y }));
    const oldPals = z.pallets.map(p => ({ x: p.x, y: p.y }));

      z.segs.forEach((s, i) => {
      s.x = doSnap(mp.x - offsets[i].dx);
      s.y = doSnap(mp.y - offsets[i].dy);
    });
    z.pallets.forEach((p, i) => {
      p.x = doSnap(mp.x - palOffsets[i].dx);
      p.y = doSnap(mp.y - palOffsets[i].dy);
    });

      if (checkZoneCollision(z)) {
      z.segs.forEach((s, i) => { s.x = oldSegs[i].x; s.y = oldSegs[i].y; });
      z.pallets.forEach((p, i) => { p.x = oldPals[i].x; p.y = oldPals[i].y; });
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
  if (addingNote && !e.target.closest('.gl-obj') && !e.target.closest('.note-obj')) {
    const pt = s2svg(e.clientX, e.clientY);
    const text = prompt('Enter note text:');
    addingNote = false;
    if (!text || !text.trim()) return;
    const note = {
      id: nid(),
      x: doSnap(pt.x),
      y: doSnap(pt.y),
      text: text.trim()
    };
    notes.push(note);
    sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: null, noteId: note.id };
    renderAll();
    openNoteEditor(note.id);
    toast('Note added', 'ok');
    return;
  }

  if (!e.target.closest('.zr') && !e.target.closest('.pr') && !e.target.closest('.rh') && !e.target.closest('.gl-obj') && !e.target.closest('.note-obj')) {
    sel.zoneId = null; sel.palletId = null; sel.segIdx = null; sel.gasLightId = null; sel.noteId = null;
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

  body.innerHTML = html || '<div style="text-align:center;padding:30px;color:var(--text-3)"><i class="fas fa-search" style="font-size:24px;display:block;margin-bottom:8px"></i>Nothing found</div>';
}

function updateStats() {
  const tP = zones.reduce((s, z) => s + z.pallets.length, 0);
  const tC = zones.reduce((s, z) => s + z.capacity, 0);
  const tB = zones.reduce((s, z) => s + z.boxes, 0);
  const pct = tC > 0 ? Math.round(tP / tC * 100) : 0;

  document.getElementById('topChips').innerHTML = `
    <div class="chip"><i class="fas fa-layer-group"></i> <b>${zones.length}</b> zones</div>
    <div class="chip"><i class="fas fa-pallet"></i> <b>${tP}</b> pallets</div>
    <div class="chip"><i class="fas fa-box"></i> <b>${tB}</b> boxes</div>
    <div class="chip"><i class="fas fa-chart-pie"></i> <b>${pct}%</b></div>`;

  document.getElementById('sbStats').innerHTML = `
    <div class="st-grid">
      <div class="st-item"><div class="st-l">Pallets</div><div class="st-v">${tP}</div></div>
      <div class="st-item"><div class="st-l">Boxes</div><div class="st-v">${tB}</div></div>
      <div class="st-item"><div class="st-l">Capacity</div><div class="st-v">${tC}</div></div>
      <div class="st-item"><div class="st-l">Zones</div><div class="st-v">${zones.length}</div></div>
    </div>
    <div class="ov-bar"><div class="ov-head"><span>Occupancy</span><b>${pct}%</b></div>
      <div class="pbar"><div class="pfill" style="width:${pct}%"></div></div></div>`;
}

// zone editor
function selectZone(id) {
  sel.zoneId = id;
  sel.palletId = null;
  sel.gasLightId = null;
  sel.noteId = null;
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
      <div class="zone-tool-grid">
        <button class="btn btn-g zone-tool-btn zone-tool-btn--quick" onclick="showQuickFillForm('${id}')"><i class="fas fa-th"></i><span>Quick Fill</span></button>
        <button class="btn zone-tool-btn zone-tool-btn--row" onclick="showRowFillForm('${id}')"><i class="fas fa-grip-lines"></i><span>Row Fill</span></button>
        <button class="btn zone-tool-btn zone-tool-btn--pack" onclick="packZoneToSegment('${id}')"><i class="fas fa-compress-arrows-alt"></i><span>Pack to Segment</span></button>
        ${z.pallets.length > 0 ? '<button class="btn zone-tool-btn zone-tool-btn--select" onclick="selectAllPalletsInZone(\'' + id + '\')"><i class="fas fa-check-double"></i><span>Select All</span></button>' : ''}
      </div>
      <div id="quickFillForm" class="tool-panel" style="display:none">
        <div class="tool-title" style="color:var(--green)"><i class="fas fa-th"></i> Quick Fill · Auto Grid</div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Pallet W (ft)</label>
            <input type="number" id="qfPw" value="4" min="1" step="0.5" style="font-size:13px" oninput="updateQfPreview('${id}')"></div>
          <div class="fg" style="margin:0"><label>Pallet H (ft)</label>
            <input type="number" id="qfPh" value="4" min="1" step="0.5" style="font-size:13px" oninput="updateQfPreview('${id}')"></div>
        </div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Gap (ft)</label>
            <input type="number" id="qfGap" value="1" min="0" step="0.5" style="font-size:13px" oninput="updateQfPreview('${id}')"></div>
          <div class="fg" style="margin:0;flex:2"><label>Prefix</label>
            <input type="text" id="qfPrefix" value="P-" style="font-size:13px"></div>
          <div class="fg" style="margin:0;flex:1"><label>Start #</label>
            <input type="number" id="qfStart" value="1" min="0" style="font-size:13px"></div>
        </div>
        <div class="qf-preview" id="qfPreview">—</div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-p" style="flex:1;justify-content:center;font-size:11px" onclick="doQuickFill('${id}')"><i class="fas fa-check"></i> Fill Zone</button>
          <button class="btn" style="padding:4px 10px;font-size:11px" onclick="document.getElementById('quickFillForm').style.display='none'"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div id="rowFillForm" class="tool-panel" style="display:none">
        <div class="tool-title" style="color:var(--accent-h)"><i class="fas fa-grip-lines"></i> Row Fill · Clean Lines</div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Direction</label>
            <select id="rfDir" onchange="updateRowFillPreview('${id}')"><option value="h">Horizontal</option><option value="v">Vertical</option></select></div>
          <div class="fg" style="margin:0"><label>Segment</label>
            <select id="rfSeg" onchange="updateRowFillPreview('${id}')">${z.segs.map((s, i) => '<option value="' + i + '"' + ((sel.segIdx ?? 0) === i ? ' selected' : '') + '>Segment ' + (i + 1) + '</option>').join('')}</select></div>
        </div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Count</label>
            <input type="number" id="rfCount" value="6" min="1" style="font-size:13px" oninput="updateRowFillPreview('${id}')"></div>
          <div class="fg" style="margin:0"><label>Gap (ft)</label>
            <input type="number" id="rfGap" value="1" min="0" step="0.5" style="font-size:13px" oninput="updateRowFillPreview('${id}')"></div>
        </div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0"><label>Pallet W (ft)</label>
            <input type="number" id="rfPw" value="4" min="1" step="0.5" style="font-size:13px" oninput="updateRowFillPreview('${id}')"></div>
          <div class="fg" style="margin:0"><label>Pallet H (ft)</label>
            <input type="number" id="rfPh" value="4" min="1" step="0.5" style="font-size:13px" oninput="updateRowFillPreview('${id}')"></div>
        </div>
        <div class="fr" style="margin-bottom:6px">
          <div class="fg" style="margin:0;flex:2"><label>Prefix</label>
            <input type="text" id="rfPrefix" value="ROW-" style="font-size:13px"></div>
          <div class="fg" style="margin:0;flex:1"><label>Start #</label>
            <input type="number" id="rfStart" value="1" min="0" style="font-size:13px" oninput="updateRowFillPreview('${id}')"></div>
        </div>
        <div class="qf-preview" id="rfPreview">—</div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-p" style="flex:1;justify-content:center;font-size:11px" onclick="doRowFill('${id}')"><i class="fas fa-plus"></i> Add Row</button>
          <button class="btn" style="padding:4px 10px;font-size:11px" onclick="document.getElementById('rowFillForm').style.display='none'"><i class="fas fa-times"></i></button>
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
  const pw = DEFAULT_PALLET.w, ph = DEFAULT_PALLET.h;
  const pad = 3;
  const headerH = 14;
  const gap = 2;

  const availW = s.w - pad * 2;
  const cols = Math.max(1, Math.floor((availW + gap) / (pw + gap)));

  let placed = false;
  for (let row = 0; row < 100 && !placed; row++) {
    for (let col = 0; col < cols && !placed; col++) {
      const px = s.x + pad + col * (pw + gap);
      const py = s.y + headerH + row * (ph + gap);
          if (py + ph > s.y + s.h) break;
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

function closeZoneToolPanels() {
  const quick = document.getElementById('quickFillForm');
  const row = document.getElementById('rowFillForm');
  if (quick) quick.style.display = 'none';
  if (row) row.style.display = 'none';
}

function showQuickFillForm(zid) {
  const form = document.getElementById('quickFillForm');
  if (!form) return;
  const shouldOpen = form.style.display === 'none';
  closeZoneToolPanels();
  form.style.display = shouldOpen ? 'block' : 'none';
  if (form.style.display === 'block') {
    updateQfPreview(zid);
    setTimeout(() => { const inp = document.getElementById('qfPw'); if (inp) inp.focus(); }, 50);
  }
}

function updateQfPreview(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const s = z.segs[0];
  const pw = parseFloat(document.getElementById('qfPw').value) || DEFAULT_PALLET.w;
  const ph = parseFloat(document.getElementById('qfPh').value) || DEFAULT_PALLET.h;
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

  const pw = parseFloat(document.getElementById('qfPw').value) || DEFAULT_PALLET.w;
  const ph = parseFloat(document.getElementById('qfPh').value) || DEFAULT_PALLET.h;
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
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        z.pallets.push({
          id: pid(), label: prefix + (startNum + count),
          x: startX + c * (pw + gap),
          y: startY + r * (ph + gap),
          w: pw, h: ph
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


function showRowFillForm(zid) {
  const form = document.getElementById('rowFillForm');
  if (!form) return;
  const shouldOpen = form.style.display === 'none';
  closeZoneToolPanels();
  form.style.display = shouldOpen ? 'block' : 'none';
  if (form.style.display === 'block') {
    updateRowFillPreview(zid);
    setTimeout(() => { const inp = document.getElementById('rfPrefix'); if (inp) inp.focus(); }, 50);
  }
}

function updateRowFillPreview(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const segIdx = parseInt(document.getElementById('rfSeg').value || (sel.segIdx ?? 0), 10) || 0;
  const dir = document.getElementById('rfDir').value || 'h';
  const count = Math.max(1, parseInt(document.getElementById('rfCount').value || '1', 10));
  const gap = parseFloat(document.getElementById('rfGap').value) || 0;
  const pw = parseFloat(document.getElementById('rfPw').value) || DEFAULT_PALLET.w;
  const ph = parseFloat(document.getElementById('rfPh').value) || DEFAULT_PALLET.h;
  const prefix = (document.getElementById('rfPrefix').value || 'ROW-').trim() || 'ROW-';
  const startNum = parseInt(document.getElementById('rfStart').value || '1', 10) || 1;
  const placement = getRowFillPlacement(z, segIdx, dir, pw, ph, gap);
  const el = document.getElementById('rfPreview');
  if (!el || !placement) return;

  const actual = Math.min(count, placement.maxCount);
  const labels = actual > 0
    ? formatSeqLabel(prefix, startNum) + ' → ' + formatSeqLabel(prefix, startNum + actual - 1)
    : formatSeqLabel(prefix, startNum);
  let msg = (dir === 'h' ? 'Horizontal' : 'Vertical') + ' row, segment ' + (segIdx + 1) + ' · ' + labels;

  if (placement.maxCount <= 0) {
    msg += ' · no free space for another ' + (dir === 'h' ? 'row' : 'column');
    el.style.color = 'var(--red)';
  } else if (actual < count) {
    msg += ' · requested ' + count + ', fits ' + actual;
    el.style.color = 'var(--yellow)';
  } else {
    msg += ' · fits ' + actual;
    el.style.color = 'var(--accent-h)';
  }

  el.textContent = msg;
}

function doRowFill(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z) return;
  const segIdx = parseInt(document.getElementById('rfSeg').value || (sel.segIdx ?? 0), 10) || 0;
  const dir = document.getElementById('rfDir').value || 'h';
  const requested = Math.max(1, parseInt(document.getElementById('rfCount').value || '1', 10));
  const gap = parseFloat(document.getElementById('rfGap').value) || 0;
  const pw = parseFloat(document.getElementById('rfPw').value) || DEFAULT_PALLET.w;
  const ph = parseFloat(document.getElementById('rfPh').value) || DEFAULT_PALLET.h;
  const prefix = (document.getElementById('rfPrefix').value || 'ROW-').trim() || 'ROW-';
  const startNum = parseInt(document.getElementById('rfStart').value || '1', 10) || 1;
  const placement = getRowFillPlacement(z, segIdx, dir, pw, ph, gap);

  if (!placement || placement.maxCount <= 0) {
    toast('No free space for another ' + (dir === 'h' ? 'row' : 'column') + ' in this segment', 'err');
    return;
  }

  const actual = Math.min(requested, placement.maxCount);
  const newPallets = [];
  for (let i = 0; i < actual; i++) {
    const px = dir === 'h' ? placement.x + i * (pw + gap) : placement.x;
    const py = dir === 'h' ? placement.y : placement.y + i * (ph + gap);
    newPallets.push({
      id: pid(),
      label: formatSeqLabel(prefix, startNum + i),
      x: round1(px),
      y: round1(py),
      w: pw,
      h: ph
    });
  }

  z.pallets.push(...newPallets);
  renderAll();
  openZoneEditor(zid);
  if (actual < requested) {
    toast('Placed ' + actual + ' of ' + requested + ' requested pallets in segment ' + (segIdx + 1), 'inf');
  } else {
    toast(actual + ' row pallets added in segment ' + (segIdx + 1), 'ok');
  }
}

function packZoneToSegment(zid) {
  const z = zones.find(zz => zz.id === zid);
  if (!z || !z.pallets || z.pallets.length === 0) { toast('No pallets to pack', 'err'); return; }
  const segIdx = sel.segIdx != null ? sel.segIdx : 0;
  const inner = getSegmentInnerBounds(z, segIdx);
  if (!inner) { toast('No segment selected', 'err'); return; }

  const targetPallets = getPalletsInSegment(z, segIdx);
  if (targetPallets.length === 0) {
    toast('No pallets found in selected segment', 'err');
    return;
  }

  const ordered = [...targetPallets].sort((a, b) => {
    const la = String(a.label || '');
    const lb = String(b.label || '');
    return la.localeCompare(lb, undefined, { numeric: true, sensitivity: 'base' });
  });

  let cx = inner.x;
  let cy = inner.y;
  let rowH = 0;
  const gap = 0.75;
  const packed = [];
  const leftover = [];

  for (const p of ordered) {
    const pw = p.w || DEFAULT_PALLET.w;
    const ph = p.h || DEFAULT_PALLET.h;
    if (cx + pw > inner.x + inner.w + 0.001) {
      cx = inner.x;
      cy += rowH + gap;
      rowH = 0;
    }
    if (cy + ph > inner.y + inner.h + 0.001) {
      leftover.push(p);
      continue;
    }
    packed.push({ id: p.id, x: round1(cx), y: round1(cy), w: pw, h: ph });
    cx += pw + gap;
    rowH = Math.max(rowH, ph);
  }

  if (packed.length === 0) {
    toast('Selected segment is too small to pack these pallets', 'err');
    return;
  }

  const posMap = new Map(packed.map(p => [p.id, p]));
  z.pallets = z.pallets.map(p => posMap.has(p.id) ? Object.assign({}, p, posMap.get(p.id)) : p);
  renderAll();
  openZoneEditor(zid);
  if (leftover.length > 0) {
    toast('Packed ' + packed.length + ' pallets, ' + leftover.length + ' left untouched', 'inf');
  } else {
    toast('Packed ' + packed.length + ' pallets into segment ' + (segIdx + 1), 'ok');
  }
}

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
          currentWH = normalized.currentWH || 0;
          if (warehouseData[currentWH]) loadSlotToCurrent(warehouseData[currentWH]);
        } else if (d.zones) {
          const normalizedSlot = normalizeSlotToCurrentWarehouse({
            zones: d.zones,
            categories: d.categories,
            nextZId: d.nextZId,
            nextPId: d.nextPId,
            nextCId: d.nextCId
          }, d.warehouse);
          zones = normalizedSlot.zones;
          zones.forEach(z => { if (!z.tags) z.tags = []; if (z.parentId === undefined) z.parentId = null; if (!z.pallets) z.pallets = []; if (!z.segs) z.segs = []; });
          if (normalizedSlot.categories) categories = normalizedSlot.categories;
          if (normalizedSlot.nextZId) nextZId = normalizedSlot.nextZId;
          if (normalizedSlot.nextPId) nextPId = normalizedSlot.nextPId;
          if (normalizedSlot.nextCId) nextCId = normalizedSlot.nextCId;
          notes = normalizedSlot.notes || [];
          nextNoteId = normalizedSlot.nextNoteId || nextNoteId;
          warehouseData[currentWH] = saveCurrentToSlot();
        }
        WH_THEMES.forEach(t => { if (t) document.body.classList.remove(t); });
        if (WH_THEMES[currentWH]) document.body.classList.add(WH_THEMES[currentWH]);
        document.querySelectorAll('.wh-tab').forEach((tab, i) => tab.classList.toggle('active', i === currentWH));
        sel = { zoneId: null, palletId: null, segIdx: null, gasLightId: null, noteId: null };
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
  if (e.key === 'Escape') {
    if (document.body.classList.contains('pres')) { togglePresentation(); return; }
    if (document.getElementById('modalBg').classList.contains('show')) closeModal();
    else if (document.getElementById('editor').classList.contains('open')) closeEditor();
    else { sel.zoneId = null; sel.palletId = null; sel.gasLightId = null; sel.noteId = null; renderAll(); }
  }
  if (e.key === 'Delete' && !e.target.closest('input,select,textarea')) {
    if (sel.noteId) {
      deleteNote(sel.noteId);
    } else if (sel.gasLightId) {
      deleteGasLight(sel.gasLightId);
    } else if (sel.zoneId) {
      if (multiSel.length > 0) {
        batchDelete();
      } else if (sel.palletId) {
        removePal(sel.zoneId, sel.palletId);
      } else {
        deleteZone(sel.zoneId);
      }
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
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(0, 0, WH.w, WH.h);
  ctx.setLineDash([]);

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
  ctx.fillText((WH.lw || WH.w) + 'ft', WH.w / 2, -10);
  ctx.fillText((WH.lw || WH.w) + 'ft', WH.w / 2, WH.h + 4);
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

// ---- FIREBASE (disabled) ----
// To re-enable: uncomment this block and the firebase lines in autoSave/autoLoad/init
/*
const firebaseConfig = {
  apiKey: "AIzaSyCDsNhXCVambn0vKzlklR83YE4B5-BE7gs",
  authDomain: "warehousemgmt-d781e.firebaseapp.com",
  databaseURL: "https://warehousemgmt-d781e-default-rtdb.firebaseio.com",
  projectId: "warehousemgmt-d781e",
  storageBucket: "warehousemgmt-d781e.firebasestorage.app",
  messagingSenderId: "316961805931",
  appId: "1:316961805931:web:5d712d4f3b8c38cb27432e",
  measurementId: "G-48ENR887R3"
};

let fbApp = null, fbDb = null, fbRef = null, fbReady = false, fbSkipNext = false;

function loadFirebaseSDK() {
  return new Promise((resolve) => {
    if (typeof firebase !== 'undefined') { resolve(true); return; }
    const s1 = document.createElement('script');
    s1.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js';
      s2.onload = () => resolve(true);
      s2.onerror = () => resolve(false);
      document.head.appendChild(s2);
    };
    s1.onerror = () => resolve(false);
    document.head.appendChild(s1);
  });
}

let firebaseLoadPromise = Promise.resolve(false);
if (firebaseConfig.apiKey !== 'YOUR_API_KEY') {
  firebaseLoadPromise = loadFirebaseSDK().then(ok => {
    if (ok && typeof firebase !== 'undefined') {
      try {
        fbApp = firebase.initializeApp(firebaseConfig);
        fbDb = firebase.database();
        fbRef = fbDb.ref('warehouse/layout');
        fbReady = true;
        return true;
      } catch (e) { return false; }
    }
    return false;
  });
}
*/
let fbReady = false;

// persistence (indexeddb)

const DB_NAME = 'WHSims';
const DB_VER = 1;
const STORE = 'layout';

let saveTimer = null;
let pollTimer = null;
let suppressAutoSave = false;
let googleClientId = '';
let googleAuthReady = false;
let serverVersion = 0;
let lastSavedPayload = '';
let saveInFlight = false;
let bootstrapDone = false;

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
    warehouses: JSON.parse(JSON.stringify(warehouseData)).map((slot, idx) => {
      if (!slot) return slot;
      slot.warehouse = { ...WH_CONFIGS[idx] };
      return slot;
    })
  };
}



function applyServerLayout(layout) {
  if (!layout || !Array.isArray(layout.warehouses)) return false;
  layout = normalizeServerLayout(layout);

  const localCurrentWH = [0, 1].includes(currentWH) ? currentWH : 0;
  const localFallback = saveCurrentToSlot();

  warehouseData = layout.warehouses.map((slot, idx) => {
    if (slot) return slot;
    if (idx === 0) return idx === localCurrentWH ? localFallback : JSON.parse(JSON.stringify(localFallback));
    return null;
  });

  if (!warehouseData[0]) warehouseData[0] = localFallback;
  currentWH = localCurrentWH;
  try { localStorage.setItem('whsims.currentWH', String(currentWH)); } catch (e) {}

  if (warehouseData[currentWH]) loadSlotToCurrent(warehouseData[currentWH]);
  else if (warehouseData[0]) {
    currentWH = 0;
    loadSlotToCurrent(warehouseData[0]);
  }

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
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
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
    bootstrapDone = true;
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
    const hasRemote = data.layout && Array.isArray(data.layout.warehouses) && data.layout.warehouses.some(Boolean);

    if (hasRemote) {
      applyServerLayout(data.layout);
      lastSavedPayload = JSON.stringify(buildServerLayoutPayload());
      bootstrapDone = true;
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
   NOTES
   ================================================================= */
function addNoteMode() {
  addingNote = true;
  toast('Click on the map to place a note', 'inf');
}

function renderNotes() {
  const nG = document.getElementById('notesG');
  if (!nG) return;
  nG.innerHTML = '';

  (notes || []).forEach(n => {
    const g = makeNS('g');
    g.setAttribute('class', 'note-obj' + (sel.noteId === n.id ? ' sel' : ''));
    g.setAttribute('data-noteid', n.id);

    const circle = makeNS('circle');
    setA(circle, {
      cx: n.x,
      cy: n.y,
      r: 5,
      fill: '#ef4444',
      stroke: sel.noteId === n.id ? '#ffffff' : '#7f1d1d',
      'stroke-width': sel.noteId === n.id ? 1.6 : 1.1
    });
    g.appendChild(circle);

    const icon = makeNS('text');
    setA(icon, {
      x: n.x,
      y: n.y + 1.8,
      'text-anchor': 'middle',
      'font-family': 'IBM Plex Mono',
      'font-size': '4.2',
      'font-weight': '700',
      fill: '#ffffff',
      'pointer-events': 'none'
    });
    icon.textContent = '!';
    g.appendChild(icon);

    const labelBg = makeNS('rect');
    const labelText = String(n.text || 'Note');
    const labelW = Math.max(18, Math.min(70, labelText.length * 2.9 + 8));
    setA(labelBg, {
      x: n.x + 7,
      y: n.y - 7,
      width: labelW,
      height: 10,
      rx: 2,
      fill: 'rgba(11,13,20,0.82)',
      stroke: 'rgba(239,68,68,0.45)',
      'stroke-width': 0.6
    });
    g.appendChild(labelBg);

    const text = makeNS('text');
    setA(text, {
      x: n.x + 11,
      y: n.y,
      'text-anchor': 'start',
      'font-family': 'IBM Plex Mono',
      'font-size': '3.5',
      'font-weight': '600',
      fill: '#ffffff',
      'pointer-events': 'none'
    });
    text.textContent = labelText.length > 34 ? labelText.slice(0, 31) + '...' : labelText;
    g.appendChild(text);

    g.addEventListener('pointerdown', e => startNoteDrag(e, n.id));
    g.addEventListener('dblclick', e => {
      e.stopPropagation();
      deleteNote(n.id);
    });

    nG.appendChild(g);
  });
}

function selectNote(id) {
  sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: null, noteId: id };
  renderAll();
  openNoteEditor(id);
}

function startNoteDrag(e, noteId) {
  e.stopPropagation();
  selectNote(noteId);
  const n = notes.find(x => x.id === noteId);
  if (!n) return;

  interacting = true;
  const pt = s2svg(e.clientX, e.clientY);
  const off = { dx: pt.x - n.x, dy: pt.y - n.y };

  const onMove = ev => {
    const mp = s2svg(ev.clientX, ev.clientY);
    n.x = Math.max(0, Math.min(WH.w, mp.x - off.dx));
    n.y = Math.max(0, Math.min(WH.h, mp.y - off.dy));
    if (snap) {
      n.x = doSnap(n.x);
      n.y = doSnap(n.y);
    }
    renderAll();
    showDimBadge(ev.clientX, ev.clientY, 'Note: ' + Math.round(n.x) + ',' + Math.round(n.y));
  };

  const onUp = () => {
    interacting = false;
    hideDimBadge();
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    renderAll();
    openNoteEditor(noteId);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function openNoteEditor(id) {
  const n = notes.find(x => x.id === id);
  if (!n) return;
  const ed = document.getElementById('editor');
  document.getElementById('edTitle').textContent = '⚠️ Note';
  document.getElementById('edBody').innerHTML = `
    <div class="fg">
      <label>Note</label>
      <textarea rows="4" style="resize:vertical" oninput="updateNote('${n.id}','text',this.value)">${esc(n.text || '')}</textarea>
    </div>
    <div class="fr">
      <div class="fg" style="margin:0">
        <label>X</label>
        <input type="number" value="${Math.round(n.x)}" onchange="updateNote('${n.id}','x',+this.value)">
      </div>
      <div class="fg" style="margin:0">
        <label>Y</label>
        <input type="number" value="${Math.round(n.y)}" onchange="updateNote('${n.id}','y',+this.value)">
      </div>
    </div>
    <div class="fg" style="font-size:12px;color:var(--text-3)">
      Drag the marker to move it. Double-click it to delete fast.
    </div>
  `;
  document.getElementById('edFoot').innerHTML = `
    <button class="btn btn-d" onclick="deleteNote('${n.id}')"><i class="fas fa-trash"></i> Delete</button>
    <button class="btn btn-p" onclick="closeEditor()"><i class="fas fa-check"></i> Done</button>
  `;
  ed.classList.add('open');
}

function updateNote(id, field, value) {
  const n = notes.find(x => x.id === id);
  if (!n) return;
  if (field === 'x' || field === 'y') {
    n[field] = Math.max(0, Math.min(field === 'x' ? WH.w : WH.h, Number(value) || 0));
  } else {
    n[field] = value;
  }
  renderAll();
}

function deleteNote(id) {
  notes = notes.filter(x => x.id !== id);
  if (sel.noteId === id) {
    sel.noteId = null;
    closeEditor();
  }
  renderAll();
  toast('Note deleted', 'inf');
}

/* =================================================================
   GAS LIGHTS
   ================================================================= */
function addGasLight() {
  const gl = {
    id: glid(),
    name: 'Light ' + nextGLId,
    x: round1(WH.w / 2 + Math.random() * 20 - 10),
    y: round1(WH.h / 2 + Math.random() * 20 - 10),
    status: 'on',
    notes: ''
  };
  gasLights.push(gl);
  renderAll();
  selectGasLight(gl.id);
  toast('Gas Light added', 'ok');
}

function selectGasLight(id) {
  sel = { zoneId: null, segIdx: null, palletId: null, gasLightId: id, noteId: null };
  openGasLightEditor(id);
  renderAll();
}

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

function openGasLightEditor(id) {
  const gl = gasLights.find(g => g.id === id);
  if (!gl) return;
  const ed = document.getElementById('editor');
  document.getElementById('edTitle').innerHTML = '<i class=\"fas fa-lightbulb\" style=\"color:#f0b429\"></i>&ensp;Gas Light';
  document.getElementById('edBody').innerHTML = `
    <div class=\"fg\">
      <label>Name</label>
      <input type=\"text\" id=\"glName\" value=\"${esc(gl.name)}\" oninput=\"updateGasLight('\${gl.id}\','name',this.value)\">
    </div>
    <div class=\"fg\">
      <label>Status</label>
      <select id=\"glStatus\" onchange=\"updateGasLight('\${gl.id}\','status',this.value)\">
        <option value=\"on\"${gl.status === 'on' ? ' selected' : ''}>Working</option>
        <option value=\"off\"${gl.status === 'off' ? ' selected' : ''}>Not Working</option>
      </select>
    </div>
    <div class=\"fg\">
      <label>Position X (ft)</label>
      <input type=\"number\" id=\"glX\" value=\"${Math.round(gl.x)}\" onchange=\"updateGasLight('\${gl.id}\','x',+this.value)\">
    </div>
    <div class=\"fg\">
      <label>Position Y (ft)</label>
      <input type=\"number\" id=\"glY\" value=\"${Math.round(gl.y)}\" onchange=\"updateGasLight('\${gl.id}\','y',+this.value)\">
    </div>
    <div class=\"fg\">
      <label>Notes</label>
      <textarea rows=\"3\" style=\"resize:vertical\" oninput=\"updateGasLight('\${gl.id}\','notes',this.value)\">${esc(gl.notes || '')}</textarea>
    </div>
    <div style=\"padding:8px 0;margin-top:8px;border-top:1px solid var(--border)\">
      <div class=\"gl-status\" style=\"font-size:12px\">
        <span class=\"gl-dot ${gl.status}\"></span>
        <span>${gl.status === 'on' ? 'Operational' : 'Offline'}</span>
      </div>
    </div>
  `;
  document.getElementById('edFoot').innerHTML = `
    <button class=\"btn btn-d\" onclick=\"deleteGasLight('\${gl.id}\')\"><i class=\"fas fa-trash\"></i> Delete</button>
    <button class=\"btn btn-p\" onclick=\"closeEditor()\"><i class=\"fas fa-check\"></i> Done</button>
  `;
  ed.classList.add('open');
}

function updateGasLight(id, field, value) {
  const gl = gasLights.find(g => g.id === id);
  if (!gl) return;
  gl[field] = value;
  renderAll();
  if (field === 'status') openGasLightEditor(id);
}

function deleteGasLight(id) {
  gasLights = gasLights.filter(g => g.id !== id);
  sel.gasLightId = null;
  closeEditor();
  renderAll();
  toast('Gas Light removed', 'ok');
}

function autoSave() {
  saveLayoutToServer(false);
}


function resetToDefaults() {
  showModal('Reset everything?', 'All zones, pallets, and categories will be reset to defaults. This cannot be undone.', async () => {
    stopServerPolling();
    serverVersion = 0;
    lastSavedPayload = '';
    bootstrapDone = false;
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

async function init() {
  renderSVG();
  renderSidebar();
  updateStats();
  document.getElementById('snapBtn').classList.add('on');
  applyWarehouseTheme(currentWH);
  setTimeout(zoomFit, 100);
  setSyncStatus('Sign in required', '#6b7280');
  initGoogleAuth();
  await restoreSession();
}
init();
window.addEventListener('resize', () => setTimeout(zoomFit, 50));


// tutorial
const TUT = {
  active: false,
  step: 0,
  steps: [],
  savedVB: null,
  savedSB: null,
  animFrame: null,
};

const tutSteps = [
  {
    target: null, // Welcome splash handled separately
    type: 'splash',
  },
  {
    target: '#canvasArea',
    icon: 'fa-map',
    title: 'Your Warehouse Canvas',
    text: 'This is the interactive floor plan of your warehouse (400\u00d7180 ft). You can <strong>pan</strong> by clicking and dragging, and <strong>zoom</strong> with the scroll wheel. Everything is rendered in real-time.',
    spotlight: 'canvas',
    zoom: { x: -20, y: -20, w: 440, h: 220 },
    cardPos: 'center',
  },
  {
    target: '#whTabs',
    icon: 'fa-layer-group',
    title: 'Tent Tabs',
    text: 'Switch between <strong>multiple tents</strong> instantly. Each tent has its own zones, pallets, and layout. Data is saved separately per tab.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: '#syncStatus',
    icon: 'fa-cloud',
    title: 'Sync Status',
    text: 'Shows whether your data is syncing with the <strong>server</strong>. When connected, changes are auto-saved and reflected across active sessions.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: '.top-right .btn-g',
    icon: 'fa-plus-circle',
    title: 'Create a Zone',
    text: 'Click here to add a new zone. You\'ll pick a <strong>category</strong> and <strong>subcategory</strong>, then the zone appears on the canvas ready to be positioned and resized.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: () => {
      const z = zones[0];
      if (!z || !z.segs || !z.segs[0]) return null;
      const s = z.segs[0];
      const r = svgToScreen(s.x, s.y, s.w, s.h);
      return r;
    },
    icon: 'fa-vector-square',
    title: 'Zones on the Canvas',
    text: 'Each colored rectangle is a <strong>zone</strong>. Click any zone to select it \u2014 drag to <strong>move</strong>, use corner handles to <strong>resize</strong>. Double-click opens the full editor.',
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
    text: 'Live stats at the bottom of the sidebar: <strong>total zones</strong>, <strong>total pallets</strong>, and overall <strong>capacity usage</strong> with a visual progress bar.',
    spotlight: 'el',
    cardPos: 'right',
    action: () => {
      const sb = document.getElementById('sidebar');
      if (sb.classList.contains('hide')) toggleSB();
    },
  },
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
    text: 'Capture the entire warehouse layout as a <strong>high-resolution PNG</strong> image. Perfect for sharing with teammates or printing for the warehouse wall.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: '.top-right .btn[title="Presentation"]',
    icon: 'fa-tv',
    title: 'Presentation Mode',
    text: 'Hides all UI panels for a <strong>clean, full-screen view</strong>. Great for meetings or displaying on a warehouse monitor. Press <strong>Esc</strong> to exit.',
    spotlight: 'el',
    cardPos: 'below',
  },
  {
    target: '.top-right .btn[title="Save"]',
    icon: 'fa-save',
    title: 'Save & Load',
    text: 'Download your layout as a <strong>JSON file</strong> for backup, or load a previously saved file. The working layout also auto-saves to the server.',
    spotlight: 'el',
    cardPos: 'below',
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
    setTimeout(() => {
      positionCard(rect, step.cardPos);
      card.classList.add('show');
    }, 80);

      if (step.miniAnim === 'drag' && rect) {
      setTimeout(() => showDragAnim(rect), 500);
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
        setTimeout(doAfterZoom, 100);
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
  closeEditor();
  showStep(0);
}

function endTutorial() {
  TUT.active = false;
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
   AUTH — Google Sign-In + Role System (server-backed)
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
