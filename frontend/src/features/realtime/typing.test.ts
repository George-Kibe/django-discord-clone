import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TypingStore, typingText } from "./typing";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("TypingStore", () => {
  it("tracks typers per channel, expires them and refreshes on repeat signals", () => {
    const store = new TypingStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.start("c1", { userId: "a", name: "Ana" }, 8);
    store.start("c1", { userId: "b", name: "Bo" }, 8);
    expect(store.get("c1").map((t) => t.name)).toEqual(["Ana", "Bo"]);
    expect(store.get("c2")).toEqual([]);

    vi.advanceTimersByTime(5000);
    store.start("c1", { userId: "a", name: "Ana" }, 8); // still typing: timer restarts
    vi.advanceTimersByTime(3000);
    expect(store.get("c1").map((t) => t.name)).toEqual(["Ana"]);
    vi.advanceTimersByTime(5000);
    expect(store.get("c1")).toEqual([]);
    expect(listener).toHaveBeenCalled();
  });

  it("stops a typer when their message arrives and keeps snapshots stable", () => {
    const store = new TypingStore();
    store.start("c1", { userId: "a", name: "Ana" }, 8);
    const snapshot = store.get("c1");
    expect(store.get("c1")).toBe(snapshot); // useSyncExternalStore needs referential stability
    store.stop("c1", "a");
    expect(store.get("c1")).toEqual([]);
    store.stop("c1", "nobody"); // no-op
  });
});

describe("typingText", () => {
  const t = (...names: string[]) => names.map((name) => ({ userId: name, name }));
  it("phrases one to many typers", () => {
    expect(typingText([])).toBe("");
    expect(typingText(t("Ana"))).toBe("Ana is typing…");
    expect(typingText(t("Ana", "Bo"))).toBe("Ana and Bo are typing…");
    expect(typingText(t("Ana", "Bo", "Cy"))).toBe("Ana, Bo and Cy are typing…");
    expect(typingText(t("Ana", "Bo", "Cy", "Di"))).toBe("Several people are typing…");
  });
});
