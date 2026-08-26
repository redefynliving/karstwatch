/**
 * Builds public/county-depressions.geojson — a precomputed set of depression
 * points across Monroe County, rendered as an instant heat view on load.
 *
 * Runs the same math as lib/depression.ts at coarse resolution per 6 km cell.
 * Usage: node scripts/build-county.mjs
 */
import { inflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

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

const Z = 12;                 // coarser zoom for county scale
const GRID = 192;             // per-cell analysis grid
const MIN_D = 1.5, MIN_A = 2000;

// Monroe County bounds
const W = -86.82, S = 38.95, E = -86.24, N = 39.42;

const lngToTileX = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) =>
  ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const tileXToLng = (tx, z) => (tx / 2 ** z) * 360 - 180;
const tileYToLat = (ty, z) => {
  const n = Math.PI - (2 * Math.PI * ty) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

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

// Split county into scan cells (~5km each)
const nCols = 10, nRows = 10;
const cellW = (E - W) / nCols, cellH = (N - S) / nRows;
const features = [];

for (let row = 0; row < nRows; row++) {
  for (let col = 0; col < nCols; col++) {
    const minLng = W + col * cellW, maxLng = minLng + cellW;
    const maxLat = N - row * cellH, minLat = maxLat - cellH;

    try {
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

      // sample to grid + smooth
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

      // components → centroid points weighted by depth
      const visited=new Uint8Array(residual.length); const stack=[];
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
        features.push({
          type:"Feature",
          geometry:{type:"Point",coordinates:[lng,lat]},
          properties:{ depth:+maxD.toFixed(1), acres:+(area/4046.86).toFixed(2) },
        });
      }
      process.stdout.write(`cell ${row*nCols+col}/${nRows*nRows} ok (${features.length} dips)\n`);
    } catch (e) {
      process.stdout.write(`cell ${row},${col} skipped: ${e.message}\n`);
    }
  }
}

writeFileSync(join(process.cwd(), "public/county-depressions.geojson"), JSON.stringify({
  type:"FeatureCollection",
  features,
}, null, 0));

console.log(`DONE: ${features.length} depressions across county`);
