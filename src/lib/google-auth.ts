import fs from "node:fs";
import path from "node:path";

export function getGoogleServiceAccountCredentials() {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

  if (inlineJson) {
    return JSON.parse(inlineJson);
  }

  if (keyPath) {
    const resolvedPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), keyPath);
    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  }

  throw new Error("Google service account credentials are not configured.");
}
