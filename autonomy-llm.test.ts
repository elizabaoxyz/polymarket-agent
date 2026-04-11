import { describe, expect, test } from "bun:test";
import { mergeEnsembleResults } from "./autonomy-llm";

describe("mergeEnsembleResults", () => {
  test("averages estimates when both agree on direction", () => {
    const result = mergeEnsembleResults(
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.65\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: BTC above target",
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.70\nEDGE: 0.20\nCONFIDENCE: 0.85\nCATEGORY: CRYPTO\nREASON: BTC momentum strong",
    );
    expect(result).not.toBeNull();
    expect(result!.side).toBe("YES");
    expect(result!.estimate).toBeCloseTo(0.675, 2);
    expect(result!.edge).toBeCloseTo(0.175, 2);
    expect(result!.confidence).toBeCloseTo(0.825, 2);
  });

  test("returns null when models disagree on direction", () => {
    const result = mergeEnsembleResults(
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.65\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: test",
      "PICK: 1\nSIDE: NO\nESTIMATE: 0.35\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: test",
    );
    expect(result).toBeNull();
  });

  test("returns null when one model skips", () => {
    const result = mergeEnsembleResults(
      "PICK: 0",
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.65\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: test",
    );
    expect(result).toBeNull();
  });

  test("handles single result (no ensemble)", () => {
    const result = mergeEnsembleResults(
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.65\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: solo reason",
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.estimate).toBe(0.65);
    expect(result!.reason).toBe("solo reason");
  });
});
