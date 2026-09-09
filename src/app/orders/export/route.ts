import * as XLSX from "xlsx";

import { markLastExportedOrder } from "@/lib/google-orders";
import { getActiveOrdersSheetRows, type SheetOrderRow } from "@/lib/google-sheets";
import { getLatestCompletedExportWindow } from "@/lib/order-workday";
import { normalizeTelegramPostalCode } from "@/lib/telegram-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_HEADERS = [
  "Naziv primaoca",
  "Adresa",
  "Postanski broj",
  "Broj telefona",
  "Otkupnina",
  "Broj paketa",
  "Vrijednost posiljke",
  "Ref br. 1",
  "Dozvoljeno otvaranje",
  "zamjenaska posiljka",
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
    order.adresa,
    toNumberOrOriginal(normalizeTelegramPostalCode(order.grad)),
    toNumberOrOriginal(order.brojTelefona),
    toNumberOrOriginal(order.otkupnina),
    toNumberOrOriginal(order.brojPaketa),
    toNumberOrOriginal(order.vrijednostPosiljke),
    order.artikal,
    toNumberOrOriginal(order.dop),
    Number(order.zamjena.trim().replace(",", ".")) === 0 ? "" : toNumberOrOriginal(order.zamjena),
  ];
}

export async function GET() {
  const window = getLatestCompletedExportWindow();
  const rows = await getActiveOrdersSheetRows({ fresh: true });
  const orders = rows
    .filter((row) => {
      const receivedAt = Date.parse(row.receivedAt);
      if (Number.isFinite(receivedAt)) return receivedAt >= window.start.getTime() && receivedAt < window.end.getTime();
      return row.dateLabel === window.endLabel;
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.receivedAt);
      const rightTime = Date.parse(right.receivedAt);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
      if (Number.isFinite(leftTime)) return 1;
      if (Number.isFinite(rightTime)) return -1;
      return left.sheetRowNumber - right.sheetRowNumber;
    });

  if (orders.length === 0) {
    return new Response(`Nema aktivnih narudžbi za ciklus ${window.startLabel} 08:00 - ${window.endLabel} 08:00.`, { status: 404 });
  }

  const missingPostalCodes = orders.filter((order) => !normalizeTelegramPostalCode(order.grad));
  if (missingPostalCodes.length > 0) {
    const names = missingPostalCodes.slice(0, 8).map((order) => order.primalac).join(", ");
    return new Response(`Nedostaje ZIP za: ${names}. Ispravi Grad u Orders sheetu pa ponovi export.`, { status: 422 });
  }

  const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...orders.map(toExportRow)]);
  worksheet["!cols"] = [
    { width: 21.85546875 },
    { width: 27.7109375 },
    { width: 17.85546875 },
    { width: 33.28515625 },
    { width: 12 },
    { width: 10.7109375 },
    { width: 17.42578125 },
    { width: 46.28515625 },
    { width: 22.140625 },
    { width: 27 },
  ];
  worksheet["!rows"] = [{ hpt: 21 }, ...orders.map(() => ({ hpt: 15.75 }))];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  const output = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  });
  await markLastExportedOrder(
    orders.at(-1)!.sheetRowNumber,
    window.marker,
    `${window.startLabel} 08:00 - ${window.endLabel} 08:00`,
  );

  const filenameDate = window.endLabel.split("/").reverse().join("-");

  return new Response(new Uint8Array(output), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="IMPORT-ELKO-${filenameDate}.xlsx"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
