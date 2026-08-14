import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const configuredStorageDir = process.env.STORAGE_DIR ?? "storage";
const storageRoot = path.resolve(/* turbopackIgnore: true */ projectRoot, configuredStorageDir);

const folders = [
  storageRoot,
  path.join(storageRoot, "data"),
  path.join(storageRoot, "pdfs"),
  path.join(storageRoot, "pdfs", "incoming"),
  path.join(storageRoot, "pdfs", "sent"),
  path.join(storageRoot, "pdfs", "delivered"),
  path.join(storageRoot, "receipts"),
];

export function ensureStorage() {
  for (const folder of folders) {
    fs.mkdirSync(folder, { recursive: true });
  }

  return {
    root: storageRoot,
    data: path.join(storageRoot, "data"),
    incomingPdfs: path.join(storageRoot, "pdfs", "incoming"),
    sentPdfs: path.join(storageRoot, "pdfs", "sent"),
    deliveredPdfs: path.join(storageRoot, "pdfs", "delivered"),
    receiptPdfs: path.join(storageRoot, "receipts"),
  };
}
