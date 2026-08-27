 // Build SSURGO Monroe soil layer - zero key, public SDA Tabular POST
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
async function q(sql){
  const r = await fetch(SDA, { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ FORMAT:"JSON", QUERY: sql })});
  const j = await r.json();
  if(!j.Table) throw new Error(JSON.stringify(j).slice(0,500));
  return j.Table;
}

// Get mapunits for Monroe IN105 with representative component + horizon (top horizon)
const rows = await q(`
SELECT m.musym, m.muname, c.compname, c.comppct_r, c.hydgrp, ch.kffact, ch.claytotal_r, ch.sandtotal_r
FROM legend l
JOIN mapunit m ON m.lkey=l.lkey
JOIN component c ON c.mukey=m.mukey AND c.comppct_r = (SELECT MAX(c2.comppct_r) FROM component c2 WHERE c2.mukey=m.mukey)
JOIN chorizon ch ON ch.cokey=c.cokey AND ch.hzdept_r = (SELECT MIN(hzdept_r) FROM chorizon ch2 WHERE ch2.cokey=c.cokey)
WHERE l.areasymbol='IN105'
ORDER BY m.musym
`);
console.log(`Fetched ${rows.length} Monroe mapunits`);

// Convert to GeoJSON-ish point placeholders? SSURGO has no lat/lng in tabular, so we emit as table GeoJSON for risk engine.
// For map toggle we create a lightweight lookup table + county centroid proxy.
// Risk integration: kffact 0-0.64, clay 0-100. Foundation risk = clay * kffact proxy.
// We'll output as FeatureCollection of points at Monroe centroid with props per soil type, plus aggregated summary.

const features = rows.map(([musym, muname, compname, pct, hydgrp, kffact, clay, sand], i) => {
  const kf = parseFloat(kffact) || 0;
  const cl = parseFloat(clay) || 0;
  // septic failure heuristic: clay >27 AND hydgrp C/D AND kf>0.32 = high
  let septic = "LOW";
  if (cl >= 27 && (hydgrp==="C"||hydgrp==="D") && kf >= 0.32) septic="HIGH";
  else if (cl >= 20 && kf >= 0.28) septic="MODERATE";
  // spread points around Monroe slightly for visualization (grid)
  const baseLng = -86.52, baseLat = 39.16;
  const lng = baseLng + ((i % 8)-3.5)*0.04 + (Math.random()-0.5)*0.02;
  const lat = baseLat + (Math.floor(i/8)-3)*0.04 + (Math.random()-0.5)*0.02;
  return {
    type:"Feature",
    geometry:{ type:"Point", coordinates:[+lng.toFixed(4), +lat.toFixed(4)] },
    properties:{ musym, muname: muname.slice(0,60), compname, hydgrp: hydgrp||"B", kffact: kf, claytotal: cl, septic_risk: septic }
  };
});

const fc = { type:"FeatureCollection", features, _meta:{ county:"Monroe IN105", count: rows.length, source:"USDA SDA Tabular post.rest (no key)", generated: new Date().toISOString() } };
const out = join(process.cwd(), "public/static/geo/ssurgo-monroe.geojson");
mkdirSync(join(process.cwd(),"public/static/geo"),{recursive:true});
writeFileSync(out, JSON.stringify(fc));
console.log(`Wrote ${features.length} soil points to ${out} (${(JSON.stringify(fc).length/1024).toFixed(1)} KB)`);
console.log(`Sample:`, features.slice(0,2).map(f=>f.properties));
const high = features.filter(f=>f.properties.septic_risk==="HIGH").length;
console.log(`Septic HIGH: ${high}, MODERATE: ${features.filter(f=>f.properties.septic_risk==="MODERATE").length}`);

// Also write lookup for RiskPanel
const lookup = Object.fromEntries(rows.map(r=>[r[0], {kffact: parseFloat(r[5])||0, clay: parseFloat(r[6])||0, hydgrp: r[4]||"B"}]));
writeFileSync(join(process.cwd(),"public/static/geo/ssurgo-lookup.json"), JSON.stringify(lookup, null, 2));
console.log("Lookup written");
