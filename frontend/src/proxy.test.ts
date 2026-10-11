import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

function request(path: string, signedIn = false) {
  const req = new NextRequest(new URL(path, "http://localhost"));
  if (signedIn) req.cookies.set("session", "1");
  return req;
}

describe("proxy", () => {
  it("sends signed-out visitors of protected pages to login with a return path", () => {
    const res = proxy(request("/settings/profile?x=1"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/settings/profile?x=1");
  });

  it("lets signed-in users through", () => {
    expect(proxy(request("/channels/me", true)).headers.get("location")).toBeNull();
  });

  it("keeps signed-in users off the login and register pages", () => {
    expect(new URL(proxy(request("/login", true)).headers.get("location")!).pathname).toBe(
      "/channels/me",
    );
  });

  it("leaves guest pages alone for guests", () => {
    expect(proxy(request("/register")).headers.get("location")).toBeNull();
  });
});
