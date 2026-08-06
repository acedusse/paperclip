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

/** An item carrying everything listTriage actually returns — the point of finding X2. */
function richItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ...lowRiskItem(id),
    type: "budget_increase",
    requestedByAgentId: "Atlas",
    payload: { title: "Increase the monthly cap to $4,000" },
    risk: { score: 88, band: "critical", reasons: ["budget over cap", "no prior approval"] },
    ...overrides,
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

  async function renderTriage() {
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ApprovalTriage />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-approval-triage-item]").length).toBeGreaterThan(0);
    });

    return { container };
  }

  it("renders items highest-risk first", async () => {
    await renderTriage();

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
    await renderTriage();

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

  it("shows the approval's title, not just its type", async () => {
    apiMocks.triage.mockResolvedValue({ items: [richItem("a1")], groups: [] });
    const { container } = await renderTriage();
    expect(container.textContent).toContain("Increase the monthly cap to $4,000");
  });

  it("shows the requesting agent on the row", async () => {
    apiMocks.triage.mockResolvedValue({ items: [richItem("a1")], groups: [] });
    const { container } = await renderTriage();
    expect(container.textContent).toContain("Atlas");
  });

  // The list is sorted by risk score, so the reasons behind that score have to be visible.
  it("shows the risk reasons behind the score it sorts by", async () => {
    apiMocks.triage.mockResolvedValue({ items: [richItem("a1")], groups: [] });
    const { container } = await renderTriage();
    expect(container.textContent).toContain("budget over cap");
  });

  it("distinguishes two groups of the same type from different agents", async () => {
    apiMocks.triage.mockResolvedValue({
      items: [richItem("a1"), richItem("a2", { requestedByAgentId: "Borealis" })],
      groups: [
        { key: "budget_increase::Atlas", type: "budget_increase", agentId: "Atlas", ids: ["a1"] },
        { key: "budget_increase::Borealis", type: "budget_increase", agentId: "Borealis", ids: ["a2"] },
      ],
    });
    const { container } = await renderTriage();
    const chips = [...container.querySelectorAll(".approval-triage__groups button")].map(
      (b) => b.textContent ?? "",
    );
    expect(chips).toHaveLength(2);
    expect(new Set(chips).size).toBe(2);
  });
});
// [END: module]
