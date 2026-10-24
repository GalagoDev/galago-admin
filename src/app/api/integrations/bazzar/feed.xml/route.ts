import { BAZZAR_RESPONSE_HEADERS, generateBazzarFeed, verifyBazzarFeedToken } from "@/lib/bazzar-feed";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const headers = BAZZAR_RESPONSE_HEADERS;
  try {
    if (!verifyBazzarFeedToken(new URL(request.url).searchParams.get("token"))) {
      return new Response("Unauthorized", { status: 401, headers });
    }
    if (process.env.BAZZAR_FEED_ENABLED?.trim().toLowerCase() === "false") {
      return new Response("Feed paused; preserve the previous catalog", { status: 503, headers });
    }
    const { xml, generatedAt } = await generateBazzarFeed();
    return new Response(xml, { headers: { ...headers, "content-type": "application/xml; charset=utf-8", "x-feed-generated-at": generatedAt } });
  } catch {
    // Never return an empty/partial XML or a stale-stock success on an upstream error.
    return new Response("Feed unavailable; preserve the previous catalog and retry", { status: 503, headers: { ...headers, "retry-after": "300" } });
  }
}
