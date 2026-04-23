import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that don't require auth (the session cookie doesn't need to exist).
const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let the API rewrites through — the Express API enforces its own auth.
  // (Normally the matcher excludes /api, but Next middleware still runs on
  // the rewritten path; being explicit here is a belt-and-braces guard.)
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Public pages: signup, login, password reset flow.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  // Everything else requires a session cookie. We only check for presence —
  // validity is enforced by the API on every request.
  const session = req.cookies.get("takumi_session");
  if (!session?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the original path so we can redirect back after login.
    if (pathname !== "/" && pathname !== "/login") {
      url.searchParams.set("next", pathname + req.nextUrl.search);
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Protect everything except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
