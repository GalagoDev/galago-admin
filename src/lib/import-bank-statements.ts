import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureStorage } from "@/lib/storage";
import { sourceSnapshotSchema, getImportBankDocument, saveImportBankDocument } from "@/lib/import-payments";
import { parseImportBankLines, type ImportBankRow } from "@/lib/import-bank-parser";
import { runImportProcess } from "@/lib/import-process";

const documentsSchema = z.object({ documents: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i), content: z.string().max(14 * 1024 * 1024).nullable() })).default([]) });

export async function enrichImportBankPayments(input: unknown) {
  const snapshot = sourceSnapshotSchema.parse(input);
  const { documents } = documentsSchema.parse(input);
  const parsed = new Map<string, ImportBankRow[]>();
  const missing = documents.filter(doc => {
    const cached = getImportBankDocument(doc.id, doc.sha256);
    if (cached) { parsed.set(doc.id, cached); return false; }
    return true;
  });
  if (missing.length) {
    const directory = await fs.mkdtemp(path.join(ensureStorage().data, "import-statements-"));
    const deadline = Date.now() + 35_000;
    try {
      for (let offset = 0; offset < missing.length; offset += 20) {
        const batch = missing.slice(offset, offset + 20);
        const files: string[] = [];
        for (const doc of batch) {
          if (!doc.content) throw new Error("Nedostaje izvorni izvod.");
          const bytes = Buffer.from(doc.content, "base64");
          if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Neispravan izvorni izvod.");
          const file = path.join(directory, `${doc.id}.pdf`);
          await fs.writeFile(file, bytes, { mode: 0o600 }); files.push(file);
        }
        const timeout = deadline - Date.now();
        if (timeout <= 0) throw new Error("Obrada izvoda će se nastaviti pri sljedećem osvježavanju.");
        const stdout = await runImportProcess(process.execPath, ["--max-old-space-size=192", path.join(process.cwd(), "scripts", "read-import-invoice.mjs"), "--batch", ...files],
          { timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "" } });
        const texts = z.array(z.array(z.string())).length(batch.length).parse(JSON.parse(stdout));
        for (let i = 0; i < batch.length; i++) {
          const rows = parseImportBankLines(texts[i]);
          saveImportBankDocument(batch[i].id, batch[i].sha256, rows);
          parsed.set(batch[i].id, rows);
        }
      }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
  snapshot.payments = snapshot.payments.map(payment => {
    if (payment.supplier || payment.kind !== "payment" || !payment.fileId) return payment;
    const matches = (parsed.get(payment.fileId) || []).filter(row => row.reference === payment.reference.trim()
      && row.currency === payment.currency && row.debitMinor === payment.amountMinor && row.date === payment.date && payment.account.includes(row.account) && row.account.length === 8);
    if (matches.length !== 1 || !matches[0].supplier) return payment;
    const row = matches[0];
    const supplier = row.supplier === "TADEX" || row.supplier === "SHENGFENG" ? row.supplier : null;
    return { ...payment, supplier, excluded: !supplier, reference: `${row.reference} · ${row.description}`.slice(0, 1000) };
  });
  return snapshot;
}
