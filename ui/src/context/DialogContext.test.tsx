/**
 * FILE: ui/src/context/DialogContext.test.tsx
 * ABOUT: DialogContext.test.tsx (context module).
 *
 * SECTIONS:
 *   [TAG: module] - DialogContext.test.tsx (context module).
 */
// ==========================================
// [META: module]
// INTENT: DialogContext.test.tsx (context module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/context/DialogContext.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DialogProvider, useDialogActions, useDialogState } from "./DialogContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("DialogContext", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps action-only consumers from rerendering when dialog state changes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let actionRenderCount = 0;
    let stateRenderCount = 0;

    function ActionOnlyConsumer() {
      actionRenderCount += 1;
      const { openNewIssue } = useDialogActions();
      return <button onClick={() => openNewIssue()}>Open issue</button>;
    }

    function StateConsumer() {
      stateRenderCount += 1;
      const { newIssueOpen } = useDialogState();
      return <span>{newIssueOpen ? "open" : "closed"}</span>;
    }

    act(() => {
      root.render(
        <DialogProvider>
          <ActionOnlyConsumer />
          <StateConsumer />
        </DialogProvider>,
      );
    });

    expect(actionRenderCount).toBe(1);
    expect(stateRenderCount).toBe(1);

    const button = host.querySelector("button");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("open");
    expect(actionRenderCount).toBe(1);
    expect(stateRenderCount).toBe(2);

    act(() => root.unmount());
  });
});
// [END: module]
