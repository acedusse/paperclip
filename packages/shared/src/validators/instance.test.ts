import { describe, expect, it } from "vitest";
import { instanceGeneralSettingsSchema } from "./instance.js";

describe("instanceGeneralSettingsSchema.workspaceClaimAwareScheduling", () => {
  it("defaults to false when absent", () => {
    const parsed = instanceGeneralSettingsSchema.parse({});
    expect(parsed.workspaceClaimAwareScheduling).toBe(false);
  });
  it("carries an explicit true", () => {
    const parsed = instanceGeneralSettingsSchema.parse({ workspaceClaimAwareScheduling: true });
    expect(parsed.workspaceClaimAwareScheduling).toBe(true);
  });
});
