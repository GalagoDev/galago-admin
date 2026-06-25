import { getDb } from "@/lib/db";

export function getUndeliveredOrders(limit = 12) {
  const db = getDb();

  return db
    .prepare(
      `SELECT s.id, s.customer_name, s.phone, s.city, s.address, s.product_summary, s.quantity, s.notes, s.created_at
       FROM orders s
       WHERE s.status = 'sent'
         AND NOT EXISTS (
           SELECT 1
           FROM orders d
           WHERE d.status = 'delivered'
             AND (
               (s.phone IS NOT NULL AND s.phone != '' AND d.phone = s.phone)
               OR (
                 s.customer_name IS NOT NULL AND s.customer_name != ''
                 AND d.customer_name = s.customer_name
               )
             )
         )
       ORDER BY datetime(s.created_at) DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
      id: number;
      customer_name: string | null;
      phone: string | null;
      city: string | null;
      address: string | null;
      product_summary: string | null;
      quantity: number | null;
      notes: string | null;
      created_at: string;
    }>;
}

export function getAllUndeliveredOrders() {
  const db = getDb();

  return db
    .prepare(
      `SELECT s.id, s.customer_name, s.phone, s.city, s.address, s.product_summary, s.quantity, s.notes, s.created_at
       FROM orders s
       WHERE s.status = 'sent'
         AND NOT EXISTS (
           SELECT 1
           FROM orders d
           WHERE d.status = 'delivered'
             AND (
               (s.phone IS NOT NULL AND s.phone != '' AND d.phone = s.phone)
               OR (
                 s.customer_name IS NOT NULL AND s.customer_name != ''
                 AND d.customer_name = s.customer_name
               )
             )
         )
       ORDER BY datetime(s.created_at) DESC`
    )
    .all() as Array<{
      id: number;
      customer_name: string | null;
      phone: string | null;
      city: string | null;
      address: string | null;
      product_summary: string | null;
      quantity: number | null;
      notes: string | null;
      created_at: string;
    }>;
}
