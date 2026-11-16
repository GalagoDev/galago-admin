import { isAuthenticated } from "@/lib/auth";
import { MAX_INVOICE_BYTES, uploadImportInvoice } from "@/lib/import-invoice-upload";
import { isSameOriginRequest } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!await isAuthenticated()) return Response.json({ error: "Sesija je istekla." }, { status: 401 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Zahtjev nije dozvoljen." }, { status: 403 });
  const max = MAX_INVOICE_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > max) return Response.json({ error: "PDF može imati najviše 10 MB." }, { status: 413 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Dokument nedostaje.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new Error("PDF može imati najviše 10 MB."); }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Odaberite PDF dokument.");
    const draft = await uploadImportInvoice(String(form.get("containerId") || ""), file);
    return Response.json({ draft }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && !("code" in error) ? error.message : "Faktura nije učitana. Pokušajte ponovo.";
    return Response.json({ error: message }, { status: 400 });
  }
}
