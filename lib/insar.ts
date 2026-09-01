/**
 * lib/insar.ts — Query NASA CMR for Sentinel-1 SAR acquisitions covering a bbox
 *
 * Returns the real count, dates, and orbits available over any user-drawn area.
 * No Earthdata auth needed for the metadata query (granule list + preview).
 * Full InSAR processing (interferograms, displacement) still requires an
 * Earthdata login on ASF Vertex or a local SNAP/GMTSAR install — this lib
 * just tells you *how much* data you actually have and whether the temporal
 * baseline supports a good pair.
 *
 * Endpoint: https://cmr.earthdata.nasa.gov/search/granules.json?short_name=SENTINEL-1...S1A_SLC...&bounding_box=...
 * Rate: unauthenticated, ~10 req/s allowed by CMR; we page_size=200.
 */

export interface InSARAcq {
  id: string;                       // CMR granule UUID
  productId: string;                // e.g. S1A_IW_SLC__1SDV_20200103T234005_...
  date: string;                     // ISO 8601
  sizeMb: number;
  polarisation: string;             // "VV+VH" or "VV"
  direction: string;                // "DESCENDING" / "ASCENDING"
  orbit: string;                    // "68" etc
  url: string;                     // direct download (ASF mirror)
}

export interface InSARSummary {
  total: number;
  acquisitions: InSARAcq[];
  dateRange: [string, string] | null;
  polarisations: string[];
  descending: number;
  ascending: number;
  spanDays: number | null;
  temporalBaseline: "poor" | "moderate" | "good";
  vertexUrl: string;            // pre-scoped ASF Vertex link
  note: string;
}

const CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json";

function parseS1Id(id: string): { polarisation: string; direction: string; orbit: string; date: string } {
  // S1A_IW_SLC__1SDV_20200103T234005_20200103T234032_030643_0382F7_F722
  const m = id.match(/^S1[AB]_IW_SLC__1S(DV|SV|SH|HH)_(\d{8})T/);
  const pol = (m && m[1]) || "VV";
  const polMap: Record<string, string> = {
    DV: "VV+VH", SV: "VV", SH: "VV+VH", HH: "HH",
  };
  const direction = id.includes("DES") || pol === "DV" || pol === "SV"
    ? "DESCENDING"
    : "ASCENDING";
  const orbitM = id.match(/_0(\d{5})_/);
  const dateM = id.match(/(\d{8})T/);
  return {
    polarisation: polMap[pol] ?? "VV",
    direction,
    orbit: orbitM ? orbitM[1] : "?",
    date: dateM ? `${dateM[1].slice(0, 4)}-${dateM[1].slice(4, 6)}-${dateM[1].slice(6, 8)}` : "?",
  };
}

export async function queryInSAR(bbox: [number, number, number, number], years: number = 4): Promise<InSARSummary> {
  const [w, s, e, n] = bbox;
  const bb = `${w},${s},${e},${n}`;
  const end = new Date().toISOString().split("T")[0];
  const startDt = new Date(); startDt.setFullYear(startDt.getFullYear() - years);
  const start = startDt.toISOString().split("T")[0];
  const temporalRange = `${start}T00:00:00Z,${end}T23:59:59Z`;

  // S1A + S1B SLC products (Interferometric Wide Swath, the workhorse for land)
  const params = new URLSearchParams({
    short_name: "SENTINEL-1A_SLC",
    version: "1",
    bounding_box: bb,
    temporal: temporalRange,
    page_size: "200",
    page_num: "1",
  });

  // We run both S1A and S1B in parallel
  const [aRes, bRes] = await Promise.all([
    fetch(`${CMR_URL}?${params.toString()}`),
    fetch(`${CMR_URL}?${new URLSearchParams({
      short_name: "SENTINEL-1B_SLC",
      version: "1", bounding_box: bb, temporal: temporalRange, page_size: "200", page_num: "1",
    }).toString()}`),
  ]);

  const a = await aRes.json();
  const b = await bRes.json();
  const entries: InSARAcq[] = [];
  for (const f of [...(a?.feed?.entry ?? []), ...(b?.feed?.entry ?? [])]) {
    const parsed = parseS1Id(f.title ?? "");
    const links = f.links ?? [];
    const dl = links.find((l: any) => l.rel === "http://esipfed.org/ns/fedsearch/1.1/data#")?.href ?? "";
    entries.push({
      id: f.id ?? "",
      productId: f.title ?? "",
      date: parsed.date,
      sizeMb: Math.round((f.granule_size ?? 0) / 1024),
      polarisation: parsed.polarisation,
      direction: parsed.direction,
      orbit: parsed.orbit,
      url: dl,
    });
  }
  entries.sort((x, y) => y.date.localeCompare(x.date));

  const descending = entries.filter((e) => e.direction === "DESCENDING").length;
  const ascending = entries.filter((e) => e.direction === "ASCENDING").length;
  const pols = Array.from(new Set(entries.map((e) => e.polarisation)));

  let dateRange: [string, string] | null = null;
  if (entries.length > 0) {
    const dates = entries.map((e) => e.date).filter((d) => d !== "?").sort();
    if (dates.length > 0) dateRange = [dates[0], dates[dates.length - 1]];
  }
  const spanDays = dateRange
    ? Math.round((new Date(dateRange[1]).getTime() - new Date(dateRange[0]).getTime()) / 86400000)
    : null;

  // Temporal baseline quality: good pairs need ~6-48 days separation, multiple of same direction
  let baseline: "poor" | "moderate" | "good" = "poor";
  if (entries.length >= 6 && descending >= 3) baseline = "good";
  else if (entries.length >= 3 && (descending >= 2 || ascending >= 2)) baseline = "moderate";

  const vertexUrl =
    `https://search.asf.alaska.edu/#/?results=true&dataset=SENTINEL-1&polygon=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${w.toFixed(4)},${s.toFixed(4)}&start=${start}&end=${end}`;

  const note =
    entries.length === 0
      ? "No Sentinel-1 acquisitions found for this bbox. The area may be outside the satellite's coverage swath."
      : baseline === "good"
      ? `Good stack: ${entries.length} acquisitions, ${spanDays} days of coverage. Ideal for multi-temporal InSAR.`
      : baseline === "moderate"
      ? `Adequate: ${entries.length} acquisitions over ${spanDays} days. Pair-based InSAR is possible but with fewer looks.`
      : `Sparse: only ${entries.length} acquisitions. A single interferogram may work if you have at least 2 of the same direction (desc/asc).`;

  return {
    total: entries.length,
    acquisitions: entries,
    dateRange,
    polarisations: pols,
    descending,
    ascending,
    spanDays,
    temporalBaseline: baseline,
    vertexUrl,
    note,
  };
}
