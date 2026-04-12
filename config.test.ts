import { describe, expect, test } from "bun:test";
import { calcKellyBetSize } from "./config";

describe("calcKellyBetSize", () => {
  test("high edge + high confidence → aggressive sizing capped by MAX_BET", () => {
    // estimatedProb=0.60, marketPrice=0.40 → kelly=0.333, quarter=0.083
    // conf=0.85 → 0.083*0.85=0.071, capped by KELLY_MAX=0.08, then MAX_BET=$5
    const size = calcKellyBetSize({
      estimatedProb: 0.6,
      marketPrice: 0.4,
      confidence: 0.85,
      balance: 100,
    });
    expect(size).toBe(5); // MAX_BET cap
  });

  test("moderate edge → Kelly-sized bet", () => {
    // estimatedProb=0.50, marketPrice=0.40 → kelly=0.167, quarter=0.042
    // conf=0.70 → 0.042*0.70=0.029, balance*0.029=$2.92, capped at $5 MAX_BET
    const size = calcKellyBetSize({
      estimatedProb: 0.5,
      marketPrice: 0.4,
      confidence: 0.7,
      balance: 100,
    });
    expect(size).toBeGreaterThanOrEqual(2);
    expect(size).toBeLessThanOrEqual(5);
  });

  test("no edge → minimum bet", () => {
    const size = calcKellyBetSize({
      estimatedProb: 0.4,
      marketPrice: 0.4,
      confidence: 0.5,
      balance: 100,
    });
    expect(size).toBe(2); // MIN_BET_SIZE_USD
  });

  test("negative edge → minimum bet (never negative)", () => {
    const size = calcKellyBetSize({
      estimatedProb: 0.3,
      marketPrice: 0.4,
      confidence: 0.5,
      balance: 100,
    });
    expect(size).toBe(2);
  });

  test("high confidence → bigger bet than low confidence", () => {
    // Large edge, mid balance so neither hits MAX_BET cap
    const highConf = calcKellyBetSize({
      estimatedProb: 0.65,
      marketPrice: 0.4,
      confidence: 0.9,
      balance: 50,
    });
    const lowConf = calcKellyBetSize({
      estimatedProb: 0.65,
      marketPrice: 0.4,
      confidence: 0.55,
      balance: 50,
    });
    expect(highConf).toBeGreaterThan(lowConf);
  });

  test("respects 8% balance cap (KELLY_MAX_FRACTION)", () => {
    // Huge edge → Kelly wants large fraction, but capped at 8%
    const size = calcKellyBetSize({
      estimatedProb: 0.95,
      marketPrice: 0.1,
      confidence: 1.0,
      balance: 100,
    });
    expect(size).toBeLessThanOrEqual(8); // 8% of 100
    expect(size).toBe(5); // further capped by MAX_BET=$5
  });

  test("respects MAX_BET_SIZE_USD=$5", () => {
    const size = calcKellyBetSize({
      estimatedProb: 0.95,
      marketPrice: 0.1,
      confidence: 1.0,
      balance: 500,
    });
    expect(size).toBe(5);
  });

  test("Jupiter $3 floor", () => {
    // No edge → returns Jupiter min bet of $3
    const size = calcKellyBetSize({
      estimatedProb: 0.4,
      marketPrice: 0.4,
      confidence: 0.5,
      balance: 100,
      minBet: 3,
    });
    expect(size).toBe(3);
  });

  test("Polymarket $22 bankroll — 8% cap hits MIN_BET floor", () => {
    // 8% of $22 = $1.76, but MIN_BET=$2 floors it
    const size = calcKellyBetSize({
      estimatedProb: 0.8,
      marketPrice: 0.5,
      confidence: 0.9,
      balance: 22,
    });
    expect(size).toBe(2); // MIN_BET floor
  });

  test("Jupiter $42 bankroll — 8% cap = $3.36 max", () => {
    const size = calcKellyBetSize({
      estimatedProb: 0.8,
      marketPrice: 0.5,
      confidence: 0.9,
      balance: 42,
    });
    expect(size).toBeLessThanOrEqual(3.36);
    expect(size).toBeGreaterThanOrEqual(2);
  });
});
