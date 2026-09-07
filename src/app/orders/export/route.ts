import { NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { getActiveOrdersSheetRows, type SheetOrderRow } from "@/lib/google-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_HEADERS = [
  "Primalac",
  "Broj telefona",
  "Grad",
  "Adresa",
  "Artikal",
  "Broj paketa",
  "Otkupnina",
  "Vrijednost posiljke",
  "DOP",
  "Zamjena",
];

function toNumberOrOriginal(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return value;

  const number = Number(normalized);
  return Number.isFinite(number) ? number : value;
}

function toExportRow(order: SheetOrderRow) {
  return [
    order.primalac,
    order.brojTelefona,
    order.grad,
    order.adresa,
    order.artikal,
    toNumberOrOriginal(order.brojPaketa),
    toNumberOrOriginal(order.otkupnina),
    toNumberOrOriginal(order.vrijednostPosiljke),
    toNumberOrOriginal(order.dop),
    toNumberOrOriginal(order.zamjena),
  ];
}

export async function GET(request: NextRequest) {
  const dateLabel = request.nextUrl.searchParams.get("date")?.trim() ?? "";

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateLabel)) {
    return new Response("Datum za izvoz nije ispravan.", { status: 400 });
  }

  const rows = await getActiveOrdersSheetRows({ fresh: true });
  const orders = rows.filter((row) => row.dateLabel === dateLabel);

  if (orders.length === 0) {
    return new Response("Nema aktivnih narudžbi za izabrani datum.", { status: 404 });
  }

  const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...orders.map(toExportRow)]);
  worksheet["!cols"] = [
    { wch: 26 },
    { wch: 18 },
    { wch: 12 },
    { wch: 32 },
    { wch: 38 },
    { wch: 12 },
    { wch: 14 },
    { wch: 20 },
    { wch: 8 },
    { wch: 10 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Narudzbe");

  const output = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  });
  const filenameDate = dateLabel.split("/").reverse().join("-");

  return new Response(new Uint8Array(output), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="brza-posta-narudzbe-${filenameDate}.xlsx"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
