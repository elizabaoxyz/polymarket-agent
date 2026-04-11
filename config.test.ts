import { describe, expect, test } from "bun:test";
import { calcKellyBetSize } from "./config";

describe("calcKellyBetSize", () => {
  test("high edge + high confidence → capped at flat $3 MAX_BET", () => {
    // With MAX_BET=$3 and MIN_BET=$3, all bets clamp to exactly $3
    const size = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.85, balance: 100 });
    expect(size).toBe(3);
  });

  test("small edge → still $3 (flat bet sizing)", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.45, marketPrice: 0.40, confidence: 0.70, balance: 100 });
    expect(size).toBe(3);
  });

  test("no edge → minimum bet ($3)", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(3); // MIN_BET_SIZE_USD
  });

  test("negative edge → minimum bet (never negative)", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.30, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(3);
  });

  test("confidence doesn't matter — flat $3 bet", () => {
    // With min=max=$3, all bets are identical regardless of confidence
    const highConf = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.90, balance: 50 });
    const lowConf = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.60, balance: 50 });
    expect(highConf).toBe(3);
    expect(lowConf).toBe(3);
  });

  test("respects balance cap of 6% (KELLY_MAX_FRACTION)", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 100 });
    expect(size).toBeLessThanOrEqual(6); // 6% of 100 = 6, but MAX_BET=$3 caps it
    expect(size).toBe(3);
  });

  test("respects MAX_BET_SIZE_USD=$3", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 500 });
    expect(size).toBe(3);
  });

  test("Jupiter minBet override", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100, minBet: 1.5 });
    // minBet=1.5 but Kelly=0, so returns 1.5 (no edge → min bet)
    expect(size).toBe(1.5);
  });

  test("$50 fund produces exactly $3 bet (plan verification)", () => {
    // Core plan requirement: calcKellyBetSize with $50 balance → $3
    const size = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.80, balance: 50 });
    expect(size).toBe(3);
  });
});
