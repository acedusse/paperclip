/**
 * FILE: ui/src/pages/Digest.test.tsx
 * ABOUT: Digest.test.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - Digest page render + generate-now tests.
 */
// ==========================================
// [META: module]
// INTENT: The Digest page renders the latest digest headline/section and generating
//   a new digest calls digestsApi.generate.
// PSEUDOCODE: 1. Mock digestsApi. 2. Render. 3. Assert content / click behavior.
// JSON_FLOW: {"file": "ui/src/pages/Digest.test.tsx", "imports": "see code", "exports": "see code"}
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
  digestLatest: vi.fn(),
  digestGenerate: vi.fn(),
  getPrefs: vi.fn(),
  putPrefs: vi.fn(),
  listDevices: vi.fn(),
  renameDevice: vi.fn(),
  removeDevice: vi.fn(),
}));

vi.mock("../api/digests", () => ({
  digestsApi: {
    latest: apiMocks.digestLatest,
    generate: apiMocks.digestGenerate,
  },
}));

vi.mock("../lib/push", () => ({
  pushSupported: () => true,
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

vi.mock("../api/push", () => ({
  pushApi: {
    getPrefs: apiMocks.getPrefs,
    putPrefs: apiMocks.putPrefs,
    listDevices: apiMocks.listDevices,
    renameDevice: apiMocks.renameDevice,
    removeDevice: apiMocks.removeDevice,
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

import { Digest } from "./Digest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function buildDigest(overrides: Record<string, unknown> = {}) {
  return {
    id: "digest-1",
    companyId: "company-1",
    periodStart: "2026-07-06T00:00:00.000Z",
    periodEnd: "2026-07-13T00:00:00.000Z",
    payload: {
      headline: "3 approvals need you",
      sections: [
        { key: "approvals", title: "Approvals waiting", lines: ["Approve run #42", "Approve run #43"] },
      ],
      text: "3 approvals need you\n\nApprovals waiting\n- Approve run #42\n- Approve run #43",
    },
    generatedAt: "2026-07-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("Digest page", () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    apiMocks.digestLatest.mockReset();
    apiMocks.digestGenerate.mockReset();
    apiMocks.getPrefs.mockReset();
    apiMocks.putPrefs.mockReset();
    apiMocks.listDevices.mockReset();
    apiMocks.renameDevice.mockReset();
    apiMocks.removeDevice.mockReset();
    apiMocks.getPrefs.mockResolvedValue({ minBand: "high", quietStart: null, quietEnd: null, timezone: null });
    apiMocks.listDevices.mockResolvedValue([]);
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });

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
    vi.unstubAllGlobals();
  });

  async function renderDigest() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Digest />
        </QueryClientProvider>,
      );
    });
  }

  it("renders the latest digest headline and section", async () => {
    apiMocks.digestLatest.mockResolvedValue(buildDigest());
    await renderDigest();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("3 approvals need you");
    });
    expect(container.textContent).toContain("Approvals waiting");
  });

  it("calls digestsApi.generate when Generate now is clicked", async () => {
    apiMocks.digestLatest.mockResolvedValue(buildDigest());
    apiMocks.digestGenerate.mockResolvedValue(buildDigest());
    await renderDigest();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("3 approvals need you");
    });

    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Generate now"),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });

    expect(apiMocks.digestGenerate).toHaveBeenCalledWith("company-1");
  });

  it("saves prefs with the browser-captured timezone and lists devices", async () => {
    apiMocks.digestLatest.mockResolvedValue(null);
    apiMocks.getPrefs.mockResolvedValue({ minBand: "high", quietStart: null, quietEnd: null, timezone: null });
    apiMocks.putPrefs.mockResolvedValue({ ok: true });
    apiMocks.listDevices.mockResolvedValue([
      { id: "d1", label: "Phone", userAgent: "UA", lastUsedAt: null, createdAt: "2026-07-14T00:00:00Z", endpointTail: "abc12345" },
    ]);

    await renderDigest();

    await vi.waitFor(() => {
      expect(apiMocks.listDevices).toHaveBeenCalledWith("company-1");
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Phone");
    });
    expect(container.textContent).toContain("abc12345");

    const quietStartInput = Array.from(container.querySelectorAll("input[type='time']"))[0] as HTMLInputElement;
    expect(quietStartInput).toBeTruthy();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      nativeInputValueSetter.call(quietStartInput, "22:00");
      quietStartInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Save notification settings"),
    );
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton!.click();
    });

    await vi.waitFor(() => {
      expect(apiMocks.putPrefs).toHaveBeenCalled();
    });
    expect(apiMocks.putPrefs).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ minBand: "high", timezone: expect.any(String) }),
    );
  });
});
// [END: module]
