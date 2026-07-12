/**
 * FILE: ui/src/components/AdmissionStatusLine.test.tsx
 * ABOUT: AdmissionStatusLine.test.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - AdmissionStatusLine.test.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: AdmissionStatusLine.test.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/AdmissionStatusLine.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AdmissionStatusLine } from "./AdmissionStatusLine";

describe("AdmissionStatusLine", () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container?.remove();
    document.body.innerHTML = "";
  });

  it("renders running / cap / queued", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{
            cap: 10,
            source: "configured-default",
            running: 3,
            queued: 2,
            runExecutionState: "running",
            breakerLevel: "normal",
          }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("running 3 / cap 10 · 2 queued");

    act(() => {
      root.unmount();
    });
  });

  it("shows 'unlimited' when cap is null", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{
            cap: null,
            source: "none",
            running: 1,
            queued: 0,
            runExecutionState: "running",
            breakerLevel: "normal",
          }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("running 1 / cap unlimited · 0 queued");

    act(() => {
      root.unmount();
    });
  });

  it("shows a destructive badge when draining or halted", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{
            cap: 10,
            source: "configured-default",
            running: 3,
            queued: 2,
            runExecutionState: "draining",
            breakerLevel: "normal",
          }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("running 3 / cap 10 · 2 queued· draining");

    act(() => {
      root.unmount();
    });

    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    const root2 = createRoot(container);

    act(() => {
      root2.render(
        <AdmissionStatusLine
          status={{
            cap: 10,
            source: "configured-default",
            running: 3,
            queued: 2,
            runExecutionState: "halted",
            breakerLevel: "normal",
          }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("· halted");

    act(() => {
      root2.unmount();
    });
  });

  it("shows a warning-toned badge for breaker level 'throttle'", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{
            cap: 10,
            source: "predictive-breaker",
            running: 3,
            queued: 2,
            runExecutionState: "running",
            breakerLevel: "throttle",
          }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("· breaker: throttle");

    act(() => {
      root.unmount();
    });
  });

  it("shows a schedule badge when the schedule sets the cap", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{
            cap: 4,
            source: "schedule",
            running: 1,
            queued: 0,
            runExecutionState: "running",
            breakerLevel: "normal",
          }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("· schedule");

    act(() => {
      root.unmount();
    });
  });

  it("shows an override badge when a manual override sets the cap", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{
            cap: 4,
            source: "manual-override",
            running: 1,
            queued: 0,
            runExecutionState: "running",
            breakerLevel: "normal",
          }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("· override");

    act(() => {
      root.unmount();
    });
  });

  it("renders the next transition when present", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{
            cap: 4,
            source: "configured-default",
            running: 1,
            queued: 0,
            runExecutionState: "running",
            breakerLevel: "normal",
            scheduleNextTransition: { at: "2026-07-13T13:00:00.000Z", cap: 2 },
          }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toMatch(/→ 2 runs/);

    act(() => {
      root.unmount();
    });
  });

  it("shows 'status unavailable' on error", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<AdmissionStatusLine status={undefined} isError={true} />);
    });

    expect(container.textContent).toContain("status unavailable");

    act(() => {
      root.unmount();
    });
  });
});
// [END: module]
