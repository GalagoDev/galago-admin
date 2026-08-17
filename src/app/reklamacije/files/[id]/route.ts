import fs from "node:fs/promises";

import { resolveCustomerReturnFile } from "@/lib/reklamacije";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "prilog";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const file = resolveCustomerReturnFile(id);
  if (!file) return new Response("Prilog nije pronađen.", { status: 404 });

  const bytes = await fs.readFile(file.path);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const fileName = safeFileName(file.originalName);
  const asciiFileName = fileName.replace(/[^\x20-\x7e]/g, "_");
  const inlineTypes = new Set(["application/pdf", "image/gif", "image/jpeg", "image/png", "image/webp"]);
  const inline = inlineTypes.has(file.mimeType.toLowerCase());

  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(bytes.length),
      "Content-Type": inline ? file.mimeType : "application/octet-stream",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
