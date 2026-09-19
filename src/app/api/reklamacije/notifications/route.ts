import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { getOpenCustomerReturnClaimCount } from "@/lib/reklamacije";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { openClaimCount: getOpenCustomerReturnClaimCount() },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
