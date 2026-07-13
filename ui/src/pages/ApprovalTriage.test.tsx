/**
 * FILE: ui/src/pages/ApprovalTriage.test.tsx
 * ABOUT: ApprovalTriage.test.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - ApprovalTriage.test.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: ApprovalTriage.test.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/ApprovalTriage.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  triage: vi.fn(),
  bulk: vi.fn(),
}));

vi.mock("../api/approvals", () => ({
  approvalsApi: {
    triage: apiMocks.triage,
    bulk: apiMocks.bulk,
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

import { ApprovalTriage } from "./ApprovalTriage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function lowRiskItem(id: string) {
  return {
    id,
    companyId: "company-1",
    type: "work_product",
    requestedByAgentId: "agent-1",
    status: "pending",
    payload: {},
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    risk: { score: 5, band: "low", reasons: [] },
  };
}

function criticalItem(id: string) {
  return {
    id,
    companyId: "company-1",
    type: "hire_agent",
    requestedByAgentId: "agent-2",
    status: "pending",
    payload: {},
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    risk: { score: 95, band: "critical", reasons: ["new_agent_hire"] },
  };
}

function buildFixture() {
  const critical = criticalItem("approval-critical");
  const lowA = lowRiskItem("approval-low-a");
  const lowB = lowRiskItem("approval-low-b");
  return {
    items: [critical, lowA, lowB],
    groups: [
      {
        key: "work_product::agent-1",
        type: "work_product",
        agentId: "agent-1",
        ids: [lowA.id, lowB.id],
      },
      {
        key: "hire_agent::agent-2",
        type: "hire_agent",
        agentId: "agent-2",
        ids: [critical.id],
      },
    ],
  };
}

describe("ApprovalTriage", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    apiMocks.triage.mockReset();
    apiMocks.bulk.mockReset();
    apiMocks.triage.mockResolvedValue(buildFixture());
    apiMocks.bulk.mockResolvedValue({ results: [] });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  let root: ReturnType<typeof createRoot> | undefined;

  it("renders items highest-risk first", async () => {
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ApprovalTriage />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-approval-triage-item]").length).toBe(3);
    });

    const rows = container.querySelectorAll("[data-approval-triage-item]");
    expect(rows.length).toBe(3);
    expect(rows[0]!.getAttribute("data-approval-triage-item")).toBe("approval-critical");
    expect(rows[1]!.getAttribute("data-approval-triage-item")).toBe("approval-low-a");
    expect(rows[2]!.getAttribute("data-approval-triage-item")).toBe("approval-low-b");

    // sanity: critical item's risk band precedes the low items in DOM order.
    const criticalIndex = container.textContent!.indexOf("critical");
    const lowIndex = container.textContent!.indexOf("low");
    expect(criticalIndex).toBeGreaterThan(-1);
    expect(criticalIndex).toBeLessThan(lowIndex);
  });

  it("selects a group and bulk-approves its ids", async () => {
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ApprovalTriage />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-approval-triage-item]").length).toBe(3);
    });

    const groupButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("work_product"),
    );
    expect(groupButton).toBeTruthy();

    await act(async () => {
      groupButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Approve selected",
    );
    expect(approveButton).toBeTruthy();
    expect((approveButton as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      approveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMocks.bulk).toHaveBeenCalledWith("company-1", {
      ids: ["approval-low-a", "approval-low-b"],
      action: "approve",
    });
  });
});
// [END: module]
