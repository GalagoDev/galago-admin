import { NextResponse } from "next/server";

import { rebuildUndeliveredSheetDemoLayoutDirect } from "@/lib/google-sheets";

export async function POST(request: Request) {
  await rebuildUndeliveredSheetDemoLayoutDirect();
  return NextResponse.redirect(new URL('/undelivered?success=sheet-demo-rebuilt', request.url), 303);
}
