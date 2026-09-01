"use client";

import { useEffect, useState } from "react";

/**
 * OfflinePreCache — fetches every KarstWatch static geo layer + service-worker
 * pre-cache key into localStorage. Lets you use the app with no signal in the
 * field. Total ~600KB of geo data; the map basemap comes from OSM and is also
 * cached by the existing service worker.
 */
const LAYERS: { url: string; key: string; label: string }[] = [
  { url: "/static/geo/bedrock-karst.geojson", key: "kw:geo:bedrock-karst", label: "Limestone bedrock (IGS 1:250K, 10 units)" },
  { url: "/static/geo/caves-clustered.geojson", key: "kw:geo:caves-clustered", label: "Cave clusters (11 from 1,951 sinks)" },
  { url: "/static/geo/county-risk.geojson", key: "kw:geo:county-risk", label: "County risk heatmap (92 counties)" },
  { url: "/static/geo/ssurgo-monroe.geojson", key: "kw:geo:ssurgo-monroe", label: "Soil erodibility (62 Monroe mapunits)" },
  { url: "/static/geo/fema-flood.geojson", key: "kw:geo:fema-flood", label: "FEMA 100-yr floodplains (8 polygons)" },
];

type CacheState = { [k: string]: { bytes: number; at: number } };

function readMeta(): CacheState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem("kw:cache:meta") ?? "{}");
  } catch {
    return {};
  }
}

function writeMeta(m: CacheState) {
  if (typeof window === "undefined") return;
  localStorage.setItem("kw:cache:meta", JSON.stringify(m));
}

export default function OfflinePreCache() {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [meta, setMeta] = useState<CacheState>({});
  const [totalBytes, setTotalBytes] = useState(0);

  useEffect(() => {
    const cur = readMeta();
    setMeta(cur);
    setTotalBytes(Object.values(cur).reduce((s, v) => s + v.bytes, 0));
  }, []);

  async function preCache() {
    setState("working");
    setProgress({ done: 0, total: LAYERS.length });
    const cur = readMeta();
    let ok = true;
    for (let i = 0; i < LAYERS.length; i++) {
      const l = LAYERS[i];
      try {
        const r = await fetch(l.url, { cache: "reload" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        localStorage.setItem(l.key, text);
        cur[l.key] = { bytes: text.length, at: Date.now() };
      } catch (e) {
        ok = false;
      }
      setProgress({ done: i + 1, total: LAYERS.length });
    }
    writeMeta(cur);
    setMeta(cur);
    setTotalBytes(Object.values(cur).reduce((s, v) => s + v.bytes, 0));
    setState(ok ? "done" : "error");
  }

  function clearCache() {
    for (const l of LAYERS) localStorage.removeItem(l.key);
    localStorage.removeItem("kw:cache:meta");
    setMeta({});
    setTotalBytes(0);
    setState("idle");
  }

  const cachedCount = Object.keys(meta).length;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold tracking-wide text-stone-800">Offline cache</h3>
        <span className="text-[11px] font-bold text-stone-500">
          {cachedCount}/{LAYERS.length} cached · {(totalBytes / 1024).toFixed(0)} KB
        </span>
      </div>
      <p className="mt-1 text-xs text-stone-600">
        Pre-download the public KarstWatch layers for your area. Once cached, the app still shows bedrock, soil, floodplains, and risk layers with no internet.
      </p>

      <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-stone-600">
        {LAYERS.map((l) => {
          const m = meta[l.key];
          return (
            <div key={l.key} className="flex justify-between gap-2">
              <span className="truncate">{l.label}</span>
              <span className="font-mono text-stone-500">
                {m ? `${(m.bytes / 1024).toFixed(0)} KB` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={preCache}
          disabled={state === "working"}
          className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {state === "working"
            ? `Caching ${progress.done}/${progress.total}…`
            : state === "done"
            ? "Re-cache all layers"
            : cachedCount > 0
            ? "Re-cache all layers"
            : "Download all layers"}
        </button>
        {cachedCount > 0 && (
          <button
            onClick={clearCache}
            className="rounded-md border border-stone-300 px-3 py-2 text-xs font-bold text-stone-700 hover:bg-stone-100"
          >
            Clear
          </button>
        )}
      </div>

      {state === "error" && (
        <p className="mt-2 text-[11px] text-red-700">Some layers failed — check your connection and try again.</p>
      )}
    </div>
  );
}