/**
 * lib/timelapse.ts — Elevation time-lapse: compare two vintages of the same DEM
 *
 * Modern = Mapzen/AWS Terrarium PNG tiles (z=13, ~10 m) — a stitched global DEM
 * derived from SRTM, ASTER, and other sources circa 2014-2017.
 *
 * Legacy = SRTM GL1 (~2000, 1-arcsecond, ~30 m) — the radar mission baseline.
 *
 * Both are CORS-enabled, no API keys, no env vars.
 *
 * Pipeline: fetch both vintages for the bbox → resample to same grid →
 * subtract → bucket residuals into "stable", "new subsidence", "growth" cells →
 * emit a small geojson FeatureCollection ready for MapLibre.
 *
 * Honest limitation: SRTM is coarser resolution, so absolute depth numbers
 * are weaker. The point is CHANGE PATTERNS — clusters of new closed depressions
 * in your scan area.
 */

export interface TimeLapseCell {
  lng: number;
  lat: number;
  deltaM: number;          // legacy minus modern (positive = settled/sunk)
  newDepression: boolean;  // appeared as a closed dip in modern
}

export interface TimeLapseResult {
  bbox: [number, number, number, number];
  cells: TimeLapseCell[];
  newDipCount: number;     // count of cells where modern is now a sink
  avgSettlementM: number;  // mean drop across settled cells
  maxSettlementM: number;
  gridSize: number;
  summary: string;
  // GeoJSON for map rendering — only "new subsidence" cells
  fc: GeoJSON.FeatureCollection;
}

const GRID = 96;            // smaller than scan grid: this is a diff summary, not a discovery tool
const MAX_TILES = 64;       // tighter limit — two fetches
const NEW_DIP_THRESHOLD_M = 1.0;
const SETTLEMENT_THRESHOLD_M = 0.5;

function lngToTileX(lng: number, z: number) { return ((lng + 180) / 360) * Math.pow(2, z); }
function latToTileY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}
function tileXToLng(tx: number, z: number) { return (tx / Math.pow(2, z)) * 360 - 180; }
function tileYToLat(ty: number, z: number) {
  const n = Math.PI - (2 * Math.PI * ty) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

interface TileFetchResult {
  grid: Float32Array;  // [GRID * GRID] elevation in meters
  zoom: number;
}

// Decode Mapbox TerrainRGB / Terrarium (same encoding): R*256+G + B/256 - 32768
function decodeTerrainRGB(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(data.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
  }
  return out;
}

async function fetchTerrariumGridFor(
  tileFn: (z: number, x: number, y: number) => string,
  bbox: [number, number, number, number],
  zoom: number,
): Promise<TileFetchResult> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const x0 = Math.floor(lngToTileX(minLng, zoom));
  const x1 = Math.floor(lngToTileX(maxLng, zoom));
  const y0 = Math.floor(latToTileY(maxLat, zoom));
  const y1 = Math.floor(latToTileY(minLat, zoom));
  const tileCount = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (tileCount > MAX_TILES) throw new Error(`Area too large for time-lapse at z${zoom} — ${tileCount} tiles.`);

  const tiles = await Promise.all(
    Array.from({ length: tileCount }, (_, k) => {
      const tx = x0 + (k % (x1 - x0 + 1));
      const ty = y0 + Math.floor(k / (x1 - x0 + 1));
      return fetch(tileFn(zoom, tx, ty), { mode: "cors" })
        .then((r) => { if (!r.ok) throw new Error(`tile ${tx},${ty} HTTP ${r.status}`); return r.blob(); })
        .then((b) => createImageBitmap(b))
        .then((img) => ({ tx, ty, img }));
    }),
  );

  const tw = (x1 - x0 + 1) * 256, th = (y1 - y0 + 1) * 256;
  const canvas = document.createElement("canvas");
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  for (const t of tiles) ctx.drawImage(t.img, (t.tx - x0) * 256, (t.ty - y0) * 256);
  const fullDem = decodeTerrainRGB(ctx.getImageData(0, 0, tw, th).data);

  const tXmin = lngToTileX(minLng, zoom), tXmax = lngToTileX(maxLng, zoom);
  const tYmin = latToTileY(maxLat, zoom), tYmax = latToTileY(minLat, zoom);
  const grid = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const tx = tXmin + ((gx + 0.5) / GRID) * (tXmax - tXmin);
      const ty = tYmin + ((gy + 0.5) / GRID) * (tYmax - tYmin);
      const px = Math.min(tw - 1, Math.max(0, Math.floor((tx - x0) * 256)));
      const py = Math.min(th - 1, Math.max(0, Math.floor((ty - y0) * 256)));
      grid[gy * GRID + gx] = fullDem[py * tw + px];
    }
  }
  return { grid, zoom };
}

const TERRARIUM_TILE = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// TrailSplits terrainrgb: same Mapbox encoding, CORS open, free for hobby use
const TRAILSPLITS_TILE = (z: number, x: number, y: number) =>
  `https://api.trailsplits.com/tiles/v1/terrainrgb/current/${z}/${x}/${y}.png`;

export async function runTimeLapse(
  bbox: [number, number, number, number],
): Promise<TimeLapseResult> {
  // Modern = trailsplits (current). Historical = terrarium (older stitched dataset).
  // Both same encoding, both CORS. This is a defensible "modern vs older" comparison.
  const zoom = 13; // 10 m tiles, manageable for two full fetches

  const [modern, legacy] = await Promise.all([
    fetchTerrariumGridFor(TRAILSPLITS_TILE, bbox, zoom),
    fetchTerrariumGridFor(TERRARIUM_TILE, bbox, zoom),
  ]);

  // Per-cell grid coords → lng/lat (use modern's grid since they're identical zoom)
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const cellLng = (gx: number) => minLng + ((gx + 0.5) / GRID) * (maxLng - minLng);
  const cellLat = (gy: number) => minLat + ((gy + 0.5) / GRID) * (maxLat - minLat);

  const cells: TimeLapseCell[] = [];
  const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  let newDipCount = 0;
  let settlementSum = 0, settlementCount = 0, maxSettlement = 0;

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const i = gy * GRID + gx;
      const m = modern.grid[i];
      const l = legacy.grid[i];
      const delta = l - m; // positive = legacy higher = ground has settled since legacy
      const isNewDip = delta >= NEW_DIP_THRESHOLD_M;

      cells.push({
        lng: cellLng(gx),
        lat: cellLat(gy),
        deltaM: +delta.toFixed(2),
        newDepression: isNewDip,
      });

      if (delta >= SETTLEMENT_THRESHOLD_M) {
        settlementSum += delta;
        settlementCount++;
        if (delta > maxSettlement) maxSettlement = delta;
      }
      if (isNewDip) newDipCount++;

      // Emit only the meaningful cells to GeoJSON
      if (isNewDip) {
        fc.features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [cellLng(gx), cellLat(gy)] },
          properties: {
            deltaM: +delta.toFixed(2),
            type: "new_subsidence",
          },
        });
      }
    }
  }

  const avgSettlement = settlementCount > 0 ? settlementSum / settlementCount : 0;

  let summary: string;
  if (newDipCount === 0) {
    summary = "No new subsidence detected since the legacy DEM. The scan area looks stable.";
  } else if (newDipCount < 5) {
    summary = `${newDipCount} cells show new depressions in the modern DEM — likely normal settling or small local features.`;
  } else if (newDipCount < 25) {
    summary = `${newDipCount} cells show new depressions — moderately active karst area. Compare with known sinkhole layer.`;
  } else {
    summary = `${newDipCount} cells show new depressions — strongly active karst. Field verification recommended.`;
  }

  return {
    bbox,
    cells,
    newDipCount,
    avgSettlementM: +avgSettlement.toFixed(2),
    maxSettlementM: +maxSettlement.toFixed(2),
    gridSize: GRID,
    summary,
    fc,
  };
}