/**
 * FILE: ui/src/pages/ApprovalDetail.autoApprove.test.tsx
 * ABOUT: ApprovalDetail.autoApprove.test.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - ApprovalDetail auto-approved badge tests.
 */
// ==========================================
// [META: module]
// INTENT: The Auto-approved badge shows when decidedVia is auto_policy, and not otherwise.
// PSEUDOCODE: 1. Mock approvalsApi.get. 2. Render. 3. Assert badge presence/absence.
// JSON_FLOW: {"file": "ui/src/pages/ApprovalDetail.autoApprove.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  approvalGet: vi.fn(),
  approvalListComments: vi.fn(),
  approvalListIssues: vi.fn(),
  agentsList: vi.fn(),
  changesetGet: vi.fn(),
}));

vi.mock("../api/approvals", () => ({
  approvalsApi: {
    get: apiMocks.approvalGet,
    listComments: apiMocks.approvalListComments,
    listIssues: apiMocks.approvalListIssues,
  },
}));

vi.mock("../api/agents", () => ({
  agentsApi: { list: apiMocks.agentsList },
}));

vi.mock("../api/runChangesets", () => ({
  runChangesetsApi: { get: apiMocks.changesetGet },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", setSelectedCompanyId: vi.fn() }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, className, ...props }: ComponentProps<"a">) => (
    <a className={className} {...props}>{children}</a>
  ),
  useNavigate: () => routerMock.navigate,
  useParams: () => ({ approvalId: "approval-1" }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

import { ApprovalDetail } from "./ApprovalDetail";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function buildApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-1",
    companyId: "company-1",
    type: "request_board_approval",
    requestedByAgentId: "agent-1",
    status: "approved",
    payload: {},
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ApprovalDetail auto-approved badge", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    apiMocks.approvalGet.mockReset();
    apiMocks.approvalListComments.mockReset();
    apiMocks.approvalListIssues.mockReset();
    apiMocks.agentsList.mockReset();
    apiMocks.changesetGet.mockReset();

    apiMocks.approvalListComments.mockResolvedValue([]);
    apiMocks.approvalListIssues.mockResolvedValue([]);
    apiMocks.agentsList.mockResolvedValue([]);

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

  async function renderDetail() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ApprovalDetail />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("approval-1");
    });
  }

  it("shows the Auto-approved badge when decidedVia is auto_policy", async () => {
    apiMocks.approvalGet.mockResolvedValue(buildApproval({ decidedVia: "auto_policy" }));
    await renderDetail();
    expect(container.textContent).toContain("Auto-approved");
  });

  it("does not show the badge for a human-approved item", async () => {
    apiMocks.approvalGet.mockResolvedValue(buildApproval({ decidedVia: "explicit_human" }));
    await renderDetail();
    expect(container.textContent).not.toContain("Auto-approved");
  });
});
// [END: module]
