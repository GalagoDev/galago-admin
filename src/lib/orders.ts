import { getDb } from "@/lib/db";

export function getRecentOrders(limit = 8) {
  const db = getDb();

  return db
    .prepare(
      `SELECT id, source, customer_name, phone, city, address, product_summary, quantity, status, notes, created_at
       FROM orders
       WHERE status = 'incoming'
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
      id: number;
      source: string;
      customer_name: string | null;
      phone: string | null;
      city: string | null;
      address: string | null;
      product_summary: string | null;
      quantity: number | null;
      status: string;
      notes: string | null;
      created_at: string;
    }>;
}

export function getOrdersByStatus(status: string, limit = 24) {
  const db = getDb();

  return db
    .prepare(
      `SELECT id, source, customer_name, phone, city, address, product_summary, quantity, notes, raw_text, status, created_at
       FROM orders
       WHERE status = ?
       ORDER BY datetime(created_at) DESC
       LIMIT ?`
    )
    .all(status, limit) as Array<{
      id: number;
      source: string;
      customer_name: string | null;
      phone: string | null;
      city: string | null;
      address: string | null;
      product_summary: string | null;
      quantity: number | null;
      notes: string | null;
      raw_text: string | null;
      status: string;
      created_at: string;
    }>;
}
