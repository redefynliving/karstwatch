import { NextRequest, NextResponse } from "next/server";

/**
 * Proxies Indiana Geological & Water Survey ArcGIS karst layers as GeoJSON
 * so the browser never hits cross-origin restrictions.
 *
 * Verified live 2026-08: https://portal.igs.indiana.edu/arcgis/rest/services
 * Layers used:
 *   - Karst_Sinkhole_Areas   (MapServer layer id 116, polygons)
 *   - Karst_Springs          (points — layer id discoverable via ?f=pjson)
 * If these ever move, list services at:
 *   https://portal.igs.indiana.edu/arcgis/rest/services?f=pjson
 */
const BASE = "https://portal.igs.indiana.edu/arcgis/rest/services";

const LAYERS: { path: string; id?: number }[] = [
  { path: "Karst_Sinkhole_Areas/MapServer", id: 116 },
  { path: "Karst_Springs/MapServer" }, // layer id auto-discovered
];

async function queryLayer(path: string, layerId: number, bbox: string) {
  const url = new URL(`${BASE}/${path}/${layerId}/query`);
  url.searchParams.set("f", "geojson");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("geometry", bbox); // xmin,ymin,xmax,ymax in 4326
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("resultRecordCount", "2000"); // stay polite/free

  const r = await fetch(url.toString(), { next: { revalidate: 86400 } });
  if (!r.ok) throw new Error(`${path} returned HTTP ${r.status}`);
  return r.json();
}

export async function GET(req: NextRequest) {
  const bbox =
    req.nextUrl.searchParams.get("bbox") ?? "-87.0,39.0,-86.0,39.5"; // Monroe County-ish

  const features: GeoJSON.Feature[] = [];
  const errors: string[] = [];

  await Promise.all(
    LAYERS.map(async ({ path, id }) => {
      try {
        let layerId = id;
        if (layerId === undefined) {
          const meta = await (
            await fetch(`${BASE}/${path}?f=pjson`)
          ).json();
          layerId = meta.layers?.[0]?.id ?? 0;
          if (layerId === undefined) layerId = 0;
        }
        const gj = await queryLayer(path, layerId, bbox);
        for (const f of gj.features ?? []) {
          features.push({ ...f, properties: { ...f.properties, source: path } });
        }
      } catch (e) {
        errors.push((e as Error).message);
      }
    }),
  );

  return NextResponse.json(
    { type: "FeatureCollection", features, ...(errors.length ? { error: errors.join("; ") } : {}) },
    { status: 200 }, // fail soft: map loads, karst layer just stays empty
  );
}
