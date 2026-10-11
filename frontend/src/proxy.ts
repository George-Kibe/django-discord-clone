import { NextResponse, type NextRequest } from "next/server";

/**
 * Route gating from the non-secret `session` hint cookie (ADR-006/ADR-022).
 * Real authorization always happens in the API; this only avoids rendering pages the
 * visitor obviously can't use.
 */
const PROTECTED_PREFIXES = ["/channels", "/settings"];
const GUEST_ONLY = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.get("session")?.value === "1";

  if (!signedIn && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if (signedIn && GUEST_ONLY.includes(pathname)) {
    return NextResponse.redirect(new URL("/channels/me", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/channels/:path*", "/settings/:path*", "/login", "/register"],
};
