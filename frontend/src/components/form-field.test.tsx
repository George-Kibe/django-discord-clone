import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormField } from "./form-field";

describe("FormField", () => {
  it("links the label, hint and error to the control", () => {
    render(
      <FormField label="Email" hint="We never share it" error="Required">
        {(field) => <input {...field} />}
      </FormField>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);
    expect(screen.queryByText("We never share it")).toBeNull(); // the error replaces the hint
  });
});
