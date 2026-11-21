import * as XLSX from "xlsx";

import { markLastExportedOrder } from "@/lib/google-orders";
import { getOrdersSheetRows, getReturnedSheetRows, isActiveOrderRow, type SheetOrderRow } from "@/lib/google-sheets";
import { assessOrderRisks, unresolvedOrderRisks } from "@/lib/order-risk";
import { getExpressOneReturnRiskContacts } from "@/lib/expressone-returns";
import { getOperationalExportWindow, isOrderInOperationalExportWindow } from "@/lib/order-workday";
import { normalizeTelegramPostalCode } from "@/lib/telegram-orders";
import { isUsableOrderPhone, normalizeOrderPhone } from "@/lib/order-phone";

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
    normalizeOrderPhone(order.brojTelefona),
    toNumberOrOriginal(order.otkupnina),
    toNumberOrOriginal(order.brojPaketa),
    toNumberOrOriginal(order.vrijednostPosiljke),
    order.artikal,
    toNumberOrOriginal(order.dop),
    Number(order.zamjena.trim().replace(",", ".")) === 0 ? "" : toNumberOrOriginal(order.zamjena),
  ];
}

const RESPONSE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Accept" };
const REVIEW_PATH = "/orders?view=export&exportError=review&refresh=1#risk-alerts";

function exportError(request: Request, error: string, status: number) {
  return request.headers.get("Accept")?.includes("application/json")
    ? Response.json({ error }, { status, headers: RESPONSE_HEADERS })
    : new Response(error, { status, headers: RESPONSE_HEADERS });
}

async function createExport(request: Request) {
  const window = getOperationalExportWindow();
  const [rows, returnedRows] = await Promise.all([
    getOrdersSheetRows({ fresh: true }),
    getReturnedSheetRows({ fresh: true }),
  ]);
  const orders = rows
    .filter(isActiveOrderRow)
    .filter((row) => isOrderInOperationalExportWindow(row, window));

  if (orders.length === 0) {
    return exportError(request, `Nema aktivnih narudžbi za ciklus ${window.startLabel} 08:00 - ${window.endLabel} 08:00.`, 404);
  }

  const unresolvedRisks = unresolvedOrderRisks(assessOrderRisks(orders, rows, returnedRows, new Date(), getExpressOneReturnRiskContacts()));
  if (unresolvedRisks.length > 0) {
    return request.headers.get("Accept")?.includes("application/json")
      ? Response.json({ redirect: REVIEW_PATH }, { status: 409, headers: RESPONSE_HEADERS })
      : new Response(null, { status: 303, headers: { ...RESPONSE_HEADERS, Location: REVIEW_PATH } });
  }

  const missingPostalCodes = orders.filter((order) => !normalizeTelegramPostalCode(order.grad));
  if (missingPostalCodes.length > 0) {
    const names = missingPostalCodes.slice(0, 8).map((order) => order.primalac).join(", ");
    return exportError(request, `Nedostaje ZIP za: ${names}. Ispravi Grad u Orders sheetu pa ponovi export.`, 422);
  }

  const invalidPhones = orders.filter(order => !isUsableOrderPhone(order.brojTelefona));
  if (invalidPhones.length) {
    const buyers = invalidPhones.map(order => `${order.primalac} (red ${order.sheetRowNumber})`);
    return exportError(request, `Provjeri telefon: ${buyers.join(", ")}. Ispravi broj u Orders sheetu pa ponovi export.`, 422);
  }

  const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...orders.map(toExportRow)]);
  // Phone identifiers must survive Excel display, resaving and courier import as literal digits.
  for (let i = 0; i < orders.length; i++) worksheet[`D${i + 2}`].z = "@";
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
      ...RESPONSE_HEADERS,
      "Content-Disposition": `attachment; filename="IMPORT-ELKO-${filenameDate}.xlsx"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const response = await createExport(request);
    console.info("Order export response", { status: response.status, durationMs: Date.now() - startedAt });
    return response;
  } catch (error) {
    // Google errors can contain credentials and sheet data; log only safe diagnostics.
    const failure = error as { code?: string | number; response?: { status?: number } } | null;
    console.error("Order export failed", {
      status: failure?.response?.status,
      code: failure?.code,
      durationMs: Date.now() - startedAt,
    });
    return exportError(request, "Excel nije preuzet jer priprema ili upis oznake u Google Sheets nije uspio. Pokušajte ponovo.", 503);
  }
}
