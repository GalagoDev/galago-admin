import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isContainerTrackingConfigured, refreshDueContainers } from "@/lib/containers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: NextRequest) {
  const secret = process.env.CONTAINER_CRON_SECRET?.trim();
  const header = request.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(secret && provided && secureEqual(secret, provided));
}

async function handleRefresh(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isContainerTrackingConfigured()) {
    return NextResponse.json({ ok: false, error: "Container tracking is not configured" }, { status: 503 });
  }

  try {
    const result = await refreshDueContainers({ limit: 20 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Scheduled container refresh failed", error);
    return NextResponse.json({ ok: false, error: "Refresh failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleRefresh(request);
}

export async function POST(request: NextRequest) {
  return handleRefresh(request);
}
