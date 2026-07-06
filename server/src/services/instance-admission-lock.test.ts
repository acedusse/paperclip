import { describe, expect, it } from "vitest";
import { withInstanceAdmissionLock } from "./instance-admission-lock.js";

describe("withInstanceAdmissionLock", () => {
  it("serializes critical sections (no interleaving)", async () => {
    const events: string[] = [];
    const critical = (id: string) =>
      withInstanceAdmissionLock(async () => {
        events.push(`enter-${id}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`exit-${id}`);
      });
    await Promise.all([critical("a"), critical("b")]);
    // Each enter is immediately followed by its own exit — no interleave.
    expect(events).toEqual(["enter-a", "exit-a", "enter-b", "exit-b"]);
  });

  it("releases the lock even when fn throws", async () => {
    await expect(
      withInstanceAdmissionLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Lock is free again:
    await expect(withInstanceAdmissionLock(async () => "ok")).resolves.toBe("ok");
  });
});
