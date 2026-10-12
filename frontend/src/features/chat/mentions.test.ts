import { describe, expect, it } from "vitest";

import {
  decodeMentions,
  encodeMentions,
  mentionQuery,
  mentionsMe,
  mentionsToMarkdown,
} from "./mentions";

const ana = {
  id: "11111111-1111-7111-8111-111111111111",
  username: "ana",
  display_name: "Ana K",
  avatar_url: null,
};
const study = { id: "22222222-2222-7222-8222-222222222222", name: "Study group", color: 0 };
const candidates = { users: [ana], roles: [study], everyone: true };

describe("encodeMentions", () => {
  it("turns known @names into tokens and leaves the rest", () => {
    expect(encodeMentions("hi @Ana and @bob", candidates)).toBe(`hi <@${ana.id}> and @bob`);
    expect(encodeMentions("@Study group meet", candidates)).toBe(`<@&${study.id}> meet`);
    expect(encodeMentions("@everyone look", candidates)).toBe("@everyone look");
    expect(encodeMentions("mail me@ana.com", candidates)).toBe("mail me@ana.com");
  });
});

describe("decodeMentions", () => {
  it("restores @names for editing", () => {
    const message = { mentions: [ana], mention_roles: [study] };
    expect(decodeMentions(`<@${ana.id}> <@&${study.id}>`, message)).toBe("@ana @Study group");
  });
});

describe("mentionsToMarkdown", () => {
  it("renders tokens as mention links, unknown ids as plain text", () => {
    const message = {
      content: `<@${ana.id}> <@00000000-0000-7000-8000-000000000000> @everyone`,
      mentions: [ana],
      mention_roles: [],
    };
    expect(mentionsToMarkdown(message)).toBe(
      `[@Ana K](mention://user/${ana.id}) @unknown-user [@everyone](mention://everyone)`,
    );
  });
});

describe("mentionsMe", () => {
  const base = { mentions: [], mention_roles: [], mention_everyone: false, reply_to: null };
  it("detects direct, role, everyone and reply mentions", () => {
    expect(mentionsMe(base, ana.id)).toBe(false);
    expect(mentionsMe({ ...base, mentions: [ana] }, ana.id)).toBe(true);
    expect(mentionsMe({ ...base, mention_roles: [study] }, ana.id, new Set([study.id]))).toBe(true);
    expect(mentionsMe({ ...base, mention_everyone: true }, ana.id)).toBe(true);
  });
});

describe("mentionQuery", () => {
  it("finds the @word being typed", () => {
    expect(mentionQuery("hello @an")).toEqual({ query: "an", start: 6 });
    expect(mentionQuery("@")).toEqual({ query: "", start: 0 });
    expect(mentionQuery("email@an")).toBeNull();
    expect(mentionQuery("@ana done")).toBeNull();
  });
});
