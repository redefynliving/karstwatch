"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import { scanBboxForDepressions, type Depression } from "@/lib/depression";
import InSARPanel from "@/components/InSARPanel";

const BLOOMINGTON: [number, number] = [-86.5264, 39.1653];
const COUNTY_BBOX = "-87.0,39.0,-86.0,39.5";

// Carto Positron: clean light basemap, free, no key. Far less visual noise
// than raw OSM tiles, so our colored results pop.
// Carto Positron @2x retina tiles: crisp on any display, free, no key.
const BASE_TILES = ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"];
const TERRARIUM_TILES =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

type LayerKey = "countyHeat" | "hillshade" | "karst" | "springs";
interface GeoResult { main: string; sub: string; full: string; kind: string; lat: number; lng: number; }
interface NearestInfo { source: string; distanceM: number; }
interface HistoryItem {
  id: string;
  label: string;
  bbox: [number, number, number, number];
  date: number;
  dips: number;
  avgDepth: number;
}

function depthColor(d: number): string {
  if (d >= 5) return "#b3402e";
  if (d >= 3) return "#c96a2e";
  if (d >= 2) return "#c9962b";
  if (d >= 1.5) return "#8fa32e";
  return "#2e7d5b";
}
function depthLabel(d: number): string {
  if (d >= 5) return "Deep dip";
  if (d >= 3) return "Moderate dip";
  if (d >= 2) return "Shallow dip";
  return "Very shallow dip";
}

/** Tiny inline icon set — no emoji, no external icon lib weight. */
const Icon = {
  pin: "M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  home: "M3 10.5 12 3l9 7.5 M5 9.5V21h14V9.5",
  road: "M6 3v18 M18 3v18 M12 5v2m0 4v2m0 4v2",
  tree: "M12 3l5 7h-3l4 6H6l4-6H7l5-7z M12 16v5",
  water: "M12 3c3 4.5 5.5 7.6 5.5 10.5a5.5 5.5 0 1 1-11 0C6.5 10.6 9 7.5 12 3z",
  building: "M4 21V5l8-2v18 M12 21h8V9l-8-3 M7 8h1M7 12h1M7 16h1M16 12h1M16 16h1",
};

function KindIcon({ kind }: { kind: string }) {
  const d =
    kind.includes("house") || kind.includes("residential") ? Icon.home :
    kind.includes("road") ? Icon.road :
    kind.includes("park") || kind.includes("forest") ? Icon.tree :
    kind.includes("water") || kind.includes("river") ? Icon.water :
    Icon.building;
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="#716b60" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function MapView() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinRef = useRef<maplibregl.Marker | null>(null);

  const [ready, setReady] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    countyHeat: true, hillshade: true, karst: true, springs: false,
  });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pins, setPins] = useState<HistoryItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Depression[] | null>(null);
  const [scanBbox, setScanBbox] = useState<[number, number, number, number] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasShape, setHasShape] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [neighborhoodScan, setNeighborhoodScan] = useState(false);

  // Predictive search
  const [query, setQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<Depression | null>(null);
  const [geoLabel, setGeoLabel] = useState<string | null>(null);

  // Load scan history + saved pins from localStorage on first mount.
  useEffect(() => {
    if (typeof window !== "undefined") {
      try { setHistory(JSON.parse(localStorage.getItem("kw-history") ?? "[]")); } catch {}
      try { setPins(JSON.parse(localStorage.getItem("kw-pins") ?? "[]")); } catch {}
    }
  }, []);
  const [nearest, setNearest] = useState<NearestInfo[] | null>(null);
  const [nearestLoading, setNearestLoading] = useState(false);

  useEffect(() => {
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
          basemap: { type: "raster", tiles: BASE_TILES, tileSize: 256,
            attribution: "© OpenStreetMap contributors © CARTO" },
          hillshadeDem: { type: "raster-dem", tiles: [TERRARIUM_TILES], tileSize: 256,
            maxzoom: 15, encoding: "terrarium" },
          karst: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          springs: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          depressions: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          county: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "draw-line": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "draw-verts": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "draw-fill": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#eef0ea" } },
          { id: "basemap", type: "raster", source: "basemap" },
          { id: "hillshade", type: "hillshade", source: "hillshadeDem",
            paint: { "hillshade-exaggeration": 0.22, "hillshade-shadow-color": "#8a857a",
              "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#a8a294" } },
          { id: "karst-fill", type: "fill", source: "karst",
            paint: { "fill-color": "#b07a24", "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.05, 0.13] } },
          { id: "karst-line", type: "line", source: "karst",
            paint: { "line-color": "#c49256", "line-width": 1, "line-dasharray": [2, 2] } },
          { id: "county-circles", type: "circle", source: "county",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "depth"], 1, 4, 5, 9, 10, 16],
              "circle-color": ["interpolate", ["linear"], ["get", "depth"],
                1, "#5ac85a", 3, "#ffd93d", 6, "#ff6b35", 12, "#c1292e"],
              "circle-stroke-color": "#fff", "circle-stroke-width": 0.5,
              "circle-stroke-opacity": 0.7, "circle-opacity": 0.8,
            },
          },
          { id: "depressions-fill", type: "fill", source: "depressions",
            paint: { "fill-opacity": 0.42, "fill-color": ["get", "color"] } },
          { id: "depressions-line", type: "line", source: "depressions",
            paint: { "line-width": 2, "line-color": ["get", "stroke"] } },
          { id: "springs-circle", type: "circle", source: "springs",
            layout: { visibility: "none" },
            paint: { "circle-radius": 5, "circle-color": "#3b7dd8",
              "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } },
          { id: "draw-fill", type: "fill", source: "draw-fill",
            paint: { "fill-color": "#2e7d5b", "fill-opacity": 0.08 } },
          { id: "draw-line", type: "line", source: "draw-line",
            paint: { "line-color": "#2e7d5b", "line-width": 2.5, "line-dasharray": [2, 1.5] } },
          { id: "draw-verts", type: "circle", source: "draw-verts",
            paint: { "circle-radius": 5.5, "circle-color": "#2e7d5b",
              "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
        ],
      },
      center: BLOOMINGTON,
      zoom: 12,
    });

    class LocateControl implements maplibregl.IControl {
      private btn!: HTMLButtonElement;
      onAdd() {
        this.btn = document.createElement("button");
        this.btn.type = "button";
        this.btn.setAttribute("aria-label", "Find my location");
        this.btn.title = "Find my location";
        this.btn.innerHTML =
          `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#23211c" stroke-width="2" stroke-linecap="round">` +
          `<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
        this.btn.style.cssText = "width:30px;height:30px;display:flex;align-items:center;justify-content:center;";
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
            window.dispatchEvent(new CustomEvent("kw-locate-error", {
              detail:
                err.code === err.PERMISSION_DENIED
                  ? "Location is blocked for this site — allow it in your browser's address bar settings."
                  : "Couldn't get your location. Try searching your address instead.",
            }));
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
      // Custom polygon drawing (MapboxDraw is unreliable on MapLibre — clicks
      // don't register points). We own the whole interaction: click to add
      // vertices, click first point or double-click to close, Esc cancels.
      const drawState = { pts: [] as [number, number][], active: false };

      const renderDraw = () => {
        const pts = drawState.pts;
        const line: GeoJSON.Feature = {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [...pts, ...(pts.length > 2 ? [pts[0]] : [])] },
        };
        const verts: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: pts.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } })),
        };
        const fill: GeoJSON.Feature | null =
          pts.length >= 3
            ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } }
            : null;
        (map.getSource("draw-line") as maplibregl.GeoJSONSource)?.setData(line);
        (map.getSource("draw-verts") as maplibregl.GeoJSONSource)?.setData(verts);
        (map.getSource("draw-fill") as maplibregl.GeoJSONSource)?.setData(
          fill ?? { type: "FeatureCollection", features: [] }
        );
      };

      (map as unknown as { kwDraw: typeof drawState }).kwDraw = drawState;

      map.on("click", (e) => {
        if (!drawState.active) return;
        const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        // Click near the first point (with ≥3 pts) closes the shape.
        if (drawState.pts.length >= 3) {
          const [fx, fy] = drawState.pts[0];
          const metersPerDeg = 111320 * Math.cos((fy * Math.PI) / 180);
          const dist = Math.hypot((e.lngLat.lng - fx) * metersPerDeg, (e.lngLat.lat - fy) * 111320);
          if (dist < 25) {
            finishDraw();
            return;
          }
        }
        drawState.pts.push(p);
        renderDraw();
      });

      map.on("dblclick", () => {
        if (drawState.active && drawState.pts.length >= 3) finishDraw();
      });

      function finishDraw() {
        if (drawState.pts.length >= 3) {
          drawState.active = false;
          setDrawing(false);
          setHasShape(true);
          renderDraw();
        }
      }

      map.on("keyup", (e) => {
        // Esc cancels an in-progress shape.
        if (e.originalEvent?.key === "Escape" && drawState.active) {
          drawState.pts = [];
          drawState.active = false;
          renderDraw();
          setDrawing(false);
        }
      });

      window.addEventListener("kw-finish-draw", finishDraw);

      fetch(`/api/karst?bbox=${COUNTY_BBOX}`)
        .then((r) => r.json())
        .then((gj) => {
          const polys = { ...gj, features: gj.features.filter((f: GeoJSON.Feature) => f.geometry?.type !== "Point") };
          const points = { ...gj, features: gj.features.filter((f: GeoJSON.Feature) => f.geometry?.type === "Point") };
          (map.getSource("karst") as maplibregl.GeoJSONSource)?.setData(polys);
          (map.getSource("springs") as maplibregl.GeoJSONSource)?.setData(points);
        })
        .catch(() => {});

      // County-wide heat layer: loads from precomputed static file (free, fast, no lambda)
      fetch("/api/heat")
        .then((r) => r.json())
        .then((gj) => {
          (map.getSource("county") as maplibregl.GeoJSONSource)?.setData(gj);
        })
        .catch(() => {});

      map.on("click", "depressions-fill", (e) => {
        const props = e.features?.[0]?.properties;
        if (!props || props.index === undefined) return;
        setSelected(resultsRef.current[Number(props.index)] ?? null);
      });
      map.on("mouseenter", "depressions-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "depressions-fill", () => { map.getCanvas().style.cursor = ""; });

      setReady(true);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  const resultsRef = useRef<Depression[]>([]);
  useEffect(() => { resultsRef.current = results ?? []; }, [results]);

  // Deep-link auto scan
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

  // Dismiss predictive dropdown on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
    if (key === "countyHeat") mapRef.current.setLayoutProperty("county-circles", "visibility", vis);
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
    } catch { setNearest(null); }
    finally { setNearestLoading(false); }
  };

  const runScanWith = async (bbox: [number, number, number, number]) => {
    setError(null); setResults(null); setSelected(null); setNearest(null);
    setScanning(true);
    try {
      const deps = await scanBboxForDepressions(bbox);
      setResults(deps);
      resultsRef.current = deps;
      setScanBbox(bbox);
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
        loadNearest((bbox[1]+bbox[3])/2, (bbox[0]+bbox[2])/2);
        // Persist to scan history.
        const avgDepth = deps.reduce((a, d) => a + d.depthM, 0) / deps.length;
        const item: HistoryItem = {
          id: crypto.randomUUID(),
          label: geoLabel ?? `${bbox[0].toFixed(3)}, ${bbox[1].toFixed(3)}`,
          bbox, date: Date.now(), dips: deps.length, avgDepth,
        };
        const prev: HistoryItem[] = JSON.parse(localStorage.getItem("kw-history") ?? "[]");
        const next = [item, ...prev.filter((p) => p.id !== item.id)].slice(0, 12);
        localStorage.setItem("kw-history", JSON.stringify(next));
        setHistory(next);
        setGeoLabel(null);

        mapRef.current?.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: { top: 40, bottom: 80, left: 60, right: 60 }, duration: 900 },
        );
      }
    } catch (e) {
      setError(`The elevation data didn't load. Usually temporary — try again. (${(e as Error).message})`);
    } finally {
      setScanning(false);
    }
  };

  const startScan = async () => {
    const map = mapRef.current as (maplibregl.Map & { kwDraw?: { pts: [number, number][]; active: boolean } }) | null;
    if (!map) return;
    const pts = map.kwDraw?.pts ?? [];
    let bbox: [number, number, number, number];
    try {
      if (pts.length < 3) throw new Error("no-shape");
      bbox = [
        Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
        Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])),
      ];
    } catch {
      setError("First draw an area on the map — tap \"Draw area\", then click points around the property.");
      return;
    }
    const spanKm = Math.max(bbox[2]-bbox[0], bbox[3]-bbox[1]) * 85;
    if (spanKm > 8) {
      setError("That area is too big — try a smaller box, about the size of a neighborhood.");
      return;
    }
    await runScanWith(bbox);
  };

  // One-tap neighborhood scan: 1.5 km box centered on current map view.
  const startNeighborhoodScan = async () => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    // 1.5 km ≈ 0.0135 degrees at 39°N latitude.
    const delta = 0.0135;
    const bbox: [number, number, number, number] = [
      center.lng - delta, center.lat - delta, center.lng + delta, center.lat + delta,
    ];
    // Clear any active draw.
    (map as any).kwDraw = { pts: [], active: false };
    setHasShape(false);
    await runScanWith(bbox);
  };

  /** Predictive search: fires debounced as the user types. */
  const onQueryChange = (value: string) => {
    setQuery(value);
    setSearchOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 3) { setGeoResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        setGeoResults(d.results ?? []);
      } catch { setGeoResults([]); }
      finally { setSearching(false); }
    }, 300);
  };

  const goTo = (r: GeoResult) => {
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 15, duration: 1400 });
    // Drop a pin at the chosen address so the spot stays marked.
    if (pinRef.current) pinRef.current.remove();
    const el = document.createElement("div");
    el.innerHTML =
      `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>` +
      `<path d="M12 22s-8-6.6-8-12a8 8 0 1 1 16 0c0 5.4-8 12-8 12z" fill="#b3402e" stroke="#fff" stroke-width="1.6"/>` +
      `<circle cx="12" cy="10" r="3" fill="#fff"/></svg>`;
    el.style.cssText = "cursor:pointer;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35));";
    pinRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([r.lng, r.lat])
      .addTo(mapRef.current!);
    setGeoResults([]); setQuery(r.full); setGeoLabel(r.full); setSearchOpen(false);
  };

  const startDrawing = () => {
    const map = mapRef.current as (maplibregl.Map & { kwDraw?: { pts: [number, number][]; active: boolean } }) | null;
    if (!map || !ready) return;
    const st = map.kwDraw;
    if (!st) return;
    // Fresh shape each time; keep the map interactive (no drag lock needed).
    st.pts = [];
    st.active = true;
    setHasShape(false);
    setSelected(null);
    setError(null);
    renderDrawReset(map);
    setDrawing(true);
  };

  const renderDrawReset = (map: maplibregl.Map) => {
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    (map.getSource("draw-line") as maplibregl.GeoJSONSource)?.setData(empty);
    (map.getSource("draw-verts") as maplibregl.GeoJSONSource)?.setData(empty);
    (map.getSource("draw-fill") as maplibregl.GeoJSONSource)?.setData(empty);
  };

  const deleteShape = () => {
    const map = mapRef.current as (maplibregl.Map & { kwDraw?: { pts: [number, number][]; active: boolean } }) | null;
    if (!map) return;
    const st = map.kwDraw;
    if (st) { st.pts = []; st.active = false; }
    renderDrawReset(map);
    setHasShape(false);
    setDrawing(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setError("Link copied — paste it to share these results.");
    } catch {
      setError("Couldn't copy automatically — copy the address bar link.");
    }
  };

  /** The Verdict: plain-English read of the scan, in one voice. */
  const verdict = (() => {
    if (!results) return null;
    const n = results.length;
    if (n === 0) {
      return {
        tone: "good" as const,
        headline: "Nothing suspicious here.",
        body: "No bowl-shaped dips showed up in this spot. That doesn't guarantee the all-clear — buried sinkholes can hide underground — but the surface looks quiet.",
      };
    }
    const deep = results.filter((d) => d.depthM >= 3).length;
    if (deep > 0) {
      return {
        tone: "attention" as const,
        headline:
          n === 1 ? "One dip worth a closer look." :
          deep === n ? `All ${n} dips look serious.` :
          `${deep} of ${n} dips look serious.`,
        body:
          "Deep, closed bowls like these match how sinkholes show up in elevation data. Before you build, dig, or buy out here, talk to a geologist and check Monroe County's sinkhole records. It's cheap insurance.",
      };
    }
    return {
      tone: "mixed" as const,
      headline:
        n === 1 ? "There's a dip here — probably fine." : `${n} shallow dips here.`,
      body:
        "These are gentle enough that they could just be drainage, old ponds, or how the land was graded. Sinkholes usually announce themselves deeper than this. Worth a glance on foot after heavy rain — standing water that drains suddenly is the classic tell.",
    };
  })();

  const step = scanning ? 3 : hasShape ? 2 : 1;
  const showDropdown = searchOpen && geoResults.length > 0;

  return (
    <>
      <aside className={`
        z-10 flex flex-col bg-kw-bg
        max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[58vh]
        max-md:rounded-t-[20px] max-md:border-t max-md:border-kw-line max-md:shadow-[0_-8px_32px_rgba(35,33,28,0.18)]
        md:relative md:h-full md:w-[360px] md:border-r md:border-kw-line md:shadow-[4px_0_24px_rgba(35,33,28,0.04)]
        p-5 overflow-y-auto kw-scroll order-2 md:order-1
      `}>
        <header>
          <div className="flex items-center gap-2">
            {/* Wordmark glyph */}
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M3 17c2.5-1 4-4 6.5-4s3.5 2 6 2 3.5-2 5.5-4" stroke="#2e7d5b" strokeWidth="2.4" strokeLinecap="round"/>
              <path d="M3 20.5h18" stroke="#23211c" strokeWidth="2.4" strokeLinecap="round"/>
              <circle cx="9.5" cy="7.5" r="2.6" fill="#b3402e" opacity=".85"/>
            </svg>
            <h1 className="text-xl font-extrabold tracking-tight text-kw-ink">KarstWatch</h1>
          </div>
          <p className="mt-1 text-sm text-kw-muted">
            Southern Indiana is hollow in places. Check what's under yours before you build, dig, or buy.
          </p>
        </header>

        {/* Predictive address search */}
        <div ref={searchBoxRef} className="relative mt-4">
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" width="15" height="15"
              viewBox="0 0 24 24" fill="none" stroke="#716b60" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
            </svg>
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder="Type your address…"
              autoComplete="off"
              className="kw-input w-full rounded-xl border border-kw-line bg-white py-2.5 pl-9 pr-9 text-sm text-kw-ink placeholder:text-kw-muted/70"
            />
            {searching && (
              <span className="kw-spinner absolute right-3 top-1/2 -translate-y-1/2" aria-label="searching" />
            )}
          </div>

          {showDropdown && (
            <ul role="listbox" className="kw-card kw-card--pop kw-animate-pop absolute inset-x-0 top-full z-20 mt-1.5 divide-y divide-kw-line overflow-hidden p-0">
              {geoResults.slice(0, 6).map((r, i) => (
                <li key={i}>
                  <button
                    onClick={() => goTo(r)}
                    className="kw-row flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left"
                  >
                    <span className="mt-0.5"><KindIcon kind={r.kind} /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-kw-ink">{r.main}</span>
                      <span className="block truncate text-xs text-kw-muted">{r.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Guided steps */}
        <ol className="mt-4 space-y-3">
          <li className="flex items-start gap-3">
            <span className={`kw-step-chip ${step===1?"kw-step-chip--active":step>1?"kw-step-chip--done":"kw-step-chip--idle"}`}>1</span>
            <p className="text-sm leading-snug"><b>Find your spot.</b> <span className="text-kw-muted">Search above, drag the map, or tap ⌖.</span></p>
          </li>
          <li className="flex items-start gap-3">
            <span className={`kw-step-chip ${step===2?"kw-step-chip--active":step>2?"kw-step-chip--done":"kw-step-chip--idle"}`}>2</span>
            <p className="text-sm leading-snug"><b>Draw your area.</b> <span className="text-kw-muted">Tap "Draw area" below, then click points around the property on the map. Double-click to finish.</span></p>
          </li>
          <li className="flex items-start gap-3">
            <span className={`kw-step-chip ${step===3?"kw-step-chip--active":"kw-step-chip--idle"}`}>3</span>
            <p className="text-sm leading-snug"><b>Run the check.</b> <span className="text-kw-muted">We find bowl-shaped dips in the ground.</span></p>
          </li>
        </ol>

        <div className="mt-4 flex gap-2">
          <button
            onClick={startDrawing}
            disabled={!ready}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              drawing
                ? "border-kw-accent bg-kw-accent text-white shadow-[0_0_0_4px_var(--kw-accent-soft)]"
                : "border-kw-line bg-white text-kw-ink hover:border-kw-accent hover:bg-kw-accent-soft/50"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            </svg>
            {drawing ? "Tap points on map…" : hasShape ? "Redraw area" : "Draw area"}
          </button>
          {hasShape && (
            <button
              onClick={deleteShape}
              aria-label="Delete drawn area"
              className="rounded-xl border border-kw-line bg-white px-3 py-2.5 text-kw-muted transition hover:border-kw-danger hover:text-kw-danger"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>
              </svg>
            </button>
          )}
        </div>

        <button onClick={startScan} disabled={!ready || scanning}
          className="kw-cta mt-4 flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-white">
          {scanning ? (
            <>
              <span className="kw-spinner" style={{ borderTopColor:"#fff", borderColor:"rgba(255,255,255,.35)" }} />
              Reading elevation…
            </>
          ) : hasShape ? "Check this area →" : "Check this area"}
        </button>

        <button onClick={startNeighborhoodScan} disabled={!ready || scanning}
          className="mt-2 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-kw-emerald hover:bg-kw-soft">
          <span aria-hidden>📍</span> Scan my neighborhood
        </button>

        {error && (
          <div role="status" className="kw-card kw-animate-pop mt-4 flex items-start gap-2 px-3 py-2.5 text-sm text-kw-ink">
            <span aria-hidden className="mt-0.5">{error.startsWith("Good news") || error.includes("copied") ? "✅" : "ℹ️"}</span>
            <span>{error}</span>
          </div>
        )}

        {/* The Verdict — the signature moment */}
        {verdict && !scanning && (
          <section
            className={`kw-card kw-animate-pop mt-4 overflow-hidden border-l-4 p-4 ${
              verdict.tone === "attention" ? "border-l-[#b3402e] bg-[#fdf3f1]" :
              verdict.tone === "good" ? "border-l-kw-accent bg-kw-accent-soft/60" :
              "border-l-[#c9962b] bg-[#fbf6ec]"
            }`}
          >
            <p className="text-[11px] font-bold uppercase tracking-widest text-kw-muted">
              {verdict.tone === "attention" ? "Worth a closer look" : verdict.tone === "good" ? "Looking quiet" : "Mixed signals"}
            </p>
            <p className="mt-1 text-lg font-extrabold leading-snug tracking-tight text-kw-ink">
              {verdict.headline}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-kw-ink/80">{verdict.body}</p>
          </section>
        )}

        {/* Results */}
        {results && results.length > 0 && (
          <section className="kw-animate-pop mt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">{results.length} dip{results.length===1?"":"s"} found</h2>
              <div className="flex gap-3">
                {scanBbox && (
                  <button onClick={copyLink} className="rounded-md bg-kw-accent-soft px-2 py-1 text-xs font-semibold text-kw-accent hover:brightness-95">Share</button>
                )}
                <button onClick={clearScan} className="text-xs font-medium text-kw-muted underline-offset-2 hover:text-kw-ink hover:underline">Clear</button>
              </div>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-kw-muted">
              Colored by depth —{" "}
              <span className="font-semibold" style={{ color:"#2e7d5b" }}>shallow</span> ·{" "}
              <span className="font-semibold" style={{ color:"#c9962b" }}>moderate</span> ·{" "}
              <span className="font-semibold" style={{ color:"#b3402e" }}>deep</span>. Tap one for details.
            </p>

            {/* What you're looking at — context so the numbers mean something */}
            <details className="kw-card mt-3 p-3 text-xs leading-relaxed text-kw-muted" open>
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-kw-ink">
                What you're looking at
              </summary>
              <ul className="mt-2 space-y-1.5">
                <li><b className="text-kw-ink">The shapes</b> are places where the land surface dips like a bowl — the classic shape of a sinkhole. They're detected by comparing the ground as-is to a "filled" version where every bowl is leveled in.</li>
                <li><b className="text-kw-ink">Depth</b> is how far the bowl drops, measured from satellite elevation data. <b className="text-kw-ink">Acres</b> is the bowl's area at its rim.</li>
                <li><b className="text-kw-ink">Resolution:</b> this scan reads the ground at roughly 10–30 m per step, so small features under ~15 m wide can be missed, and edges are approximate. Great for "should I look closer?" — not a property-line survey.</li>
                <li><b className="text-kw-ink">A dip is not automatically a sinkhole.</b> Old ponds, drainage ditches, quarries, and grading all leave bowl shapes. Cross-check the state's mapped sinkhole areas (tan overlay) and springs (blue dots) below the map.</li>
              </ul>
            </details>

            {nearestLoading && (
              <div className="kw-card mt-3 flex items-center gap-2 p-3 text-xs text-kw-muted">
                <span className="kw-dot-live h-2 w-2 rounded-full bg-kw-accent" />
                Checking state karst records…
              </div>
            )}
            {nearest && nearest.length > 0 && (
              <div className="kw-card mt-3 border-l-[3px] border-l-kw-accent p-3 text-xs leading-relaxed">
                <p className="font-bold text-kw-ink">State records nearby</p>
                {nearest.map((n, i) => (
                  <p key={i} className="mt-0.5 text-kw-muted">
                    {n.source.replace(/_/g, " ").toLowerCase()} mapped ~{Math.max(30, n.distanceM)} m from this area&apos;s center
                  </p>
                ))}
              </div>
            )}

            <ul className="kw-card kw-scroll mt-3 max-h-64 divide-y divide-kw-line overflow-y-auto">
              {results.slice(0, 50).map((d, i) => (
                <li key={i}>
                  <button
                    className={`kw-row flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left ${selected===d?"bg-kw-soft":""}`}
                    onClick={() => { setSelected(d); mapRef.current?.fitBounds(d.bounds, { padding: 80 }); }}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style={{ background: depthColor(d.depthM), boxShadow:`0 0 0 1px ${depthColor(d.depthM)}55` }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{depthLabel(d.depthM)}</span>
                      <span className="block font-mono text-[11px] text-kw-muted">{d.depthM.toFixed(1)} m deep · {(d.areaM2 / 4046.86).toFixed(2)} acres</span>
                    </span>
                    <span aria-hidden className="text-kw-muted">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Scan history — your recent checks, tap to reload */}
        {history.length > 0 && !results && !scanning && !error && (
          <section className="kw-card mt-4 p-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-kw-muted">Your recent checks</h2>
            <ul className="mt-2 space-y-1.5">
              {history.slice(0, 8).map((h) => (
                <li key={h.id}>
                  <button
                    className="kw-row flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-left"
                    onClick={() => runScanWith(h.bbox)}
                  >
                    <span className="shrink-0 rounded-md bg-kw-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-kw-accent">{h.dips} dip{h.dips === 1 ? "" : "s"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-kw-ink truncate">{h.label}</span>
                      <span className="block font-mono text-[11px] text-kw-muted">{new Date(h.date).toLocaleString([], { month:"short", day:"numeric" })} · avg {h.avgDepth.toFixed(1)} m</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Saved pins */}\
        {pins.length > 0 && (
          <section className="kw-card mt-4 p-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-kw-muted">Saved pins</h2>
            <ul className="mt-2 space-y-1.5">
              {pins.slice(0, 12).map((p) => (
                <li key={p.id}>
                  <button
                    className="kw-row flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-left"
                    onClick={() => {
                      mapRef.current?.fitBounds(
                        [[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]],
                        { padding: 80, duration: 900 },
                      );
                    }}
                  >
                    <span className="shrink-0 text-base">📌</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-kw-ink truncate">{p.label}</span>
                      <span className="block font-mono text-[11px] text-kw-muted">{new Date(p.date).toLocaleString([], { month: "short", day: "numeric" })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Detail card */}
        {selected && (
          <section className="kw-card kw-card--pop kw-animate-pop mt-4 p-4">
            <div className="flex items-start justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <span className="h-3 w-3 rounded-full ring-2 ring-white" style={{ background: depthColor(selected.depthM), boxShadow:`0 0 0 1px ${depthColor(selected.depthM)}55` }} />
                {depthLabel(selected.depthM)}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const c = selected.centroid;
                    const label = geoLabel ?? `${c[0].toFixed(3)}, ${c[1].toFixed(3)}`;
                    const item: HistoryItem = {
                      id: crypto.randomUUID(),
                      label,
                      bbox: [selected.bounds[0][0], selected.bounds[0][1], selected.bounds[1][0], selected.bounds[1][1]],
                      date: Date.now(),
                      dips: 1,
                      avgDepth: selected.depthM,
                    };
                    const prev: HistoryItem[] = JSON.parse(localStorage.getItem("kw-pins") ?? "[]");
                    const next = [item, ...prev].slice(0, 50);
                    localStorage.setItem("kw-pins", JSON.stringify(next));
                    setPins(next);
                  }}
                  className="rounded-md p-1.5 text-xs text-kw-muted hover:bg-kw-soft hover:text-kw-ink"
                  title="Save this pin"
                >
                  📌
                </button>
                <button onClick={() => setSelected(null)} className="-mr-1 -mt-1 rounded-md px-1.5 text-lg leading-none text-kw-muted hover:bg-kw-soft hover:text-kw-ink" aria-label="Close">×</button>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="font-medium text-kw-muted">Depth</dt><dd className="font-semibold">{selected.depthM.toFixed(1)} meters</dd>
              <dt className="font-medium text-kw-muted">Area</dt><dd className="font-semibold">{(selected.areaM2 / 4046.86).toFixed(2)} acres</dd>
              <dt className="font-medium text-kw-muted">Center</dt><dd className="font-mono">{((( selected.bounds[0][1]+selected.bounds[1][1])/2)).toFixed(5)}, {(((selected.bounds[0][0]+selected.bounds[1][0])/2)).toFixed(5)}</dd>
            </dl>
            <p className="mt-3 rounded-lg bg-kw-bg px-2.5 py-2 text-[11px] leading-relaxed text-kw-muted">
              Detected from elevation math — not a confirmed sinkhole. For anything that matters, ask a licensed geologist.
            </p>
          </section>
        )}

        {/* Advanced + disclaimer */}
        <div className="pt-5">
          <button onClick={() => setShowAdvanced((s) => !s)} aria-expanded={showAdvanced}
            className="text-xs font-medium text-kw-muted underline-offset-2 hover:text-kw-ink hover:underline">
            {showAdvanced ? "Hide map layers & info" : "Map layers & info"}
          </button>
          {showAdvanced && (
            <div className="kw-card mt-2 space-y-2 p-3">
              {([
                ["hillshade", "Shaded terrain"],
                ["karst", "Known sinkhole areas (state survey)"],
                ["springs", "Mapped springs"],
                ["countyHeat", "County-wide dips (heat view)"],
              ] as [LayerKey, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={layers[key]} onChange={() => toggle(key)} className="accent-kw-accent" disabled={!ready} />
                  {label}
                </label>
              ))}
              <InSARPanel bbox={scanBbox ?? [-86.85, 38.95, -86.25, 39.45]} />
              <details className="rounded-lg border border-kw-line bg-kw-bg p-3 text-xs leading-relaxed text-kw-muted">
                <summary className="cursor-pointer font-medium text-kw-ink">About &amp; limitations</summary>
                <p className="mt-2">KarstWatch is educational and built entirely on free public data: elevation from USGS/NASA (AWS Open Data), karst maps from the Indiana Geological &amp; Water Survey, addresses from OpenStreetMap.</p>
                <p className="mt-2"><b className="text-kw-ink">This is not a geological survey.</b> Dips are shapes in elevation data — some are sinkholes, many aren&apos;t. Never buy, dig, drill, or build based on this alone.</p>
              </details>

              <div className="mt-4 border-t border-kw-border pt-3 text-center">
                <Link href="/about" className="text-xs text-kw-muted underline-offset-2 hover:text-kw-ink hover:underline">About · Methodology · Accuracy</Link>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div ref={mapDiv} className="relative order-1 h-screen w-full flex-1 md:order-2 md:h-full" />
    </>
  );
}
