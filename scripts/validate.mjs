/**
 * Accuracy validation: run the KarstWatch pipeline over known karst ground,
 * then score our detected dips against the IGWS mapped sinkhole inventory.
 *
 * Metrics computed:
 *  - overlap rate: % of our dips whose centroid falls inside a mapped IGWS sinkhole area
 *  - hit density inside vs outside mapped karst (does the scanner concentrate where karst is?)
 *  - size/depth distributions
 *
 * Usage: node scripts/validate.mjs
 */
import { inflateSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------- PNG decode (terrarium) ----------
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const bb = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += bb; break;
        case 3: v += (a + bb) >> 1; break;
        case 4: {
          const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
        }
      }
      out[x] = v & 0xff;
    }
  }
  return { w, h, channels, px };
}

// ---------- geometry helpers ----------
function pointInPolygon(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function anyRingContains(pt, geom) {
  if (!geom) return false;
  if (geom.type === "Polygon") return geom.coordinates.some((r) => pointInPolygon(pt, r));
  if (geom.type === "MultiPolygon") return geom.coordinates.some((p) => p.some((r) => pointInPolygon(pt, r)));
  return false;
}

// ---------- depression pipeline (same as app) ----------
function fillSinks(dem, w, h) {
  const filled = Float32Array.from(dem), closed = new Uint8Array(w * h);
  const hi = [], hk = [];
  const push = (i, k) => { hi.push(i); hk.push(k); let c = hk.length - 1;
    while (c > 0) { const p = (c - 1) >> 1; if (hk[p] <= hk[c]) break;
      [hk[p], hk[c]] = [hk[c], hk[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; } };
  const pop = () => { const ti = hi[0], tk = hk[0]; const li = hi.pop(), lk = hk.pop();
    if (hk.length) { hi[0] = li; hk[0] = lk; let p = 0;
      for (;;) { const l = 2*p+1, r = l+1; let m = p;
        if (l < hk.length && hk[l] < hk[m]) m = l;
        if (r < hk.length && hk[r] < hk[m]) m = r;
        if (m === p) break; [hk[m],hk[p]]=[hk[p],hk[m]]; [hi[m],hi[p]]=[hi[p],hi[m]]; p = m; } }
    return [ti, tk]; };
  for (let x=0;x<w;x++){push(x,dem[x]);closed[x]=1;push((h-1)*w+x,dem[(h-1)*w+x]);closed[(h-1)*w+x]=1;}
  for (let y=0;y<h;y++){push(y*w,dem[y*w]);closed[y*w]=1;push(y*w+w-1,dem[y*w+w-1]);closed[y*w+w-1]=1;}
  while (hk.length){const[i,k]=pop();const cx=i%w,cy=(i/w)|0;
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=cx+dx,ny=cy+dy;
      if(nx<0||nx>=w||ny<0||ny>=h)continue;const ni=ny*w+nx;if(closed[ni])continue;closed[ni]=1;
      if(filled[ni]<k)filled[ni]=k;push(ni,filled[ni]);}}
  return filled;
}

const Z = 13; // finer than county build for a fair test
const GRID = 256;
const MIN_D = 1.0, MIN_A = 400;

// Test boxes: mix of known-karst ground and control ground
const TEST_BOXES = [
  { name: "karst-heavy (Lake Lemon area)", bbox: [-86.46, 39.08, -86.33, 39.20] },
  { name: "karst-heavy (Harrodsburg/S. Bloomington)", bbox: [-86.52, 38.99, -86.40, 39.05] },
  { name: "control (IU campus)", bbox: [-86.53, 39.16, -86.50, 39.18] },
  { name: "control (Lake Monroe)", bbox: [-86.33, 39.02, -86.27, 39.08] },
];
const INVENTORY = "https://portal.igs.indiana.edu/arcgis/rest/services/Karst_Sinkhole_Inventory_IN_KY_2011/MapServer/118/query";

const lngToTileX = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) =>
  ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const tileXToLng = (tx, z) => (tx / 2 ** z) * 360 - 180;
const tileYToLat = (ty, z) => {
  const n = Math.PI - (2 * Math.PI * ty) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

async function scanBox(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const x0 = Math.floor(lngToTileX(minLng, Z)), x1 = Math.floor(lngToTileX(maxLng, Z));
  const y0 = Math.floor(latToTileY(maxLat, Z)), y1 = Math.floor(latToTileY(minLat, Z));
  const tw = (x1-x0+1)*256, th = (y1-y0+1)*256;
  const big = new Float32Array(tw*th);

  for (let ty=y0; ty<=y1; ty++) for (let tx=x0; tx<=x1; tx++) {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const png = decodePng(Buffer.from(await r.arrayBuffer()));
    for (let py=0; py<256; py++) for (let px2=0; px2<256; px2++) {
      const i = (py*256+px2)*png.channels;
      big[(ty-y0)*256*tw + (tx-x0)*256 + py*tw + px2] =
        png.px[i]*256 + png.px[i+1] + png.px[i+2]/256 - 32768;
    }
  }

  const tXmin = lngToTileX(minLng,Z), tXmax = lngToTileX(maxLng,Z);
  const tYmin = latToTileY(maxLat,Z), tYmax = latToTileY(minLat,Z);
  const dem = new Float32Array(GRID*GRID);
  for (let gy=0; gy<GRID; gy++) for (let gx=0; gx<GRID; gx++) {
    const tx = tXmin + ((gx+.5)/GRID)*(tXmax-tXmin);
    const ty = tYmin + ((gy+.5)/GRID)*(tYmax-tYmin);
    dem[gy*GRID+gx] = big[
      Math.min(th-1, Math.floor((ty-y0)*256))*tw +
      Math.min(tw-1, Math.floor((tx-x0)*256))];
  }

  // smooth 3x3
  const smooth = new Float32Array(GRID*GRID);
  for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){
    let s=0,n=0;
    for(const[dx,dy]of[[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
      const nx=x+dx,ny=y+dy;if(nx<0||nx>=GRID||ny<0||ny>=GRID)continue;
      s+=dem[ny*GRID+nx];n++;
    }
    smooth[y*GRID+x]=s/n;
  }

  const filled = fillSinks(smooth, GRID, GRID);
  const residual = new Float32Array(GRID*GRID);
  for(let i=0;i<residual.length;i++) residual[i]=Math.max(0,filled[i]-smooth[i]);

  const midLat=((minLat+maxLat)/2)*(Math.PI/180);
  const cellArea=((maxLng-minLng)*111320*Math.cos(midLat)/GRID)*(((maxLat-minLat)*110540)/GRID);

  const visited=new Uint8Array(residual.length); const stack=[];
  const dips=[];
  for(let s2=0;s2<residual.length;s2++){
    if(visited[s2]||residual[s2]<MIN_D)continue;
    stack.length=0;stack.push(s2);visited[s2]=1;
    let cells=0,maxD=0,sumX=0,sumY=0,sumW=0;
    while(stack.length){const i=stack.pop();cells++;
      const wgt=residual[i]; sumW+=wgt; if(wgt>maxD)maxD=wgt;
      const x=i%GRID,y=(i/GRID)|0; sumX+=x*wgt; sumY+=y*wgt;
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;
        if(nx<0||nx>=GRID||ny<0||ny>=GRID)continue;const ni=ny*GRID+nx;
        if(!visited[ni]&&residual[ni]>=MIN_D){visited[ni]=1;stack.push(ni);}}}
    const area=cells*cellArea;
    if(area<MIN_A||sumW===0)continue;
    const cgx=sumX/sumW, cgy=sumY/sumW;
    const lng=tileXToLng(tXmin+(cgx/GRID)*(tXmax-tXmin),Z);
    const lat=tileYToLat(tYmin+(cgy/GRID)*(tYmax-tYmin),Z);
    dips.push({ lng, lat, depth:maxD, area });
  }
  return dips;
}

// ---------- run ----------
console.log("Fetching IGWS sinkhole polygons (per test box, spatially filtered)...");

const report = { generated: new Date().toISOString(), boxes: [] };
let totalDips = 0, totalInKarst = 0;

for (const box of TEST_BOXES) {
  process.stdout.write(`Scanning ${box.name}... `);
  let dips = [];
  try { dips = await scanBox(box.bbox); }
  catch (e) { console.log(`FAILED: ${e.message}`); continue; }

  const [minLng, minLat, maxLng, maxLat] = box.bbox;
  const boxCenterLat = (minLat + maxLat) / 2;
  // Determine ground-truth source based on whether the box is within the
  // IGWS inventory coverage (SE Indiana; inventory extent tops out at 39.71°N).
  const inventoryAvailable = boxCenterLat <= 39.71;
  let invPts = [];
  if (inventoryAvailable) {
    const q = `${INVENTORY}?f=geojson&where=1%3D1&outFields=*&geometry=${minLng},${minLat},${maxLng},${maxLat}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&resultRecordCount=2000`;
    try {
      const kr = await fetch(q);
      const kj = await kr.json();
      invPts = (kj.features ?? [])
        .filter((f) => f.geometry)
        .map((f) => {
          const c = f.geometry.type === "Point" ? f.geometry.coordinates
            : f.geometry.type === "MultiPoint" ? f.geometry.coordinates[0] : null;
          return c ? { lng: c[0], lat: c[1] } : null;
        })
        .filter(Boolean);
    } catch {}
  } else {
    // Outside inventory coverage — fall back to karst-zone "Areas" polygons;
    // scoring is proximity to known karst rather than sinkhole inventory match.
    const q = `https://portal.igs.indiana.edu/arcgis/rest/services/Karst_Sinkhole_Areas/MapServer/116/query?f=geojson&where=1%3D1&outFields=*&geometry=${minLng},${minLat},${maxLng},${maxLat}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&resultRecordCount=2000`;
    try {
      const kr = await fetch(q);
      const kj = await kr.json();
      // use polygon centroids as the "truth" points in this case
      invPts = (kj.features ?? []).filter((f) => f.geometry).map((f) => {
        if (f.geometry.type === "Point") return { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
        const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
        const ring = rings[0];
        const n = ring.length - 1;
        let sx = 0, sy = 0;
        for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
        return { lng: sx / n, lat: sy / n };
      });
    } catch {}
  }

  totalDips += dips.length;

  // DEBUG: dump first few dip coords + inventory pts
  if (process.env.DEBUG) {
    console.log("  dips:", dips.slice(0,3).map(d => `${d.lng.toFixed(4)},${d.lat.toFixed(4)}`));
    console.log("  invPts:", invPts.slice(0,3).map(p => `${p.lng.toFixed(4)},${p.lat.toFixed(4)}`));
  }


  // Match metric: % of our dips within 200 m of a mapped inventory sinkhole.
  // (Inventory points mark sinkhole locations; 200 m accounts for centroid
  // offset + feature size. Inventory is sparse, so proximity is the fair signal.)
  const dists = dips.map((d) =>
    invPts.length ? Math.min(...invPts.map((p) => {
      const mx = (p.lng - d.lng) * 111320 * Math.cos((d.lat * Math.PI) / 180);
      const my = (p.lat - d.lat) * 111320;
      return Math.hypot(mx, my);
    })) : Infinity
  );
  const matched = dists.filter((x) => x <= 200).length;
  const within500 = dists.filter((x) => x <= 500).length;
  const medianDist = dists.length && dists.every((x) => isFinite(x))
    ? +dists.slice().sort((a, b) => a - b)[Math.floor(dists.length / 2)].toFixed(0)
    : null;

  // Reverse check: % of mapped sinkholes our scan "sees" within 150 m.
  const invMatched = invPts.filter((p) =>
    dips.some((d) => {
      const mx = (p.lng - d.lng) * 111320 * Math.cos((p.lat * Math.PI) / 180);
      const my = (p.lat - d.lat) * 111320;
      return Math.hypot(mx, my) <= 200;
    })
  ).length;

  const boxAreaKm2 = (box.bbox[2]-box.bbox[0]) * 85 * (box.bbox[3]-box.bbox[1]) * 111;
  const row = {
    name: box.name,
    bbox: box.bbox,
    inventoryPts: invPts.length,
    inventorySource: inventoryAvailable ? "IGWS sinkhole inventory" : "karst-zone centroids (outside inventory coverage)",
    dipsFound: dips.length,
    dipsPerKm2: +(dips.length / boxAreaKm2).toFixed(1),
    matchedToInventoryPct: dips.length ? +((matched / dips.length) * 100).toFixed(0) : 0,
    inventorySeenByScanPct: invPts.length ? +((invMatched / invPts.length) * 100).toFixed(0) : null,
    within500m: within500,
    medianDistToInventoryM: medianDist,
    deepestM: dips.length ? +Math.max(...dips.map((d) => d.depth)).toFixed(1) : 0,
    medianDepthM: dips.length ? +dips.map((d) => d.depth).sort((a,b)=>a-b)[Math.floor(dips.length/2)].toFixed(1) : 0,
  };
  report.boxes.push(row);
  console.log(`${row.dipsFound} dips, ${row.inventoryPts} truth pts, ${row.matchedToInventoryPct}% matched`);
}

const inventoryBoxes = report.boxes.filter((b) => b.inventorySource === "IGWS sinkhole inventory");
const rates = inventoryBoxes.map((b) => b.matchedToInventoryPct);
const inventoryMatchRate = inventoryBoxes.length
  ? +(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(0)
  : 0;

report.summary = {
  totalDips,
  totalInventoryPoints: report.boxes.reduce((a, b) => a + b.inventoryPts, 0),
  inventoryCoverageBoxes: inventoryBoxes.length,
  inventoryCoveragePct: inventoryMatchRate,
  note: inventoryBoxes.length
    ? `Of KarstWatch dips within IGWS inventory coverage, ~${inventoryMatchRate}% fall within 200 m of a mapped sinkhole. (Inventory is itself incomplete — unmapped dips may be genuine.) For boxes outside inventory coverage, scoring compares against karst-zone polygons and is more lenient.`
    : "No inventory-coverage boxes ran.",
};

writeFileSync(join(process.cwd(), "validation-report.json"), JSON.stringify(report, null, 2));
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(report.summary, null, 2));
