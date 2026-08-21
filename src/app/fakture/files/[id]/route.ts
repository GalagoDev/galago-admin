import fs from "node:fs/promises";

import { resolveInvoiceFile } from "@/lib/invoices";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "faktura";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId) || invoiceId < 1) return new Response("Faktura nije pronađena.", { status: 404 });

  const file = resolveInvoiceFile(invoiceId);
  if (!file) return new Response("Faktura nije pronađena.", { status: 404 });

  const bytes = await fs.readFile(file.path);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const fileName = safeFileName(file.originalName);
  const asciiFileName = fileName.replace(/[^\x20-\x7e]/g, "_");

  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `inline; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(bytes.length),
      "Content-Type": file.mimeType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
