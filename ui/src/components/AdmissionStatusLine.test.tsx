// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AdmissionStatusLine } from "./AdmissionStatusLine";

describe("AdmissionStatusLine", () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container?.remove();
    document.body.innerHTML = "";
  });

  it("renders running / cap / queued", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{ cap: 10, source: "configured-default", running: 3, queued: 2 }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("running 3 / cap 10 · 2 queued");

    act(() => {
      root.unmount();
    });
  });

  it("shows 'unlimited' when cap is null", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AdmissionStatusLine
          status={{ cap: null, source: "none", running: 1, queued: 0 }}
          isError={false}
        />,
      );
    });

    expect(container.textContent).toContain("running 1 / cap unlimited · 0 queued");

    act(() => {
      root.unmount();
    });
  });

  it("shows 'status unavailable' on error", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<AdmissionStatusLine status={undefined} isError={true} />);
    });

    expect(container.textContent).toContain("status unavailable");

    act(() => {
      root.unmount();
    });
  });
});
