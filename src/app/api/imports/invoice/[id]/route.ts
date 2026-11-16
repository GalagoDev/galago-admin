import fs from "node:fs/promises";
import { isAuthenticated } from "@/lib/auth";
import { getImportInvoiceFile } from "@/lib/import-payments";
import { importInvoicePath } from "@/lib/import-invoice-upload";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAuthenticated()) return new Response("Unauthorized", { status: 401 });
  const invoice = getImportInvoiceFile((await context.params).id);
  if (!invoice) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(importInvoicePath(invoice.fileId));
    return new Response(data, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="invoice.pdf"; filename*=UTF-8''${encodeURIComponent(invoice.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
