/**
 * FILE: ui/src/components/AgentWipReadout.test.tsx
 * ABOUT: AgentWipReadout.test.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - AgentWipReadout.test.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: Prove the per-agent WIP + flow readout shows `WIP current / limit`
// (with a `⚠` warning once over the limit), falls back to `WIP current` with
// no slash when there's no configured limit, and renders an em dash for a
// null median cycle time. Harness modeled on AgentCadenceReadout.test.tsx
// (react-dom/client createRoot + act; @testing-library/react is not
// installed in this repo).
// JSON_FLOW: {"file": "ui/src/components/AgentWipReadout.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AgentWipReadout } from "./AgentWipReadout";

describe("AgentWipReadout", () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container?.remove();
    document.body.innerHTML = "";
  });

  it("shows the count with a limit and no warning when under", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AgentWipReadout
          wip={{ limit: 3, current: 2, overBy: 0, overLimit: false }}
          flow={{ throughputLast7d: 4, medianCycleTimeMs: 7200000 }}
        />,
      );
    });

    expect(container.textContent).toMatch(/WIP 2 \/ 3/);
    expect(container.textContent).not.toMatch(/⚠/);

    act(() => {
      root.unmount();
    });
  });

  it("warns when over the limit", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AgentWipReadout
          wip={{ limit: 3, current: 5, overBy: 2, overLimit: true }}
          flow={{ throughputLast7d: 0, medianCycleTimeMs: null }}
        />,
      );
    });

    expect(container.textContent).toMatch(/WIP 5 \/ 3/);
    expect(container.textContent).toMatch(/⚠/);

    act(() => {
      root.unmount();
    });
  });

  it("shows only the count when there is no limit", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AgentWipReadout
          wip={{ limit: null, current: 1, overBy: 0, overLimit: false }}
          flow={{ throughputLast7d: 0, medianCycleTimeMs: null }}
        />,
      );
    });

    expect(container.textContent).toMatch(/WIP 1\b/);
    // The flow segment always renders "N/wk", so assert no "/ limit" suffix on
    // the WIP count specifically rather than "no slash anywhere in the text".
    expect(container.textContent).not.toMatch(/WIP 1 \//);

    act(() => {
      root.unmount();
    });
  });

  it("renders an em dash for a null median cycle time", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AgentWipReadout
          wip={{ limit: null, current: 0, overBy: 0, overLimit: false }}
          flow={{ throughputLast7d: 0, medianCycleTimeMs: null }}
        />,
      );
    });

    expect(container.textContent).toMatch(/—/);

    act(() => {
      root.unmount();
    });
  });
});
// [END: module]
