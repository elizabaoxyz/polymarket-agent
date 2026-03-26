import { describe, expect, test } from "bun:test";

describe("jupiter-prediction plugin", () => {
  test("exports a valid elizaOS plugin", async () => {
    const mod = await import("./plugins/jupiter-prediction/index");
    const plugin = mod.default ?? mod.jupiterPredictionPlugin;
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("jupiter-prediction");
    expect(Array.isArray(plugin.actions)).toBe(true);
    expect(plugin.actions.length).toBeGreaterThanOrEqual(4);
  });

  test("exports all expected actions", async () => {
    const mod = await import("./plugins/jupiter-prediction/index");
    const plugin = mod.default ?? mod.jupiterPredictionPlugin;
    const names = plugin.actions.map((a: { name: string }) => a.name);
    expect(names).toContain("SCAN_JUPITER_MARKETS");
    expect(names).toContain("PLACE_JUPITER_BET");
    expect(names).toContain("CHECK_JUPITER_POSITIONS");
    expect(names).toContain("CLAIM_JUPITER_WINNINGS");
  });
});
