import { describe, expect, test } from "bun:test";
import { createState, updatePeakPrice, getDropFromPeak, trackPositionAge, getPositionAgeDays, pruneStaleTracking } from "./autonomy-state";

describe("peak price tracking", () => {
  test("updatePeakPrice tracks highest observed price", () => {
    const state = createState("both");
    updatePeakPrice(state, "token-a", 0.45);
    expect(state.peakPrice.get("token-a")).toBe(0.45);

    updatePeakPrice(state, "token-a", 0.55);
    expect(state.peakPrice.get("token-a")).toBe(0.55);

    // Lower price should NOT update peak
    updatePeakPrice(state, "token-a", 0.50);
    expect(state.peakPrice.get("token-a")).toBe(0.55);
  });

  test("getDropFromPeak returns percentage drop", () => {
    const state = createState("both");
    updatePeakPrice(state, "token-a", 0.80);
    // Current price 0.70 → drop = (0.80-0.70)/0.80 * 100 = 12.5%
    const drop = getDropFromPeak(state, "token-a", 0.70);
    expect(drop).toBeCloseTo(12.5, 1);
  });

  test("getDropFromPeak returns 0 when no peak recorded", () => {
    const state = createState("both");
    const drop = getDropFromPeak(state, "unknown", 0.50);
    expect(drop).toBe(0);
  });
});

describe("position age tracking", () => {
  test("trackPositionAge records first-seen time", () => {
    const state = createState("both");
    const before = Date.now();
    trackPositionAge(state, "token-a");
    const after = Date.now();
    const seen = state.positionFirstSeen.get("token-a")!;
    expect(seen).toBeGreaterThanOrEqual(before);
    expect(seen).toBeLessThanOrEqual(after);
  });

  test("trackPositionAge does not overwrite existing", () => {
    const state = createState("both");
    state.positionFirstSeen.set("token-a", 1000);
    trackPositionAge(state, "token-a");
    expect(state.positionFirstSeen.get("token-a")).toBe(1000);
  });

  test("getPositionAgeDays returns correct age", () => {
    const state = createState("both");
    state.positionFirstSeen.set("token-a", Date.now() - 3 * 86_400_000);
    const age = getPositionAgeDays(state, "token-a");
    expect(age).toBeGreaterThanOrEqual(2.9);
    expect(age).toBeLessThanOrEqual(3.1);
  });

  test("getPositionAgeDays returns 0 for unknown", () => {
    const state = createState("both");
    expect(getPositionAgeDays(state, "unknown")).toBe(0);
  });
});

describe("pruneStaleTracking", () => {
  test("removes entries not in activeKeys", () => {
    const state = createState("both");
    state.peakPrice.set("alive", 0.50);
    state.peakPrice.set("dead", 0.30);
    state.positionFirstSeen.set("alive", Date.now());
    state.positionFirstSeen.set("dead", Date.now());
    pruneStaleTracking(state, new Set(["alive"]));
    expect(state.peakPrice.has("alive")).toBe(true);
    expect(state.peakPrice.has("dead")).toBe(false);
    expect(state.positionFirstSeen.has("alive")).toBe(true);
    expect(state.positionFirstSeen.has("dead")).toBe(false);
  });
});
