/**
 * Smoke test for the FIXED pipeline: real bbox-sized cells, 3x3 smoothing,
 * realistic thresholds. Run: node scripts/smoke.mjs
 */
import { inflateSync } from "node:zlib";

function decodePng(buf) {
  const b = buf;
  let pos = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString("ascii", pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
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

const GRID = 400, Z = 13;
const bbox = [-86.62, 39.12, -86.50, 39.22]; // ~10.3 km wide karst area
const [minLng, minLat, maxLng, maxLat] = bbox;
const lngToTileX = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) =>
  ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

const x0 = Math.floor(lngToTileX(minLng, Z)), x1 = Math.floor(lngToTileX(maxLng, Z));
const y0 = Math.floor(latToTileY(maxLat, Z)), y1 = Math.floor(latToTileY(minLat, Z));

const tw = (x1 - x0 + 1) * 256, th = (y1 - y0 + 1) * 256;
const big = new Float32Array(tw * th);
for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
  const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
  if (!r.ok) throw new Error(`tile ${tx},${ty}: HTTP ${r.status}`);
  const png = decodePng(Buffer.from(await r.arrayBuffer()));
  for (let py = 0; py < 256; py++) for (let px2 = 0; px2 < 256; px2++) {
    const i = (py * 256 + px2) * png.channels;
    big[(ty - y0) * 256 * tw + (tx - x0) * 256 + py * tw + px2] =
      png.px[i] * 256 + png.px[i + 1] + png.px[i + 2] / 256 - 32768;
  }
}

const tXmin = lngToTileX(minLng, Z), tXmax = lngToTileX(maxLng, Z);
const tYmin = latToTileY(maxLat, Z), tYmax = latToTileY(minLat, Z);
const dem = new Float32Array(GRID * GRID);
for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
  const tx = tXmin + ((gx + .5) / GRID) * (tXmax - tXmin);
  const ty = tYmin + ((gy + .5) / GRID) * (tYmax - tYmin);
  dem[gy * GRID + gx] = big[
    Math.min(th - 1, Math.floor((ty - y0) * 256)) * tw +
    Math.min(tw - 1, Math.floor((tx - x0) * 256))];
}
console.log(`DEM ${GRID}x${GRID} over ${(bbox[2]-bbox[0])*85.6|0} m — ok`);

// FIXED: true cell size from bbox extent
const midLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
const cellAreaM2 = (((bbox[2]-bbox[0]) * 111320 * Math.cos(midLat)) / GRID) *
                   (((bbox[3]-bbox[1]) * 110540) / GRID);
console.log(`cell area: ${cellAreaM2.toFixed(0)} m² per grid cell (${Math.sqrt(cellAreaM2).toFixed(1)} m square)`);

// 3x3 smooth (FIX)
const smooth = new Float32Array(GRID * GRID);
for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
  let s = 0, n = 0;
  for (const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
    const nx=x+dx, ny=y+dy; if(nx<0||nx>=GRID||ny<0||ny>=GRID) continue;
    s += dem[ny*GRID+nx]; n++;
  }
  smooth[y*GRID+x] = s/n;
}

// fill sinks
function fillSinks(demIn, w, h) {
  const filled = Float32Array.from(demIn), closed = new Uint8Array(w*h);
  const hi=[], hk=[];
  const push=(i,k)=>{hi.push(i);hk.push(k);let c=hk.length-1;
    while(c>0){const p=(c-1)>>1;if(hk[p]<=hk[c])break;[hk[p],hk[c]]=[hk[c],hk[p]];[hi[p],hi[c]]=[hi[c],hi[p]];c=p;}};
  const pop=()=>{const ti=hi[0],tk=hk[0];const li=hi.pop(),lk=hk.pop();
    if(hk.length){hi[0]=li;hk[0]=lk;let p=0;
      for(;;){const l=2*p+1,r=l+1;let m=p;
        if(l<hk.length&&hk[l]<hk[m])m=l;if(r<hk.length&&hk[r]<hk[m])m=r;
        if(m===p)break;[hk[m],hk[p]]=[hk[p],hk[m]];[hi[m],hi[p]]=[hi[p],hi[m]];p=m;}}
    return[ti,tk];};
  for(let x=0;x<w;x++){push(x,demIn[x]);closed[x]=1;push((h-1)*w+x,demIn[(h-1)*w+x]);closed[(h-1)*w+x]=1;}
  for(let y=0;y<h;y++){push(y*w,demIn[y*w]);closed[y*w]=1;push(y*w+w-1,demIn[y*w+w-1]);closed[y*w+w-1]=1;}
  while(hk.length){const[i,k]=pop();const cx=i%w,cy=(i/w)|0;
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=cx+dx,ny=cy+dy;
      if(nx<0||nx>=w||ny<0||ny>=h)continue;const ni=ny*w+nx;if(closed[ni])continue;closed[ni]=1;
      if(filled[ni]<k)filled[ni]=k;push(ni,filled[ni]);}}
  return filled;
}

const filled = fillSinks(smooth, GRID, GRID);
const residual = new Float32Array(GRID*GRID);
for(let i=0;i<residual.length;i++) residual[i]=Math.max(0,filled[i]-smooth[i]);

// realistic thresholds: >=1m deep, >=500 m² (a real sinkhole, not noise)
const MIN_D = 1.0, MIN_A = 500;
const visited=new Uint8Array(residual.length); const stack=[];
let kept=0; const tops=[];
for(let s=0;s<residual.length;s++){
  if(visited[s]||residual[s]<MIN_D) continue;
  stack.length=0;stack.push(s);visited[s]=1;
  let cells=0,maxD=0;
  while(stack.length){const i=stack.pop();cells++;if(residual[i]>maxD)maxD=residual[i];
    const x=i%GRID,y=(i/GRID)|0;
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;
      if(nx<0||nx>=GRID||ny<0||ny>=GRID)continue;const ni=ny*GRID+nx;
      if(!visited[ni]&&residual[ni]>=MIN_D){visited[ni]=1;stack.push(ni);}}}
  const area=cells*cellAreaM2;
  if(area>=MIN_A){kept++;tops.push({depth:+maxD.toFixed(1),acres:+(area/4046.86).toFixed(2)});}
}
console.log(`depressions kept: ${kept}`);
console.log("top 8:", JSON.stringify(tops.sort((a,b)=>b.depth-a.depth).slice(0,8)));
