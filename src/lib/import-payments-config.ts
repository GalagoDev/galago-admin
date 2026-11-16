import "server-only";
import fs from "node:fs";
import path from "node:path";
import { ensureStorage } from "@/lib/storage";

export function getImportPaymentsConfig() {
  let saved: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(ensureStorage().data, "import-payments-source.json"), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
  } catch { /* Optional private server configuration. */ }
  const appPath = process.env.NALTO_APP_PATH ?? saved.appPath;
  const companyId = process.env.NALTO_COMPANY_ID ?? saved.companyId;
  const phpBinary = process.env.NALTO_PHP_BINARY ?? saved.phpBinary ?? "/usr/bin/php";
  if (typeof appPath !== "string" || !path.isAbsolute(appPath) || typeof companyId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(companyId) || typeof phpBinary !== "string" || !path.isAbsolute(phpBinary)) return null;
  return { appPath, companyId, phpBinary };
}
