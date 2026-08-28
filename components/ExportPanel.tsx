"use client";

import { useState } from "react";
import type { RiskResult } from "@/lib/risk";
import type { GwResult } from "@/lib/groundwater";

interface ExportPanelProps {
  results: unknown[] | null;
  riskResult: RiskResult | null;
  gwResult?: GwResult | null;
  areaLabel?: string | null;
  bbox?: [number, number, number, number] | null;
}

function captureMapPng(): string | null {
  try {
    const canvas = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
    if (!canvas || canvas.width === 0) return null;
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function depNumber(dep: unknown, keys: string[]): number | null {
  const d = dep as Record<string, unknown>;
  for (const k of keys) {
    const v = d?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function depClass(dep: unknown): string {
  const d = dep as Record<string, unknown>;
  const v = (d?.confidence ?? d?.classification ?? d?.label ?? d?.klass) as
    | string
    | undefined;
  return typeof v === "string" && v ? v : "detected";
}

function wellWaterAdvisory(gw: GwResult): string {
  const f = gw.factors;
  const parts: string[] = [];
  if (f.bedrockKarst) parts.push("limestone/dolomite bedrock");
  if (f.karstOverlapPct > 0)
    parts.push(`${Math.round(f.karstOverlapPct)}% of the area overlies mapped karst zones`);
  const d = f.nearestSinkKm ?? f.nearestCaveKm;
  if (d != null) parts.push(`nearest known sinkhole/cave ~${d.toFixed(1)} km away`);
  if (f.hydgrp) parts.push(`soil drainage group ${String(f.hydgrp).toUpperCase()}`);
  if (f.floodNearby) parts.push("a mapped floodplain nearby adds recharge");
  const detail = parts.length
    ? parts.join(", ")
    : "no major karst indicators detected in this scan area";
  const advice =
    gw.level === "LOW"
      ? "Standard well care is usually enough — test for bacteria and nitrate once a year."
      : "Test well water for bacteria and nitrate every year, and keep septic, fuel, and fertilizer at least 100 ft from any sinkhole or depression.";
  return `${detail}. ${advice}`;
}

export default function ExportPanel({
  results,
  riskResult,
  gwResult,
  areaLabel,
  bbox,
}: ExportPanelProps) {
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const hasScan = !!(results && results.length) || !!riskResult || !!gwResult;

  const exportPng = () => {
    setBusy("png");
    try {
      const png = captureMapPng();
      if (!png) {
        alert("Map image isn't available yet — pan the map or run a scan first.");
        return;
      }
      download(png, "karstwatch-map.png");
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = async () => {
    setBusy("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const W = doc.internal.pageSize.getWidth();
      const M = 40;
      let y = 48;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(28, 25, 23);
      doc.text("KarstWatch Pro — Area Risk Report", M, y);
      y += 20;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(87, 83, 78);
      const meta = [
        `Generated ${new Date().toLocaleString()}`,
        areaLabel ? `Area: ${areaLabel}` : null,
        bbox ? `Bounds: ${bbox.map((n) => n.toFixed(4)).join(", ")}` : null,
      ].filter(Boolean) as string[];
      meta.forEach((line) => {
        doc.text(line, M, y);
        y += 14;
      });
      y += 6;

      const png = captureMapPng();
      if (png) {
        const imgW = W - M * 2;
        const imgH = imgW * 0.55;
        doc.addImage(png, "PNG", M, y, imgW, imgH);
        y += imgH + 16;
      }

      const section = (title: string) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(28, 25, 23);
        doc.text(title, M, y);
        y += 15;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(68, 64, 60);
      };
      const wrap = (text: string) => {
        const lines = doc.splitTextToSize(text, W - M * 2) as string[];
        doc.text(lines, M, y);
        y += lines.length * 13 + 4;
      };

      if (riskResult) {
        section("Karst risk");
        wrap(`Level: ${riskResult.risk} — score ${Math.round(riskResult.score * 100)}/100`);
        wrap(riskResult.recommendation);
        const f = riskResult.factors;
        wrap(
          `Dips detected: ${f.dipCount} (avg depth ${f.avgDepthM} m, max ${f.maxDepthM} m) · Likely sinkholes: ${f.likelyCount}, uncertain: ${f.uncertainCount}`
        );
        if (f.nearestSinkholeKm != null)
          wrap(`Nearest verified sinkhole: ${f.nearestSinkholeKm.toFixed(1)} km`);
        if (f.karstZoneOverlap > 0) wrap(`Area over known karst zones: ${f.karstZoneOverlap}%`);
        y += 4;
      }

      if (gwResult) {
        if (y > 660) {
          doc.addPage();
          y = 48;
        }
        section(`Groundwater contamination risk: ${gwResult.level} (${gwResult.score}/100)`);
        wrap(gwResult.why);
        doc.setFont("helvetica", "bold");
        wrap(`Well water: ${gwResult.level} — ${wellWaterAdvisory(gwResult)}`);
        doc.setFont("helvetica", "normal");
        y += 4;
      }

      const rows = (results ?? [])
        .slice()
        .sort(
          (a, b) =>
            (depNumber(b, ["depthM", "depth", "depth_m"]) ?? 0) -
            (depNumber(a, ["depthM", "depth", "depth_m"]) ?? 0)
        )
        .slice(0, 15);
      if (rows.length) {
        if (y > 620) {
          doc.addPage();
          y = 48;
        }
        section(`Detected depressions (top ${rows.length} by depth)`);
        doc.setFontSize(9);
        rows.forEach((r, i) => {
          if (y > 760) {
            doc.addPage();
            y = 48;
          }
          const depth = depNumber(r, ["depthM", "depth", "depth_m"]);
          const area = depNumber(r, ["areaM2", "area", "area_m2"]);
          doc.text(
            `${i + 1}. Depth ${depth != null ? depth.toFixed(1) + " m" : "—"}  ·  Area ${
              area != null ? Math.round(area) + " m²" : "—"
            }  ·  ${depClass(r)}`,
            M,
            y
          );
          y += 12;
        });
        y += 8;
      }

      if (y > 700) {
        doc.addPage();
        y = 48;
      }
      doc.setFontSize(8);
      doc.setTextColor(120, 113, 108);
      wrap(
        "Sources: Indiana Geological Survey (bedrock, karst zones, springs), USDA SSURGO soils, FEMA floodplains, USGS terrain. Public data, no warranty."
      );
      wrap(
        "KarstWatch is a screening tool, not an engineering or geological assessment. Consult a licensed professional before construction, septic, or well decisions."
      );

      doc.save("karstwatch-report.pdf");
    } catch (e) {
      console.error(e);
      alert("PDF export failed — see console for details.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold tracking-wide text-stone-800">Export report</h3>
      {gwResult && (
        <p className="mt-2 text-xs leading-relaxed text-stone-600">
          <span className="font-semibold text-stone-800">Well water: {gwResult.level}.</span>{" "}
          {wellWaterAdvisory(gwResult)}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={exportPng}
          disabled={busy !== null}
          className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          {busy === "png" ? "Saving…" : "Map PNG"}
        </button>
        <button
          onClick={exportPdf}
          disabled={!hasScan || busy !== null}
          className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy === "pdf" ? "Building…" : "PDF report"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-stone-500">
        PDF includes the map image, karst + groundwater scores, well-water advisory, and the top
        depressions.
      </p>
    </div>
  );
}
