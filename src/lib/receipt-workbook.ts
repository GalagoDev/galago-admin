import { isExcelWorkbook } from "@/lib/excel-file";
import { readFirstWorksheet } from "@/lib/excel-workbook";

const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;

export type ReceiptWorkbookRow = {
  sourceRowNumber: number;
  shipmentDateSort: number;
  shipmentDateLabel: string;
  recipient: string;
  city: string;
  amount: number | null;
  reference: string;
};

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

function parseShipmentDate(value: unknown) {
  let date: Date;
  if (value instanceof Date) {
    date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  } else if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
  } else {
    const raw = text(value);
    const localDate = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
    if (localDate) {
      const day = Number(localDate[1]);
      const month = Number(localDate[2]);
      const rawYear = Number(localDate[3]);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    } else {
      date = new Date(raw);
    }
  }
  if (Number.isNaN(date.getTime())) return null;
  return {
    sort: date.getTime(),
    label: new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
  };
}

export async function parseReceiptWorkbook(file: File): Promise<ReceiptWorkbookRow[]> {
  if (!isExcelWorkbook(file.name)) {
    throw new Error("Odaberite Excel .xls ili .xlsx dokument.");
  }
  if (file.size === 0) throw new Error("Excel dokument je prazan.");
  if (file.size > MAX_WORKBOOK_BYTES) throw new Error("Excel dokument može imati najviše 5 MB.");

  const rows = await readFirstWorksheet(file);
  const headerRowIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell) === "primaoc"));
  if (headerRowIndex === -1) throw new Error("Kolona 'primaoc' nije pronađena u dokumentu.");

  const headers = rows[headerRowIndex].map(normalizeHeader);
  const requiredHeaders = ["datum_slanja", "primaoc", "primaoc_mjesto", "iznos_otk", "ref1"];
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) throw new Error(`Kolona '${header}' nije pronađena u dokumentu.`);
  }

  const dateIndex = headers.indexOf("datum_slanja");
  const recipientIndex = headers.indexOf("primaoc");
  const cityIndex = headers.indexOf("primaoc_mjesto");
  const amountIndex = headers.indexOf("iznos_otk");
  const referenceIndex = headers.indexOf("ref1");

  const result: ReceiptWorkbookRow[] = [];
  for (const [index, row] of rows.slice(headerRowIndex + 1).entries()) {
    const recipient = text(row[recipientIndex]);
    if (!recipient) continue;
    const sourceRowNumber = headerRowIndex + index + 2;
    const shipmentDate = parseShipmentDate(row[dateIndex]);
    if (!shipmentDate) throw new Error(`Red ${sourceRowNumber} nema ispravan datum_slanja.`);

    result.push({
      sourceRowNumber,
      shipmentDateSort: shipmentDate.sort,
      shipmentDateLabel: shipmentDate.label,
      recipient,
      city: text(row[cityIndex]),
      amount: amount(row[amountIndex]),
      reference: text(row[referenceIndex]),
    });
    if (result.length > 500) throw new Error("Dokument može sadržavati najviše 500 kupaca.");
  }

  if (result.length === 0) throw new Error("Dokument ne sadrži kupce za obradu.");
  return result.sort((a, b) => a.shipmentDateSort - b.shipmentDateSort || a.sourceRowNumber - b.sourceRowNumber);
}
