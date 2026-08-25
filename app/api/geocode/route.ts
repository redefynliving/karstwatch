import { NextRequest, NextResponse } from "next/server";

/**
 * Address search proxy for Nominatim (OpenStreetMap's free geocoder).
 * No API key; we add a proper User-Agent as their usage policy requires.
 * Free-tier limit: max 1 request/second — fine for human typing.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json({ results: [] });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${q}, Indiana`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("viewbox", "-87.0,39.6,-86.0,38.9"); // bias to south-central IN
  url.searchParams.set("bounded", "0");

  try {
    const r = await fetch(url.toString(), {
      headers: { "User-Agent": "KarstWatch/0.1 (Bloomington IN sinkhole info)" },
      next: { revalidate: 3600 },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as {
      display_name: string;
      lat: string;
      lon: string;
    }[];
    return NextResponse.json({
      results: data.map((d) => ({
        name: d.display_name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { results: [], error: (e as Error).message },
      { status: 200 }
    );
  }
}
