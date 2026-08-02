// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BudgetPolicySummary } from "@paperclipai/shared";
import { BudgetPolicyCard } from "./BudgetPolicyCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeSummary(overrides: Partial<BudgetPolicySummary>): BudgetPolicySummary {
  return {
    policyId: "policy-1",
    companyId: "company-1",
    scopeType: "agent",
    scopeId: "agent-1",
    scopeName: "Token Agent",
    metric: "billed_cents",
    windowKind: "calendar_month_utc",
    amount: 10_000,
    observedAmount: 2_500,
    remainingAmount: 7_500,
    utilizationPercent: 25,
    warnPercent: 80,
    hardStopEnabled: true,
    notifyEnabled: true,
    isActive: true,
    status: "ok",
    paused: false,
    pauseReason: null,
    windowStart: new Date(),
    windowEnd: new Date(),
    ...overrides,
  } as BudgetPolicySummary;
}

describe("BudgetPolicyCard", () => {
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

  it("formats a dollar budget as currency", () => {
    act(() => {
      root.render(
        <BudgetPolicyCard summary={makeSummary({ metric: "billed_cents" })} onSave={() => {}} />,
      );
    });
    expect(container.textContent).toContain("$100.00");
    expect(container.textContent).toContain("Budget (USD)");
  });

  it("formats a token budget as tokens, not dollars", () => {
    act(() => {
      root.render(
        <BudgetPolicyCard
          summary={makeSummary({
            metric: "total_tokens",
            amount: 5_000_000,
            observedAmount: 1_250_000,
            remainingAmount: 3_750_000,
          })}
          onSave={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain("5.0M");
    expect(container.textContent).toContain("1.3M");
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).toContain("Budget (tokens)");
  });
});
