import { google } from "googleapis";

import { getGoogleServiceAccountCredentials } from "@/lib/google-auth";
import { parseSheetDateLabel } from "@/lib/sheet-dates";

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

function getTodayLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
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

export async function appendOrderToOrdersSheet(input: OrderSheetInput) {
  const { sheets, spreadsheetId } = getSheetsClient();
  const today = getTodayLabel();

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

  let dateRowIndex = rows.findIndex((row, index) => index > 0 && (row[0] ?? "").toString().trim() === today);
  if (dateRowIndex === -1) {
    const latestDateRow = rows
      .map((row, index) => ({ index, dateLabel: (row[0] ?? "").toString().trim() }))
      .filter((row) => indexIsSheetDateRow(row.index, row.dateLabel))
      .sort((a, b) => parseSheetDateLabel(b.dateLabel) - parseSheetDateLabel(a.dateLabel))[0];

    if (!latestDateRow) {
      throw new Error(`Today's block (${today}) was not found in Orders sheet.`);
    }

    dateRowIndex = latestDateRow.index;
  }

  const sheetId = await getOrdersSheetId(sheets, spreadsheetId);
  const block = analyzeDateBlock(rows, dateRowIndex);
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
  ]];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A${targetRowIndex + 1}:J${targetRowIndex + 1}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
