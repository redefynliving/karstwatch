/**
 * Depression finder v2.
 *
 * Pipeline: fetch terrarium PNG tiles (or HD COGs) covering the bbox ->
 * decode to a grid -> 3x3 smooth -> priority-flood fill-sinks -> residual ->
 * connected components -> boundary-traced polygons + stats. Client-side.
 */

export interface Depression {
  polygon: GeoJSON.Polygon;
  bounds: [[number, number], [number, number]];
  depthM: number;
  areaM2: number;
  centroid: [number, number];
}

const GRID = 384;          // analysis grid (square)
const SCAN_ZOOM = 15;     // terrarium zoom (HD: ~4.7 m; fallback: z13 ~10 m)
const MIN_DEPTH_M = 1.0;   // ignore dips shallower than 1 m
const MIN_AREA_M2 = 500;   // ~ a 4-car driveway
const MAX_TILES = 256;     // hard cap on concurrent tile fetches

// ---- geo helpers -----------------------------------------------------------

function lngToTileX(lng: number, z: number) {
  return ((lng + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    Math.pow(2, z);
}
function tileXToLng(tx: number, z: number) {
  return (tx / Math.pow(2, z)) * 360 - 180;
}
function tileYToLat(ty: number, z: number) {
  const n = Math.PI - (2 * Math.PI * ty) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Decode terrarium RGB -> meters.
function decodeTerrarium(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(data.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = data[i*4] * 256 + data[i*4+1] + data[i*4+2] / 256 - 32768;
  }
  return out;
}

// ---- tile fetch -------------------------------------------------------------

interface GridResult {
  dem: Float32Array;
  zoom: number;
}

async function fetchGrid(bbox: [number, number, number, number]): Promise<GridResult> {
  // Try high-resolution terrarium (z=15, ~4.7 m/pixel). If the area is too
  // large for z15 (exceeds MAX_TILES), fall back to z=13 (~10 m).
  try {
    const dem = await fetchTerrariumGrid(bbox, 15);
    return { dem, zoom: 15 };
  } catch (e: any) {
    if (e?.message?.includes("too large")) {
      const dem = await fetchTerrariumGrid(bbox, 13);
      return { dem, zoom: 13 };
    }
    throw e;
  }
}

// Standard path — terrarium RGB tiles (z=15: ~4.7 m/pixel, z=13: ~10 m fallback).
async function fetchTerrariumGrid(bbox: [number, number, number, number], zoom?: number): Promise<Float32Array> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const z = zoom ?? SCAN_ZOOM;
  const x0 = Math.floor(lngToTileX(minLng, z));
  const x1 = Math.floor(lngToTileX(maxLng, z));
  const y0 = Math.floor(latToTileY(maxLat, z));
  const y1 = Math.floor(latToTileY(minLat, z));

  const tileCount = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (tileCount > MAX_TILES) throw new Error(`Area too large at z${z} — ${tileCount} tiles.`);

  const tiles = await Promise.all(
    Array.from({ length: (y1 - y0 + 1) * (x1 - x0 + 1) }, (_, k) => {
      const tx = x0 + (k % (x1 - x0 + 1));
      const ty = y0 + Math.floor(k / (x1 - x0 + 1));
      return fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`, { mode: "cors" })
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
  const fullDem = decodeTerrarium(ctx.getImageData(0, 0, tw, th).data);

  const tXmin = lngToTileX(minLng, z), tXmax = lngToTileX(maxLng, z);
  const tYmin = latToTileY(maxLat, z), tYmax = latToTileY(minLat, z);
  const dem = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const tx = tXmin + ((gx + 0.5) / GRID) * (tXmax - tXmin);
      const ty = tYmin + ((gy + 0.5) / GRID) * (tYmax - tYmin);
      const px = Math.min(tw - 1, Math.max(0, Math.floor((tx - x0) * 256)));
      const py = Math.min(th - 1, Math.max(0, Math.floor((ty - y0) * 256)));
      dem[gy * GRID + gx] = fullDem[py * tw + px];
    }
  }
  return dem;
}


// ---- fill sinks (priority-flood, Barnes et al.) ------------------------------

function fillSinks(dem: Float32Array, w: number, h: number): Float32Array {
  const filled = new Float32Array(dem);
  const closed = new Uint8Array(w*h);
  const heapIdx: number[] = [], heapKey: number[] = [];
  const push = (i: number, k: number) => {
    heapIdx.push(i); heapKey.push(k);
    let c = heapKey.length-1;
    while (c > 0) {
      const p = (c-1)>>1;
      if (heapKey[p] <= heapKey[c]) break;
      [heapKey[p], heapKey[c]] = [heapKey[c], heapKey[p]];
      [heapIdx[p], heapIdx[c]] = [heapIdx[c], heapIdx[p]];
      c = p;
    }
  };
  const pop = (): [number, number] => {
    const ti = heapIdx[0], tk = heapKey[0];
    const li = heapIdx.pop()!, lk = heapKey.pop()!;
    if (heapKey.length) {
      heapIdx[0]=li; heapKey[0]=lk;
      let p=0;
      for(;;){
        const l=2*p+1,r=l+1; let m=p;
        if(l<heapKey.length&&heapKey[l]<heapKey[m])m=l;
        if(r<heapKey.length&&heapKey[r]<heapKey[m])m=r;
        if(m===p)break;
        [heapKey[m],heapKey[p]]=[heapKey[p],heapKey[m]];
        [heapIdx[m],heapIdx[p]]=[heapIdx[p],heapIdx[m]];
        p=m;
      }
    }
    return [ti, tk];
  };
  for (let x=0;x<w;x++){push(x,dem[x]);closed[x]=1;push((h-1)*w+x,dem[(h-1)*w+x]);closed[(h-1)*w+x]=1;}
  for (let y=0;y<h;y++){push(y*w,dem[y*w]);closed[y*w]=1;push(y*w+w-1,dem[y*w+w-1]);closed[y*w+w-1]=1;}
  while (heapKey.length) {
    const [i,k]=pop();
    const cx=i%w,cy=(i/w)|0;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=cx+dx,ny=cy+dy;
      if(nx<0||nx>=w||ny<0||ny>=h)continue;
      const ni=ny*w+nx;
      if(closed[ni])continue;
      closed[ni]=1;
      if(filled[ni]<k)filled[ni]=k;
      push(ni,filled[ni]);
    }
  }
  return filled;
}

// ---- polygon tracing: cell-edge walk around each component -------------------
// Walks the boundary between inside/outside cells and emits closed rings —
// real sinkhole outlines, not bounding rectangles.

function tracePolygon(cellsSet: Set<number>, w: number, h: number): number[][] {
  // Horizontal & vertical cut edges between inside and outside cells.
  type Edge = { from: string; to: string; x1: number; y1: number; x2: number; y2: number };
  const edges = new Map<string, Edge>();

  const isInside = (x: number, y: number) => cellsSet.has(y*w+x);

  for (const ci of cellsSet) {
    const x = ci % w, y = (ci / w) | 0;
    // corner coordinates in cell units
    const tl = `${x},${y}`, tr = `${x+1},${y}`, bl = `${x},${y+1}`, br = `${x+1},${y+1}`;
    if (!isInside(x, y-1)) edges.set(`H${tl}-${tr}`, { from: tl, to: tr, x1:x, y1:y, x2:x+1, y2:y });
    if (!isInside(x, y+1)) edges.set(`H${bl}-${br}`, { from: br, to: bl, x1:x+1, y1:y+1, x2:x, y2:y+1 });
    if (!isInside(x-1, y)) edges.set(`V${tl}-${bl}`, { from: bl, to: tl, x1:x, y1:y+1, x2:x, y2:y });
    if (!isInside(x+1, y)) edges.set(`V${tr}-${br}`, { from: tr, to: br, x1:x+1, y1:y, x2:x+1, y2:y+1 });
  }

  // Walk edge-to-edge joining at shared corner points.
  const byFrom = new Map<string, Edge[]>();
  for (const e of edges.values()) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from)!.push(e);
  }

  const rings: number[][][] = [];
  const used = new Set<string>();
  for (const startEdge of edges.values()) {
    if (used.has(`${startEdge.x1},${startEdge.y1},${startEdge.x2},${startEdge.y2}`)) continue;
    const ring: number[][] = [];
    let cur = startEdge;
    let guard = 0;
    while (cur && guard++ < 100000) {
      used.add(`${cur.x1},${cur.y1},${cur.x2},${cur.y2}`);
      ring.push([cur.x1, cur.y1]);
      const candidates = byFrom.get(cur.to) ?? [];
      const next = candidates.find((e) => !used.has(`${e.x1},${e.y1},${e.x2},${e.y2}`));
      if (!next) break;
      cur = next;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  // Largest ring first (drop interior holes for simplicity).
  rings.sort((a, b) => b.length - a.length);
  return rings[0] ?? [];
}

// ---- main entry ---------------------------------------------------------------

export async function scanBboxForDepressions(
  bbox: [number, number, number, number],
): Promise<Depression[]> {
  const dem = await fetchGrid(bbox);
  const w = GRID, h = GRID;
  const z = dem.zoom;

  // 3x3 smoothing
  const smooth = new Float32Array(w*h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    let sum=0,n=0;
    for (const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      const nx=x+dx, ny=y+dy;
      if(nx<0||nx>=w||ny<0||ny>=h)continue;
      sum+=dem.dem[ny*w+nx]; n++;
    }
    smooth[y*w+x]=sum/n;
  }

  const filled = fillSinks(smooth, w, h);
  const residual = new Float32Array(w*h);
  for (let i=0;i<residual.length;i++) residual[i]=Math.max(0,filled[i]-smooth[i]);

  // True ground size per cell.
  const midLat=((bbox[1]+bbox[3])/2)*(Math.PI/180);
  const bboxW=(bbox[2]-bbox[0])*111320*Math.cos(midLat);
  const bboxH=(bbox[3]-bbox[1])*110540;
  const cellAreaM2=(bboxW/w)*(bboxH/h);

  // Components
  const visited=new Uint8Array(residual.length);
  const stack:number[]=[];
  const out:Depression[]=[];

  const gridToLng=(gx:number)=>{
    const t=lngToTileX(bbox[0],z)+((gx)/GRID)*(lngToTileX(bbox[2],z)-lngToTileX(bbox[0],z));
    return tileXToLng(t,z);
  };
  const gridToLat=(gy:number)=>{
    const t=latToTileY(bbox[3],z)+((gy)/GRID)*(latToTileY(bbox[1],z)-latToTileY(bbox[3],z));
    return tileYToLat(t,z);
  };

  for (let seed=0;seed<residual.length;seed++){
    if(visited[seed]||residual[seed]<MIN_DEPTH_M)continue;
    stack.length=0;stack.push(seed);visited[seed]=1;
    const cells:number[]=[];
    let maxDepth=0,sumResid=0;
    while(stack.length){
      const i=stack.pop()!;
      cells.push(i);
      sumResid+=residual[i];
      if(residual[i]>maxDepth)maxDepth=residual[i];
      const x=i%GRID,y=(i/GRID)|0;
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx,ny=y+dy;
        if(nx<0||nx>=GRID||ny<0||ny>=GRID)continue;
        const ni=ny*GRID+nx;
        if(!visited[ni]&&residual[ni]>=MIN_DEPTH_M){visited[ni]=1;stack.push(ni);}
      }
    }
    const areaM2=cells.length*cellAreaM2;
    if(areaM2<MIN_AREA_M2)continue;

    const ring=tracePolygon(new Set(cells), GRID, GRID);
    if(ring.length<4){
      continue; // couldn't trace cleanly — skip rather than emit junk
    }

    // ring cell corners -> lon/lat
    const coords=ring.map(([gx,gy])=>[gridToLng(gx),gridToLat(gy)]);
    coords.push(coords[0]); // close the ring

    let lngMin=Infinity,lngMax=-Infinity,latMin=Infinity,latMax=-Infinity;
    for(const[c2,c3] of coords){
      if(c2<lngMin)lngMin=c2;if(c2>lngMax)lngMax=c2;
      if(c3<latMin)latMin=c3;if(c3>latMax)latMax=c3;
    }

    out.push({
      polygon:{type:"Polygon",coordinates:[coords]},
      bounds:[[lngMin,latMin],[lngMax,latMax]],
      depthM:maxDepth,
      areaM2,
      centroid:[(lngMin+lngMax)/2, (latMin+latMax)/2],
    });
  }

  return out.sort((a,b)=>b.depthM-a.depthM);
}
