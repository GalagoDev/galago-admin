import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getClaimMessagingConfig } from "@/lib/claim-messaging-config";
import { finishClaimGmailConnection, CLAIM_OAUTH_COOKIE, CLAIM_OAUTH_PATH } from "@/lib/claim-gmail";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const config = getClaimMessagingConfig();
  if (!config || !(await requireAuth())) return new Response("Unauthorized", { status: 401 });
  let success = false;
  try {
    await finishClaimGmailConnection(request.nextUrl.searchParams.get("state") || "",
      request.cookies.get(CLAIM_OAUTH_COOKIE)?.value || "", request.nextUrl.searchParams.get("code") || "");
    success = true;
  } catch { console.error("Claims Gmail OAuth connection was not completed"); }
  const response = NextResponse.redirect(`${config.publicUrl}/reklamacije/povezivanje?gmail=${success ? "connected" : "error"}`, 303);
  response.cookies.set(CLAIM_OAUTH_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: CLAIM_OAUTH_PATH, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
