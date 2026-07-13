/**
 * FILE: ui/src/pages/ApprovalDetail.changeset.test.tsx
 * ABOUT: ApprovalDetail.changeset.test.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - ApprovalDetail.changeset.test.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: ApprovalDetail.changeset.test.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/ApprovalDetail.changeset.test.tsx", "imports": "see code", "exports": "see code"}
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
    type: "work_product",
    requestedByAgentId: "agent-1",
    status: "pending",
    payload: {},
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildChangeset(overrides: Record<string, unknown> = {}) {
  return {
    id: "changeset-1",
    heartbeatRunId: "run-1",
    baseRef: "main",
    headRef: "HEAD",
    files: [
      {
        path: "src/example/changed-file.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        binary: false,
        truncated: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ],
    commands: [],
    summaryStats: { filesChanged: 1, additions: 3, deletions: 1 },
    warning: null,
    ...overrides,
  };
}

describe("ApprovalDetail changeset", () => {
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

  it("fetches and renders the run changeset when the approval references a run", async () => {
    apiMocks.approvalGet.mockResolvedValue(buildApproval({ payload: { runId: "run-1" } }));
    apiMocks.changesetGet.mockResolvedValue(buildChangeset());

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ApprovalDetail />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(apiMocks.changesetGet).toHaveBeenCalledWith("run-1");
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("src/example/changed-file.ts");
    });
  });

  it("renders nothing for the changeset section when there is no runId on the payload", async () => {
    apiMocks.approvalGet.mockResolvedValue(buildApproval({ payload: {} }));

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ApprovalDetail />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain(buildApproval().id);
    });

    expect(apiMocks.changesetGet).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Changes");
  });
});
// [END: module]
