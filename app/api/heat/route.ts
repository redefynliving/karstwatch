import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * County-wide depression heat view — served from a precomputed GeoJSON file
 * (built once by scripts/build-county.mjs, committed to /public).
 * Static = free, instant, no lambda time.
 */
export async function GET() {
  const p = join(process.cwd(), "public", "county-depressions.geojson");
  if (!existsSync(p)) {
    return NextResponse.json(
      { error: "not built yet" },
      { status: 404 }
    );
  }
  const raw = readFileSync(p, "utf-8");
  return new NextResponse(raw, {
    headers: {
      "Content-Type": "application/geo+json",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
