/**
 * FILE: packages/db/src/embedded-postgres-error.test.ts
 * ABOUT: embedded-postgres-error.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - embedded-postgres-error.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: embedded-postgres-error.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/embedded-postgres-error.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { createEmbeddedPostgresLogBuffer, formatEmbeddedPostgresError } from "./embedded-postgres-error.js";

describe("formatEmbeddedPostgresError", () => {
  it("adds a shared-memory hint when initdb logs expose the real cause", () => {
    const error = formatEmbeddedPostgresError("Postgres init script exited with code 1.", {
      fallbackMessage: "Failed to initialize embedded PostgreSQL cluster",
      recentLogs: [
        "running bootstrap script ...",
        "FATAL:  could not create shared memory segment: Cannot allocate memory",
        "DETAIL:  Failed system call was shmget(key=123, size=56, 03600).",
      ],
    });

    expect(error.message).toContain("could not allocate shared memory");
    expect(error.message).toContain("kern.sysv.shm");
    expect(error.message).toContain("could not create shared memory segment");
  });

  it("keeps only recent non-empty log lines in the collector", () => {
    const buffer = createEmbeddedPostgresLogBuffer(2);
    buffer.append("line one\n\n");
    buffer.append("line two");
    buffer.append("line three");

    expect(buffer.getRecentLogs()).toEqual(["line two", "line three"]);
  });
});
// [END: module]
