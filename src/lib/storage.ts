import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const configuredStorageDir = process.env.STORAGE_DIR ?? "storage";

function getRuntimeBase() {
  const hostingerBuildMarker = `${path.sep}hbuilds${path.sep}`;
  const markerIndex = projectRoot.indexOf(hostingerBuildMarker);
  return markerIndex > 0 ? projectRoot.slice(0, markerIndex) : projectRoot;
}

export function resolveRuntimePath(configuredPath: string) {
  if (path.isAbsolute(configuredPath)) return configuredPath;
  return path.resolve(/* turbopackIgnore: true */ getRuntimeBase(), configuredPath);
}

const storageRoot = resolveRuntimePath(configuredStorageDir);

const folders = [
  storageRoot,
  path.join(storageRoot, "data"),
  path.join(storageRoot, "pdfs"),
  path.join(storageRoot, "pdfs", "incoming"),
  path.join(storageRoot, "pdfs", "sent"),
  path.join(storageRoot, "pdfs", "delivered"),
  path.join(storageRoot, "receipts"),
  path.join(storageRoot, "return-claims"),
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
    returnClaimFiles: path.join(storageRoot, "return-claims"),
  };
}
