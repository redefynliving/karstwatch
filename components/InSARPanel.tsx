"use client";

import { useState } from "react";
import type { InSARSummary } from "@/lib/insar";

interface Props {
  bbox: [number, number, number, number];
}

/**
 * Real Sentinel-1 SAR data lookup via NASA CMR (no auth needed for metadata).
 *
 * Replaces the generic "open Vertex" link with:
 *  1. actual acquisition count / date range for the user's scan bbox
 *  2. a quality signal (temporal baseline: good / moderate / poor)
 *  3. a pre-scoped Vertex link pointed at the exact area + date range
 *
 * Full interferogram processing still lives in ASF Vertex or a local SNAP/GMTSAR
 * install — we just make sure the user goes there with the right inputs.
 */
export default function InSARPanel({ bbox }: Props) {
  const [summ, setSumm] = useState<InSARSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await import("@/lib/insar").then(m => m.queryInSAR(bbox));
      setSumm(r);
    } catch (e: any) {
      setErr(e?.message ?? "InSAR query failed — NASA CMR may be down or rate-limited.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <summary
        className="cursor-pointer text-sm font-medium text-kw-ink"
        onClick={(e) => {
          // don't toggle closed while loading
          if (busy) e.preventDefault();
        }}
      >
        Check if the ground is moving (advanced)
      </summary>
      <div className="mt-2 space-y-3 text-xs leading-relaxed text-stone-600">
        <p>
          Satellites can measure tiny ground movements over time. This looks up
          real Sentinel-1 radar acquisitions from NASA's public catalog (CMR — no
          login needed) for your scan area, then points you to ASF Vertex for the
          actual processing.
        </p>

        {!summ && (
          <button
            onClick={go}
            disabled={busy}
            className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Querying NASA CMR…" : "Look up Sentinel-1 acquisitions"}
          </button>
        )}

        {busy && <p className="text-[11px] text-stone-500">Querying NASA CMR for Sentinel-1 acquisitions over the scan area…</p>}

        {err && <p className="text-xs text-red-700">{err}</p>}

        {summ && (
          <div className="space-y-2">
            <p>{summ.note}</p>
            {summ.total > 0 && summ.dateRange && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white border border-stone-200 p-2">
                  <span className="block font-bold text-stone-900">{summ.total}</span>
                  <span className="text-stone-500">acquisitions ({summ.spanDays} days span)</span>
                </div>
                <div className="rounded-lg bg-white border border-stone-200 p-2">
                  <span className="block font-bold text-stone-900">↙ {summ.descending} / ↗ {summ.ascending}</span>
                  <span className="text-stone-500">descending / ascending</span>
                </div>
              </div>
            )}
            <p className="text-[11px] text-stone-500">
              Polarisations: {summ.polarisations?.join(", ") ?? "—"}
            </p>

            {summ.temporalBaseline !== "poor" && (
              <a
                href={summ.vertexUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block font-medium text-kw-accent underline underline-offset-2 hover:brightness-90"
              >
                Open ASF Vertex (pre-scoped to this area) →
              </a>
            )}
            {summ.temporalBaseline === "poor" && (
              <p className="text-[11px] text-amber-700">
                Not enough same-direction acquisitions for a clean interferogram. Move your scan smaller or pick a different date range.
              </p>
            )}

            <button
              onClick={go}
              disabled={busy}
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
            >
              {busy ? "Refreshing…" : "Re-check acquisitions"}
            </button>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-stone-500">
          Sentinel-1 flies every 6 days (12 with the A+B pair). Look for clusters of
          colors in the Vertex "map stack" view that tighten over time — that can
          mean sinking ground. Slow movement of a few mm/year is normal.
        </p>
      </div>
    </details>
  );
}
