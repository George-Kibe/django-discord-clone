import { describe, expect, it } from "vitest";

import type { Member, Role } from "../api";
import { groupMembers, roleColor } from "./member-list";

const role = (id: string, name: string, position: number, hoist = true): Role => ({
  id,
  name,
  position,
  hoist,
  color: 0,
  permissions: 0,
  is_default: false,
  mentionable: false,
});
const member = (name: string, roleIds: string[] = []): Member => ({
  user: { id: name, username: name, display_name: "", avatar_url: null },
  nickname: "",
  role_ids: roleIds,
  is_owner: false,
  joined_at: "2026-01-01T00:00:00Z",
});

describe("groupMembers", () => {
  it("groups by highest hoisted role, then everyone else", () => {
    const roles = [role("a", "Admin", 3), role("m", "Mod", 2), role("q", "Quiet", 1, false)];
    const sections = groupMembers(
      [member("zed", ["m", "a"]), member("amy", ["m"]), member("bob", ["q"])],
      roles,
    );
    expect(sections.map((s) => [s.title, s.members.map((m) => m.user.username)])).toEqual([
      ["Admin", ["zed"]],
      ["Mod", ["amy"]],
      ["Members", ["bob"]],
    ]);
  });
});

describe("roleColor", () => {
  it("formats 24-bit colours and treats 0 as default", () => {
    expect(roleColor(0x3ba55c)).toBe("#3ba55c");
    expect(roleColor(0x0000ff)).toBe("#0000ff");
    expect(roleColor(0)).toBeUndefined();
  });
});
