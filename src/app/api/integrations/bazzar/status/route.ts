import { BAZZAR_RESPONSE_HEADERS, getBazzarFeedStatus, getBazzarFeedUrl } from "@/lib/bazzar-feed";
import { verifyIntegrationSecret } from "@/lib/shopify-ananas-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyIntegrationSecret(request.headers.get("x-integration-secret"))) {
    return Response.json({ ok: false }, { status: 401, headers: BAZZAR_RESPONSE_HEADERS });
  }
  return Response.json({ ok: true, ...getBazzarFeedStatus(), feedUrl: getBazzarFeedUrl() }, { headers: BAZZAR_RESPONSE_HEADERS });
}
