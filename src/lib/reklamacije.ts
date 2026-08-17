import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";
import { ensureStorage } from "@/lib/storage";

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
  status: string;
  createdAt: string;
  updatedAt: string;
  files: ClaimFile[];
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
           ORDER BY
             CASE status WHEN 'new' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END,
             datetime(created_at) DESC
           LIMIT 500`,
        )
        .all(...Array(5).fill(`%${search}%`))
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
