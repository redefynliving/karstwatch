"use client";

import { useState } from "react";
import type { TimeLapseResult } from "@/lib/timelapse";

interface Props {
  bbox: [number, number, number, number];
  onResult?: (r: TimeLapseResult) => void;
}

export default function TimeLapsePanel({ bbox, onResult }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TimeLapseResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const r = await import("@/lib/timelapse").then(m => m.runTimeLapse(bbox));
      setResult(r);
      onResult?.(r);
    } catch (e: any) {
      setErr(e?.message ?? "Time-lapse failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold tracking-wide text-amber-900">Elevation time-lapse</h3>
        {result && (
          <span className={`rounded-full border px-3 py-1 text-xs font-extrabold tracking-wider ${
            result.newDipCount === 0 ? "bg-emerald-600 text-white border-emerald-700" :
            result.newDipCount < 5 ? "bg-amber-400 text-stone-900 border-amber-500" :
            result.newDipCount < 25 ? "bg-orange-500 text-white border-orange-600" :
            "bg-red-600 text-white border-red-700"
          }`}>
            {result.newDipCount} new dips
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-amber-800">
        Compare two DEM vintages (modern vs older stitched dataset) to find where the ground has dropped.
      </p>

      {!result && (
        <button
          onClick={go}
          disabled={busy}
          className="mt-3 w-full rounded-md bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? "Fetching 2 vintages of elevation…" : "Run elevation time-lapse"}
        </button>
      )}

      {busy && (
        <p className="mt-2 text-[11px] text-stone-500">
          Downloads ~16-64 tiles twice (modern + legacy) and computes the diff. 30-90 sec depending on area.
        </p>
      )}

      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}

      {result && (
        <div className="mt-3 space-y-2">
          <p className="text-sm leading-relaxed text-stone-700">{result.summary}</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-white border border-amber-100 p-2">
              <div className="text-[10px] font-bold text-amber-800 uppercase">New dips</div>
              <div className="text-lg font-black text-stone-900">{result.newDipCount}</div>
              <div className="text-[10px] text-stone-500">closed depressions</div>
            </div>
            <div className="rounded-lg bg-white border border-amber-100 p-2">
              <div className="text-[10px] font-bold text-amber-800 uppercase">Avg settle</div>
              <div className="text-lg font-black text-stone-900">{result.avgSettlementM}<span className="text-xs font-normal text-stone-500"> m</span></div>
              <div className="text-[10px] text-stone-500">across dropped cells</div>
            </div>
            <div className="rounded-lg bg-white border border-amber-100 p-2">
              <div className="text-[10px] font-bold text-amber-800 uppercase">Max settle</div>
              <div className="text-lg font-black text-stone-900">{result.maxSettlementM}<span className="text-xs font-normal text-stone-500"> m</span></div>
              <div className="text-[10px] text-stone-500">single cell</div>
            </div>
          </div>
          <button
            onClick={go}
            disabled={busy}
            className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {busy ? "Running…" : "Re-run time-lapse"}
          </button>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
        Honest caveat: terrain tiles blend multiple sources; absolute depth numbers aren't precise. Use this to spot <i>patterns</i> of new subsidence, then verify on the ground.
      </p>
    </div>
  );
}