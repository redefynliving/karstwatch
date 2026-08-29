 // Build SSURGO south-central Indiana karst belt soil layer - zero key, public SDA Tabular POST
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
async function q(sql){
  const r = await fetch(SDA, { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ FORMAT:"JSON", QUERY: sql })});
  const j = await r.json();
  if(!j.Table) throw new Error(JSON.stringify(j).slice(0,500));
  return j.Table;
}

// 17 south-central Indiana karst belt counties with their areasymbol codes
const COUNTIES = [
  { name: "Monroe",      sym: "IN105", lng: -86.52, lat: 39.16 },
  { name: "Lawrence",    sym: "IN093", lng: -86.48, lat: 38.84 },
  { name: "Orange",      sym: "IN117", lng: -86.50, lat: 38.54 },
  { name: "Washington",  sym: "IN175", lng: -86.10, lat: 38.60 },
  { name: "Harrison",    sym: "IN061", lng: -86.12, lat: 38.20 },
  { name: "Crawford",    sym: "IN025", lng: -86.47, lat: 38.30 },
  { name: "Perry",       sym: "IN123", lng: -86.65, lat: 37.95 },
  { name: "Greene",      sym: "IN055", lng: -87.00, lat: 39.05 },
  { name: "Owen",        sym: "IN119", lng: -86.83, lat: 39.33 },
  { name: "Brown",       sym: "IN013", lng: -86.22, lat: 39.20 },
  { name: "Bartholomew", sym: "IN005", lng: -85.90, lat: 39.21 },
  { name: "Jackson",     sym: "IN071", lng: -86.02, lat: 38.91 },
  { name: "Jennings",    sym: "IN079", lng: -85.63, lat: 38.98 },
  { name: "Jefferson",   sym: "IN077", lng: -85.44, lat: 38.79 },
  { name: "Switzerland", sym: "IN155", lng: -85.03, lat: 38.83 },
  { name: "Clark",       sym: "IN019", lng: -85.71, lat: 38.48 },
  { name: "Floyd",       sym: "IN043", lng: -85.91, lat: 38.31 },
];

const symList = COUNTIES.map(c => `'${c.sym}'`).join(",");

// Get mapunits for all 17 counties with representative component + top horizon
const rows = await q(`
SELECT m.musym, m.muname, c.compname, c.comppct_r, c.hydgrp, ch.kffact, ch.claytotal_r, ch.sandtotal_r, l.areasymbol
FROM legend l
JOIN mapunit m ON m.lkey=l.lkey
JOIN component c ON c.mukey=m.mukey AND c.comppct_r = (SELECT MAX(c2.comppct_r) FROM component c2 WHERE c2.mukey=m.mukey)
JOIN chorizon ch ON ch.cokey=c.cokey AND ch.hzdept_r = (SELECT MIN(hzdept_r) FROM chorizon ch2 WHERE ch2.cokey=c.cokey)
WHERE l.areasymbol IN (${symList})
ORDER BY l.areasymbol, m.musym
`);
console.log(`Fetched ${rows.length} karst-belt mapunits`);

if (rows.length <= 300) {
  throw new Error(`Only ${rows.length} rows returned — upstream may be down or returning sparse data. Expected > 300. Not writing.`);
}

// Build centroid lookup by areasymbol
const centroidBySymbol = Object.fromEntries(COUNTIES.map(c => [c.sym, { lng: c.lng, lat: c.lat }]));

const features = rows.map(([musym, muname, compname, pct, hydgrp, kffact, clay, sand, areasym], i) => {
  const kf = parseFloat(kffact) || 0;
  const cl = parseFloat(clay) || 0;
  // septic failure heuristic: clay >27 AND hydgrp C/D AND kf>0.32 = high
  let septic = "LOW";
  if (cl >= 27 && (hydgrp==="C"||hydgrp==="D") && kf >= 0.32) septic="HIGH";
  else if (cl >= 20 && kf >= 0.28) septic="MODERATE";
  // spread points around county centroid for visualization
  const { lng: baseLng, lat: baseLat } = centroidBySymbol[areasym] ?? { lng: -86.52, lat: 39.16 };
  const lng = baseLng + ((i % 10)-4.5)*0.04 + (Math.random()-0.5)*0.02;
  const lat = baseLat + (Math.floor(i/10)-5)*0.04 + (Math.random()-0.5)*0.02;
  return {
    type:"Feature",
    geometry:{ type:"Point", coordinates:[+lng.toFixed(4), +lat.toFixed(4)] },
    properties:{ musym, muname: muname.slice(0,60), compname, hydgrp: hydgrp||"B", kffact: kf, claytotal: cl, septic_risk: septic }
  };
});

// Validate ≥ 95% of features have all required props
const REQUIRED = ["musym","muname","compname","hydgrp","kffact","claytotal","septic_risk"];
const valid = features.filter(f => REQUIRED.every(k => f.properties[k] !== undefined && f.properties[k] !== null));
const pct = valid.length / features.length;
console.log(`Required-props coverage: ${(pct*100).toFixed(1)}% (${valid.length}/${features.length})`);
if (pct < 0.95) {
  throw new Error(`Only ${(pct*100).toFixed(1)}% of features have all required props — schema mismatch. Not writing.`);
}

const fc = { type:"FeatureCollection", features, _meta:{ region:"south-central Indiana karst belt (17 counties)", count: rows.length, source:"USDA SDA Tabular post.rest (no key)", generated: new Date().toISOString() } };
const payload = JSON.stringify(fc);

// Final FeatureCollection validation (use in-memory fc directly)
if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features) || fc.features.length <= 300) {
  throw new Error("Validation failed: output is not a valid FeatureCollection with > 300 features.");
}

const outDir = join(process.cwd(),"public/static/geo");
mkdirSync(outDir, {recursive:true});
const out = join(outDir, "ssurgo-karstbelt.geojson");
writeFileSync(out, payload);
console.log(`Wrote ${features.length} soil points to ${out} (${(payload.length/1024).toFixed(1)} KB)`);
console.log(`Sample:`, features.slice(0,2).map(f=>f.properties));
const high = features.filter(f=>f.properties.septic_risk==="HIGH").length;
console.log(`Septic HIGH: ${high}, MODERATE: ${features.filter(f=>f.properties.septic_risk==="MODERATE").length}`);

// Also write lookup for RiskPanel
const lookup = Object.fromEntries(rows.map(r=>[r[0], {kffact: parseFloat(r[5])||0, clay: parseFloat(r[6])||0, hydgrp: r[4]||"B"}]));
writeFileSync(join(outDir,"ssurgo-lookup.json"), JSON.stringify(lookup, null, 2));
console.log("Lookup written");
