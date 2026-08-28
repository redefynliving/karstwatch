/**
 * lib/groundwater.ts — Groundwater vulnerability (DRASTIC-lite)
 * Pure client-side, zero API. Derives from data we already have:
 *  Soil (SSURGO K-factor/clay/hydgrp) + Bedrock + Karst proximity + Flood + Densities
 *  Score 0-100 → LOW/MODERATE/HIGH/CRITICAL with plain-English why
 */

export type GwLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface GwFactors {
  hydgrp: string | null;      // A/B/C/D from SSURGO
  kffact: number | null;       // 0-0.64
  clayPct: number | null;      // 0-100
  bedrockKarst: boolean;
  karstOverlapPct: number;     // 0-100
  nearestSinkKm: number | null;
  nearestCaveKm: number | null;
  floodNearby: boolean;        // inside/beside FEMA 100yr
  dipDensity: number;          // 0-1 normalized
}

export interface GwResult {
  score: number;              // 0-100
  level: GwLevel;
  label: string;              // "HIGH groundwater contamination risk"
  why: string;                // 1-sentence plain English
  factors: GwFactors;
  breakdown: { name: string; value: number; weight: number; note: string }[]; // for expand
}

function hydgrpScore(h: string | null): number {
  if (!h) return 0.4;
  const v = h.toUpperCase();
  if (v.includes("D")) return 1.0;
  if (v.includes("C")) return 0.7;
  if (v.includes("B")) return 0.4;
  if (v.includes("A")) return 0.2;
  return 0.5;
}

export function scoreGroundwater(f: GwFactors): GwResult {
  // Weights sum 1.0
  const wBedrock = 0.22;
  const wSoilPerm = 0.20; // hydgrp + kffact
  const wKarst = 0.18;
  const wFlood = 0.15;
  const wDensity = 0.13;
  const wClayInv = 0.12; // low clay = more permeability = more vulnerability

  const bedrock = f.bedrockKarst ? 1 : 0;
  const soilPerm = (hydgrpScore(f.hydgrp) * 0.7 + Math.min((f.kffact ?? 0.3)/0.6,1) * 0.3);
  const karstProx = (() => {
    const d = f.nearestSinkKm ?? f.nearestCaveKm ?? 10;
    return Math.max(0, 1 - d/5); // 0km=1, 5km=0
  })() * 0.6 + (f.karstOverlapPct/100)*0.4;
  const flood = f.floodNearby ? 1 : 0;
  const density = Math.min(f.dipDensity, 1);
  const clayInv = 1 - Math.min((f.clayPct ?? 20)/40, 1); // 0 clay=1, 40+ clay=0

  const score01 =
    bedrock * wBedrock +
    soilPerm * wSoilPerm +
    karstProx * wKarst +
    flood * wFlood +
    density * wDensity +
    clayInv * wClayInv;

  const score = Math.round(score01 * 100);

  let level: GwLevel = "LOW";
  if (score >= 75) level = "CRITICAL";
  else if (score >= 55) level = "HIGH";
  else if (score >= 32) level = "MODERATE";

  const label = `${level} groundwater contamination risk`;

  let why = "";
  if (level === "CRITICAL") why = "Limestone bedrock with sinkholes nearby and permeable soil creates a direct path to the aquifer — surface contaminants can reach groundwater quickly.";
  else if (level === "HIGH") why = "Karst bedrock and/or nearby sinkholes plus somewhat permeable soil means water (and anything in it) moves to groundwater faster than normal.";
  else if (level === "MODERATE") why = "Some karst or moderately permeable soil nearby. Groundwater is somewhat protected, but watch wells and septic placement.";
  else why = "No limestone bedrock detected and soil is tighter. Groundwater has more natural protection here.";

  const breakdown = [
    { name: "Limestone bedrock", value: bedrock, weight: wBedrock, note: f.bedrockKarst ? "Present" : "Not detected" },
    { name: "Soil permeability", value: +soilPerm.toFixed(2), weight: wSoilPerm, note: `${f.hydgrp ?? "?"} • K=${f.kffact ?? "?"}` },
    { name: "Near karst features", value: +karstProx.toFixed(2), weight: wKarst, note: f.nearestSinkKm !== null ? `${f.nearestSinkKm.toFixed(1)} km to sink` : "No sink nearby" },
    { name: "Floodplain nearby", value: flood, weight: wFlood, note: f.floodNearby ? "Inside 100-yr floodplain" : "Outside" },
    { name: "Depression density", value: +density.toFixed(2), weight: wDensity, note: `${Math.round(f.dipDensity*100)}%` },
    { name: "Low clay (permeable)", value: +clayInv.toFixed(2), weight: wClayInv, note: `${f.clayPct ?? "?"}% clay` },
  ];

  return { score, level, label, why, factors: f, breakdown };
}
