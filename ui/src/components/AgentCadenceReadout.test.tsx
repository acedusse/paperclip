/**
 * FILE: ui/src/components/AgentCadenceReadout.test.tsx
 * ABOUT: AgentCadenceReadout.test.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - AgentCadenceReadout.test.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: Prove the per-agent cadence readout shows the backed-off interval
// (`idle ×N → <human interval>`) only once idle backoff is enabled AND the
// agent has an idle streak, and otherwise falls back to the plain configured
// interval. Harness modeled on AdmissionStatusLine.test.tsx (react-dom/client
// createRoot + act; @testing-library/react is not installed in this repo).
// JSON_FLOW: {"file": "ui/src/components/AgentCadenceReadout.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCadenceReadout } from "./AgentCadenceReadout";

describe("AgentCadenceReadout", () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container?.remove();
    document.body.innerHTML = "";
  });

  it("shows the backed-off cadence when idle", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AgentCadenceReadout
          heartbeatIdleStreak={6}
          effectiveHeartbeatIntervalSec={1800}
          enabled
          intervalSec={300}
        />,
      );
    });

    expect(container.textContent).toMatch(/idle ×6/);
    expect(container.textContent).toMatch(/30m/);

    act(() => {
      root.unmount();
    });
  });

  it("shows the plain interval when not backed off", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AgentCadenceReadout
          heartbeatIdleStreak={0}
          effectiveHeartbeatIntervalSec={300}
          enabled
          intervalSec={300}
        />,
      );
    });

    expect(container.textContent).not.toMatch(/idle ×/);
    expect(container.textContent).toMatch(/5m/);

    act(() => {
      root.unmount();
    });
  });

  it("shows the plain interval when idle backoff is disabled, even with a streak", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AgentCadenceReadout
          heartbeatIdleStreak={6}
          effectiveHeartbeatIntervalSec={1800}
          enabled={false}
          intervalSec={300}
        />,
      );
    });

    expect(container.textContent).not.toMatch(/idle ×/);
    expect(container.textContent).toMatch(/5m/);

    act(() => {
      root.unmount();
    });
  });
});
// [END: module]
