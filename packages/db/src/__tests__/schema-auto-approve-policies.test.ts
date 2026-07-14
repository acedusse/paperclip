import { describe, it, expect } from "vitest";
import { autoApprovePolicies } from "../schema/index.js";

describe("auto_approve_policies schema", () => {
  it("exposes the auto_approve_policies table", () => {
    expect(autoApprovePolicies).toBeDefined();
  });
});
