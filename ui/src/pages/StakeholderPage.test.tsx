// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StakeholderView } from "./StakeholderPage";
import type { StakeholderPayload } from "../api/stakeholder-shares";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("StakeholderView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(payload: StakeholderPayload) {
    act(() => {
      root.render(<StakeholderView payload={payload} />);
    });
  }

  it("renders only the company name when nothing is shared", () => {
    render({ companyName: "Acme" });

    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("Nothing has been shared yet");
    expect(container.querySelector('[data-testid="section-goal-progress"]')).toBeNull();
    expect(container.querySelector('[data-testid="section-shipped-work"]')).toBeNull();
    expect(container.querySelector('[data-testid="section-narrative"]')).toBeNull();
    expect(container.querySelector('[data-testid="section-activity-timeline"]')).toBeNull();
  });

  it("renders only the sections present in the payload", () => {
    render({
      companyName: "Acme",
      goalProgress: {
        byStatus: { active: 1 },
        goals: [{ title: "Reach 100 customers", status: "active" }],
      },
    });

    expect(container.querySelector('[data-testid="section-goal-progress"]')).not.toBeNull();
    expect(container.textContent).toContain("Reach 100 customers");
    // Absent from the payload => absent from the DOM.
    expect(container.querySelector('[data-testid="section-shipped-work"]')).toBeNull();
    expect(container.querySelector('[data-testid="section-narrative"]')).toBeNull();
    expect(container.querySelector('[data-testid="section-activity-timeline"]')).toBeNull();
  });

  it("renders shipped work and the narrative when both are present", () => {
    render({
      companyName: "Acme",
      shippedWork: [{ title: "Shipped billing v2", completedAt: "2026-07-30T00:00:00.000Z" }],
      narrative: {
        headline: "Acme — latest progress",
        sections: ["1 item shipped recently"],
        text: "Acme — latest progress\n1 item shipped recently",
      },
    });

    expect(container.textContent).toContain("Shipped billing v2");
    expect(container.textContent).toContain("1 item shipped recently");
    expect(container.querySelector('[data-testid="section-goal-progress"]')).toBeNull();
  });

  it("does not render any mutation control", () => {
    render({
      companyName: "Acme",
      goalProgress: { byStatus: { active: 1 }, goals: [{ title: "Goal", status: "active" }] },
    });

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });
});
