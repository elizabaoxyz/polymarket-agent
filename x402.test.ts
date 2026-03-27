import { describe, expect, test } from "bun:test";

describe("x402-solana plugin", () => {
  test("exports a valid elizaOS plugin", async () => {
    const mod = await import("./plugins/x402-solana/index");
    const plugin = mod.default ?? mod.x402SolanaPlugin;
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("x402-solana");
    expect(Array.isArray(plugin.services)).toBe(true);
    expect(plugin.services.length).toBeGreaterThanOrEqual(1);
  });
});
