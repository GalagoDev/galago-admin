function ensureUndeliveredSheetLayout() {
  const SHEET_NAME = 'Undelivered orders';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const headers = [
    'Primalac',
    'Broj telefona',
    'Grad',
    'Adresa',
    'Artikal',
    'Broj paketa',
    'Otkupnina',
    'Vrijednost posiljke',
    'DOP',
    'Zamjena',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontSize(10)
    .setBackground('#f1f5f9')
    .setFontColor('#1f2937')
    .setHorizontalAlignment('center');

  sheet.setFrozenRows(1);
}

function insertTodayBlock() {
  const SHEET_NAME = 'Undelivered orders';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  ensureUndeliveredSheetLayout();

  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Europe/Sarajevo';
  const now = new Date();
  const day = now.getDay(); // 0 Sun, 6 Sat
  if (day === 0 || day === 6) return; // weekends off

  const dateLabel = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const existing = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getDisplayValues().flat();
  if (existing.includes(dateLabel)) return;

  // Insert 7 new rows below fixed header:
  // row 2 empty, row 3 date, rows 4-8 empty
  sheet.insertRowsAfter(1, 7);

  const dateRange = sheet.getRange(3, 1, 1, 10);
  dateRange.merge();
  dateRange
    .setValue(dateLabel)
    .setFontWeight('bold')
    .setFontSize(11)
    .setFontColor('#334155')
    .setBackground('#dbeafe')
    .setHorizontalAlignment('left');

  // Keep the 5 rows below date empty and clean
  sheet.getRange(4, 1, 5, 10)
    .clearContent()
    .setBackground('#ffffff')
    .setFontColor('#111827')
    .setFontSize(10)
    .setFontWeight('normal');

  // Optional: subtle borders for the new block
  sheet.getRange(3, 1, 6, 10).setBorder(true, true, true, true, false, false, '#d1d5db', SpreadsheetApp.BorderStyle.SOLID);
}

function createWeekdayTrigger() {
  const fn = 'insertTodayBlock';
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === fn)
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
}
