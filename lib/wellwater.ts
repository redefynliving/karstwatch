/**
 * lib/wellwater.ts — Private well water testing recommendations
 *
 * Pure client-side. Combines groundwater vulnerability + karst risk + distance
 * to nearest mapped sinkhole → recommended well-water test cadence, what to
 * test for, and an actionable checklist.
 *
 * No network calls, no API keys. All inputs already exist from prior scans.
 */

import type { GwResult, GwLevel } from "./groundwater";
import type { RiskResult } from "./risk";

export type WellLevel = "EXCELLENT" | "GOOD" | "MONITOR" | "TEST_YEARLY" | "TEST_TWICE_YEARLY";

export interface WellFactors {
  gwLevel: GwLevel;
  gwScore: number;
  nearestSinkKm: number | null;
  nearestCaveKm: number | null;
  karstOverlapPct: number;
  dipCount: number;
  likelyCount: number;
}

export interface WellResult {
  level: WellLevel;
  cadence: string;          // "Test every 2 years" / "Test yearly" / etc.
  priority: number;         // 0-100
  reason: string;           // one-sentence plain English
  tests: string[];           // what to test for
  actions: string[];         // what the homeowner can do
  factors: WellFactors;
}

export function scoreWell(f: WellFactors): WellResult {
  // Score combines GW + proximity to known features + dip count.
  const proximity = (() => {
    const d = f.nearestSinkKm ?? f.nearestCaveKm ?? 10;
    return Math.max(0, 1 - d / 5); // 0km=1, 5km=0
  })();
  const gw01 = f.gwScore / 100;
  const karstDensity = f.karstOverlapPct / 100;
  const dips01 = Math.min(f.likelyCount / 8, 1); // 8+ likely dips = saturated

  const priority =
    gw01 * 0.45 +
    proximity * 0.30 +
    karstDensity * 0.15 +
    dips01 * 0.10;

  const pct = Math.round(priority * 100);

  // Map to a level
  let level: WellLevel;
  let cadence: string;
  let reason: string;

  if (pct >= 75) {
    level = "TEST_TWICE_YEARLY";
    cadence = "Test every 6 months";
    reason = "High karst + permeable soil means surface contaminants can reach your well fast — twice-yearly testing is the safe play.";
  } else if (pct >= 55) {
    level = "TEST_YEARLY";
    cadence = "Test every year";
    reason = "Karst bedrock or permeable soil nearby. Annual testing catches most contamination before it becomes a health issue.";
  } else if (pct >= 32) {
    level = "MONITOR";
    cadence = "Test every 2 years";
    reason = "Some karst signal but you're not in the worst zone. Every-other-year testing is enough unless conditions change (new construction, flooding, nearby spill).";
  } else if (pct >= 15) {
    level = "GOOD";
    cadence = "Test every 3 years";
    reason = "Limited karst influence. Routine testing every 3 years is fine — your well is probably well protected.";
  } else {
    level = "EXCELLENT";
    cadence = "Test every 5 years";
    reason = "No karst influence detected and your soil is tight. Your well is well protected — basic testing every 5 years is plenty.";
  }

  // What to test for — escalates with risk
  const tests: string[] = ["Coliform bacteria (basic potability)"];
  if (pct >= 32) tests.push("Nitrate (runoff from septic / fertilizer)");
  if (pct >= 55) tests.push("Volatile organics (industrial / fuel)");
  if (pct >= 75) tests.push("Lead, arsenic, pesticides (full panel)");
  if (proximity >= 0.5) tests.push("Turbidity after heavy rain (sinkhole shortcut)");

  // Homeowner actions
  const actions: string[] = [
    "Keep well cap sealed and inspect yearly for cracks.",
  ];
  if (f.nearestSinkKm !== null && f.nearestSinkKm < 0.3) {
    actions.unshift(`Sinkhole only ${(f.nearestSinkKm*1000).toFixed(0)} ft from your scan center — keep septic, livestock, and chemical storage >100 ft from any sinkhole.`);
  }
  if (pct >= 55) {
    actions.push("Redirect downspouts and runoff away from the wellhead.");
    actions.push("If you use lawn fertilizer, apply in fall (not summer) — less wash-off into sinkholes.");
  }
  if (pct >= 75) {
    actions.push("Consider adding point-of-use filtration (reverse osmosis) at the kitchen tap.");
  }

  return {
    level,
    cadence,
    priority: pct,
    reason,
    tests,
    actions,
    factors: f,
  };
}

/**
 * Convenience: derive WellFactors from existing GW + risk results.
 */
export function wellFactorsFrom(gw: GwResult | null, risk: RiskResult | null): WellFactors {
  return {
    gwLevel: gw?.level ?? "LOW",
    gwScore: gw?.score ?? 0,
    nearestSinkKm: risk?.factors.nearestSinkholeKm ?? null,
    nearestCaveKm: risk?.factors.nearestCaveKm ?? null,
    karstOverlapPct: risk?.factors.karstZoneOverlap ?? 0,
    dipCount: risk?.factors.dipCount ?? 0,
    likelyCount: risk?.factors.likelyCount ?? 0,
  };
}