/**
 * FILE: ui/src/pages/InstanceGeneralSettings.test.tsx
 * ABOUT: InstanceGeneralSettings.test.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - InstanceGeneralSettings.test.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: InstanceGeneralSettings.test.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/InstanceGeneralSettings.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InstanceGeneralSettings as InstanceGeneralSettingsPayload } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InstanceGeneralSettings } from "./InstanceGeneralSettings";

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getGeneral: vi.fn(),
  updateGeneral: vi.fn(),
  getAdmissionStatus: vi.fn(),
}));

const mockAuthApi = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

const mockHealthApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("@/api/auth", () => ({
  authApi: mockAuthApi,
}));

vi.mock("@/api/health", () => ({
  healthApi: mockHealthApi,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

function typeIntoInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function defaultGeneralSettings(): InstanceGeneralSettingsPayload {
  return {
    censorUsernameInLogs: false,
    keyboardShortcuts: false,
    feedbackDataSharingPreference: "prompt",
    backupRetention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
  };
}

describe("InstanceGeneralSettings — instance cap + admission status", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let currentGeneralSettings: InstanceGeneralSettingsPayload;

  async function renderPage() {
    root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <InstanceGeneralSettings />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  function maxRunsInput(): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>('input[type="number"]');
  }

  function saveButton(): HTMLButtonElement | undefined {
    return [...container.querySelectorAll("button")].find((button) =>
      /save/i.test(button.textContent ?? ""),
    ) as HTMLButtonElement | undefined;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    currentGeneralSettings = defaultGeneralSettings();
    mockInstanceSettingsApi.getGeneral.mockImplementation(async () => ({
      ...currentGeneralSettings,
    }));
    mockInstanceSettingsApi.updateGeneral.mockImplementation(async (patch) => {
      currentGeneralSettings = { ...currentGeneralSettings, ...patch };
      return { ...currentGeneralSettings };
    });
    mockInstanceSettingsApi.getAdmissionStatus.mockResolvedValue({
      cap: null,
      source: "unset",
      running: 0,
      queued: 0,
    });
    mockHealthApi.get.mockResolvedValue({
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
      authReady: true,
      bootstrapStatus: "ready",
      bootstrapInviteActive: false,
    });
    mockAuthApi.signOut.mockResolvedValue({});
  });

  afterEach(() => {
    flushSync(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  it("seeds the input from the loaded settings, saves a new cap, then clears it", async () => {
    currentGeneralSettings = { ...defaultGeneralSettings(), maxConcurrentRuns: 5 };
    await renderPage();

    const input = maxRunsInput();
    expect(input).not.toBeNull();
    expect(input!.value).toBe("5");

    await act(async () => {
      typeIntoInput(input!, "10");
    });
    await flushReact();

    await act(async () => {
      saveButton()!.click();
    });
    await flushReact();

    expect(mockInstanceSettingsApi.updateGeneral.mock.calls.at(-1)?.[0]).toEqual({
      maxConcurrentRuns: 10,
      maxRunWallClockMs: null,
      maxRunCostCents: null,
      maxRunTurns: null,
    });

    const refreshedInput = maxRunsInput();
    await act(async () => {
      typeIntoInput(refreshedInput!, "");
    });
    await flushReact();

    await act(async () => {
      saveButton()!.click();
    });
    await flushReact();

    expect(mockInstanceSettingsApi.updateGeneral.mock.calls.at(-1)?.[0]).toEqual({
      maxConcurrentRuns: null,
      maxRunWallClockMs: null,
      maxRunCostCents: null,
      maxRunTurns: null,
    });
  });

  it("disables the save affordance when the cap is not empty or a positive integer", async () => {
    await renderPage();

    const input = maxRunsInput();
    expect(input).not.toBeNull();
    expect(input!.value).toBe("");

    await act(async () => {
      typeIntoInput(input!, "0");
    });
    await flushReact();

    expect(saveButton()?.disabled).toBe(true);

    await act(async () => {
      typeIntoInput(input!, "-3");
    });
    await flushReact();

    expect(saveButton()?.disabled).toBe(true);

    await act(async () => {
      typeIntoInput(input!, "2.5");
    });
    await flushReact();

    expect(saveButton()?.disabled).toBe(true);

    await act(async () => {
      typeIntoInput(input!, "7");
    });
    await flushReact();

    expect(saveButton()?.disabled).toBe(false);

    expect(mockInstanceSettingsApi.updateGeneral).not.toHaveBeenCalled();
  });

  it("renders the live admission status line", async () => {
    mockInstanceSettingsApi.getAdmissionStatus.mockResolvedValue({
      cap: 10,
      source: "configured-default",
      running: 2,
      queued: 1,
    });
    await renderPage();

    expect(container.textContent).toMatch(/running 2 \/ cap 10 · 1 queued/i);
  });

  it("shows a fallback when the admission status query errors", async () => {
    mockInstanceSettingsApi.getAdmissionStatus.mockRejectedValue(new Error("boom"));
    await renderPage();

    expect(container.textContent).toContain("status unavailable");
  });
});
// [END: module]
