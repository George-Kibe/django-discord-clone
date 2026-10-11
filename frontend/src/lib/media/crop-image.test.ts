import { describe, expect, it } from "vitest";

import { validateImageFile } from "./crop-image";

const file = (type: string, size: number) => new File([new Uint8Array(size)], "x", { type });

describe("validateImageFile", () => {
  it("accepts supported images up to 5 MB", () => {
    expect(validateImageFile(file("image/png", 1024))).toBeNull();
    expect(validateImageFile(file("image/jpeg", 5 * 1024 * 1024))).toBeNull();
  });

  it("rejects other types and oversized files", () => {
    expect(validateImageFile(file("image/svg+xml", 10))).toMatch(/PNG/);
    expect(validateImageFile(file("image/png", 5 * 1024 * 1024 + 1))).toMatch(/5 MB/);
  });
});
