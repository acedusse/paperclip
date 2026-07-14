import { describe, it, expect } from "vitest";
import { digests } from "../schema/index.js";

describe("digests schema", () => {
  it("exposes the digests table", () => {
    expect(digests).toBeDefined();
  });
});
