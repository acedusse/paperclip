// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheHitRate } from "./Costs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("CacheHitRate", () => {
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

  it("renders a percentage and its band", () => {
    act(() => {
      root.render(<CacheHitRate cachedInputTokens={80_000} inputTokens={20_000} />);
    });
    expect(container.textContent).toContain("80%");
    expect(container.textContent?.toLowerCase()).toContain("good");
  });

  it("renders an honest placeholder below the volume floor", () => {
    act(() => {
      root.render(<CacheHitRate cachedInputTokens={100} inputTokens={100} />);
    });
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("%");
  });
});
