import { google, sheets_v4 } from "googleapis";

import { getGoogleServiceAccountCredentials } from "@/lib/google-auth";
import { createOrderFingerprint } from "@/lib/order-fingerprint";

export type SheetOrderRow = {
  rowNumber: number;
  sheetRowNumber: number;
  fingerprint: string;
  dateLabel: string;
  primalac: string;
  brojTelefona: string;
  grad: string;
  adresa: string;
  artikal: string;
  brojPaketa: string;
  otkupnina: string;
  vrijednostPosiljke: string;
  dop: string;
  zamjena: string;
};

export type UndeliveredSheetRow = SheetOrderRow;

const SHEET_NAME = "Undelivered orders";
const HEADER = [
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

const SHEET_CACHE_TTL_MS = 300_000;
const sheetRowsCache = new Map<string, { expiresAt: number; data: SheetOrderRow[] }>();
const sheetRowsInFlight = new Map<string, Promise<SheetOrderRow[]>>();

export function invalidateSheetCache(sheetName?: string) {
  if (sheetName) {
    sheetRowsCache.delete(sheetName);
    sheetRowsInFlight.delete(sheetName);
    return;
  }

  sheetRowsCache.clear();
  sheetRowsInFlight.clear();
}

function getCachedSheetRows(sheetName: string) {
  const cached = sheetRowsCache.get(sheetName);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    sheetRowsCache.delete(sheetName);
    return null;
  }
  return cached.data;
}

function setCachedSheetRows(sheetName: string, data: SheetOrderRow[]) {
  sheetRowsCache.set(sheetName, {
    expiresAt: Date.now() + SHEET_CACHE_TTL_MS,
    data,
  });
}

function getTodayLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function getSheetsClient() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (!spreadsheetId) {
    throw new Error("Google Sheets is not configured.");
  }

  const credentials = getGoogleServiceAccountCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return {
    spreadsheetId,
    sheets: google.sheets({ version: "v4", auth }),
  };
}

async function getSheetId(sheets: sheets_v4.Sheets, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === SHEET_NAME);
  return sheet?.properties?.sheetId ?? 0;
}

async function styleSheetHeader(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetId: number) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.94, green: 0.96, blue: 0.99 },
                textFormat: {
                  foregroundColor: { red: 0.20, green: 0.24, blue: 0.30 },
                  bold: true,
                  fontSize: 11,
                },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
      ],
    },
  });
}

async function styleDateRow(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetId: number, rowNumber: number) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.80, green: 0.87, blue: 0.97 },
                textFormat: {
                  foregroundColor: { red: 0.18, green: 0.22, blue: 0.30 },
                  bold: true,
                  fontSize: 11,
                },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
      ],
    },
  });
}

export async function ensureTodayBlockAtTop() {
  invalidateSheetCache("Undelivered orders");
  const { sheets, spreadsheetId } = getSheetsClient();
  const today = getTodayLabel();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:Z`,
  });
  const rows = response.data.values ?? [];

  const existingDateRow = rows.findIndex((row, index) => index > 0 && (row[0] ?? "").toString().trim() === today);
  const sheetId = await getSheetId(sheets, spreadsheetId);

  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:J2`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER, [today, "", "", "", "", "", "", "", "", ""]] },
    });
    await styleSheetHeader(sheets, spreadsheetId, sheetId);
    await styleDateRow(sheets, spreadsheetId, sheetId, 2);
    return;
  }

  const firstHeader = rows[0] ?? [];
  const headerOk = HEADER.every((value, index) => (firstHeader[index] ?? "") === value);
  if (!headerOk) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A1:J1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER] },
    });
  }
  await styleSheetHeader(sheets, spreadsheetId, sheetId);

  if (existingDateRow === 1) {
    await styleDateRow(sheets, spreadsheetId, sheetId, 2);
    return;
  }

  if (existingDateRow > 1) {
    // leave existing historic block in place; just style header/top. user wants newest on top moving forward
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: 1,
              endIndex: 2,
            },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A2:J2`,
    valueInputOption: "RAW",
    requestBody: { values: [[today, "", "", "", "", "", "", "", "", ""]] },
  });
  await styleDateRow(sheets, spreadsheetId, sheetId, 2);
}

export async function getSheetRowsByName(sheetName: string, options: { fresh?: boolean } = {}) {
  if (options.fresh) invalidateSheetCache(sheetName);
  const cached = getCachedSheetRows(sheetName);
  if (cached) return cached;

  const existingRequest = sheetRowsInFlight.get(sheetName);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const { sheets, spreadsheetId } = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:J`,
    });

    const rows = response.data.values ?? [];
    const result: SheetOrderRow[] = [];
    let currentDate = "";
    let rowNumber = 0;

    for (const [sourceIndex, row] of rows.slice(1).entries()) {
      const cells = row.map((cell) => (cell ?? "").toString().trim());
      const filled = cells.filter(Boolean);
      if (filled.length === 0) continue;

      if (filled.length === 1 && /^\d{2}\/\d{2}\/\d{4}$/.test(cells[0] ?? "")) {
        currentDate = cells[0] ?? "";
        continue;
      }

      rowNumber += 1;
      const order = {
        rowNumber,
        sheetRowNumber: sourceIndex + 2,
        dateLabel: currentDate,
        primalac: cells[0] ?? "",
        brojTelefona: cells[1] ?? "",
        grad: cells[2] ?? "",
        adresa: cells[3] ?? "",
        artikal: cells[4] ?? "",
        brojPaketa: cells[5] ?? "",
        otkupnina: cells[6] ?? "",
        vrijednostPosiljke: cells[7] ?? "",
        dop: cells[8] ?? "",
        zamjena: cells[9] ?? "",
      };
      result.push({
        ...order,
        fingerprint: createOrderFingerprint(order),
      });
    }

    setCachedSheetRows(sheetName, result);
    return result;
  })();

  sheetRowsInFlight.set(sheetName, request);

  try {
    return await request;
  } finally {
    sheetRowsInFlight.delete(sheetName);
  }
}

export async function getUndeliveredSheetRows(options: { fresh?: boolean } = {}) {
  return getSheetRowsByName("Undelivered orders", options);
}

export async function getOrdersSheetRows() {
  return getSheetRowsByName("Orders");
}

export async function getReturnedSheetRows() {
  return getSheetRowsByName("Povrati");
}
