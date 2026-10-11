import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusPill } from "./status-pill";

describe("StatusPill", () => {
  it("exposes label, detail and state", () => {
    render(<StatusPill label="API" state="ok" detail="ready" />);
    const pill = screen.getByTestId("status-api");
    expect(pill).toHaveAttribute("data-state", "ok");
    expect(pill).toHaveTextContent("API");
    expect(pill).toHaveTextContent("ready");
  });
});
