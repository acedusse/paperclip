import { describe, expect, it } from "vitest";
import { detectClaimOverlap, normalizeClaimPath, pathsOverlap } from "./workspace-path-overlap.js";

describe("normalizeClaimPath", () => {
  it("normalizes separators, trims slashes, collapses dot/empty to root", () => {
    expect(normalizeClaimPath("src\\pay/")).toBe("src/pay");
    expect(normalizeClaimPath("/src/pay/")).toBe("src/pay");
    expect(normalizeClaimPath("./src//pay")).toBe("src/pay");
    expect(normalizeClaimPath("")).toBe("");
    expect(normalizeClaimPath("/")).toBe("");
    expect(normalizeClaimPath(".")).toBe("");
  });
});

describe("pathsOverlap", () => {
  it("equal paths overlap", () => { expect(pathsOverlap("src/pay", "src/pay")).toBe(true); });
  it("ancestor overlaps descendant (both directions)", () => {
    expect(pathsOverlap("src", "src/pay")).toBe(true);
    expect(pathsOverlap("src/pay/api", "src/pay")).toBe(true);
  });
  it("siblings do NOT overlap (segment-aware, not raw prefix)", () => {
    expect(pathsOverlap("src/pay", "src/payments")).toBe(false);
    expect(pathsOverlap("src/a", "src/b")).toBe(false);
  });
  it("root overlaps everything", () => {
    expect(pathsOverlap("", "src/pay")).toBe(true);
    expect(pathsOverlap("anything", "")).toBe(true);
  });
});

describe("detectClaimOverlap", () => {
  const claims = [
    { path: "src/pay", heartbeatRunId: "rA" },
    { path: "docs", heartbeatRunId: "rB" },
    { path: "src/pay/api", heartbeatRunId: "rSelf" },
  ];
  it("returns overlapping claims, excluding the caller's own run", () => {
    expect(detectClaimOverlap("src/pay", claims, "rSelf")).toEqual([{ path: "src/pay", heartbeatRunId: "rA" }]);
  });
  it("returns [] when nothing overlaps", () => {
    expect(detectClaimOverlap("web", claims)).toEqual([]);
  });
});
