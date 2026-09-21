import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const allowedActions = new Set([
  "prices-stock",
  "discounts",
  "refresh-ids",
  "import-catalog",
  "invoices",
]);
const action = process.argv[2];

if (!allowedActions.has(action)) {
  throw new Error(`Unsupported Ananas cron action: ${action || "missing"}`);
}

const secret = process.env.ANANAS_SYNC_SECRET?.trim();
if (!secret) throw new Error("ANANAS_SYNC_SECRET is not configured.");

const baseUrl = (process.env.ANANAS_CRON_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const response = await fetch(`${baseUrl}/api/integrations/ananas/run`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-integration-secret": secret,
  },
  body: JSON.stringify({ action }),
});
const text = await response.text();

if (!response.ok) {
  throw new Error(`Ananas cron ${action} failed (${response.status}): ${text.slice(0, 1000)}`);
}

console.log(`${new Date().toISOString()} ${action} ${text}`);
