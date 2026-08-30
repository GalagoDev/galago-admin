import { google } from "googleapis";

import { getGoogleServiceAccountCredentials } from "@/lib/google-auth";
import { invalidateSheetCache } from "@/lib/google-sheets";

const SHEET_NAME = "Orders";
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
const TRAILING_EMPTY_ROWS = 5;
const WORKDAY_TIME_ZONE = "Europe/Sarajevo";

type OrderSheetInput = {
  primalac: string;
  brojTelefona: string;
  grad: string;
  adresa: string;
  artikal: string;
  brojPaketa?: string;
  otkupnina?: string;
  vrijednostPosiljke?: string;
  dop?: string;
  zamjena?: string;
};

type AppendOrderOptions = {
  sourceId?: string;
};

function formatSheetDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: WORKDAY_TIME_ZONE,
  }).format(date);
}

function getTargetWorkdayLabel() {
  const date = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: WORKDAY_TIME_ZONE,
  }).format(date);

  if (weekday === "Sat") {
    date.setDate(date.getDate() + 2);
  } else if (weekday === "Sun") {
    date.setDate(date.getDate() + 1);
  }

  return formatSheetDateLabel(date);
}

function indexIsSheetDateRow(index: number, value: string) {
  return index > 0 && /^\d{2}\/\d{2}\/\d{4}$/.test(value);
}

function rowHasValue(row: unknown[]) {
  return row.some((cell) => (cell ?? "").toString().trim() !== "");
}

function findNextDateRowIndex(rows: unknown[][], dateRowIndex: number) {
  return rows.findIndex((row, index) => index > dateRowIndex && indexIsSheetDateRow(index, (row[0] ?? "").toString().trim()));
}

function analyzeDateBlock(rows: unknown[][], dateRowIndex: number) {
  const nextDateRowIndex = findNextDateRowIndex(rows, dateRowIndex);
  const blockEndIndex = nextDateRowIndex === -1 ? Math.max(rows.length - 1, dateRowIndex) : nextDateRowIndex - 1;
  let lastFilledIndex = dateRowIndex;

  for (let index = dateRowIndex + 1; index <= blockEndIndex; index += 1) {
    const row = rows[index] ?? [];
    if (rowHasValue(row)) lastFilledIndex = index;
  }

  let trailingEmptyRows = 0;
  for (let index = blockEndIndex; index > lastFilledIndex; index -= 1) {
    const row = rows[index] ?? [];
    if (!rowHasValue(row)) {
      trailingEmptyRows += 1;
    } else {
      break;
    }
  }

  return {
    nextDateRowIndex,
    blockEndIndex,
    lastFilledIndex,
    trailingEmptyRows,
  };
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

async function getOrdersSheetId(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.sheetId,sheets.properties.title",
  });

  const sheet = spreadsheet.data.sheets?.find((entry) => entry.properties?.title === SHEET_NAME);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Sheet not found: ${SHEET_NAME}`);
  }

  return sheetId;
}

async function insertRows(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string, sheetId: number, rowIndex: number, count: number) {
  if (count <= 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndex,
              endIndex: rowIndex + count,
            },
            inheritFromBefore: rowIndex > 0,
          },
        },
      ],
    },
  });
}

async function createOrdersDateBlock(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string, sheetId: number, dateLabel: string) {
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
              endIndex: 8,
            },
            inheritFromBefore: true,
          },
        },
        {
          updateCells: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 8,
              startColumnIndex: 0,
              endColumnIndex: HEADER.length,
            },
            fields: "userEnteredValue",
          },
        },
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: 2,
              endRowIndex: 3,
              startColumnIndex: 0,
              endColumnIndex: HEADER.length,
            },
            mergeType: "MERGE_ALL",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 2,
              endRowIndex: 3,
              startColumnIndex: 0,
              endColumnIndex: HEADER.length,
            },
            cell: {
              userEnteredValue: { stringValue: dateLabel },
              userEnteredFormat: {
                backgroundColor: { red: 0.85882354, green: 0.91764706, blue: 0.99607843 },
                horizontalAlignment: "LEFT",
                textFormat: {
                  bold: true,
                  fontSize: 11,
                  foregroundColor: { red: 0.2, green: 0.25490198, blue: 0.33333334 },
                },
              },
            },
            fields: "userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 3,
              endRowIndex: 8,
              startColumnIndex: 0,
              endColumnIndex: HEADER.length,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 1, green: 1, blue: 1 },
                textFormat: {
                  bold: false,
                  fontSize: 10,
                  foregroundColor: { red: 0.06666667, green: 0.09411765, blue: 0.15294118 },
                },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 3,
              endRowIndex: 8,
              startColumnIndex: 0,
              endColumnIndex: HEADER.length,
            },
            top: { style: "SOLID", color: { red: 0.81960785, green: 0.8352941, blue: 0.85882354 } },
            bottom: { style: "SOLID", color: { red: 0.81960785, green: 0.8352941, blue: 0.85882354 } },
            left: { style: "SOLID", color: { red: 0.81960785, green: 0.8352941, blue: 0.85882354 } },
            right: { style: "SOLID", color: { red: 0.81960785, green: 0.8352941, blue: 0.85882354 } },
          },
        },
      ],
    },
  });
}

export async function appendOrderToOrdersSheet(input: OrderSheetInput, options: AppendOrderOptions = {}) {
  const { sheets, spreadsheetId } = getSheetsClient();
  const targetDate = getTargetWorkdayLabel();
  const sourceId = String(options.sourceId || "").trim().slice(0, 220);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:Z`,
  });

  const rows = response.data.values ?? [];
  if (rows.length === 0) {
    throw new Error("Orders sheet is empty. Run Apps Script layout first.");
  }

  const header = rows[0] ?? [];
  const headerOk = HEADER.every((value, index) => (header[index] ?? "") === value);
  if (!headerOk) {
    throw new Error("Orders sheet header does not match expected layout.");
  }

  if (sourceId) {
    const existingRowIndex = rows.findIndex((row, index) => index > 0 && String(row[10] || "").trim() === sourceId);
    if (existingRowIndex !== -1) {
      return { created: false, sheetRowNumber: existingRowIndex + 1, sheetOrderId: sourceId };
    }
  }

  const sheetId = await getOrdersSheetId(sheets, spreadsheetId);
  let sheetRows = rows;
  let dateRowIndex = sheetRows.findIndex((row, index) => index > 0 && (row[0] ?? "").toString().trim() === targetDate);
  if (dateRowIndex === -1) {
    await createOrdersDateBlock(sheets, spreadsheetId, sheetId, targetDate);

    const refreshed = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A:Z`,
    });
    sheetRows = refreshed.data.values ?? [];
    dateRowIndex = sheetRows.findIndex((row, index) => index > 0 && (row[0] ?? "").toString().trim() === targetDate);
    if (dateRowIndex === -1) {
      throw new Error(`Workday block (${targetDate}) was not found in Orders sheet.`);
    }
  }

  const block = analyzeDateBlock(sheetRows, dateRowIndex);
  let targetRowIndex = block.lastFilledIndex + 1;
  let insertedTargetRow = false;

  if (block.nextDateRowIndex !== -1 && targetRowIndex >= block.nextDateRowIndex) {
    await insertRows(sheets, spreadsheetId, sheetId, block.nextDateRowIndex, 1);
    targetRowIndex = block.nextDateRowIndex;
    insertedTargetRow = true;
  }

  const targetInsideCurrentBlock = targetRowIndex <= block.blockEndIndex;
  const blankRowsAfterTarget = targetInsideCurrentBlock ? block.blockEndIndex - targetRowIndex : 0;
  const missingEmptyRows = TRAILING_EMPTY_ROWS - blankRowsAfterTarget;

  if (targetInsideCurrentBlock || insertedTargetRow) {
    const insertAt = targetInsideCurrentBlock ? block.blockEndIndex + 1 : targetRowIndex + 1;
    await insertRows(sheets, spreadsheetId, sheetId, insertAt, missingEmptyRows);
  } else {
    await insertRows(sheets, spreadsheetId, sheetId, targetRowIndex, TRAILING_EMPTY_ROWS + 1);
  }

  const values = [[
    input.primalac || "",
    input.brojTelefona || "",
    input.grad || "",
    input.adresa || "",
    input.artikal || "",
    input.brojPaketa || "",
    input.otkupnina || "",
    input.vrijednostPosiljke || "",
    input.dop || "",
    input.zamjena || "",
    sourceId,
  ]];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A${targetRowIndex + 1}:K${targetRowIndex + 1}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  invalidateSheetCache(SHEET_NAME);
  return { created: true, sheetRowNumber: targetRowIndex + 1, sheetOrderId: sourceId };
}

export async function deleteOrderFromOrdersSheet(sheetOrderId: string) {
  const orderId = String(sheetOrderId || "").trim();
  if (!orderId) throw new Error("Telegram order ID is missing.");

  const { sheets, spreadsheetId } = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:K`,
  });
  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[10] || "").trim() === orderId);
  if (rowIndex === -1) return false;

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A${rowIndex + 1}:K${rowIndex + 1}`,
  });
  invalidateSheetCache(SHEET_NAME);
  return true;
}
