/**
 * lib/risk.ts — KarstWatch Pro risk scoring engine
 *
 * Pure client-side scoring. Combines:
 * - Depression count & depth (from ScanResult)
 * - Karst zone overlap (IGWS Sinkhole Areas polygon)
 * - Bedrock lithology (limestone/dolomite = high potential)
 * - Proximity to known cave entrances & sinkhole inventory points
 *
 * All inputs are pre-loaded GeoJSON features or scalar stats.
 * No network calls, no API keys.
 */

import type { Depression } from "./depression";

type GeoObj = { type: string; geometry: { type: string; coordinates: any }; properties: any };

// ---- helpers -------------------------------------------------------------

function areaOfPolygon(coords: number[][][]): number {
  // Shoelace formula on a sphere (approximate, in degrees²)
  const ring = coords[0];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += (x2 - x1) * (y2 + y1);
  }
  return Math.abs(area / 2);
}

function pointInPolygon(lng: number, lat: number, polygon: number[][][]): boolean {
  // Ray casting algorithm
  const ring = polygon[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Normalize a GeoJSON geometry to a list of outer rings so that both
 * Polygon (coordinates[0] is the ring) and MultiPolygon (coordinates[i][0]
 * is the ring of the i-th polygon) are handled correctly.
 */
function outerRings(geometry: { type: string; coordinates: any }): number[][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((poly: number[][][]) => poly[0]);
  return [];
}

function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- scoring -------------------------------------------------------------

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskFactors {
  dipCount: number;
  avgDepthM: number;
  maxDepthM: number;
  karstZoneOverlap: number;  // 0–1 fraction of scan area in karst zones
  bedrockKarst: boolean;     // true if any limestone/dolomite under scan area
  nearestSinkholeKm: number | null;
  nearestCaveKm: number | null;
  likelyCount: number;       // count of likely-confidence dips
  uncertainCount: number;    // count of uncertain-confidence dips
}

export interface RiskResult {
  score: number;           // 0–1 composite score
  risk: RiskLevel;
  factors: RiskFactors;
  recommendation: string;
}

/**
 * Compute a karst risk score from a set of detected depressions + overlay context.
 *
 * Scoring weights (total = 1.0):
 *   dip_density     — 25%  (how many dips per km²)
 *   avg_depth       — 20%  (how deep the dips are on average)
 *   karst_overlap   — 20%  (fraction of area over known karst zones)
 *   bedrock_karst   — 15%  (limestone/dolomite bedrock present)
 *   nearest_feature — 10%  (proximity to known sinkholes/caves)
 *   shape_quality   — 10%  (fraction of dips classified "likely")
 */
export function scoreRisk(
  dips: Depression[],
  bbox: [number, number, number, number],
  karstZones: GeoObj[] | null,    // IGWS Karst Sinkhole Areas polygons
  bedrockKarst: GeoObj[] | null,  // limestone/dolomite bedrock polygons
  knownSinkholes: GeoObj[] | null, // IGWS Sinkhole Inventory points
  knownCaves: GeoObj[] | null,     // NSS cave entrances points (optional)
): RiskResult {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const areaDeg2 = (maxLng - minLng) * (maxLat - minLat);
  // Rough area in km² (valid near Indiana latitude)
  const areaKm2 = areaDeg2 * 111 * 111;

  // --- dip density (0–1, normalized to 50 dips/km² = max) ---
  const dipCount = dips.length;
  const dipDensity = Math.min(dipCount / Math.max(areaKm2, 0.01) / 50, 1);

  // --- depth (0–1, normalized to 5m = max) ---
  const depths = dips.map(d => d.depthM);
  const avgDepth = depths.reduce((a, b) => a + b, 0) / Math.max(dips.length, 1);
  const maxDepth = Math.max(...depths, 0);
  const depthScore = Math.min(avgDepth / 5, 1);

  // --- karst zone overlap ---
  let karstOverlap = 0;
  if (karstZones && karstZones.length > 0) {
    const testPoints = gridSample(bbox, 50); // 50 sample points
    let hits = 0;
    for (const [lng, lat] of testPoints) {
      if (karstZones.some(z => outerRings(z.geometry).some(ring => pointInPolygon(lng, lat, [ring])))) {
        hits++;
      }
    }
    karstOverlap = hits / testPoints.length;
  }

  // --- bedrock lithology ---
  let bedrockIsKarst = false;
  if (bedrockKarst && bedrockKarst.length > 0) {
    const testPoints = gridSample(bbox, 50);
    bedrockIsKarst = testPoints.some(([lng, lat]) =>
      bedrockKarst.some(b => outerRings(b.geometry).some(ring => pointInPolygon(lng, lat, [ring])))
    );
  }

  // --- nearest known sinkhole / cave ---
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const nearestSinkholeKm = nearestDistance(centerLat, centerLng, knownSinkholes);
  const nearestCaveKm = nearestDistance(centerLat, centerLng, knownCaves);

  // Proximity score: 0km = 1.0, 5km+ = 0
  const proximityScore = nearestSinkholeKm !== null
    ? Math.max(0, 1 - nearestSinkholeKm / 5)
    : 0;

  // --- shape quality ---
  const likelyCount = dips.filter(d => d.confidence === "likely").length;
  const uncertainCount = dips.filter(d => d.confidence === "uncertain").length;
  const shapeQuality = dips.length > 0
    ? likelyCount / dips.length + (uncertainCount / dips.length) * 0.5
    : 0;

  // --- composite score ---
  const score =
    dipDensity * 0.25 +
    depthScore * 0.20 +
    karstOverlap * 0.20 +
    (bedrockIsKarst ? 1 : 0) * 0.15 +
    proximityScore * 0.10 +
    Math.min(shapeQuality, 1) * 0.10;

  // --- risk level ---
  let risk: RiskLevel;
  if (score >= 0.7) risk = "CRITICAL";
  else if (score >= 0.5) risk = "HIGH";
  else if (score >= 0.3) risk = "MEDIUM";
  else risk = "LOW";

  // --- recommendation ---
  let recommendation: string;
  if (risk === "CRITICAL") {
    recommendation = "Critical karst risk. " + dipCount + " depression" + (dipCount === 1 ? " was" : "s were") +
      " detected, many with classic sinkhole shape. Nearest verified sinkhole is " +
      (nearestSinkholeKm !== null ? nearestSinkholeKm.toFixed(1) + " km away" : "unknown") +
      ". Professional geotechnical survey required before any ground disturbance.";
  } else if (risk === "HIGH") {
    recommendation = "High karst risk detected. " + likelyCount + " likely sinkholes on " +
      (bedrockIsKarst ? "limestone bedrock" : "karst-prone terrain") +
      ". Recommend professional site assessment before building or digging.";
  } else if (risk === "MEDIUM") {
    recommendation = "Moderate risk. " + dipCount + " depressions detected (" +
      likelyCount + " likely sinkholes). Karst features present nearby. Monitor for changes.";
  } else {
    recommendation = "Low karst risk. " + dipCount + " depressions found, mostly natural " +
      "topography features. Low likelihood of active karst processes.";
  }

  return {
    score: Math.round(score * 100) / 100,
    risk,
    factors: {
      dipCount,
      avgDepthM: Math.round(avgDepth * 10) / 10,
      maxDepthM: Math.round(maxDepth * 10) / 10,
      karstZoneOverlap: Math.round(karstOverlap * 100),
      bedrockKarst: bedrockIsKarst,
      nearestSinkholeKm,
      nearestCaveKm,
      likelyCount,
      uncertainCount,
    },
    recommendation,
  };
}

// ---- utility helpers -----------------------------------------------------

function nearestDistance(
  lat: number, lng: number,
  features: GeoObj[] | null,
): number | null {
  if (!features || features.length === 0) return null;
  let minDist = Infinity;
  for (const f of features) {
    const coords = (f as any).geometry.coordinates;
    const [flng, flat] = coords.length === 2 ? coords : coords[0];
    const d = distM(lat, lng, flat, flng);
    if (d < minDist) minDist = d;
  }
  return minDist / 1000; // km
}

function gridSample(
  bbox: [number, number, number, number],
  n: number,
): [number, number][] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const side = Math.ceil(Math.sqrt(n));
  const points: [number, number][] = [];
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      const lng = minLng + (maxLng - minLng) * (i / (side - 1));
      const lat = minLat + (maxLat - minLat) * (j / (side - 1));
      points.push([lng, lat]);
    }
  }
  return points;
}
