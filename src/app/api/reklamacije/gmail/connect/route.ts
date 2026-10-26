import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/request-origin";
import { beginClaimGmailConnection, CLAIM_OAUTH_COOKIE, CLAIM_OAUTH_PATH } from "@/lib/claim-gmail";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!(await requireAuth())) return new Response("Unauthorized", { status: 401 });
  if (!isSameOriginRequest(request)) return new Response("Forbidden", { status: 403 });
  try {
    const form = await request.formData();
    const { url, browser } = beginClaimGmailConnection(form.get("readReplies") === "1");
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(CLAIM_OAUTH_COOKIE, browser, { httpOnly: true, secure: true, sameSite: "lax", path: CLAIM_OAUTH_PATH, maxAge: 600 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return new Response("Gmail OAuth nije konfigurisan.", { status: 503 }); }
}
