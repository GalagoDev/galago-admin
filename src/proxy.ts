import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isClaimInfo = ["/galago-reklamacije.html", "/galago-reklamacije-privatnost.html", "/galago-reklamacije-uslovi.html", "/galago-reklamacije.css"].includes(pathname);

  if (isClaimInfo || pathname.startsWith("/_next") || pathname === "/login" || pathname.startsWith("/favicon") || pathname.startsWith("/r/")) {
    return NextResponse.next();
  }

  const isAuthed = verifySession(request.cookies.get(AUTH_COOKIE)?.value);

  if (!isAuthed) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api).*)"],
};
