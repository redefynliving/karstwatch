"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { scanBboxForDepressions, type Depression } from "@/lib/depression";
import InSARPanel from "@/components/InSARPanel";

const BLOOMINGTON: [number, number] = [-86.5264, 39.1653];
const COUNTY_BBOX = "-87.0,39.0,-86.0,39.5";
const TERRARIUM_TILES =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

type LayerKey = "hillshade" | "karst" | "springs";
interface GeoResult { name: string; lat: number; lng: number; }
interface NearestInfo { source: string; distanceM: number; }

/** Depth -> color ramp (green shallow → red deep). */
function depthColor(d: number): string {
  if (d >= 5) return "#b3402e";
  if (d >= 3) return "#c96a2e";
  if (d >= 2) return "#c9962b";
  if (d >= 1.5) return "#8fa32e";
  return "#2e7d5b";
}

export default function MapView() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);

  const [ready, setReady] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ hillshade: true, karst: true, springs: false });
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Depression[] | null>(null);
  const [scanBbox, setScanBbox] = useState<[number, number, number, number] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasShape, setHasShape] = useState(false);

  // Address search
  const [query, setQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Selected dip popup
  const [selected, setSelected] = useState<Depression | null>(null);

  // Nearest known sinkhole info for the scanned area center
  const [nearest, setNearest] = useState<NearestInfo[] | null>(null);
  const [nearestLoading, setNearestLoading] = useState(false);

  useEffect(() => {
    // Service worker for tile caching.
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    if (!mapDiv.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          basemap: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
          terrainRgb: {
            type: "raster", tiles: [TERRARIUM_TILES], tileSize: 256, maxzoom: 15,
            attribution: "Elevation: USGS / NASA via AWS Open Data",
          },
          hillshadeDem: {
            type: "raster-dem", tiles: [TERRARIUM_TILES], tileSize: 256,
            maxzoom: 15, encoding: "terrarium",
          },
          karst: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          springs: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          depressions: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#dfe6df" } },
          { id: "basemap", type: "raster", source: "basemap" },
          { id: "terrain", type: "raster", source: "terrainRgb", paint: { "raster-opacity": 0.2 } },
          {
            id: "hillshade", type: "hillshade", source: "hillshadeDem",
            paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#5a564e" },
          },
          { id: "karst-fill", type: "fill", source: "karst", paint: { "fill-color": "#c98a2b", "fill-opacity": 0.18 } },
          { id: "karst-line", type: "line", source: "karst", paint: { "line-color": "#b07a24", "line-width": 1 } },
          {
            id: "depressions-fill", type: "fill", source: "depressions",
            paint: { "fill-opacity": 0.45, "fill-color": ["get", "color"] },
          },
          {
            id: "depressions-line", type: "line", source: "depressions",
            paint: { "line-width": 1.5, "line-color": ["get", "stroke"] },
          },
          {
            id: "springs-circle", type: "circle", source: "springs",
            paint: {
              "circle-radius": 5,
              "circle-color": "#3b7dd8",
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 1,
            },
            layout: { visibility: "none" },
          },
        ],
      },
      center: BLOOMINGTON,
      zoom: 12,
    });

    // Custom locate control with real error messages.
    class LocateControl implements maplibregl.IControl {
      private btn!: HTMLButtonElement;
      onAdd() {
        this.btn = document.createElement("button");
        this.btn.type = "button";
        this.btn.setAttribute("aria-label", "Find my location");
        this.btn.title = "Find my location";
        this.btn.innerHTML =
          `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#26241f" stroke-width="2">` +
          `<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8" opacity="0.5"/></svg>`;
        this.btn.style.cssText = "width:29px;height:29px;display:flex;align-items:center;justify-content:center;background:#fff;border:none;cursor:pointer;";
        this.btn.addEventListener("click", () => this.locate());
        const c = document.createElement("div");
        c.className = "maplibregl-ctrl maplibregl-ctrl-group";
        c.appendChild(this.btn);
        return c;
      }
      onRemove() {}
      private locate() {
        if (!navigator.geolocation) {
          window.dispatchEvent(new CustomEvent("kw-locate-error", { detail: "Your browser can't share your location." }));
          return;
        }
        this.btn.style.opacity = "0.5";
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this.btn.style.opacity = "1";
            mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14, duration: 1200 });
          },
          (err) => {
            this.btn.style.opacity = "1";
            const msg =
              err.code === err.PERMISSION_DENIED
                ? "Location is blocked for this site — allow it in your browser's address bar settings."
                : err.code === err.POSITION_UNAVAILABLE
                ? "Couldn't get your location right now. Try again or search your address instead."
                : "Location request timed out. Try searching your address instead.";
            window.dispatchEvent(new CustomEvent("kw-locate-error", { detail: msg }));
          },
          { enableHighAccuracy: false, timeout: 10000 },
        );
      }
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const style = document.createElement("style");
    style.textContent =
      ".maplibregl-ctrl-bottom-right{z-index:30 !important;} .maplibregl-ctrl-top-left{z-index:30 !important;}";
    document.head.appendChild(style);
    map.addControl(new LocateControl(), "bottom-right");

    map.on("load", () => {
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
      });
      map.addControl(draw as unknown as maplibregl.IControl, "top-left");
      drawRef.current = draw;

      map.on("draw.create", () => {
        const all = draw.getAll();
        if (all.features.length > 1) {
          const keep = all.features[all.features.length - 1].id;
          for (const f of all.features) if (f.id !== keep) draw.delete(f.id as string);
        }
        setHasShape(true);
      });
      map.on("draw.delete", () => setHasShape(false));

      fetch(`/api/karst?bbox=${COUNTY_BBOX}`)
        .then((r) => r.json())
        .then((gj) => {
          // Split polygons and points into their two sources.
          const polys = { ...gj, features: gj.features.filter((f: GeoJSON.Feature) => f.geometry?.type !== "Point") };
          const points = { ...gj, features: gj.features.filter((f: GeoJSON.Feature) => f.geometry?.type === "Point") };
          (map.getSource("karst") as maplibregl.GeoJSONSource)?.setData(polys);
          (map.getSource("springs") as maplibregl.GeoJSONSource)?.setData(points);
        })
        .catch(() => {});

      // Click a dip -> show its details.
      map.on("click", "depressions-fill", (e) => {
        const props = e.features?.[0]?.properties;
        if (!props || props.index === undefined) return;
        const dep = resultsRef.current[Number(props.index)];
        if (dep) setSelected(dep);
      });
      map.on("mouseenter", "depressions-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "depressions-fill", () => { map.getCanvas().style.cursor = ""; });

      setReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep latest results reachable inside map event handlers.
  const resultsRef = useRef<Depression[]>([]);
  useEffect(() => { resultsRef.current = results ?? []; }, [results]);

  // Shareable links: ?bbox=w,s,e,n triggers an auto-scan on first load.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (!ready || bootstrapped.current) return;
    bootstrapped.current = true;
    const p = new URLSearchParams(window.location.search).get("bbox");
    if (!p) return;
    const parts = p.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      runScanWith(parts as [number, number, number, number]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const onErr = (e: Event) => setError((e as CustomEvent<string>).detail);
    window.addEventListener("kw-locate-error", onErr);
    return () => window.removeEventListener("kw-locate-error", onErr);
  }, []);

  const toggle = (key: LayerKey) => {
    if (!mapRef.current || !ready) return;
    const vis = layers[key] ? "none" : "visible";
    setLayers((s) => ({ ...s, [key]: !s[key] }));
    if (key === "hillshade") mapRef.current.setLayoutProperty("hillshade", "visibility", vis);
    if (key === "karst") {
      mapRef.current.setLayoutProperty("karst-fill", "visibility", vis);
      mapRef.current.setLayoutProperty("karst-line", "visibility", vis);
    }
    if (key === "springs") mapRef.current.setLayoutProperty("springs-circle", "visibility", vis);
  };

  const clearScan = () => {
    setResults(null); setScanBbox(null); setError(null); setSelected(null); setNearest(null);
    (mapRef.current?.getSource("depressions") as maplibregl.GeoJSONSource | undefined)
      ?.setData({ type: "FeatureCollection", features: [] });
    window.history.replaceState({}, "", "/");
  };

  const loadNearest = async (lat: number, lng: number) => {
    setNearestLoading(true);
    try {
      const r = await fetch(`/api/nearest?lat=${lat}&lng=${lng}`);
      const d = await r.json();
      setNearest(d.nearest ?? null);
    } catch {
      setNearest(null);
    } finally {
      setNearestLoading(false);
    }
  };

  const runScanWith = async (bbox: [number, number, number, number]) => {
    setError(null); setResults(null); setSelected(null); setNearest(null);
    setScanning(true);
    try {
      const deps = await scanBboxForDepressions(bbox);
      setResults(deps);
      resultsRef.current = deps;
      setScanBbox(bbox);
      // Update URL so the view is shareable.
      const q = new URLSearchParams({ bbox: bbox.map((n) => n.toFixed(5)).join(",") });
      window.history.replaceState({}, "", `/?${q}`);

      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: deps.map((d, i) => ({
          type: "Feature" as const,
          properties: {
            index: i,
            depth_m: d.depthM.toFixed(1),
            acres: (d.areaM2 / 4046.86).toFixed(2),
            color: depthColor(d.depthM),
            stroke: depthColor(d.depthM),
          },
          geometry: d.polygon,
        })),
      };
      (mapRef.current!.getSource("depressions") as maplibregl.GeoJSONSource)?.setData(fc);

      if (deps.length === 0) {
        setError("Good news — no sinkhole-shaped dips found in this spot.");
      } else {
        const cLat = (bbox[1] + bbox[3]) / 2, cLng = (bbox[0] + bbox[2]) / 2;
        loadNearest(cLat, cLng);
      }
    } catch (e) {
      setError(`The elevation data didn't load. Usually temporary — try again. (${(e as Error).message})`);
    } finally {
      setScanning(false);
    }
  };

  const startScan = async () => {
    const draw = drawRef.current;
    if (!draw) return;
    let bbox: [number, number, number, number];
    try {
      const all = draw.getAll();
      const feat = all.features.find((f) => f.geometry.type === "Polygon");
      if (!feat) throw new Error("no-shape");
      const coords = (feat.geometry as GeoJSON.Polygon).coordinates[0];
      bbox = [
        Math.min(...coords.map((c) => c[0])), Math.min(...coords.map((c) => c[1])),
        Math.max(...coords.map((c) => c[0])), Math.max(...coords.map((c) => c[1])),
      ];
    } catch {
      setError("First draw a box on the map with the polygon tool.");
      return;
    }
    const spanKm = Math.max(bbox[2]-bbox[0], bbox[3]-bbox[1]) * 85;
    if (spanKm > 8) {
      setError("That area is too big — try a smaller box, about the size of a neighborhood.");
      return;
    }
    await runScanWith(bbox);
  };

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 3) return;
    setSearching(true); setGeoResults([]);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      setGeoResults(d.results ?? []);
      if ((d.results ?? []).length === 0) setError(`No matches found for “${q}”.`);
      else setError(null);
    } catch {
      setError("Address search is temporarily unavailable.");
    } finally {
      setSearching(false);
    }
  };

  const goTo = (r: GeoResult) => {
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 14, duration: 1400 });
    setGeoResults([]); setQuery("");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setError("Link copied — paste it to share these results.");
    } catch {
      setError("Couldn't copy automatically — copy the address bar link.");
    }
  };

  const step = scanning ? 3 : hasShape ? 2 : 1;

  return (
    <>
      <aside className={`
        z-10 flex flex-col bg-kw-bg
        max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[55vh]
        max-md:rounded-t-2xl max-md:border-t max-md:border-kw-line max-md:shadow-[0_-6px_24px_rgba(38,36,31,0.15)]
        md:relative md:h-full md:w-[340px] md:border-r md:border-kw-line
        p-5 overflow-y-auto order-2 md:order-1
      `}>
        <header>
          <h1 className="text-xl font-bold tracking-tight text-kw-ink">KarstWatch</h1>
          <p className="mt-0.5 text-sm text-kw-muted">Check land around Bloomington for sinkhole risk.</p>
        </header>

        {/* Address search */}
        <div className="relative mt-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search an address…"
            className="w-full rounded-lg border border-kw-line bg-white px-3 py-2 text-sm text-kw-ink placeholder:text-kw-muted focus:border-kw-accent focus:outline-none"
          />
          <button onClick={runSearch} disabled={searching || query.trim().length < 3}
            className="absolute right-1 top-1 rounded-md px-2 py-1 text-xs font-semibold text-kw-accent hover:bg-kw-soft disabled:text-kw-muted">
            {searching ? "…" : "Go"}
          </button>
          {geoResults.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 divide-y divide-kw-line rounded-lg border border-kw-line bg-white shadow-lg">
              {geoResults.slice(0, 5).map((r, i) => (
                <li key={i}>
                  <button className="w-full truncate px-3 py-2 text-left text-sm hover:bg-kw-soft"
                    onClick={() => goTo(r)} title={r.name}>
                    {r.name.split(",").slice(0, 3).join(",")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Guided steps */}
        <ol className="mt-4 space-y-3">
          <li className="flex items-start gap-2.5">
            <span className={`kw-step-chip ${step===1?"kw-step-chip--active":step>1?"kw-step-chip--done":"kw-step-chip--idle"}`}>1</span>
            <p className="text-sm leading-snug"><b>Find your spot.</b> <span className="text-kw-muted">Search above, drag the map, or tap ⌖ to jump to where you are.</span></p>
          </li>
          <li className="flex items-start gap-2.5">
            <span className={`kw-step-chip ${step===2?"kw-step-chip--active":step>2?"kw-step-chip--done":"kw-step-chip--idle"}`}>2</span>
            <p className="text-sm leading-snug"><b>Draw the area.</b> <span className="text-kw-muted">Use the polygon tool on the map, click around your property, double-click to finish.</span></p>
          </li>
          <li className="flex items-start gap-2.5">
            <span className={`kw-step-chip ${step===3?"kw-step-chip--active":"kw-step-chip--idle"}`}>3</span>
            <p className="text-sm leading-snug"><b>Run the check.</b> <span className="text-kw-muted">We look for bowl-shaped dips in the ground.</span></p>
          </li>
        </ol>

        <button onClick={startScan} disabled={!ready || scanning}
          className="mt-4 w-full rounded-lg bg-kw-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
          {scanning ? "Checking…" : hasShape ? "Check this area" : "Check this area (draw first)"}
        </button>

        {scanning && (
          <div className="mt-3 flex items-center gap-2 text-xs text-kw-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-kw-accent" />
            Reading elevation data… usually takes a few seconds.
          </div>
        )}

        {error && (
          <div role="status" className="mt-4 rounded-lg border border-kw-line bg-white px-3 py-2.5 text-sm text-kw-ink">{error}</div>
        )}

        {/* Results */}
        {results && results.length > 0 && (
          <section className="mt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{results.length} dip{results.length===1?"":"s"} found</h2>
              <div className="flex gap-3">
                {scanBbox && (
                  <button onClick={copyLink} className="text-xs font-medium text-kw-accent underline-offset-2 hover:underline">Share</button>
                )}
                <button onClick={clearScan} className="text-xs font-medium text-kw-muted underline-offset-2 hover:text-kw-ink hover:underline">Clear</button>
              </div>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-kw-muted">
              Colored by depth: <span className="font-medium text-kw-accent">shallow</span> →{" "}
              <span className="font-medium text-yellow-700">moderate</span> →{" "}
              <span className="font-medium text-red-800">deep</span>. Tap any result or shape for details.
            </p>

            {nearest && nearest.length > 0 && (
              <div className="mt-3 rounded-lg border border-kw-line bg-white p-3 text-xs leading-relaxed">
                <p className="font-medium text-kw-ink">Known karst nearby:</p>
                {nearest.map((n, i) => (
                  <p key={i} className="text-kw-muted mt-0.5">
                    {n.source.replace(/_/g, " ").toLowerCase()} mapped within ~{Math.max(30, n.distanceM)} m of this area&apos;s center
                  </p>
                ))}
              </div>
            )}
            {nearestLoading && <p className="mt-2 text-xs text-kw-muted">Checking state karst records…</p>}

            <ul className="mt-3 max-h-64 divide-y divide-kw-line overflow-y-auto rounded-lg border border-kw-line bg-white">
              {results.slice(0, 50).map((d, i) => (
                <li key={i}>
                  <button
                    className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left hover:bg-kw-soft/60"
                    onClick={() => {
                      setSelected(d);
                      mapRef.current?.fitBounds(d.bounds, { padding: 80 });
                    }}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: depthColor(d.depthM) }} />
                    <span className="text-sm font-medium">
                      {d.depthM >= 3 ? "Deep dip" : d.depthM >= 2 ? "Moderate dip" : d.depthM >= 1.5 ? "Shallow dip" : "Very shallow dip"}{" "}
                      <span className="font-mono text-xs text-kw-muted">
                        · {d.depthM.toFixed(1)} m · {(d.areaM2 / 4046.86).toFixed(2)} ac
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Selected dip detail card */}
        {selected && (
          <section className="mt-4 rounded-lg border border-kw-line bg-white p-3">
            <div className="flex items-start justify-between">
              <h3 className="text-sm font-semibold">
                <span className="mr-1.5 inline-block h-3 w-3 rounded-full align-middle" style={{ background: depthColor(selected.depthM) }} />
                Dip details
              </h3>
              <button onClick={() => setSelected(null)} className="text-kw-muted hover:text-kw-ink" aria-label="Close">×</button>
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-kw-muted">Depth</dt><dd>{selected.depthM.toFixed(1)} meters</dd>
              <dt className="text-kw-muted">Area</dt><dd>{(selected.areaM2 / 4046.86).toFixed(2)} acres</dd>
              <dt className="text-kw-muted">Center</dt>
              <dd className="font-mono">
                {((( selected.bounds[0][1]+selected.bounds[1][1])/2)).toFixed(5)}, {(((selected.bounds[0][0]+selected.bounds[1][0])/2)).toFixed(5)}
              </dd>
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-kw-muted">
              Model output from elevation data — not a confirmed sinkhole. A geologist or drilling survey confirms what this suggests.
            </p>
          </section>
        )}

        {/* Advanced */}
        <div className="pt-5">
          <button onClick={() => setShowAdvanced((s) => !s)} aria-expanded={showAdvanced}
            className="text-xs font-medium text-kw-muted underline-offset-2 hover:text-kw-ink hover:underline">
            {showAdvanced ? "Hide map details" : "Show map details"}
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-2 rounded-lg border border-kw-line bg-white p-3">
              {([
                ["hillshade", "Shaded terrain"],
                ["karst", "Known sinkhole areas (state survey)"],
                ["springs", "Mapped springs"],
              ] as [LayerKey, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={layers[key]} onChange={() => toggle(key)} className="accent-kw-accent" disabled={!ready} />
                  {label}
                </label>
              ))}
              <InSARPanel bbox={scanBbox ?? [-86.85, 38.95, -86.25, 39.45]} />

              {/* Disclaimer */}
              <details className="rounded-lg border border-kw-line bg-kw-bg p-3 text-xs leading-relaxed text-kw-muted">
                <summary className="cursor-pointer font-medium text-kw-ink">About &amp; limitations</summary>
                <p className="mt-2">
                  KarstWatch is an educational tool built entirely on free public data:
                  elevation from USGS/NASA (via AWS Open Data), karst mapping from the Indiana
                  Geological &amp; Water Survey, addresses from OpenStreetMap.
                </p>
                <p className="mt-2">
                  <b className="text-kw-ink">This is not a geological survey.</b> Detected dips are
                  mathematical shapes in elevation data. Some are sinkholes; many are not
                  (quarries, ponds, ditches, data noise). Never buy, dig, drill, or build based
                  on this tool alone — consult a licensed geologist for anything that matters.
                </p>
              </details>
            </div>
          )}
        </div>
      </aside>

      <div ref={mapDiv} className="relative order-1 h-screen w-full flex-1 md:order-2 md:h-full" />
    </>
  );
}
