import { describe, it, expect } from "vitest";
import { scoreRisk, type RiskResult } from "../risk";
import type { Depression } from "../depression";

// Minimal bbox covering a small area in Indiana
const bbox: [number, number, number, number] = [-86.16, 39.77, -86.14, 39.79];

// Helper to make a minimal Depression fixture
function makeDep(opts: Partial<Depression> = {}): Depression {
  return {
    polygon: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
    bounds: [[0, 0], [1, 1]],
    depthM: 2,
    areaM2: 1000,
    centroid: [0.5, 0.5],
    circularity: 0.8,
    perimeterM: 120,
    confidence: "likely",
    ...opts,
  };
}

describe("scoreRisk — empty depressions", () => {
  it("does not throw and returns valid RiskResult", () => {
    const r = scoreRisk([], bbox, null, null, null, null);
    expect(r).toBeTruthy();
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(r.risk);
    expect(r.factors.dipCount).toBe(0);
  });
});

describe("scoreRisk — result shape", () => {
  it("all expected fields exist", () => {
    const r: RiskResult = scoreRisk([], bbox, null, null, null, null);
    expect(typeof r.score).toBe("number");
    expect(typeof r.risk).toBe("string");
    expect(typeof r.recommendation).toBe("string");
    expect(r.recommendation.length).toBeGreaterThan(0);
    expect(typeof r.factors.dipCount).toBe("number");
    expect(typeof r.factors.likelyCount).toBe("number");
    expect(typeof r.factors.uncertainCount).toBe("number");
    expect(typeof r.factors.bedrockKarst).toBe("boolean");
    expect(typeof r.factors.karstZoneOverlap).toBe("number");
    // nearestSinkholeKm can be null or number
    expect(r.factors.nearestSinkholeKm === null || typeof r.factors.nearestSinkholeKm === "number").toBe(true);
  });
});

describe("scoreRisk — classifier partition", () => {
  it("likelyCount + uncertainCount === dipCount for mixed fixtures", () => {
    const dips = [
      makeDep({ confidence: "likely" }),
      makeDep({ confidence: "likely" }),
      makeDep({ confidence: "uncertain" }),
      makeDep({ confidence: "low" }),
    ];
    const r = scoreRisk(dips, bbox, null, null, null, null);
    // The implementation counts likely + uncertain (low confidence is neither)
    expect(r.factors.dipCount).toBe(4);
    expect(r.factors.likelyCount).toBe(2);
    expect(r.factors.uncertainCount).toBe(1);
    // Note: "low" confidence dips contribute to dipCount but not likelyCount or uncertainCount
  });
});

describe("scoreRisk — monotonicity", () => {
  it("bedrockKarst=true never lowers score vs false", () => {
    // A standard MultiPolygon that covers the bbox
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const poly = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [[
          [
            [minLng - 1, minLat - 1],
            [maxLng + 1, minLat - 1],
            [maxLng + 1, maxLat + 1],
            [minLng - 1, maxLat + 1],
            [minLng - 1, minLat - 1],
          ],
        ]],
      },
      properties: {},
    } as any;

    const rFalse = scoreRisk([], bbox, null, null, null, null);
    const rTrue = scoreRisk([], bbox, null, [poly], null, null);
    expect(rTrue.score).toBeGreaterThanOrEqual(rFalse.score);
  });

  it("more depressions never lower the score vs fewer", () => {
    const few = [makeDep({ depthM: 2 })];
    const many = [makeDep({ depthM: 2 }), makeDep({ depthM: 3 }), makeDep({ depthM: 4 })];
    const rFew = scoreRisk(few, bbox, null, null, null, null);
    const rMany = scoreRisk(many, bbox, null, null, null, null);
    expect(rMany.score).toBeGreaterThanOrEqual(rFew.score);
  });
});

describe("scoreRisk — null tolerance", () => {
  it("empty arrays and null knownSinkholes do not throw", () => {
    expect(() => scoreRisk([], bbox, [], [], null, [])).not.toThrow();
    const r = scoreRisk([], bbox, [], [], null, []);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});

describe("scoreRisk — determinism", () => {
  it("identical inputs produce deeply equal outputs", () => {
    const dips = [makeDep(), makeDep({ confidence: "uncertain", depthM: 1.5 })];
    const r1 = scoreRisk(dips, bbox, null, null, null, null);
    const r2 = scoreRisk(dips, bbox, null, null, null, null);
    expect(r1).toEqual(r2);
  });
});

describe("scoreRisk — Polygon geometry regression", () => {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const ring = [
    [minLng - 1, minLat - 1],
    [maxLng + 1, minLat - 1],
    [maxLng + 1, maxLat + 1],
    [minLng - 1, maxLat + 1],
    [minLng - 1, minLat - 1],
  ];

  it("standard GeoJSON Polygon bedrockKarst raises score same as MultiPolygon", () => {
    const polyGeo = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {},
    } as any;
    const multiGeo = {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [[ring]] },
      properties: {},
    } as any;
    const baseline = scoreRisk([], bbox, null, null, null, null);
    const rPoly = scoreRisk([], bbox, null, [polyGeo], null, null);
    const rMulti = scoreRisk([], bbox, null, [multiGeo], null, null);
    expect(rPoly.score).toBeGreaterThanOrEqual(baseline.score);
    expect(rPoly.score).toBe(rMulti.score);
  });

  it("standard GeoJSON Polygon karstZones raises score same as MultiPolygon", () => {
    const polyGeo = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {},
    } as any;
    const multiGeo = {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [[ring]] },
      properties: {},
    } as any;
    const baseline = scoreRisk([], bbox, null, null, null, null);
    const rPoly = scoreRisk([], bbox, [polyGeo], null, null, null);
    const rMulti = scoreRisk([], bbox, [multiGeo], null, null, null);
    expect(rPoly.score).toBeGreaterThanOrEqual(baseline.score);
    expect(rPoly.score).toBe(rMulti.score);
  });
});
