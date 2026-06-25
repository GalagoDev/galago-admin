import fs from "node:fs";
import path from "node:path";

import { google, sheets_v4 } from "googleapis";

export type SheetOrderRow = {
  rowNumber: number;
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

function getTodayLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function getSheetsClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (!keyPath || !spreadsheetId) {
    throw new Error("Google Sheets is not configured.");
  }

  const resolvedPath = path.resolve(process.cwd(), keyPath);
  const credentials = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

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

export async function rebuildUndeliveredSheetDemoLayoutDirect() {
  const { sheets, spreadsheetId } = getSheetsClient();
  const sheetId = await getSheetId(sheets, spreadsheetId);
  const demo = [
    ["21/03/2026", "", "", "", "", "", "", "", "", ""],
    ["Melisa Paratusic", "38765041633", "KOZARAC", "Trnopolje Kararic bb", "simple", "92418467", "169 KM", "169 KM", "1", "0"],
    ["Aida Samardzic", "38763641775", "CAZIN", "ul.zrtava domovinskog rata E-B kod Binga,25/4", "ladičar malmo", "92418468", "99 KM", "99 KM", "1", "0"],
    ["", "", "", "", "", "", "", "", "", ""],
    ["20/03/2026", "", "", "", "", "", "", "", "", ""],
    ["Popara Danisa", "38762468073", "SARAJEVO", "Grlicica brdo 46", "manji sto za sminkanje", "92418480", "89 KM", "89 KM", "1", "0"],
    ["Natasa Milakovic", "38766458025", "BANJA LUKA", "Ul. Milana Karanovica 51", "kontrast oba bijela crne nogare", "92418469", "85 KM", "85 KM", "1", "0"],
  ];
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAME}'!A:Z` });
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${SHEET_NAME}'!A1:J${demo.length + 1}`, valueInputOption: "RAW", requestBody: { values: [HEADER, ...demo] } });
  await styleSheetHeader(sheets, spreadsheetId, sheetId);
  await styleDateRow(sheets, spreadsheetId, sheetId, 2);
  await styleDateRow(sheets, spreadsheetId, sheetId, 6);
}

async function getSheetRowsByName(sheetName: string) {
  const { sheets, spreadsheetId } = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:Z`,
  });

  const rows = response.data.values ?? [];
  const result: SheetOrderRow[] = [];
  let currentDate = "";
  let rowNumber = 0;

  for (const row of rows.slice(1)) {
    const cells = row.map((cell) => (cell ?? "").toString().trim());
    const filled = cells.filter(Boolean);
    if (filled.length === 0) continue;

    if (filled.length === 1 && /^\d{2}\/\d{2}\/\d{4}$/.test(cells[0] ?? "")) {
      currentDate = cells[0] ?? "";
      continue;
    }

    rowNumber += 1;
    result.push({
      rowNumber,
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
    });
  }

  return result;
}

export async function getUndeliveredSheetRows() {
  return getSheetRowsByName("Undelivered orders");
}

export async function getOrdersSheetRows() {
  return getSheetRowsByName("Orders");
}
