import { getDb } from "@/lib/db";

export function getRecentDocuments(limit = 6) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, type, original_name, stored_name, uploaded_at
       FROM documents
       ORDER BY datetime(uploaded_at) DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
      id: number;
      type: string;
      original_name: string;
      stored_name: string;
      uploaded_at: string;
    }>;
}

export function getDocumentSummaries(limit = 10) {
  const db = getDb();
  return db
    .prepare(
      `SELECT d.id, d.type, d.original_name, d.uploaded_at, COUNT(o.id) as row_count,
              COALESCE(SUM(CASE WHEN o.status = 'sent' THEN o.quantity ELSE 0 END), 0) as total_amount
       FROM documents d
       LEFT JOIN orders o ON o.document_id = d.id
       GROUP BY d.id, d.type, d.original_name, d.uploaded_at
       ORDER BY datetime(d.uploaded_at) DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
      id: number;
      type: string;
      original_name: string;
      uploaded_at: string;
      row_count: number;
      total_amount: number;
    }>;
}
