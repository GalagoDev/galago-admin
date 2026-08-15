import { resolveReceiptDownloadToken } from "@/lib/receipt-links";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const token = file.endsWith(".pdf") ? file.slice(0, -4) : "";
  const receipt = resolveReceiptDownloadToken(token);
  if (!receipt) return new Response("Račun nije pronađen ili je link istekao.", { status: 404 });

  const body = receipt.bytes.buffer.slice(
    receipt.bytes.byteOffset,
    receipt.bytes.byteOffset + receipt.bytes.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'inline; filename="racun.pdf"',
      "Content-Length": String(receipt.bytes.length),
      "Content-Type": "application/pdf",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
