import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const type = String(formData.get("type") ?? "");
  const file = formData.get("pdf");

  if (type !== "sent" && type !== "delivered") {
    return NextResponse.redirect(new URL("/?error=invalid-upload-type", request.url), 303);
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.redirect(new URL(`/?error=missing-${type}-pdf`, request.url), 303);
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.redirect(new URL(`/?error=invalid-${type}-pdf`, request.url), 303);
  }

  const { importPdfSegments, savePdfDocument } = await import("@/lib/documents");
  const saved = await savePdfDocument(file, type);
  const imported = importPdfSegments(saved.documentId, type, saved.segments);

  return NextResponse.redirect(
    new URL(`/?success=${type}-pdf-uploaded&imported=${imported}`, request.url),
    303
  );
}
