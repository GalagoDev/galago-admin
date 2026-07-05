import fs from "node:fs";
import path from "node:path";

function parseServiceAccountJson(value: string) {
  const trimmed = value.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");

  const credentials = JSON.parse(jsonText);

  if (typeof credentials.private_key === "string") {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  return credentials;
}

export function getGoogleServiceAccountCredentials() {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

  if (inlineJson) {
    return parseServiceAccountJson(inlineJson);
  }

  if (keyPath) {
    const resolvedPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), keyPath);
    return parseServiceAccountJson(fs.readFileSync(resolvedPath, "utf8"));
  }

  throw new Error("Google service account credentials are not configured.");
}
