import { describe, expect, it } from "vitest";

import { DEFAULT_EVERYONE } from "@/types/permissions";

import { hasPerm, Perm, toggleBit } from "./permissions";

describe("hasPerm", () => {
  it("checks single bits", () => {
    expect(hasPerm(DEFAULT_EVERYONE, "SEND_MESSAGES")).toBe(true);
    expect(hasPerm(DEFAULT_EVERYONE, "MANAGE_CHANNELS")).toBe(false);
    expect(hasPerm(undefined, "VIEW_CHANNEL")).toBe(false);
  });

  it("treats ADMINISTRATOR as every permission", () => {
    expect(hasPerm(Perm.ADMINISTRATOR, "BAN_MEMBERS")).toBe(true);
  });

  it("toggles bits", () => {
    expect(toggleBit(0, "KICK_MEMBERS", true)).toBe(Perm.KICK_MEMBERS);
    expect(toggleBit(Perm.KICK_MEMBERS | Perm.VIEW_CHANNEL, "KICK_MEMBERS", false)).toBe(
      Perm.VIEW_CHANNEL,
    );
  });
});
