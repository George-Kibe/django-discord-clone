import { describe, expect, it } from "vitest";

import { registerSchema, resetPasswordSchema } from "./schemas";

const valid = { email: "a@example.com", username: "Ann.B_1", password: "long-enough-pw" };

describe("registerSchema", () => {
  it("lowercases usernames like the API does", () => {
    expect(registerSchema.parse(valid).username).toBe("ann.b_1");
  });

  it.each([
    [{ password: "short" }, "password"],
    [{ password: "12345678901234" }, "password"],
    [{ username: "a" }, "username"],
    [{ username: "has space" }, "username"],
    [{ email: "nope" }, "email"],
  ])("rejects %o", (override, field) => {
    const result = registerSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual([field]);
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    const result = resetPasswordSchema.safeParse({ password: "long-enough-pw", confirm: "other" });
    expect(result.error?.issues[0].path).toEqual(["confirm"]);
  });
});
