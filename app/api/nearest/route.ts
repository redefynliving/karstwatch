import { NextRequest, NextResponse } from "next/server";

/**
 * Distance from a point to the nearest IGWS-mapped karst feature
 * (sinkhole areas + springs), computed server-side.
 *
 * Free-tier: ArcGIS query with distance/geometry — no key needed.
 */
const BASE = "https://portal.igs.indiana.edu/arcgis/rest/services";
const LAYERS = [
  { path: "Karst_Sinkhole_Areas/MapServer", id: 116 },
  { path: "Karst_Springs/MapServer", id: undefined }, // auto-discover
];

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat & lng required" }, { status: 400 });
  }

  // Search a ~3 km box around the point.
  const dLat = 3 / 111;
  const dLng = 3 / (111 * Math.cos((lat * Math.PI) / 180));
  const bbox = `${(lng - dLng).toFixed(5)},${(lat - dLat).toFixed(5)},${(lng + dLng).toFixed(5)},${(lat + dLat).toFixed(5)}`;

  const nearest: { source: string; distanceM: number; name?: string }[] = [];
  const errors: string[] = [];

  await Promise.all(
    LAYERS.map(async ({ path, id }) => {
      try {
        let layerId = id;
        if (layerId === undefined) {
          const meta = await (await fetch(`${BASE}/${path}?f=pjson`)).json();
          layerId = meta.layers?.[0]?.id;
          if (layerId === undefined) return;
        }
        const url = new URL(`${BASE}/${path}/${layerId}/query`);
        url.searchParams.set("f", "geojson");
        url.searchParams.set("where", "1=1");
        url.searchParams.set("outFields", "*");
        url.searchParams.set("geometry", bbox);
        url.searchParams.set("geometryType", "esriGeometryEnvelope");
        url.searchParams.set("inSR", "4326");
        url.searchParams.set("outSR", "4326");
        url.searchParams.set("resultRecordCount", "500");

        const r = await fetch(url.toString(), { next: { revalidate: 86400 } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const gj = await r.json();
        const feats = gj.features ?? [];

        let bestM = Infinity;
        for (const f of feats) {
          const d = distToFeature(lng, lat, f);
          if (d < bestM) bestM = d;
        }
        if (bestM < Infinity) {
          nearest.push({
            source: path.split("/")[0],
            distanceM: Math.round(bestM),
          });
        }
      } catch (e) {
        errors.push(`${path}: ${(e as Error).message}`);
      }
    }),
  );

  return NextResponse.json(
    { nearest, ...(errors.length ? { error: errors.join("; ") } : {}) },
    { status: 200 },
  );
}

/** Rough meters from a lng/lat point to a GeoJSON feature (any geometry type). */
function distToFeature(lng: number, lat: number, f: GeoJSON.Feature): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const distPt = (plng: number, plat: number) => {
    const dLat = toRad(plat - lat);
    const dLng = toRad(plng - lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat)) * Math.cos(toRad(plat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const g = f.geometry;
  if (!g) return Infinity;
  let best = Infinity;
  const walk = (coords: GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][] | unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      const d = distPt(coords[0] as number, coords[1] as number);
      if (d < best) best = d;
      return;
    }
    if (Array.isArray(coords)) for (const c of coords) walk(c);
  };
  walk((g as Exclude<GeoJSON.Geometry, GeoJSON.GeometryCollection>).coordinates);
  return best; // NOTE: polygon edges are approximated by their vertices here
}
