import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";
import { ensureStorage } from "@/lib/storage";
import { queueNewClaimNotification } from "@/lib/claim-messaging-store";

export const CLAIM_STATUSES = ["new", "in_review", "approved", "rejected", "resolved"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

type ClaimRow = {
  id: string;
  reference: string;
  request_type: string;
  order_number: string;
  customer_name: string;
  email: string;
  address: string;
  city: string;
  phone: string;
  description: string;
  company_name: string | null;
  company_id_number: string | null;
  company_vat_number: string | null;
  company_address: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type ClaimFileRow = {
  id: string;
  claim_id: string;
  original_name: string;
  stored_name: string;
  stored_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type ClaimFile = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type CustomerReturnClaim = {
  id: string;
  reference: string;
  requestType: string;
  orderNumber: string;
  customerName: string;
  email: string;
  address: string;
  city: string;
  phone: string;
  description: string;
  companyName: string;
  companyIdNumber: string;
  companyVatNumber: string;
  companyAddress: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  files: ClaimFile[];
};

export type PreparedClaimFile = {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Buffer;
};

export type NewCustomerRequest = {
  requestType: string;
  orderNumber: string;
  customerName: string;
  email: string;
  address: string;
  city: string;
  phone: string;
  description: string;
  companyName: string;
  companyIdNumber: string;
  companyVatNumber: string;
  companyAddress: string;
  files: PreparedClaimFile[];
};

function mapClaim(row: ClaimRow, files: ClaimFile[] = []): CustomerReturnClaim {
  return {
    id: row.id,
    reference: row.reference,
    requestType: row.request_type,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    email: row.email,
    address: row.address,
    city: row.city,
    phone: row.phone,
    description: row.description,
    companyName: row.company_name || "",
    companyIdNumber: row.company_id_number || "",
    companyVatNumber: row.company_vat_number || "",
    companyAddress: row.company_address || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files,
  };
}

function mapFile(row: ClaimFileRow): ClaimFile {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export function getCustomerReturnClaims(query = "") {
  const db = getDb();
  const search = query.trim();
  const rows = (search
    ? db
        .prepare(
          `SELECT * FROM customer_return_claims
           WHERE reference LIKE ?
              OR order_number LIKE ?
              OR customer_name LIKE ?
              OR phone LIKE ?
              OR email LIKE ?
              OR company_name LIKE ?
           ORDER BY
             CASE status WHEN 'new' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END,
             datetime(created_at) DESC
           LIMIT 500`,
        )
        .all(...Array(6).fill(`%${search}%`))
    : db
        .prepare(
          `SELECT * FROM customer_return_claims
           ORDER BY
             CASE status WHEN 'new' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END,
             datetime(created_at) DESC
           LIMIT 500`,
        )
        .all()) as ClaimRow[];

  if (rows.length === 0) return [];

  const placeholders = rows.map(() => "?").join(",");
  const fileRows = db
    .prepare(
      `SELECT * FROM customer_return_files
       WHERE claim_id IN (${placeholders})
       ORDER BY datetime(created_at), id`,
    )
    .all(...rows.map((row) => row.id)) as ClaimFileRow[];
  const filesByClaim = new Map<string, ClaimFile[]>();
  for (const row of fileRows) {
    const files = filesByClaim.get(row.claim_id) || [];
    files.push(mapFile(row));
    filesByClaim.set(row.claim_id, files);
  }

  return rows.map((row) => mapClaim(row, filesByClaim.get(row.id) || []));
}

function makeReference() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("-", "");
  return `GAL-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function createCustomerRequest(input: NewCustomerRequest) {
  const db = getDb();
  const storage = ensureStorage();
  const id = crypto.randomUUID();
  let reference = makeReference();

  while (db.prepare("SELECT 1 FROM customer_return_claims WHERE reference = ?").get(reference)) {
    reference = makeReference();
  }

  const claimDir = path.join(storage.returnClaimFiles, id);
  fs.mkdirSync(claimDir, { recursive: true });

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO customer_return_claims (
        id, reference, request_type, order_number, customer_name, email,
        address, city, phone, description, company_name, company_id_number,
        company_vat_number, company_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      reference,
      input.requestType,
      input.orderNumber,
      input.customerName,
      input.email,
      input.address,
      input.city,
      input.phone,
      input.description,
      input.companyName,
      input.companyIdNumber,
      input.companyVatNumber,
      input.companyAddress,
    );

    const insertFile = db.prepare(
      `INSERT INTO customer_return_files (
        id, claim_id, original_name, stored_name, stored_path, mime_type, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const file of input.files) {
      const storedPath = path.join(claimDir, file.storedName);
      fs.writeFileSync(storedPath, file.bytes, { flag: "wx", mode: 0o600 });
      insertFile.run(
        file.id,
        id,
        file.originalName,
        file.storedName,
        storedPath,
        file.mimeType,
        file.sizeBytes,
      );
    }
    queueNewClaimNotification(id, reference, input);
  });

  try {
    insert();
  } catch (error) {
    fs.rmSync(claimDir, { recursive: true, force: true });
    throw error;
  }

  return { id, reference };
}

export function isCustomerRequestRateLimited(ipHash: string) {
  const db = getDb();
  db.prepare("DELETE FROM customer_return_rate_limits WHERE created_at < datetime('now', '-24 hours')").run();
  const result = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM customer_return_rate_limits
       WHERE ip_hash = ? AND created_at >= datetime('now', '-1 hour')`,
    )
    .get(ipHash) as { count: number };
  return result.count >= 5;
}

export function recordCustomerRequestAttempt(ipHash: string) {
  getDb().prepare("INSERT INTO customer_return_rate_limits (ip_hash) VALUES (?)").run(ipHash);
}

export function getCustomerReturnClaimStats() {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
         SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) AS in_review_count,
         SUM(CASE WHEN status IN ('resolved', 'rejected') THEN 1 ELSE 0 END) AS closed_count
       FROM customer_return_claims`,
    )
    .get() as { total: number; new_count: number | null; in_review_count: number | null; closed_count: number | null };

  return {
    total: row.total,
    new: row.new_count || 0,
    inReview: row.in_review_count || 0,
    closed: row.closed_count || 0,
  };
}

export function getOpenCustomerReturnClaimCount() {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM customer_return_claims
       WHERE status NOT IN ('resolved', 'rejected')`,
    )
    .get() as { count: number };
  return row.count;
}

export function updateCustomerReturnClaimStatus(id: string, status: ClaimStatus) {
  const result = getDb()
    .prepare(
      `UPDATE customer_return_claims
       SET status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(status, new Date().toISOString(), id);
  return result.changes > 0;
}

export function deleteCustomerReturnClaim(id: string) {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM customer_return_claims WHERE id = ?").get(id);
  if (!exists) return false;
  const files = db
    .prepare("SELECT stored_path FROM customer_return_files WHERE claim_id = ?")
    .all(id) as Array<{ stored_path: string }>;

  const result = db.transaction(() => db.prepare("DELETE FROM customer_return_claims WHERE id = ?").run(id))();
  if (result.changes === 0) return false;

  const storage = ensureStorage();
  const claimDirectory = path.join(storage.returnClaimFiles, id);
  const storageRoot = fs.realpathSync(storage.returnClaimFiles);
  for (const file of files) {
    const configuredPath = path.isAbsolute(file.stored_path)
      ? file.stored_path
      : path.resolve(storage.root, file.stored_path);
    try {
      const storedPath = fs.realpathSync(configuredPath);
      if (storedPath.startsWith(`${storageRoot}${path.sep}`)) fs.rmSync(storedPath, { force: true });
    } catch {
      // A missing legacy attachment should not prevent deleting the claim record.
    }
  }
  try {
    fs.rmSync(claimDirectory, { recursive: true, force: true });
  } catch (error) {
    console.error("Deleted reklamacija record, but failed to remove its files", { id, error });
  }
  return true;
}

export function resolveCustomerReturnFile(id: string) {
  const row = getDb()
    .prepare("SELECT * FROM customer_return_files WHERE id = ?")
    .get(id) as ClaimFileRow | undefined;
  if (!row) return null;

  const storage = ensureStorage();
  const configuredPath = path.isAbsolute(row.stored_path)
    ? row.stored_path
    : path.resolve(storage.root, row.stored_path);

  try {
    const storageRoot = fs.realpathSync(storage.returnClaimFiles);
    const storedPath = fs.realpathSync(configuredPath);
    if (storedPath !== storageRoot && !storedPath.startsWith(`${storageRoot}${path.sep}`)) return null;
    const stat = fs.statSync(storedPath);
    if (!stat.isFile()) return null;
    return {
      path: storedPath,
      originalName: row.original_name,
      mimeType: row.mime_type || "application/octet-stream",
      sizeBytes: stat.size,
    };
  } catch {
    return null;
  }
}
