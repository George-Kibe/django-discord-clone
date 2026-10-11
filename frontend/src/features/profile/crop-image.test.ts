import { describe, expect, it } from "vitest";

import { validateAvatarFile } from "./crop-image";

const file = (type: string, size: number) => new File([new Uint8Array(size)], "x", { type });

describe("validateAvatarFile", () => {
  it("accepts supported images up to 5 MB", () => {
    expect(validateAvatarFile(file("image/png", 1024))).toBeNull();
    expect(validateAvatarFile(file("image/jpeg", 5 * 1024 * 1024))).toBeNull();
  });

  it("rejects other types and oversized files", () => {
    expect(validateAvatarFile(file("image/svg+xml", 10))).toMatch(/PNG/);
    expect(validateAvatarFile(file("image/png", 5 * 1024 * 1024 + 1))).toMatch(/5 MB/);
  });
});
