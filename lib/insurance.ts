/**
 * lib/insurance.ts — Sinkhole-claim insurance risk proxy
 *
 * There is NO public dataset of "what insurance companies flag as sinkhole-prone",
 * so this is a transparent composite: karst activity + flood exposure + soil
 * erodibility → what an underwriter would likely think of this address.
 *
 * Score 0-100 → LOW / MODERATE / ELEVATED / HIGH, with the headline factors and
 * a "what insurers actually ask" panel (caveat: not a quote, not a denial).
 *
 * Pure client-side. No API keys.
 */

import type { RiskResult, RiskLevel } from "./risk";
import type { GwResult } from "./groundwater";

export type InsLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH";

export interface InsFactors {
  karstScore: number;       // 0-100 (from existing risk engine)
  karstRisk: RiskLevel;
  gwScore: number;          // 0-100
  nearestSinkKm: number | null;
  nearestCaveKm: number | null;
  floodNearby: boolean;
  inKarstZonePct: number;
  dipCount: number;
}

export interface InsResult {
  score: number;
  level: InsLevel;
  headline: string;           // one-liner like "Likely standard premium"
  reason: string;            // plain English why
  factors: InsFactors;
  whatInsurersAsk: string[];   // questions a real underwriter asks
  whatToDo: string[];         // actions that can lower your risk
}

export function scoreInsurance(f: InsFactors): InsResult {
  // Weights: karst activity is the dominant factor, flood adds exposure,
  // soil + proximity are secondary. Sums to 1.0.
  const proximity = (() => {
    const d = f.nearestSinkKm ?? f.nearestCaveKm ?? 10;
    return Math.max(0, 1 - d / 3); // 0km=1, 3km=0
  })();

  const karst01 = f.karstScore / 100;
  const flood01 = f.floodNearby ? 1 : 0.2; // some base flood exposure
  const gw01 = f.gwScore / 100;
  const karstZone01 = f.inKarstZonePct / 100;
  const dips01 = Math.min(f.dipCount / 12, 1); // 12+ dips = saturated
  const prox01 = proximity;

  const score01 =
    karst01 * 0.40 +
    prox01 * 0.20 +
    flood01 * 0.15 +
    karstZone01 * 0.10 +
    gw01 * 0.10 +
    dips01 * 0.05;

  const score = Math.round(score01 * 100);

  let level: InsLevel;
  let headline: string;
  let reason: string;

  if (score >= 70) {
    level = "HIGH";
    headline = "Above-average sinkhole-claim risk";
    reason = "Your scan shows karst features and a high dip count nearby. Some insurers price this as a separate sinkhole endorsement or exclude coverage — many don't ask at all unless you do.";
  } else if (score >= 45) {
    level = "ELEVATED";
    headline = "Elevated sinkhole-claim risk";
    reason = "Some karst activity detected and you're close to mapped sinkholes or cave clusters. Most insurers won't surcharge, but you may get follow-up questions at renewal.";
  } else if (score >= 22) {
    level = "MODERATE";
    headline = "Standard pricing most likely";
    reason = "Modest karst influence. You're unlikely to face sinkhole-specific questions, but mention any visible ground changes to your agent at renewal.";
  } else {
    level = "LOW";
    headline = "Standard pricing expected";
    reason = "No significant karst signal near your scan. Sinkhole-specific questions are unlikely — standard homeowner's pricing applies.";
  }

  // What real underwriters actually ask
  const whatInsurersAsk = [
    "Any history of sinkhole activity on the property?",
    "Cracks in foundation, walls, or pool deck wider than ¼ inch?",
    "Doors or windows that stick or won't close since purchase?",
    "Visible ground depressions or recent earthwork in the yard?",
    "Pool losing water faster than evaporation can explain?",
  ];
  if (f.floodNearby) whatInsurersAsk.push("Property within a FEMA 100-year floodplain?");
  if (f.nearestSinkKm !== null && f.nearestSinkKm < 1) {
    whatInsurersAsk.unshift(`Sinkhole ${(f.nearestSinkKm).toFixed(1)} km from scan center — be ready to describe any prior subsidence.`);
  }

  // What lowers risk
  const whatToDo = [
    "Document the property's condition now (date-stamped photos of walls, foundation, slab).",
    "Re-grade soil so roof gutters drain at least 10 ft from the foundation.",
  ];
  if (f.floodNearby) whatToDo.push("Ask about a separate flood policy — standard homeowner's excludes flood.");
  if (score >= 45) {
    whatToDo.push("Shop 2–3 carriers: sinkhole-coverage language varies wildly. A carrier in karst country (Indiana, Kentucky, Florida, Pennsylvania) is more likely to price this honestly.");
    whatToDo.push("If denied sinkhole coverage, request the underwriting reason in writing — useful if you later dispute.");
  }

  return { score, level, headline, reason, factors: f, whatInsurersAsk, whatToDo };
}

export function insFactorsFrom(risk: RiskResult | null, gw: GwResult | null, floodNearby: boolean): InsFactors {
  return {
    karstScore: risk ? Math.round(risk.score * 100) : 0,
    karstRisk: risk?.risk ?? "LOW",
    gwScore: gw?.score ?? 0,
    nearestSinkKm: risk?.factors.nearestSinkholeKm ?? null,
    nearestCaveKm: risk?.factors.nearestCaveKm ?? null,
    floodNearby,
    inKarstZonePct: risk?.factors.karstZoneOverlap ?? 0,
    dipCount: risk?.factors.dipCount ?? 0,
  };
}