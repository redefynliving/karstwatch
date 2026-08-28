import { describe, it, expect } from "vitest";
import { scoreGroundwater, type GwFactors } from "../groundwater";

const worst: GwFactors = {
  bedrockKarst: true,
  hydgrp: "D",
  kffact: 0.64,
  karstOverlapPct: 100,
  nearestSinkKm: 0,
  nearestCaveKm: null,
  floodNearby: true,
  dipDensity: 1,
  clayPct: 0,
};

const best: GwFactors = {
  bedrockKarst: false,
  hydgrp: "A",
  kffact: 0,
  karstOverlapPct: 0,
  nearestSinkKm: null,
  nearestCaveKm: null,
  floodNearby: false,
  dipDensity: 0,
  clayPct: 40,
};

describe("scoreGroundwater — worst case", () => {
  it("score >= 75 and level CRITICAL", () => {
    const r = scoreGroundwater(worst);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.level).toBe("CRITICAL");
  });

  it("why is a non-empty string", () => {
    const r = scoreGroundwater(worst);
    expect(typeof r.why).toBe("string");
    expect(r.why.length).toBeGreaterThan(0);
  });
});

describe("scoreGroundwater — best case", () => {
  it("score < 32 and level LOW", () => {
    const r = scoreGroundwater(best);
    expect(r.score).toBeLessThan(32);
    expect(r.level).toBe("LOW");
  });
});

describe("scoreGroundwater — level thresholds", () => {
  it("LOW: score < 32", () => {
    const r = scoreGroundwater(best);
    expect(r.score).toBeLessThan(32);
    expect(r.level).toBe("LOW");
  });

  it("MODERATE: score 32-54", () => {
    // moderate-ish inputs
    const f: GwFactors = { ...best, bedrockKarst: false, hydgrp: "C", kffact: 0.3, karstOverlapPct: 30, nearestSinkKm: 2, dipDensity: 0.4, clayPct: 10, floodNearby: false };
    const r = scoreGroundwater(f);
    expect(r.score).toBeGreaterThanOrEqual(32);
    expect(r.score).toBeLessThanOrEqual(54);
    expect(r.level).toBe("MODERATE");
  });

  it("HIGH: score 55-74", () => {
    const f: GwFactors = { ...worst, floodNearby: false, bedrockKarst: true, hydgrp: "C", karstOverlapPct: 60, nearestSinkKm: 1, dipDensity: 0.5, clayPct: 5 };
    const r = scoreGroundwater(f);
    expect(r.score).toBeGreaterThanOrEqual(55);
    expect(r.score).toBeLessThanOrEqual(74);
    expect(r.level).toBe("HIGH");
  });

  it("CRITICAL: score >= 75", () => {
    const r = scoreGroundwater(worst);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.level).toBe("CRITICAL");
  });
});

describe("scoreGroundwater — hydgrp ordering", () => {
  const base: GwFactors = { ...best, bedrockKarst: false, floodNearby: false, dipDensity: 0, nearestSinkKm: null, nearestCaveKm: null, karstOverlapPct: 0, clayPct: 20 };

  it("score(D) > score(C) > score(B) > score(A)", () => {
    const sD = scoreGroundwater({ ...base, hydgrp: "D" }).score;
    const sC = scoreGroundwater({ ...base, hydgrp: "C" }).score;
    const sB = scoreGroundwater({ ...base, hydgrp: "B" }).score;
    const sA = scoreGroundwater({ ...base, hydgrp: "A" }).score;
    expect(sD).toBeGreaterThan(sC);
    expect(sC).toBeGreaterThan(sB);
    expect(sB).toBeGreaterThan(sA);
  });

  it("null hydgrp does not throw and returns a valid score 0-100", () => {
    const r = scoreGroundwater({ ...base, hydgrp: null });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("scoreGroundwater — null/NaN tolerance", () => {
  it("all nullable numerics null → score clamped 0-100", () => {
    const f: GwFactors = {
      bedrockKarst: false,
      hydgrp: null,
      kffact: null,
      karstOverlapPct: 0,
      nearestSinkKm: null,
      nearestCaveKm: null,
      floodNearby: false,
      dipDensity: 0,
      clayPct: null,
    };
    const r = scoreGroundwater(f);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(["LOW", "MODERATE", "HIGH", "CRITICAL"]).toContain(r.level);
  });
});

describe("scoreGroundwater — breakdown", () => {
  it("weights sum to ~1.0", () => {
    const r = scoreGroundwater(worst);
    const sum = r.breakdown.reduce((acc, b) => acc + b.weight, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("each entry has name, value, note", () => {
    const r = scoreGroundwater(worst);
    for (const b of r.breakdown) {
      expect(typeof b.name).toBe("string");
      expect(typeof b.value).toBe("number");
      expect(typeof b.note).toBe("string");
    }
  });
});

describe("scoreGroundwater — monotonicity on nearestSinkKm", () => {
  it("score(sink=0) >= score(sink=10), all else equal", () => {
    const near: GwFactors = { ...worst, nearestSinkKm: 0 };
    const far: GwFactors = { ...worst, nearestSinkKm: 10 };
    expect(scoreGroundwater(near).score).toBeGreaterThanOrEqual(scoreGroundwater(far).score);
  });
});
