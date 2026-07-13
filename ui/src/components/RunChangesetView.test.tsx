/**
 * FILE: ui/src/components/RunChangesetView.test.tsx
 * ABOUT: RunChangesetView.test.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - RunChangesetView.test.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: RunChangesetView.test.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/RunChangesetView.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunChangeset } from "../api/runChangesets";
import { RunChangesetView } from "./RunChangesetView";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const changeset: RunChangeset = {
  id: "c1",
  heartbeatRunId: "r1",
  baseRef: "main",
  headRef: "abc",
  files: [
    {
      path: "src/a.ts",
      status: "modified",
      additions: 3,
      deletions: 1,
      binary: false,
      truncated: false,
      diff: "@@\n+added line\n",
    },
    {
      path: "img.png",
      status: "added",
      additions: 0,
      deletions: 0,
      binary: true,
      truncated: false,
    },
  ],
  commands: [{ command: "pnpm test", status: "completed", exitCode: 0 }],
  summaryStats: { filesChanged: 2, additions: 3, deletions: 1 },
  warning: null,
};

describe("RunChangesetView", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("lists files with status and shows a diff for text files", () => {
    const root = createRoot(container);

    act(() => {
      root.render(<RunChangesetView changeset={changeset} />);
    });

    expect(container.textContent).toContain("src/a.ts");
    expect(container.textContent).toContain("+added line");
    expect(container.textContent).toContain("img.png");
    expect(container.textContent).toMatch(/binary/i);

    const fileItems = container.querySelectorAll(".run-changeset__file");
    expect(fileItems.length).toBe(2);

    const textFileDiff = fileItems[0]?.querySelector(".run-changeset__diff");
    expect(textFileDiff).not.toBeNull();
    expect(textFileDiff?.textContent).toContain("+added line");

    const binaryFileNote = fileItems[1]?.querySelector(".run-changeset__note");
    expect(binaryFileNote?.textContent).toMatch(/binary/i);
    expect(fileItems[1]?.querySelector(".run-changeset__diff")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("shows command status and summary stats", () => {
    const root = createRoot(container);

    act(() => {
      root.render(<RunChangesetView changeset={changeset} />);
    });

    expect(container.textContent).toContain("pnpm test");
    expect(container.textContent).toContain("completed");
    expect(container.textContent).toContain("2 files");

    act(() => {
      root.unmount();
    });
  });

  it("renders a warning banner when present", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <RunChangesetView changeset={{ ...changeset, warning: "Changeset truncated" }} />,
      );
    });

    expect(container.querySelector(".run-changeset__warning")?.textContent).toBe(
      "Changeset truncated",
    );

    act(() => {
      root.unmount();
    });
  });
});
// [END: module]
