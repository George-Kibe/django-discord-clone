import { describe, expect, it } from "vitest";

import { parseInviteCode } from "./api";

describe("parseInviteCode", () => {
  it.each([
    ["AbC123xy", "AbC123xy"],
    ["  AbC123xy ", "AbC123xy"],
    ["http://localhost/invite/AbC123xy", "AbC123xy"],
    ["https://chat.example.com/invite/AbC123xy/", "AbC123xy"],
    ["not a code!", null],
    ["", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseInviteCode(input)).toBe(expected);
  });
});
