import { getAnanasSyncSummary } from "@/lib/ananas-store";
import { verifyIntegrationSecret } from "@/lib/shopify-ananas-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyIntegrationSecret(request.headers.get("x-integration-secret"))) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ ok: true, summary: getAnanasSyncSummary() });
}
