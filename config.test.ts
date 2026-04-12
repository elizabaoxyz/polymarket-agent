import { describe, expect, test } from "bun:test";
import { calcKellyBetSize } from "./config";

describe("calcKellyBetSize", () => {
  test("high edge + high confidence → aggressive sizing capped by MAX_BET", () => {
    // estimatedProb=0.60, marketPrice=0.40 → kelly=0.333, half=0.167
    // Capped by KELLY_MAX_FRACTION=0.10 → $10, then capped by MAX_BET=$5
    const size = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.85, balance: 100 });
    expect(size).toBe(5); // MAX_BET cap
  });

  test("small edge → small bet", () => {
    // estimatedProb=0.45, marketPrice=0.40 → kelly=0.083, half=0.042
    // conf=0.70 → 0.042*0.70=0.029, balance*0.029=$2.94 → rounds to min $1
    const size = calcKellyBetSize({ estimatedProb: 0.45, marketPrice: 0.40, confidence: 0.70, balance: 100 });
    expect(size).toBeGreaterThanOrEqual(1);
    expect(size).toBeLessThanOrEqual(5);
  });

  test("no edge → minimum bet", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(1); // MIN_BET_SIZE_USD
  });

  test("negative edge → minimum bet (never negative)", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.30, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(1);
  });

  test("high confidence → bigger bet than low confidence", () => {
    const highConf = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.90, balance: 50 });
    const lowConf = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.60, balance: 50 });
    expect(highConf).toBeGreaterThan(lowConf);
  });

  test("respects 10% balance cap (KELLY_MAX_FRACTION)", () => {
    // Huge edge → Kelly wants large fraction, but capped at 10%
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 100 });
    expect(size).toBeLessThanOrEqual(10); // 10% of 100
    expect(size).toBe(5); // further capped by MAX_BET=$5
  });

  test("respects MAX_BET_SIZE_USD=$5", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 500 });
    expect(size).toBe(5);
  });

  test("Jupiter minBet override", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100, minBet: 0.5 });
    expect(size).toBe(0.5);
  });

  test("Polymarket $22 bankroll — 10% cap = $2.20 max", () => {
    // 10% of $22 = $2.20. With big edge, should hit the cap.
    const size = calcKellyBetSize({ estimatedProb: 0.80, marketPrice: 0.50, confidence: 0.90, balance: 22 });
    expect(size).toBeLessThanOrEqual(2.20);
    expect(size).toBeGreaterThanOrEqual(1);
  });

  test("Jupiter $42 bankroll — 10% cap = $4.20 max", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.80, marketPrice: 0.50, confidence: 0.90, balance: 42 });
    expect(size).toBeLessThanOrEqual(4.20);
    expect(size).toBeGreaterThanOrEqual(1);
  });
});
