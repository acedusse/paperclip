// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdmissionStatusLine } from "./AdmissionStatusLine";

describe("AdmissionStatusLine", () => {
  it("renders running / cap / queued", () => {
    render(<AdmissionStatusLine status={{ cap: 10, source: "configured-default", running: 3, queued: 2 }} isError={false} />);
    expect(screen.getByText(/running 3 \/ cap 10 · 2 queued/i)).toBeInTheDocument();
  });
  it("shows 'unlimited' when cap is null", () => {
    render(<AdmissionStatusLine status={{ cap: null, source: "none", running: 1, queued: 0 }} isError={false} />);
    expect(screen.getByText(/running 1 \/ cap unlimited · 0 queued/i)).toBeInTheDocument();
  });
  it("shows 'status unavailable' on error", () => {
    render(<AdmissionStatusLine status={undefined} isError={true} />);
    expect(screen.getByText(/status unavailable/i)).toBeInTheDocument();
  });
});
