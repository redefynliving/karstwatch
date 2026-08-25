import { NextRequest, NextResponse } from "next/server";

/**
 * Address autocomplete proxy for Nominatim (free, no key).
 * Called debounced from the client as the user types.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json({ results: [] });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${q}, Indiana`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("viewbox", "-87.0,39.6,-86.0,38.9");
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
      type?: string;
      addresstype?: string;
    }[];
    return NextResponse.json({
      results: data.map((d) => {
        const parts = d.display_name.split(",").map((s) => s.trim());
        return {
          main: parts[0],
          sub: parts.slice(1, 4).join(", "),
          full: d.display_name,
          kind: d.addresstype ?? d.type ?? "place",
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
        };
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { results: [], error: (e as Error).message },
      { status: 200 }
    );
  }
}
