import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders the allowed subset", () => {
    const { container } = render(<Markdown>{"**bold** _em_ `code` ~~gone~~"}</Markdown>);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("em");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelector("del")?.textContent).toBe("gone");
  });

  it("never renders raw HTML or scripts", () => {
    const { container } = render(
      <Markdown>{'<img src=x onerror="alert(1)"><script>alert(1)</script>hi'}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("drops disallowed elements but keeps their text", () => {
    const { container } = render(<Markdown>{"# Heading\n\n![alt](http://x/y.png)"}</Markdown>);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Heading");
  });

  it("opens links safely in a new tab", () => {
    const { container } = render(<Markdown>{"[site](https://example.com)"}</Markdown>);
    const link = container.querySelector("a")!;
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("neutralises javascript: links", () => {
    const { container } = render(<Markdown>{"[x](javascript:alert(1))"}</Markdown>);
    expect(container.querySelector("a")?.getAttribute("href") ?? "").not.toContain("javascript");
  });
});
