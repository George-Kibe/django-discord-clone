import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authFetch, refreshSession } from "./client";

const ORIGIN = "http://localhost";

function setCookies(...cookies: string[]) {
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
  for (const cookie of cookies) document.cookie = `${cookie}; path=/`;
}

function response(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  setCookies("csrftoken=abc123", "session=1");
});

afterEach(() => vi.unstubAllGlobals());

const urlOf = (call: Parameters<typeof fetch>) =>
  call[0] instanceof Request ? new URL(call[0].url).pathname : String(call[0]);

describe("authFetch", () => {
  it("adds the CSRF header to unsafe requests only", async () => {
    fetchMock.mockResolvedValue(response(200));
    await authFetch(new Request(`${ORIGIN}/api/v1/users/me`, { method: "PATCH", body: "{}" }));
    await authFetch(new Request(`${ORIGIN}/api/v1/users/me`));
    const [patch, get] = fetchMock.mock.calls.map((call) => call[0] as Request);
    expect(patch.headers.get("X-CSRFToken")).toBe("abc123");
    expect(get.headers.get("X-CSRFToken")).toBeNull();
  });

  it("fetches a CSRF cookie first when it is missing", async () => {
    setCookies("session=1");
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/csrf")) document.cookie = "csrftoken=fresh; path=/";
      return response(200);
    });
    await authFetch(new Request(`${ORIGIN}/api/v1/users/me`, { method: "PATCH", body: "{}" }));
    const sent = fetchMock.mock.calls.at(-1)![0] as Request;
    expect(sent.headers.get("X-CSRFToken")).toBe("fresh");
  });

  it("refreshes once on 401 and retries the original request", async () => {
    fetchMock
      .mockResolvedValueOnce(response(401, { code: "token_not_valid" }))
      .mockResolvedValueOnce(response(200)) // refresh
      .mockResolvedValueOnce(response(200, { ok: true })); // retry
    const result = await authFetch(new Request(`${ORIGIN}/api/v1/users/me`));
    expect(result.status).toBe(200);
    expect(fetchMock.mock.calls.map(urlOf)).toEqual([
      "/api/v1/users/me",
      "/api/v1/auth/refresh",
      "/api/v1/users/me",
    ]);
  });

  it("gives up and clears the session hint when refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(401));
    const result = await authFetch(new Request(`${ORIGIN}/api/v1/users/me`));
    expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.cookie).not.toContain("session=1");
  });

  it("never refreshes for anonymous auth endpoints", async () => {
    fetchMock.mockResolvedValue(response(401));
    await authFetch(new Request(`${ORIGIN}/api/v1/auth/login`, { method: "POST", body: "{}" }));
    expect(fetchMock.mock.calls.map(urlOf)).toEqual(["/api/v1/auth/login"]);
  });

  it("does refresh for authenticated auth endpoints like password change", async () => {
    fetchMock.mockResolvedValueOnce(response(401)).mockResolvedValue(response(200));
    await authFetch(
      new Request(`${ORIGIN}/api/v1/auth/password/change`, { method: "POST", body: "{}" }),
    );
    expect(fetchMock.mock.calls.map(urlOf)).toContain("/api/v1/auth/refresh");
  });

  it("doesn't refresh when there is no session hint", async () => {
    setCookies("csrftoken=abc123");
    fetchMock.mockResolvedValue(response(401));
    await authFetch(new Request(`${ORIGIN}/api/v1/users/me`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("refreshSession", () => {
  it("shares one request between concurrent callers", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const results = Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    resolve(response(200));
    expect(await results).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns false on network errors", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    expect(await refreshSession()).toBe(false);
  });
});
