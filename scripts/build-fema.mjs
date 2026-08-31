 import { writeFileSync } from "node:fs";
import { join } from "node:path";

const URL = "https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0/query";
// Expanded to south-central Indiana karst belt
const BBOX = "-87.7,37.7,-85.8,39.65";
const MAX_SIZE_KB = 500;

const p = new URLSearchParams({
  where: "1=1",
  geometry: BBOX,
  geometryType: "esriGeometryEnvelope",
  inSR: "4326",
  spatialRel: "esriSpatialRelIntersects",
  outFields: "FLD_ZONE,ZONE_SUBTY",
  outSR: "4326",
  f: "geojson",
  resultRecordCount: "4000",
});

const r = await fetch(`${URL}?${p}`);
const gj = await r.json();

if (!Array.isArray(gj.features) || gj.features.length === 0) {
  throw new Error(`Upstream returned no features: ${JSON.stringify(gj).slice(0, 300)}`);
}

let feats = gj.features.filter(f => {
  const z = f.properties.FLD_ZONE;
  return z === "A" || z === "AE" || z === "AO" || z === "VE";
});
console.log(`HIGH raw ${feats.length}`);

if (feats.length < 8) {
  throw new Error(`Too few AE/A features (${feats.length}) — upstream may be down or returning sparse data. Not writing.`);
}

feats.sort((a, b) => {
  const getArea = f => {
    const c = f.geometry.coordinates?.[0];
    if (!c) return 0;
    let a = 0;
    for (let i = 0; i < c.length - 1; i++) a += (c[i + 1][0] - c[i][0]) * (c[i + 1][1] + c[i][1]);
    return Math.abs(a);
  };
  return getArea(b) - getArea(a);
});

// Keep up to 300 polygons; aggressive decimation will keep file ≤ 500 KB
feats = feats.slice(0, 300);

function decimate(ring, step = 8) {
  if (ring.length <= 8) return ring.map(([lng, lat]) => [+lng.toFixed(4), +lat.toFixed(4)]);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push([+ring[i][0].toFixed(4), +ring[i][1].toFixed(4)]);
  if (out[out.length - 1][0] !== out[0][0] || out[out.length - 1][1] !== out[0][1]) out.push(out[0]);
  return out;
}

for (const f of feats) {
  if (f.geometry.type === "Polygon") f.geometry.coordinates = f.geometry.coordinates.map(r => decimate(r, 8));
  else if (f.geometry.type === "MultiPolygon") f.geometry.coordinates = f.geometry.coordinates.map(poly => poly.map(r => decimate(r, 8)));
  f.properties = { FLD_ZONE: f.properties.FLD_ZONE, flood_risk: "HIGH" };
}

const fc = { type: "FeatureCollection", features: feats, _meta: { source: "FEMA USA_Flood_Hazard public no key", bbox: BBOX, count: feats.length } };
const payload = JSON.stringify(fc);
const sizeKB = payload.length / 1024;
console.log(`Output: ${feats.length} features, ${sizeKB.toFixed(1)} KB`);

if (sizeKB > MAX_SIZE_KB) {
  throw new Error(`Output ${sizeKB.toFixed(1)} KB exceeds ${MAX_SIZE_KB} KB limit — increase decimation step or reduce polygon cap.`);
}

// Validate FeatureCollection structure
if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features) || fc.features.length < 8) {
  throw new Error("Validation failed: output is not a valid FeatureCollection with ≥ 8 features.");
}

const out = join(process.cwd(), "public/static/geo/fema-flood.geojson");
writeFileSync(out, payload);
console.log(`Wrote ${feats.length} HIGH flood polys ${sizeKB.toFixed(1)}KB → ${out}`);