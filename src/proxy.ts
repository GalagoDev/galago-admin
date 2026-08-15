import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const AUTH_COOKIE = "store-admin-session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname === "/login" || pathname.startsWith("/favicon") || pathname.startsWith("/r/")) {
    return NextResponse.next();
  }

  const isAuthed = request.cookies.get(AUTH_COOKIE)?.value === "ok";

  if (!isAuthed) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api).*)"],
};
