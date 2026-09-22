import "server-only";

import { createHash } from "node:crypto";
import { google } from "googleapis";

import { getGoogleServiceAccountCredentials } from "@/lib/google-auth";
import { invalidateSheetCache } from "@/lib/google-sheets";
import { createOrderFingerprint, type OrderIdentity } from "@/lib/order-fingerprint";

const SOURCE_SHEET = "Orders";
const DELIVERED_SHEET = "Delivered orders";
const RETURNS_SHEET = "Povrati";
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
const STATUS_ID_HEADER = "Status ID";
const SOURCE_STATUS_HEADER = "App status";
const SOURCE_STATUS_COLUMN_NUMBER = 12;
const SOURCE_STATUS_CELL_INDEX = SOURCE_STATUS_COLUMN_NUMBER - 1;
const STATUS_COLUMNS = [...HEADER, STATUS_ID_HEADER];
const TRAILING_EMPTY_ROWS = 5;
const WORKDAY_TIME_ZONE = "Europe/Sarajevo";

export type OrderMoveReference = {
  sheetRowNumber: number;
  fingerprint: string;
  dateLabel: string;
};

type StatusDestination = typeof DELIVERED_SHEET | typeof RETURNS_SHEET;

let moveQueue: Promise<unknown> = Promise.resolve();

function getSheetsClient() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error("Google Sheets is not configured.");

  const auth = new google.auth.GoogleAuth({
    credentials: getGoogleServiceAccountCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return {
    spreadsheetId,
    sheets: google.sheets({ version: "v4", auth }),
  };
}

function targetWorkdayLabel() {
  const date = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: WORKDAY_TIME_ZONE,
  }).format(date);
  if (weekday === "Sat") date.setDate(date.getDate() + 2);
  if (weekday === "Sun") date.setDate(date.getDate() + 1);

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: WORKDAY_TIME_ZONE,
  }).format(date);
}

function isDateRow(index: number, value: unknown) {
  return index > 0 && /^\d{2}\/\d{2}\/\d{4}$/.test(String(value ?? "").trim());
}

function rowHasValue(row: unknown[]) {
  return row.some((cell) => String(cell ?? "").trim() !== "");
}

function analyzeDateBlock(rows: unknown[][], dateRowIndex: number) {
  const nextDateRowIndex = rows.findIndex((row, index) => index > dateRowIndex && isDateRow(index, row[0]));
  const blockEndIndex = nextDateRowIndex === -1 ? Math.max(rows.length - 1, dateRowIndex) : nextDateRowIndex - 1;
  let lastFilledIndex = dateRowIndex;

  for (let index = dateRowIndex + 1; index <= blockEndIndex; index += 1) {
    if (rowHasValue(rows[index] ?? [])) lastFilledIndex = index;
  }

  return { nextDateRowIndex, blockEndIndex, lastFilledIndex };
}

function rawOrderIdentity(row: unknown[]): OrderIdentity {
  const cells = row.map((cell) => String(cell ?? "").trim());
  return {
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
}

function orderIdentityValues(identity: OrderIdentity) {
  return [
    identity.primalac,
    identity.brojTelefona,
    identity.grad,
    identity.adresa,
    identity.artikal,
    identity.brojPaketa,
    identity.otkupnina,
    identity.vrijednostPosiljke,
    identity.dop,
    identity.zamjena,
  ];
}

function dateLabelForRow(rows: unknown[][], rowIndex: number) {
  for (let index = rowIndex - 1; index > 0; index -= 1) {
    if (isDateRow(index, rows[index]?.[0])) return String(rows[index]?.[0] ?? "").trim();
  }
  return "";
}

function transitionId(destination: StatusDestination, reference: OrderMoveReference) {
  return createHash("sha256")
    .update(`${SOURCE_SHEET}\u001f${destination}\u001f${reference.sheetRowNumber}\u001f${reference.dateLabel}\u001f${reference.fingerprint}`)
    .digest("hex")
    .slice(0, 32);
}

async function ensureStatusSheet(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: StatusDestination,
) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.sheetId,sheets.properties.title",
  });
  let sheetId = metadata.data.sheets?.find((sheet) => sheet.properties?.title === sheetName)?.properties?.sheetId;

  if (sheetId === undefined || sheetId === null) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName, gridProperties: { columnCount: 11 } } } }],
      },
    });
    sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
  }

  if (sheetId === undefined || sheetId === null) throw new Error(`Unable to create sheet: ${sheetName}`);

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A1:K1`,
  });
  const currentHeader = headerResponse.data.values?.[0] ?? [];
  const hasHeaderValues = currentHeader.some((value) => String(value ?? "").trim() !== "");

  if (hasHeaderValues) {
    const headerMatches = HEADER.every((value, index) => String(currentHeader[index] ?? "").trim() === value);
    if (!headerMatches) throw new Error(`${sheetName} header does not match the order layout.`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1:K1`,
    valueInputOption: "RAW",
    requestBody: { values: [STATUS_COLUMNS] },
  });

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
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.94, green: 0.96, blue: 0.99 },
                textFormat: { foregroundColor: { red: 0.2, green: 0.24, blue: 0.3 }, bold: true, fontSize: 11 },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 10, endIndex: 11 },
            properties: { hiddenByUser: true },
            fields: "hiddenByUser",
          },
        },
      ],
    },
  });

  return sheetId;
}

async function ensureSourceStatusColumn(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.sheetId,sheets.properties.title,sheets.properties.gridProperties.columnCount",
  });
  const sourceSheet = metadata.data.sheets?.find((sheet) => sheet.properties?.title === SOURCE_SHEET);
  const sheetId = sourceSheet?.properties?.sheetId;
  const columnCount = sourceSheet?.properties?.gridProperties?.columnCount ?? 0;
  if (sheetId === undefined || sheetId === null) throw new Error(`Sheet not found: ${SOURCE_SHEET}`);

  if (columnCount < SOURCE_STATUS_COLUMN_NUMBER) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          appendDimension: {
            sheetId,
            dimension: "COLUMNS",
            length: SOURCE_STATUS_COLUMN_NUMBER - columnCount,
          },
        }],
      },
    });
  }

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SOURCE_SHEET}'!L1`,
  });
  const currentHeader = String(headerResponse.data.values?.[0]?.[0] ?? "").trim();
  if (currentHeader && currentHeader !== SOURCE_STATUS_HEADER) {
    throw new Error(`${SOURCE_SHEET} column L is already in use.`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SOURCE_SHEET}'!L1`,
    valueInputOption: "RAW",
    requestBody: { values: [[SOURCE_STATUS_HEADER]] },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: 10, endIndex: 12 },
          properties: { hiddenByUser: true },
          fields: "hiddenByUser",
        },
      }],
    },
  });
}

async function insertRows(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetId: number,
  rowIndex: number,
  count: number,
) {
  if (count <= 0) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        insertDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + count },
          inheritFromBefore: rowIndex > 0,
        },
      }],
    },
  });
}

async function createDateBlock(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetId: number,
  dateLabel: string,
) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 8 },
            inheritFromBefore: true,
          },
        },
        {
          updateCells: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 11 },
            fields: "userEnteredValue",
          },
        },
        {
          mergeCells: {
            range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 10 },
            mergeType: "MERGE_ALL",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 10 },
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
            range: { sheetId, startRowIndex: 3, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 10 },
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
      ],
    },
  });
}

async function appendStatusRows(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: StatusDestination,
  sheetId: number,
  rowsToAppend: Array<{ values: string[]; statusId: string }>,
) {
  if (rowsToAppend.length === 0) return;
  const dateLabel = targetWorkdayLabel();
  let response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A:K` });
  let rows = response.data.values ?? [];
  let dateRowIndex = rows.findIndex((row, index) => isDateRow(index, row[0]) && String(row[0]).trim() === dateLabel);

  if (dateRowIndex === -1) {
    await createDateBlock(sheets, spreadsheetId, sheetId, dateLabel);
    response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A:K` });
    rows = response.data.values ?? [];
    dateRowIndex = rows.findIndex((row, index) => isDateRow(index, row[0]) && String(row[0]).trim() === dateLabel);
    if (dateRowIndex === -1) throw new Error(`Unable to create ${dateLabel} block in ${sheetName}.`);
  }

  const block = analyzeDateBlock(rows, dateRowIndex);
  const targetRowIndex = block.lastFilledIndex + 1;
  const availableRows = Math.max(0, block.blockEndIndex - block.lastFilledIndex);
  const missingRows = Math.max(0, rowsToAppend.length + TRAILING_EMPTY_ROWS - availableRows);
  await insertRows(sheets, spreadsheetId, sheetId, block.blockEndIndex + 1, missingRows);

  const values = rowsToAppend.map((row) => [...row.values.slice(0, 10), row.statusId]);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A${targetRowIndex + 1}:K${targetRowIndex + rowsToAppend.length}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

async function performMove(references: OrderMoveReference[], destination: StatusDestination) {
  const { sheets, spreadsheetId } = getSheetsClient();
  const sheetId = await ensureStatusSheet(sheets, spreadsheetId, destination);
  await ensureSourceStatusColumn(sheets, spreadsheetId);
  const [sourceResponse, statusIdsResponse] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SOURCE_SHEET}'!A:L` }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: `'${destination}'!K:K` }),
  ]);
  const sourceRows = sourceResponse.data.values ?? [];
  const existingStatusIds = new Set((statusIdsResponse.data.values ?? []).flat().map((value) => String(value ?? "").trim()).filter(Boolean));
  const uniqueReferences = Array.from(
    new Map(references.map((reference) => [`${reference.sheetRowNumber}:${reference.fingerprint}`, reference])).values(),
  );
  const valid: Array<{ reference: OrderMoveReference; values: string[]; statusId: string; sourceStatus: string }> = [];

  for (const reference of uniqueReferences) {
    if (!Number.isInteger(reference.sheetRowNumber) || reference.sheetRowNumber < 2) continue;
    const sourceIndex = reference.sheetRowNumber - 1;
    const sourceRow = sourceRows[sourceIndex];
    if (!sourceRow) continue;
    if (String(sourceRow[SOURCE_STATUS_CELL_INDEX] ?? "").trim()) continue;
    const identity = rawOrderIdentity(sourceRow);
    if (!identity.primalac && !identity.brojTelefona && !identity.artikal) continue;
    if (createOrderFingerprint(identity) !== reference.fingerprint) continue;
    if (dateLabelForRow(sourceRows, sourceIndex) !== reference.dateLabel) continue;

    const statusId = transitionId(destination, reference);
    valid.push({
      reference,
      values: orderIdentityValues(identity),
      statusId,
      sourceStatus: `${destination === DELIVERED_SHEET ? "delivered" : "returned"}:${statusId}`,
    });
  }

  const newRows = valid
    .filter((entry) => !existingStatusIds.has(entry.statusId))
    .map((entry) => ({ values: entry.values, statusId: entry.statusId }));
  await appendStatusRows(sheets, spreadsheetId, destination, sheetId, newRows);

  if (valid.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: valid.flatMap((entry) => [
          { range: `'${SOURCE_SHEET}'!L${entry.reference.sheetRowNumber}`, values: [[entry.sourceStatus]] },
          { range: `'${SOURCE_SHEET}'!P${entry.reference.sheetRowNumber}`, values: [[true]] },
        ]),
      },
    });
  }

  invalidateSheetCache(SOURCE_SHEET);
  invalidateSheetCache(destination);
  return { moved: valid.length, skipped: uniqueReferences.length - valid.length };
}

async function performRestoreReturn(reference: OrderMoveReference) {
  const { sheets, spreadsheetId } = getSheetsClient();
  await ensureSourceStatusColumn(sheets, spreadsheetId);
  const [sourceResponse, returnsResponse] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SOURCE_SHEET}'!A:L` }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: `'${RETURNS_SHEET}'!A:K` }),
  ]);
  const sourceRows = sourceResponse.data.values ?? [];
  const returnRows = returnsResponse.data.values ?? [];
  const returnIndex = reference.sheetRowNumber - 1;
  const returnRow = returnRows[returnIndex];

  if (!returnRow) return { restored: 0, skipped: 1 };
  const statusId = String(returnRow[10] ?? "").trim();
  if (!/^[a-f0-9]{32}$/.test(statusId)) return { restored: 0, skipped: 1 };
  const returnIdentity = rawOrderIdentity(returnRow);
  if (createOrderFingerprint(returnIdentity) !== reference.fingerprint) return { restored: 0, skipped: 1 };
  if (dateLabelForRow(returnRows, returnIndex) !== reference.dateLabel) return { restored: 0, skipped: 1 };

  const sourceIndex = sourceRows.findIndex((row) => String(row[SOURCE_STATUS_CELL_INDEX] ?? "").trim() === `returned:${statusId}`);
  if (sourceIndex === -1) return { restored: 0, skipped: 1 };
  if (createOrderFingerprint(rawOrderIdentity(sourceRows[sourceIndex])) !== reference.fingerprint) {
    return { restored: 0, skipped: 1 };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        {
          range: `'${SOURCE_SHEET}'!L${sourceIndex + 1}`,
          values: [[""]],
        },
        {
          range: `'${RETURNS_SHEET}'!K${reference.sheetRowNumber}`,
          values: [[`restored:${statusId}`]],
        },
      ],
    },
  });

  invalidateSheetCache(SOURCE_SHEET);
  invalidateSheetCache(RETURNS_SHEET);
  return { restored: 1, skipped: 0 };
}

function queuedMove(references: OrderMoveReference[], destination: StatusDestination) {
  const operation = moveQueue.then(() => performMove(references, destination));
  moveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function markOrdersDelivered(references: OrderMoveReference[]) {
  return queuedMove(references, DELIVERED_SHEET);
}

export function moveOrderToReturns(reference: OrderMoveReference) {
  return queuedMove([reference], RETURNS_SHEET);
}

export function restoreReturnToTransit(reference: OrderMoveReference) {
  const operation = moveQueue.then(() => performRestoreReturn(reference));
  moveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
