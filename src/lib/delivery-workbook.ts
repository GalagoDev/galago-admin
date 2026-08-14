import { readSheet } from "read-excel-file/node";

import type { CourierDeliveryRow } from "@/lib/order-matching";

const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function amount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(text(value).replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function parseCourierDeliveryWorkbook(file: File): Promise<CourierDeliveryRow[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Odaberite Excel .xlsx dokument.");
  }
  if (file.size === 0) throw new Error("Excel dokument je prazan.");
  if (file.size > MAX_WORKBOOK_BYTES) throw new Error("Excel dokument može imati najviše 5 MB.");

  const rows = await readSheet(Buffer.from(await file.arrayBuffer()));
  const headerRowIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "primaoc"));
  if (headerRowIndex === -1) throw new Error("Kolona 'primaoc' nije pronađena u dokumentu.");

  const headers = rows[headerRowIndex].map(normalizeHeader);
  const recipientIndex = headers.indexOf("primaoc");
  const cityIndex = headers.indexOf("primaoc_mjesto");
  const amountIndex = headers.indexOf("iznos_otk");
  const productIndex = headers.indexOf("ref1");

  const deliveries: CourierDeliveryRow[] = [];
  for (const [index, row] of rows.slice(headerRowIndex + 1).entries()) {
    const recipient = text(row[recipientIndex]);
    if (!recipient) continue;

    deliveries.push({
      sourceRowNumber: headerRowIndex + index + 2,
      recipient,
      city: cityIndex >= 0 ? text(row[cityIndex]) : "",
      amount: amountIndex >= 0 ? amount(row[amountIndex]) : null,
      product: productIndex >= 0 ? text(row[productIndex]) : "",
    });
    if (deliveries.length > 500) throw new Error("Dokument može sadržavati najviše 500 kupaca.");
  }

  if (deliveries.length === 0) throw new Error("Dokument ne sadrži kupce za obradu.");
  return deliveries;
}
