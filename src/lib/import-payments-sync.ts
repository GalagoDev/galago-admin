import "server-only";
import path from "node:path";
import { applyImportSnapshot, claimImportSync, failImportSync, getImportBankDocumentHashes } from "@/lib/import-payments";
import { getImportPaymentsConfig } from "@/lib/import-payments-config";
import { runImportProcess } from "@/lib/import-process";
import { enrichImportBankPayments } from "@/lib/import-bank-statements";

export async function syncImportPayments(manual = false) {
  const config = getImportPaymentsConfig();
  if (!config) throw new Error("Nalto izvor uplata nije povezan.");
  if (!claimImportSync(manual)) return { skipped: true, count: 0 };
  let phase = "read";
  try {
    const stdout = await runImportProcess(config.phpBinary,
      ["-d", "display_errors=stderr", "-d", "html_errors=0", path.join(process.cwd(), "scripts", "read-nalto-import-payments.php")],
      { timeout: 45_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NALTO_APP_PATH: config.appPath, NALTO_COMPANY_ID: config.companyId,
        NALTO_KNOWN_DOCUMENTS: JSON.stringify(getImportBankDocumentHashes()) } });
    phase = "decode";
    const raw: unknown = JSON.parse(stdout);
    phase = "statements";
    const snapshot = await enrichImportBankPayments(raw);
    phase = "store";
    const count = applyImportSnapshot(snapshot, config.companyId);
    return { skipped: false, count };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    failImportSync({ phase, code: /^[a-zA-Z0-9_-]{1,40}$/.test(code) ? code : "", name: error instanceof Error ? error.name : "Error" });
    throw new Error("Uplate nisu osvježene. Prethodni podaci i raspored po kontejnerima su sačuvani.");
  }
}

declare global { var galagoImportPaymentsScheduler: ReturnType<typeof setInterval> | undefined; }
export function startImportPaymentsScheduler() {
  if (globalThis.galagoImportPaymentsScheduler || !getImportPaymentsConfig()) return;
  const tick = () => { void syncImportPayments().catch(() => console.error("Import payment sync unavailable")); };
  tick();
  globalThis.galagoImportPaymentsScheduler = setInterval(tick, 30 * 60_000);
  globalThis.galagoImportPaymentsScheduler.unref();
}
