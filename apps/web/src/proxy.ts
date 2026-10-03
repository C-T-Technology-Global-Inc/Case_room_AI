import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/invite"];
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Optimistic redirect for signed-out visitors. This only checks that a session
 * cookie exists; the real authentication and authorization checks happen in
 * the data access layer (every page, server action and route handler calls
 * requireUser / getSessionUser and verifies case access).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip API routes (they return 401 themselves), Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
