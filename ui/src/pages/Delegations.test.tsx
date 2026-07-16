/**
 * FILE: ui/src/pages/Delegations.test.tsx
 * ABOUT: Delegations.test.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - Delegations page render + coverage/OOO/grant mutation tests.
 */
// ==========================================
// [META: module]
// INTENT: The Delegations page renders coverage config, out-of-office and grants
//   sections, and saving/creating/revoking issues the expected API calls.
// PSEUDOCODE: 1. Mock delegationsApi. 2. Render. 3. Assert content / click behavior.
// JSON_FLOW: {"file": "ui/src/pages/Delegations.test.tsx", "imports": "see code", "exports": "see code"}
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
  listGrants: vi.fn(),
  createGrant: vi.fn(),
  revokeGrant: vi.fn(),
  getCoverageConfig: vi.fn(),
  updateCoverageConfig: vi.fn(),
  setOutOfOffice: vi.fn(),
  listBoundedAgents: vi.fn(),
  createBoundedAgent: vi.fn(),
  revokeBoundedAgent: vi.fn(),
}));

vi.mock("../api/delegations", () => ({
  delegationsApi: {
    listGrants: apiMocks.listGrants,
    createGrant: apiMocks.createGrant,
    revokeGrant: apiMocks.revokeGrant,
    getCoverageConfig: apiMocks.getCoverageConfig,
    updateCoverageConfig: apiMocks.updateCoverageConfig,
    setOutOfOffice: apiMocks.setOutOfOffice,
    listBoundedAgents: apiMocks.listBoundedAgents,
    createBoundedAgent: apiMocks.createBoundedAgent,
    revokeBoundedAgent: apiMocks.revokeBoundedAgent,
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", setSelectedCompanyId: vi.fn() }),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, className, ...props }: ComponentProps<"a">) => (
    <a className={className} {...props}>{children}</a>
  ),
  useNavigate: () => routerMock.navigate,
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

import { Delegations } from "./Delegations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function buildGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    companyId: "company-1",
    grantorUserId: "user-board",
    delegateUserId: "user-delegate",
    approvalTypes: ["hire_agent"],
    maxBand: "high",
    maxSpendCents: 500000,
    validFrom: "2026-07-01T00:00:00.000Z",
    validUntil: "2026-08-01T00:00:00.000Z",
    revokedAt: null,
    source: "manual",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildCoverageConfig(overrides: Record<string, unknown> = {}) {
  return {
    companyId: "company-1",
    enabled: false,
    backupUserId: null,
    slaCriticalMinutes: 60,
    slaHighMinutes: 240,
    slaMediumMinutes: 1440,
    slaLowMinutes: 4320,
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Delegations page", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    apiMocks.listGrants.mockReset();
    apiMocks.createGrant.mockReset();
    apiMocks.revokeGrant.mockReset();
    apiMocks.getCoverageConfig.mockReset();
    apiMocks.updateCoverageConfig.mockReset();
    apiMocks.setOutOfOffice.mockReset();
    apiMocks.listBoundedAgents.mockReset();
    apiMocks.createBoundedAgent.mockReset();
    apiMocks.revokeBoundedAgent.mockReset();

    apiMocks.getCoverageConfig.mockResolvedValue(buildCoverageConfig());
    apiMocks.listGrants.mockResolvedValue([buildGrant()]);
    apiMocks.listBoundedAgents.mockResolvedValue([]);

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

  async function renderDelegations() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Delegations />
        </QueryClientProvider>,
      );
    });
  }

  function findButton(text: string) {
    return Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(text),
    );
  }

  function setInputValue(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
    const proto =
      input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : input instanceof HTMLSelectElement
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  }

  it("renders coverage config, out-of-office and grants sections", async () => {
    await renderDelegations();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Coverage");
    });
    expect(container.textContent).toContain("Out of office");
    expect(container.textContent).toContain("Delegations");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("user-delegate");
    });
  });

  it("creates a grant with the chosen fields", async () => {
    apiMocks.createGrant.mockResolvedValue(buildGrant());
    await renderDelegations();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("user-delegate");
    });

    const delegateInput = container.querySelector<HTMLInputElement>("input[name='delegateUserId']");
    expect(delegateInput).toBeTruthy();
    await act(async () => {
      setInputValue(delegateInput!, "user-new-delegate");
    });

    const bandSelect = container.querySelector<HTMLSelectElement>("select[name='grantMaxBand']");
    expect(bandSelect).toBeTruthy();
    await act(async () => {
      setInputValue(bandSelect!, "critical");
    });

    const spendInput = container.querySelector<HTMLInputElement>("input[name='maxSpendCents']");
    expect(spendInput).toBeTruthy();
    await act(async () => {
      setInputValue(spendInput!, "10000");
    });

    const untilInput = container.querySelector<HTMLInputElement>("input[name='validUntil']");
    expect(untilInput).toBeTruthy();
    await act(async () => {
      setInputValue(untilInput!, "2026-09-01");
    });

    const checkbox = container.querySelector<HTMLInputElement>("input[type='checkbox'][value='hire_agent']");
    expect(checkbox).toBeTruthy();
    await act(async () => {
      checkbox!.click();
    });

    const submitButton = findButton("Create grant");
    expect(submitButton).toBeTruthy();
    await act(async () => {
      submitButton!.click();
    });

    await vi.waitFor(() => {
      expect(apiMocks.createGrant).toHaveBeenCalled();
    });
    expect(apiMocks.createGrant).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        delegateUserId: "user-new-delegate",
        maxBand: "critical",
        maxSpendCents: 10000,
        approvalTypes: ["hire_agent"],
        validUntil: expect.any(String),
      }),
    );
  });

  it("enabling out-of-office issues a POST with backup/band/until", async () => {
    apiMocks.setOutOfOffice.mockResolvedValue({ grant: buildGrant({ source: "out_of_office" }), revokedIds: [] });
    await renderDelegations();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Out of office");
    });

    const oooToggle = container.querySelector<HTMLInputElement>("input[name='oooEnabled']");
    expect(oooToggle).toBeTruthy();
    await act(async () => {
      oooToggle!.click();
    });

    const backupInput = container.querySelector<HTMLInputElement>("input[name='oooBackupUserId']");
    expect(backupInput).toBeTruthy();
    await act(async () => {
      setInputValue(backupInput!, "user-backup");
    });

    const bandSelect = container.querySelector<HTMLSelectElement>("select[name='oooMaxBand']");
    expect(bandSelect).toBeTruthy();
    await act(async () => {
      setInputValue(bandSelect!, "high");
    });

    const untilInput = container.querySelector<HTMLInputElement>("input[name='oooUntil']");
    expect(untilInput).toBeTruthy();
    await act(async () => {
      setInputValue(untilInput!, "2026-09-01");
    });

    const saveButton = findButton("Save out-of-office");
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton!.click();
    });

    await vi.waitFor(() => {
      expect(apiMocks.setOutOfOffice).toHaveBeenCalled();
    });
    expect(apiMocks.setOutOfOffice).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        enabled: true,
        backupUserId: "user-backup",
        maxBand: "high",
        until: expect.any(String),
      }),
    );
  });

  it("revokes a grant", async () => {
    apiMocks.revokeGrant.mockResolvedValue(buildGrant({ revokedAt: "2026-07-15T00:00:00.000Z" }));
    await renderDelegations();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("user-delegate");
    });

    const revokeButton = findButton("Revoke");
    expect(revokeButton).toBeTruthy();
    await act(async () => {
      revokeButton!.click();
    });

    await vi.waitFor(() => {
      expect(apiMocks.revokeGrant).toHaveBeenCalledWith("grant-1");
    });
  });

  it("saves coverage config with enabled + backup + SLA inputs", async () => {
    apiMocks.updateCoverageConfig.mockResolvedValue(buildCoverageConfig({ enabled: true, backupUserId: "user-backup" }));
    await renderDelegations();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Coverage");
    });

    const coverageToggle = container.querySelector<HTMLInputElement>("input[name='coverageEnabled']");
    expect(coverageToggle).toBeTruthy();
    await act(async () => {
      coverageToggle!.click();
    });

    const backupInput = container.querySelector<HTMLInputElement>("input[name='coverageBackupUserId']");
    expect(backupInput).toBeTruthy();
    await act(async () => {
      setInputValue(backupInput!, "user-backup");
    });

    const saveButton = findButton("Save coverage");
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton!.click();
    });

    await vi.waitFor(() => {
      expect(apiMocks.updateCoverageConfig).toHaveBeenCalled();
    });
    expect(apiMocks.updateCoverageConfig).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        enabled: true,
        backupUserId: "user-backup",
        slaCriticalMinutes: 60,
        slaHighMinutes: 240,
        slaMediumMinutes: 1440,
        slaLowMinutes: 4320,
      }),
    );
  });

  it("renders the bounded agent approvers section and creates a grant", async () => {
    apiMocks.createBoundedAgent.mockResolvedValue({
      id: "ba-1",
      companyId: "company-1",
      grantorUserId: "user-board",
      delegateAgentId: "agent-manager",
      approvalTypes: ["hire_agent"],
      maxBand: "low",
      maxSpendCents: null,
      validFrom: "2026-07-01T00:00:00.000Z",
      validUntil: "2026-08-01T00:00:00.000Z",
      revokedAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    await renderDelegations();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Bounded agent approvers");
    });

    const agentInput = container.querySelector<HTMLInputElement>('input[name="delegateAgentId"]');
    expect(agentInput).toBeTruthy();

    await act(async () => {
      setInputValue(agentInput!, "agent-manager");
    });

    const untilInput = container.querySelector<HTMLInputElement>('input[name="baValidUntil"]');
    expect(untilInput).toBeTruthy();
    await act(async () => {
      setInputValue(untilInput!, "2026-09-01");
    });

    const submitButton = findButton("Create approver");
    expect(submitButton).toBeTruthy();
    await act(async () => {
      submitButton!.click();
    });

    await vi.waitFor(() => {
      expect(apiMocks.createBoundedAgent).toHaveBeenCalled();
    });
    expect(apiMocks.createBoundedAgent).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        delegateAgentId: "agent-manager",
        maxBand: "low",
        validUntil: expect.any(String),
      }),
    );
  });
});
// [END: module]
