import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureStorage } from "@/lib/storage";
import { addImportInvoiceFile, getImportsOverview } from "@/lib/import-payments";
import { parseImportInvoiceLines, type InvoiceExtraction } from "@/lib/import-invoice-parser";
import type { ImportInvoiceDraft } from "@/lib/import-payments-types";
import { runImportProcess } from "@/lib/import-process";

export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;
let reading = false;

export function importInvoicePath(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Neispravna oznaka dokumenta.");
  return path.join(ensureStorage().root, "import-invoices", `${id}.pdf`);
}

export async function uploadImportInvoice(containerId: string, file: File): Promise<ImportInvoiceDraft> {
  if (reading) throw new Error("Druga faktura se trenutno obrađuje. Pokušajte ponovo za nekoliko sekundi.");
  if (!getImportsOverview().containers.some(c => c.id === containerId)) throw new Error("Kontejner nije pronađen.");
  if (!file.size || file.size > MAX_INVOICE_BYTES) throw new Error("PDF može imati najviše 10 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Odaberite ispravan PDF dokument.");
  const fileId = randomUUID();
  const destination = importInvoicePath(fileId);
  reading = true;
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    let extraction: InvoiceExtraction;
    try {
      // Parsing is isolated, time-limited and only runs on upload, never on page views.
      const stdout = await runImportProcess(process.execPath, ["--max-old-space-size=192", path.join(process.cwd(), "scripts", "read-import-invoice.mjs"), destination],
        { timeout: 20_000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "" } });
      const lines: unknown = JSON.parse(stdout);
      if (!Array.isArray(lines) || lines.some(line => typeof line !== "string")) throw new Error("Invalid text");
      extraction = parseImportInvoiceLines(lines);
    } catch {
      extraction = { totalMinor: null, currency: null, supplier: null, number: "", warning: "Tekst PDF-a nije moguće pouzdano očitati. Unesite ukupan iznos i valutu ručno." };
    }
    const draft: ImportInvoiceDraft = { ...extraction, fileId, containerId, filename: path.basename(file.name).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200) || "faktura.pdf" };
    addImportInvoiceFile(draft);
    return draft;
  } catch (error) {
    await fs.unlink(destination).catch(() => {});
    throw error;
  } finally { reading = false; }
}
