import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";
import { ensureStorage } from "@/lib/storage";

export async function POST(request: Request) {
  const db = getDb();
  db.exec("DELETE FROM orders; DELETE FROM documents;");

  const storage = ensureStorage();
  for (const dir of [storage.sentPdfs, storage.deliveredPdfs, storage.incomingPdfs]) {
    for (const entry of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, entry), { force: true });
    }
  }

  return NextResponse.redirect(new URL('/?success=cleared-test-data', request.url), 303);
}
