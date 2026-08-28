import { NextRequest, NextResponse } from "next/server";

const SRC =
  "https://portal.igs.indiana.edu/arcgis/rest/services/Karst_Springs/FeatureServer/120/query";

const EMPTY = { type: "FeatureCollection", features: [] };

// IGS karst springs of south-central Indiana — public, no key required.
export async function GET(req: NextRequest) {
  const bbox = req.nextUrl.searchParams.get("bbox");
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
    resultRecordCount: "2000",
  });
  if (bbox) {
    params.set("geometry", bbox);
    params.set("geometryType", "esriGeometryEnvelope");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }
  try {
    const upstream = await fetch(`${SRC}?${params.toString()}`, {
      next: { revalidate: 86400 },
    });
    const data = upstream.ok ? await upstream.json() : null;
    if (!data || (data as { error?: unknown }).error || !Array.isArray((data as { features?: unknown[] }).features)) {
      return NextResponse.json(EMPTY);
    }
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200",
      },
    });
  } catch {
    return NextResponse.json(EMPTY);
  }
}
