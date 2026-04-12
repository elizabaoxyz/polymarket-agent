import { describe, expect, test } from "bun:test";
import { calcKellyBetSize } from "./config";

describe("calcKellyBetSize", () => {
  test("high edge + high confidence → aggressive sizing capped by MAX_BET", () => {
    // estimatedProb=0.60, marketPrice=0.40 → kelly=0.333, full=0.333
    // conf=0.85 → 0.333*0.85=0.283, capped by KELLY_MAX=0.15 → $15, then MAX_BET=$7
    const size = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.85, balance: 100 });
    expect(size).toBe(7); // MAX_BET cap
  });

  test("moderate edge → Kelly-sized bet", () => {
    // estimatedProb=0.50, marketPrice=0.40 → kelly=0.167, full=0.167
    // conf=0.70 → 0.167*0.70=0.117, balance*0.117=$11.67, capped at $7 MAX_BET
    const size = calcKellyBetSize({ estimatedProb: 0.50, marketPrice: 0.40, confidence: 0.70, balance: 100 });
    expect(size).toBeGreaterThanOrEqual(2);
    expect(size).toBeLessThanOrEqual(7);
  });

  test("no edge → minimum bet", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(2); // MIN_BET_SIZE_USD
  });

  test("negative edge → minimum bet (never negative)", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.30, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(2);
  });

  test("high confidence → bigger bet than low confidence", () => {
    // Smaller edge so both don't hit the Kelly/MAX_BET caps
    const highConf = calcKellyBetSize({ estimatedProb: 0.50, marketPrice: 0.40, confidence: 0.90, balance: 30 });
    const lowConf = calcKellyBetSize({ estimatedProb: 0.50, marketPrice: 0.40, confidence: 0.65, balance: 30 });
    expect(highConf).toBeGreaterThan(lowConf);
  });

  test("respects 15% balance cap (KELLY_MAX_FRACTION)", () => {
    // Huge edge → Kelly wants large fraction, but capped at 15%
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 100 });
    expect(size).toBeLessThanOrEqual(15); // 15% of 100
    expect(size).toBe(7); // further capped by MAX_BET=$7
  });

  test("respects MAX_BET_SIZE_USD=$7", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 500 });
    expect(size).toBe(7);
  });

  test("Jupiter $3 floor", () => {
    // No edge → returns Jupiter min bet of $3
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100, minBet: 3 });
    expect(size).toBe(3);
  });

  test("Polymarket $22 bankroll — 15% cap = $3.30 max", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.80, marketPrice: 0.50, confidence: 0.90, balance: 22 });
    expect(size).toBeLessThanOrEqual(3.30);
    expect(size).toBeGreaterThanOrEqual(2);
  });

  test("Jupiter $42 bankroll — 15% cap = $6.30 max", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.80, marketPrice: 0.50, confidence: 0.90, balance: 42 });
    expect(size).toBeLessThanOrEqual(6.30);
    expect(size).toBeGreaterThanOrEqual(3);
  });
});
