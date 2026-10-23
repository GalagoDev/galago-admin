import { getAnanasSyncSummary } from "@/lib/ananas-store";
import { verifyIntegrationSecret } from "@/lib/shopify-ananas-auth";
import { getBedlyProductsForAnanas } from "@/lib/bedly-ananas";
import { mapShopifyProductToAnanas } from "@/lib/ananas-mapping";
import { getAnanasLinkByVariantId } from "@/lib/ananas-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyIntegrationSecret(request.headers.get("x-integration-secret"))) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (new URL(request.url).searchParams.get("source") === "bedly") {
    try {
      const products = await getBedlyProductsForAnanas();
      return Response.json({ ok: true, source: "bedly", inventorySource: "admin-lager", products: products.flatMap((product) =>
        mapShopifyProductToAnanas(product, { vat: 17, defaultWeightKg: Number(process.env.ANANAS_DEFAULT_PACKAGE_WEIGHT_KG) || 1 })
          .map((item) => ({ ...item, link: getAnanasLinkByVariantId(item.shopifyVariantId) || null }))),
      });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }
  }
  return Response.json({ ok: true, summary: getAnanasSyncSummary() });
}
