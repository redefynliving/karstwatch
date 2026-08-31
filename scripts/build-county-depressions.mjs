// scripts/build-county-depressions.mjs
// Pre-scans the 17-county south-central Indiana karst belt for terrain
// depressions ("dips") using public AWS Terrarium elevation tiles (no key).
// Runs on GitHub Actions via .github/workflows/build-data.yml, where pngjs
// is installed ad hoc (npm install --no-save pngjs).
//
// Method: stitch Terrarium tiles at zoom 13 into a per-county elevation grid,
// priority-flood fill (Barnes) to find closed depressions, cluster the filled
// cells, and emit one GeoJSON polygon per dip with depth/area/circularity and
// a likely/uncertain/low confidence class. Checkpoint-writes after each county
// so a mid-run failure never loses completed counties.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const ZOOM = 13;
const TILE = 256;
const TILE_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const FETCH_CONCURRENCY = 6;

const MIN_DEPTH_M = 0.5;        // cell must fill at least this much to count as dip
const MIN_DIP_AREA_M2 = 500;    // noise filter for clusters
const MIN_DIP_MAXDEPTH_M = 0.75;
const MAX_PER_COUNTY = 400;     // size guard if output grows past MAX_BYTES
const MAX_BYTES = 2 * 1024 * 1024;

const OUT_DIR = join(process.cwd(), "public");
const OUT_FILE = join(OUT_DIR, "county-depressions.geojson");

// [name, west, south, east, north] — approximate county bounds
const COUNTIES = [
  ["Monroe", -86.66, 38.99, -86.34, 39.32],
  ["Lawrence", -86.72, 38.66, -86.31, 39.03],
  ["Orange", -86.71, 38.41, -86.30, 38.70],
  ["Washington", -86.35, 38.51, -85.94, 38.76],
  ["Harrison", -86.27, 38.05, -85.92, 38.38],
  ["Crawford", -86.72, 38.19, -86.33, 38.48],
  ["Perry", -86.83, 37.88, -86.42, 38.11],
  ["Greene", -87.22, 38.88, -86.81, 39.13],
  ["Owen", -87.00, 39.17, -86.58, 39.46],
  ["Brown", -86.38, 39.07, -86.08, 39.36],
  ["Bartholomew", -86.10, 39.05, -85.74, 39.36],
  ["Jackson", -86.22, 38.75, -85.82, 39.08],
  ["Jennings", -85.85, 38.83, -85.49, 39.13],
  ["Jefferson", -85.65, 38.60, -85.30, 38.99],
  ["Switzerland", -85.22, 38.69, -84.84, 38.99],
  ["Clark", -85.92, 38.31, -85.55, 38.66],
  ["Floyd", -86.05, 38.19, -85.79, 38.46],
];

// ---------- geo math ----------
function lngToTileX(lng, z) { return Math.floor(((lng + 180) / 360) * 2 ** z); }
function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
function pxToLng(gx) { return (gx / 2 ** (ZOOM + 8)) * 360 - 180; }
function pxToLat(gy) {
  const n = Math.PI * (1 - (2 * gy) / 2 ** (ZOOM + 8));
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}
const metersPerPx = (latDeg) =>
  (156543.03392 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** ZOOM;

// ---------- tile fetching ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(z, x, y) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(TILE_URL(z, x, y));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
      const g = new Float32Array(TILE * TILE);
      const d = png.data;
      for (let i = 0, j = 0; i < g.length; i++, j += 4) {
        g[i] = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768; // Terrarium decode
      }
      return g;
    } catch (e) {
      if (attempt === 3) throw new Error(`tile ${z}/${x}/${y}: ${e.message}`);
      await sleep(400 * attempt);
    }
  }
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]);
      }
    })
  );
}

// ---------- priority flood (Barnes fill) ----------
class MinHeap {
  constructor() { this.v = []; this.k = []; }
  get size() { return this.v.length; }
  push(val, idx) {
    const v = this.v, k = this.k;
    v.push(val); k.push(idx);
    let i = v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [v[p], v[i]] = [v[i], v[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop() {
    const v = this.v, k = this.k;
    const topV = v[0], topK = k[0];
    const lastV = v.pop(), lastK = k.pop();
    if (v.length) {
      v[0] = lastV; k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < v.length && v[l] < v[m]) m = l;
        if (r < v.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [v[m], v[i]] = [v[i], v[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return [topV, topK];
  }
}

function priorityFlood(elev, w, h) {
  const filled = new Float32Array(elev);
  const seen = new Uint8Array(w * h);
  const heap = new MinHeap();
  const relax = (j, level) => {
    if (seen[j]) return;
    seen[j] = 1;
    filled[j] = Math.max(elev[j], level);
    heap.push(filled[j], j);
  };
  for (let x = 0; x < w; x++) {
    relax(x, elev[x]);
    const b = (h - 1) * w + x;
    relax(b, elev[b]);
  }
  for (let y = 1; y < h - 1; y++) {
    const l = y * w;
    relax(l, elev[l]);
    const r = y * w + w - 1;
    relax(r, elev[r]);
  }
  while (heap.size > 0) {
    const [level, i] = heap.pop();
    const x = i % w;
    if (x > 0) relax(i - 1, level);
    if (x < w - 1) relax(i + 1, level);
    if (i >= w) relax(i - w, level);
    if (i + w < w * h) relax(i + w, level);
  }
  return filled;
}

// ---------- clustering (4-connected components on dip cells) ----------
function clusterDips(diff, w, h) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < diff.length; i++) if (diff[i] >= MIN_DEPTH_M) mask[i] = 1;
  const label = new Int32Array(w * h).fill(-1);
  const clusters = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    const id = clusters.length;
    const cells = [];
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const x = i % w;
      if (x > 0 && mask[i - 1] && label[i - 1] === -1) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && label[i + 1] === -1) { label[i + 1] = id; stack.push(i + 1); }
      if (i >= w && mask[i - w] && label[i - w] === -1) { label[i - w] = id; stack.push(i - w); }
      if (i + w < w * h && mask[i + w] && label[i + w] === -1) { label[i + w] = id; stack.push(i + w); }
    }
    clusters.push(cells);
  }
  return { clusters, label };
}

// ---------- per-county scan ----------
async function scanCounty(name, bbox) {
  const [w, s, e, n] = bbox;
  const x0 = lngToTileX(w, ZOOM), x1 = lngToTileX(e, ZOOM);
  const y0 = latToTileY(n, ZOOM), y1 = latToTileY(s, ZOOM); // north edge = smaller y
  const tilesX = x1 - x0 + 1, tilesY = y1 - y0 + 1;
  const W = tilesX * TILE, H = tilesY * TILE;
  console.log(`  ${name}: ${tilesX * tilesY} tiles, grid ${W}x${H}`);

  const elev = new Float32Array(W * H);
  const coords = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) coords.push([tx, ty]);
  let done = 0;
  await pool(coords, FETCH_CONCURRENCY, async ([tx, ty]) => {
    const g = await fetchTile(ZOOM, tx, ty);
    const ox = (tx - x0) * TILE, oy = (ty - y0) * TILE;
    for (let row = 0; row < TILE; row++) {
      elev.set(g.subarray(row * TILE, row * TILE + TILE), (oy + row) * W + ox);
    }
    done++;
    if (done % 40 === 0) console.log(`  ${name}: ${done}/${coords.length} tiles`);
  });

  const filled = priorityFlood(elev, W, H);
  const diff = new Float32Array(W * H);
  for (let i = 0; i < diff.length; i++) diff[i] = filled[i] - elev[i];

  const { clusters, label } = clusterDips(diff, W, H);

  const centerLat = (s + n) / 2;
  const cellM = metersPerPx(centerLat);
  const cellArea = cellM * cellM;
  const originGX = x0 * TILE, originGY = y0 * TILE;

  const features = [];
  for (let id = 0; id < clusters.length; id++) {
    const cells = clusters[id];
    const area = cells.length * cellArea;
    if (area < MIN_DIP_AREA_M2) continue;

    let maxDepth = 0, sumDepth = 0, sumGX = 0, sumGY = 0, edgeCount = 0;
    const boundary = [];
    for (const i of cells) {
      const d = diff[i];
      if (d > maxDepth) maxDepth = d;
      sumDepth += d;
      const gx = originGX + (i % W), gy = originGY + Math.floor(i / W);
      sumGX += gx; sumGY += gy;
      const x = i % W;
      const isEdge =
        !(x > 0 && label[i - 1] === id) ||
        !(x < W - 1 && label[i + 1] === id) ||
        !(i >= W && label[i - W] === id) ||
        !(i + W < W * H && label[i + W] === id);
      if (isEdge) { edgeCount++; boundary.push([gx, gy]); }
    }
    if (maxDepth < MIN_DIP_MAXDEPTH_M) continue;

    const cGX = sumGX / cells.length, cGY = sumGY / cells.length;
    const cLng = pxToLng(cGX), cLat = pxToLat(cGY);
    if (cLng < w || cLng > e || cLat < s || cLat > n) continue; // dips centered in-county only

    const perimeter = edgeCount * cellM; // staircase boundary: overestimates slightly
    const circ = (4 * Math.PI * area) / (perimeter * perimeter);
    let confidence = "low";
    if (circ > 0.6 && maxDepth >= 1.5) confidence = "likely";
    else if (circ > 0.4 || maxDepth >= 1.0) confidence = "uncertain";

    // Polygon ring: boundary points ordered by angle around centroid.
    // Dip shapes are approximations — good enough for a heatmap layer.
    let ring;
    if (boundary.length >= 3) {
      boundary.sort((a, b) => Math.atan2(a[1] - cGY, a[0] - cGX) - Math.atan2(b[1] - cGY, b[0] - cGX));
      ring = boundary.map(([gx, gy]) => [+pxToLng(gx).toFixed(5), +pxToLat(gy).toFixed(5)]);
      ring.push(ring[0]);
    } else {
      const half = ((cellM / 2) / 111320); // half cell in degrees, rough
      ring = [
        [cLng - half, cLat - half], [cLng + half, cLat - half],
        [cLng + half, cLat + half], [cLng - half, cLat + half],
        [cLng - half, cLat - half],
      ].map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
    }

    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        county: name,
        depthM: +maxDepth.toFixed(2),
        avgDepthM: +(sumDepth / cells.length).toFixed(2),
        areaM2: Math.round(area),
        perimeterM: Math.round(perimeter),
        circularity: +circ.toFixed(3),
        confidence,
      },
    });
  }
  return features;
}

// ---------- output ----------
function toFC(features) {
  return JSON.stringify({
    type: "FeatureCollection",
    features,
    _meta: {
      source: "AWS Terrarium elevation tiles (public, no key) — priority-flood depression detection",
      zoom: ZOOM,
      counties: COUNTIES.map((c) => c[0]),
      count: features.length,
      generated: new Date().toISOString(),
    },
  });
}

function writeOut(features) {
  let payload = toFC(features);
  if (payload.length > MAX_BYTES) {
    const byCounty = new Map();
    for (const f of features) {
      const k = f.properties.county;
      if (!byCounty.has(k)) byCounty.set(k, []);
      byCounty.get(k).push(f);
    }
    const trimmed = [];
    for (const arr of byCounty.values()) {
      arr.sort((a, b) => b.properties.depthM - a.properties.depthM);
      trimmed.push(...arr.slice(0, MAX_PER_COUNTY));
    }
    console.log(`Size guard: trimmed ${features.length} -> ${trimmed.length} dips`);
    payload = toFC(trimmed);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, payload);
  console.log(`  wrote ${OUT_FILE} (${(payload.length / 1024).toFixed(0)} KB)`);
}

// ---------- main ----------
const all = [];
const failed = [];
for (const [name, w, s, e, n] of COUNTIES) {
  console.log(`Scanning ${name}…`);
  try {
    const feats = await scanCounty(name, [w, s, e, n]);
    all.push(...feats);
    console.log(`${name}: ${feats.length} dips`);
    writeOut(all); // checkpoint after each county
  } catch (err) {
    console.error(`COUNTY FAILED ${name}: ${err.message}`);
    failed.push(name);
  }
}

if (all.length < 200) {
  throw new Error(`Only ${all.length} dips total — suspiciously low (Monroe alone should yield hundreds). Failing loudly.`);
}
writeOut(all);
console.log(`Done: ${all.length} dips across ${COUNTIES.length - failed.length}/${COUNTIES.length} counties.`);
if (failed.length) console.log(`Failed/skipped counties: ${failed.join(", ")}`);
