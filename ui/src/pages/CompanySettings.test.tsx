/**
 * FILE: ui/src/pages/CompanySettings.test.tsx
 * ABOUT: CompanySettings.test.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - CompanySettings.test.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: CompanySettings.test.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/CompanySettings.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AGENT_ADAPTER_TYPES, getEnvironmentCapabilities } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyEnvironments } from "./CompanyEnvironments";
import { CompanySettings } from "./CompanySettings";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockCompaniesApi = vi.hoisted(() => ({
  update: vi.fn(),
  getAdmissionStatus: vi.fn(),
}));

const mockAccessApi = vi.hoisted(() => ({
  createOpenClawInvitePrompt: vi.fn(),
  getInviteOnboarding: vi.fn(),
}));

const mockAssetsApi = vi.hoisted(() => ({
  uploadCompanyLogo: vi.fn(),
}));

const mockEnvironmentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  capabilities: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  probe: vi.fn(),
  probeConfig: vi.fn(),
  archive: vi.fn(),
}));

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));

const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockPushToast = vi.hoisted(() => vi.fn());
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockSetSelectedCompanyId = vi.hoisted(() => vi.fn());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSelectedCompanyRef = vi.hoisted(() => ({
  current: {
    id: "company-1",
    name: "Paperclip",
    description: null,
    brandColor: null,
    logoUrl: null,
    issuePrefix: "PAP",
  } as any,
}));

vi.mock("../api/companies", () => ({
  companiesApi: mockCompaniesApi,
}));

vi.mock("../api/access", () => ({
  accessApi: mockAccessApi,
}));

vi.mock("../api/assets", () => ({
  assetsApi: mockAssetsApi,
}));

vi.mock("../api/environments", () => ({
  environmentsApi: mockEnvironmentsApi,
}));

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("../api/secrets", () => ({
  secretsApi: mockSecretsApi,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: mockSetBreadcrumbs,
  }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({
    pushToast: mockPushToast,
  }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", name: "Paperclip", issuePrefix: "PAP" }],
    selectedCompany: mockSelectedCompanyRef.current,
    selectedCompanyId: "company-1",
    setSelectedCompanyId: mockSetSelectedCompanyId,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? ResizeObserverStub;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function getOpenDialog(): HTMLElement | null {
  return document.body.querySelector("[role='dialog']");
}

describe("CompanyEnvironments", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableEnvironments: true,
    });
    mockEnvironmentsApi.list.mockResolvedValue([]);
    mockEnvironmentsApi.capabilities.mockResolvedValue(
      getEnvironmentCapabilities(AGENT_ADAPTER_TYPES),
    );
    mockSecretsApi.list.mockResolvedValue([]);
    mockCompaniesApi.update.mockResolvedValue({
      id: "company-1",
      name: "Paperclip",
      description: null,
      brandColor: null,
      logoUrl: null,
      issuePrefix: "PAP",
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("hides sandbox creation when no run-capable sandbox provider plugins are installed", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanyEnvironments />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const optionLabels = Array.from(container.querySelectorAll("option")).map((option) => option.textContent?.trim());

    expect(optionLabels).not.toContain("Sandbox");
    expect(container.textContent).not.toContain("Fake sandbox");
    expect(container.textContent).not.toContain("Fake is the deterministic test provider");

    await act(async () => {
      root.unmount();
    });
  });

  it("omits the Local driver option and lists Sandbox before SSH", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockEnvironmentsApi.capabilities.mockResolvedValue(
      getEnvironmentCapabilities(AGENT_ADAPTER_TYPES, {
        sandboxProviders: {
          "secure-plugin": {
            status: "supported",
            supportsSavedProbe: true,
            supportsUnsavedProbe: true,
            supportsRunExecution: true,
            supportsReusableLeases: true,
            displayName: "Secure Sandbox",
            configSchema: { type: "object", properties: {} },
          },
        },
      }),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanyEnvironments />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const addEnvironmentButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add environment",
    );
    expect(addEnvironmentButton).toBeTruthy();

    await act(async () => {
      addEnvironmentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const dialog = getOpenDialog();
    expect(dialog).toBeTruthy();

    const driverSelect = Array.from(dialog?.querySelectorAll("select") ?? [])
      .find((select) => Array.from(select.options).some((option) => option.value === "ssh")) as
      | HTMLSelectElement
      | undefined;
    expect(driverSelect).toBeTruthy();

    const driverOptionValues = Array.from(driverSelect!.options).map((option) => option.value);
    expect(driverOptionValues).not.toContain("local");
    expect(driverOptionValues).toEqual(["sandbox", "ssh"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the Local driver option when editing an existing local environment", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockEnvironmentsApi.list.mockResolvedValue([
      {
        id: "env-local",
        companyId: "company-1",
        name: "Local host",
        description: null,
        driver: "local",
        status: "active",
        config: {},
        metadata: null,
        createdAt: new Date("2026-04-25T00:00:00.000Z"),
        updatedAt: new Date("2026-04-25T00:00:00.000Z"),
      },
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanyEnvironments />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const editButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Edit");
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const dialog = getOpenDialog();
    expect(dialog).toBeTruthy();

    const driverSelect = Array.from(dialog?.querySelectorAll("select") ?? [])
      .find((select) => Array.from(select.options).some((option) => option.value === "ssh")) as
      | HTMLSelectElement
      | undefined;
    expect(driverSelect).toBeTruthy();

    const driverOptionValues = Array.from(driverSelect!.options).map((option) => option.value);
    expect(driverOptionValues).toContain("local");
    expect(driverSelect!.value).toBe("local");

    await act(async () => {
      root.unmount();
    });
  });

  it("preserves sandbox config when re-selecting the same provider while editing", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockEnvironmentsApi.list.mockResolvedValue([
      {
        id: "env-1",
        companyId: "company-1",
        name: "Secure Sandbox",
        description: null,
        driver: "sandbox",
        status: "active",
        config: {
          provider: "secure-plugin",
          template: "saved-template",
        },
        metadata: null,
        createdAt: new Date("2026-04-25T00:00:00.000Z"),
        updatedAt: new Date("2026-04-25T00:00:00.000Z"),
      },
    ]);
    mockEnvironmentsApi.capabilities.mockResolvedValue(
      getEnvironmentCapabilities(AGENT_ADAPTER_TYPES, {
        sandboxProviders: {
          "secure-plugin": {
            status: "supported",
            supportsSavedProbe: true,
            supportsUnsavedProbe: true,
            supportsRunExecution: true,
            supportsReusableLeases: true,
            displayName: "Secure Sandbox",
            configSchema: {
              type: "object",
              properties: {
                template: { type: "string", title: "Template" },
              },
            },
          },
        },
      }),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanyEnvironments />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Secure Sandbox");

    const editButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Edit");
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const dialog = getOpenDialog();
    expect(dialog).toBeTruthy();

    const providerSelect = Array.from(dialog?.querySelectorAll("select") ?? []).find((select) =>
      Array.from(select.options).some((option) => option.value === "secure-plugin"),
    ) as HTMLSelectElement | undefined;
    expect(providerSelect).toBeTruthy();

    await act(async () => {
      providerSelect!.value = "secure-plugin";
      providerSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();

    const templateInput = Array.from(dialog?.querySelectorAll("input") ?? [])
      .find((input) => (input as HTMLInputElement).value === "saved-template") as HTMLInputElement | undefined;
    expect(templateInput?.value).toBe("saved-template");

    await act(async () => {
      root.unmount();
    });
  });
});

// ---- Task 4: company cap input + live status --------------------------------

const DEFAULT_TEST_COMPANY = {
  id: "company-1",
  name: "Paperclip",
  description: null,
  brandColor: null,
  logoUrl: null,
  issuePrefix: "PAP",
} as const;

function maxRunsInput(container: HTMLDivElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('[data-testid="company-max-runs-input"]');
}

function breakerHorizonInput(container: HTMLDivElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(
    '[data-testid="company-breaker-horizon-minutes-input"]',
  );
}

function saveChangesButton(container: HTMLDivElement): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    /save changes/i.test(button.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
}

function typeIntoInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CompanySettings — company cap + admission status", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockSelectedCompanyRef.current = { ...DEFAULT_TEST_COMPANY };
    mockCompaniesApi.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      mockSelectedCompanyRef.current = { ...mockSelectedCompanyRef.current, ...patch };
      return mockSelectedCompanyRef.current;
    });
    mockCompaniesApi.getAdmissionStatus.mockResolvedValue({
      cap: null,
      source: "unset",
      running: 0,
      queued: 0,
    });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableCloudSync: false,
    });
  });

  afterEach(async () => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    mockSelectedCompanyRef.current = { ...DEFAULT_TEST_COMPANY };
  });

  it("seeds the max-runs input from the selected company, saves a new cap, then clears it", async () => {
    mockSelectedCompanyRef.current = { ...DEFAULT_TEST_COMPANY, maxConcurrentRuns: 5 };
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanySettings />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const input = maxRunsInput(container);
    expect(input).not.toBeNull();
    expect(input!.value).toBe("5");

    await act(async () => {
      typeIntoInput(input!, "4");
    });
    await flushReact();

    await act(async () => {
      saveChangesButton(container)!.click();
    });
    await flushReact();

    expect(mockCompaniesApi.update).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ maxConcurrentRuns: 4 }),
    );

    await flushReact();
    const refreshedInput = maxRunsInput(container);
    await act(async () => {
      typeIntoInput(refreshedInput!, "");
    });
    await flushReact();

    await act(async () => {
      saveChangesButton(container)!.click();
    });
    await flushReact();

    expect(mockCompaniesApi.update).toHaveBeenLastCalledWith(
      "company-1",
      expect.objectContaining({ maxConcurrentRuns: null }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("clears a previously-set breaker horizon by sending null, not undefined", async () => {
    mockSelectedCompanyRef.current = {
      ...DEFAULT_TEST_COMPANY,
      predictiveBreakerEnabled: true,
      breakerHorizonMinutes: 30,
    };
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanySettings />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const input = breakerHorizonInput(container);
    expect(input).not.toBeNull();
    expect(input!.value).toBe("30");

    await act(async () => {
      typeIntoInput(input!, "");
    });
    await flushReact();

    await act(async () => {
      saveChangesButton(container)!.click();
    });
    await flushReact();

    expect(mockCompaniesApi.update).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ breakerHorizonMinutes: null }),
    );
    const [, sentPatch] = mockCompaniesApi.update.mock.calls[0];
    expect(sentPatch).toHaveProperty("breakerHorizonMinutes", null);
    expect(Object.prototype.hasOwnProperty.call(sentPatch, "breakerHorizonMinutes")).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("disables save when the cap is not empty or a positive integer", async () => {
    mockSelectedCompanyRef.current = { ...DEFAULT_TEST_COMPANY, maxConcurrentRuns: null };
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanySettings />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const input = maxRunsInput(container);
    expect(input).not.toBeNull();

    await act(async () => {
      typeIntoInput(input!, "0");
    });
    await flushReact();
    expect(saveChangesButton(container)?.disabled).toBe(true);

    await act(async () => {
      typeIntoInput(input!, "-3");
    });
    await flushReact();
    expect(saveChangesButton(container)?.disabled).toBe(true);

    await act(async () => {
      typeIntoInput(input!, "3");
    });
    await flushReact();
    expect(saveChangesButton(container)?.disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("renders the live company admission status line", async () => {
    mockCompaniesApi.getAdmissionStatus.mockResolvedValue({
      cap: 4,
      source: "configured-default",
      running: 1,
      queued: 0,
    });
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanySettings />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toMatch(/running 1 \/ cap 4 · 0 queued/i);

    await act(async () => {
      root.unmount();
    });
  });

  it("shows a fallback when the admission status query errors", async () => {
    mockCompaniesApi.getAdmissionStatus.mockRejectedValue(new Error("boom"));
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanySettings />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("status unavailable");

    await act(async () => {
      root.unmount();
    });
  });
});
// [END: module]
