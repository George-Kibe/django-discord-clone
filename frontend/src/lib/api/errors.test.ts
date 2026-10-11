import { describe, expect, it, vi } from "vitest";

import { ApiError, applyFieldErrors, toApiError } from "./errors";

const validation = (fields: Record<string, string[]>) =>
  new ApiError(400, {
    type: "validation_error",
    code: "invalid",
    detail: "Invalid input.",
    fields,
  });

describe("ApiError", () => {
  it("prefers non-field errors, then the first field error, then the summary", () => {
    expect(validation({ non_field_errors: ["Bad login"], email: ["x"] }).message).toBe("Bad login");
    expect(validation({ email: ["Enter a valid email address."] }).message).toBe(
      "Enter a valid email address.",
    );
    expect(
      new ApiError(429, { type: "throttled", code: "throttled", detail: "Slow down" }).message,
    ).toBe("Slow down");
  });

  it("wraps non-envelope bodies", () => {
    expect(toApiError(502, "<html>").body.type).toBe("server_error");
    expect(toApiError(400, null).message).toBe("Request failed.");
  });
});

describe("applyFieldErrors", () => {
  it("places known field errors and returns the rest", () => {
    const setError = vi.fn();
    const leftover = applyFieldErrors(
      validation({ email: ["Taken"], non_field_errors: ["Nope"] }),
      setError,
      ["email", "password"],
    );
    expect(setError).toHaveBeenCalledWith("email", { type: "server", message: "Taken" });
    expect(leftover).toBe("Nope");
  });

  it("returns null when everything was placed", () => {
    expect(applyFieldErrors(validation({ email: ["Taken"] }), vi.fn(), ["email"])).toBeNull();
  });

  it("explains network failures", () => {
    expect(applyFieldErrors(new TypeError("failed"), vi.fn(), [])).toMatch(/Network error/);
  });
});
