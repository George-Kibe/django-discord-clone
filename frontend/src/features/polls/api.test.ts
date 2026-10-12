import { describe, expect, it } from "vitest";

import { applyPollUpdate, type PollSummary } from "./api";

const poll = (my_votes: number[]): PollSummary => ({
  id: "p",
  question: "?",
  allow_multiple: false,
  closes_at: null,
  closed_at: null,
  options: [
    { id: 1, text: "a", votes: 1 },
    { id: 2, text: "b", votes: 0 },
  ],
  total_voters: 1,
  my_votes,
});

describe("applyPollUpdate", () => {
  const broadcast = (({ my_votes, ...rest }) => (void my_votes, rest))({
    ...poll([]),
    total_voters: 2,
  });
  it("keeps your own votes when someone else voted", () => {
    const next = applyPollUpdate(poll([1]), broadcast, { isMe: false, optionIds: [2] });
    expect(next.my_votes).toEqual([1]);
    expect(next.total_voters).toBe(2);
  });
  it("takes your selection from your own vote in another tab", () => {
    expect(applyPollUpdate(poll([1]), broadcast, { isMe: true, optionIds: [2] }).my_votes).toEqual([
      2,
    ]);
    expect(applyPollUpdate(poll([1]), broadcast, { isMe: true, optionIds: [] }).my_votes).toEqual(
      [],
    );
  });
  it("keeps your votes when the poll is closed (no voter)", () => {
    expect(
      applyPollUpdate(poll([2]), broadcast, { isMe: false, optionIds: null }).my_votes,
    ).toEqual([2]);
  });
});
