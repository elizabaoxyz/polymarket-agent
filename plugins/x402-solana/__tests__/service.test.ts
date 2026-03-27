import { describe, expect, test } from "bun:test";
import { X402PaymentCapExceeded, DEFAULT_MAX_PAYMENT_USD } from "../types";

describe("X402 payment cap", () => {
  test("X402PaymentCapExceeded has correct properties", () => {
    const err = new X402PaymentCapExceeded(0.50, 0.10);
    expect(err.name).toBe("X402PaymentCapExceeded");
    expect(err.requestedUsd).toBe(0.50);
    expect(err.capUsd).toBe(0.10);
    expect(err.message).toContain("$0.5000");
    expect(err.message).toContain("$0.10");
  });

  test("DEFAULT_MAX_PAYMENT_USD is 0.10", () => {
    expect(DEFAULT_MAX_PAYMENT_USD).toBe(0.10);
  });
});

describe("X402SolanaService", () => {
  test("module exports X402SolanaService class", async () => {
    const mod = await import("../service");
    expect(typeof mod.X402SolanaService).toBe("function");
    expect(mod.X402SolanaService.serviceType).toBe("X402_SOLANA");
  });

  test("static start returns stub when keys are missing", async () => {
    const mod = await import("../service");
    const mockRuntime = {
      getSetting: (_key: string) => undefined,
    };
    const svc = await mod.X402SolanaService.start(mockRuntime);
    expect(svc.serviceType).toBe("X402_SOLANA");
    expect(typeof svc.getWrappedFetch()).toBe("function");
  });
});
