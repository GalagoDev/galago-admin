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

  let targetRow = dateRowIndex + 2; // first row under date, spreadsheet 1-indexed
  while (true) {
    const row = rows[targetRow - 1] ?? [];
    const filled = row.some((cell) => (cell ?? "").toString().trim() !== "");
    if (!filled) break;
    targetRow += 1;
  }

  const values = [[
    input.primalac || "",
    input.brojTelefona || "",
    input.grad || "",
    input.adresa || "",
    input.artikal || "",
    input.brojPaketa || "",
    input.otkupnina || "",
    input.vrijednostPosiljke || input.otkupnina || "",
    input.dop || "0",
    input.zamjena || "0",
  ]];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A${targetRow}:J${targetRow}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
