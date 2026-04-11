import { describe, expect, test } from "bun:test";
import { calcKellyBetSize } from "./config";

describe("calcKellyBetSize", () => {
  test("high edge + high confidence → aggressive sizing (capped at MAX_BET)", () => {
    // estimatedProb=0.60, marketPrice=0.40 → kelly=(0.60-0.40)/(1-0.40)=0.333, half=0.167
    // Capped by KELLY_MAX_FRACTION=0.10 → $10, then capped by MAX_BET=8 → $8
    const size = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.85, balance: 100 });
    expect(size).toBeGreaterThanOrEqual(5);
    expect(size).toBeLessThanOrEqual(8);
  });

  test("small edge → small bet", () => {
    // estimatedProb=0.45, marketPrice=0.40 → kelly=(0.45-0.40)/(1-0.40)=0.083, half=0.042
    // balance=100 → $4.17
    const size = calcKellyBetSize({ estimatedProb: 0.45, marketPrice: 0.40, confidence: 0.70, balance: 100 });
    expect(size).toBeGreaterThanOrEqual(3);
    expect(size).toBeLessThanOrEqual(8);
  });

  test("no edge → minimum bet", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(3); // MIN_BET_SIZE_USD
  });

  test("negative edge → minimum bet (never negative)", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.30, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(3);
  });

  test("low confidence scales down", () => {
    // With MAX_BET=8, both may hit the cap at balance=100. Use lower balance to see the difference.
    const highConf = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.90, balance: 50 });
    const lowConf = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.60, balance: 50 });
    expect(highConf).toBeGreaterThan(lowConf);
  });

  test("respects balance cap of 10%", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 100 });
    expect(size).toBeLessThanOrEqual(10);
  });

  test("respects MAX_BET_SIZE_USD=8", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 500 });
    expect(size).toBeLessThanOrEqual(8);
  });

  test("Jupiter minBet override", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100, minBet: 1.5 });
    expect(size).toBe(1.5);
  });
});
