const HEADER = [
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

const SHEET_NAME = 'Orders';
const BLOCK_EMPTY_ROWS = 5;
const TOTAL_COLUMNS = 10;
const INTERNAL_ID_COLUMN = 11; // K
const SPREADSHEET_ID = '1P99qsJa4HzruxVCB3BHLTpZ5Jvb1jiTVvjf6IuRho9s';
const DEFAULT_SHOPIFY_STORE_KEY = 'galago';

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    const body = e && e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : null;

    if (!body) {
      return jsonResponse_({ ok: false, error: 'Missing JSON body' });
    }

    const shopifyOrderId = String(body.id || '').trim();
    if (!shopifyOrderId) {
      return jsonResponse_({ ok: false, error: 'Missing Shopify order id' });
    }
    const shopifyStoreKey = getShopifyStoreKey_(e, body);
    const shopifyOrderKey = buildShopifyOrderKey_(shopifyStoreKey, shopifyOrderId);

    locked = lock.tryLock(30000);
    if (!locked) {
      return jsonResponse_({
        ok: false,
        error: 'Could not acquire Shopify import lock',
        shopifyOrderId,
        shopifyStoreKey,
      });
    }

    ensureOrdersSheetLayout();
    insertOrdersTodayBlock();

    if (orderAlreadyImported_(shopifyOrderKey, shopifyOrderId, shopifyStoreKey)) {
      return jsonResponse_({
        ok: true,
        skipped: true,
        reason: 'duplicate',
        shopifyOrderId,
        shopifyStoreKey,
      });
    }

    const mapped = mapShopifyOrder_(body);
    appendOrderToOrdersSheet_(mapped, shopifyOrderKey);

    return jsonResponse_({
      ok: true,
      message: 'Order imported',
      order: mapped,
      shopifyOrderId,
      shopifyStoreKey,
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getShopifyStoreKey_(e, body) {
  const params = e && e.parameter ? e.parameter : {};
  const raw =
    params.store ||
    params.shop ||
    params.source ||
    body.shop_domain ||
    body.shop ||
    body.domain ||
    DEFAULT_SHOPIFY_STORE_KEY;

  return sanitizeShopifyStoreKey_(raw);
}

function sanitizeShopifyStoreKey_(value) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.myshopify\.com$/, '')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned || DEFAULT_SHOPIFY_STORE_KEY;
}

function buildShopifyOrderKey_(shopifyStoreKey, shopifyOrderId) {
  return `${sanitizeShopifyStoreKey_(shopifyStoreKey)}:${String(shopifyOrderId).trim()}`;
}

function ensureOrdersSheetLayout() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  sheet.getRange(1, 1, 1, HEADER.length)
    .setFontWeight('bold')
    .setFontSize(10)
    .setBackground('#f1f5f9')
    .setFontColor('#1f2937')
    .setHorizontalAlignment('center');

  sheet.setFrozenRows(1);
}

function insertOrdersTodayBlock() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Europe/Sarajevo';
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return;

  const dateLabel = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const existing = sheet
    .getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1)
    .getDisplayValues()
    .flat();

  if (existing.includes(dateLabel)) return;

  // row 1 header
  // row 2 empty
  // row 3 date
  // row 4-8 empty
  sheet.insertRowsAfter(1, 7);
  sheet.getRange(2, 1, 1, TOTAL_COLUMNS).clearContent();

  const dateRange = sheet.getRange(3, 1, 1, TOTAL_COLUMNS);
  try {
    dateRange.breakApart();
  } catch (err) {}

  dateRange.merge();
  dateRange
    .setValue(dateLabel)
    .setFontWeight('bold')
    .setFontSize(11)
    .setFontColor('#334155')
    .setBackground('#dbeafe')
    .setHorizontalAlignment('left');

  styleEmptyRows_(sheet, 4, BLOCK_EMPTY_ROWS);
}

function styleEmptyRows_(sheet, startRow, numRows) {
  if (numRows <= 0) return;

  sheet.getRange(startRow, 1, numRows, TOTAL_COLUMNS)
    .clearContent()
    .setBackground('#ffffff')
    .setFontColor('#111827')
    .setFontSize(10)
    .setFontWeight('normal');

  sheet.getRange(startRow, 1, numRows, TOTAL_COLUMNS)
    .setBorder(true, true, true, true, false, false, '#d1d5db', SpreadsheetApp.BorderStyle.SOLID);
}

function appendOrderToOrdersSheet_(order, shopifyOrderId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Europe/Sarajevo';
  const today = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');

  const colA = sheet
    .getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1)
    .getDisplayValues()
    .flat();

  const dateRow = colA.findIndex(v => String(v).trim() === today) + 1;
  if (!dateRow) throw new Error(`Today's block not found: ${today}`);

  const insertRow = findAppendRowInBlock_(sheet, dateRow);

  sheet.getRange(insertRow, 1, 1, TOTAL_COLUMNS).setValues([[ 
    order.primalac,
    order.brojTelefona,
    order.grad,
    order.adresa,
    order.artikal,
    order.brojPaketa,
    order.otkupnina,
    order.vrijednostPosiljke,
    order.dop,
    order.zamjena,
  ]]);

  sheet.getRange(insertRow, INTERNAL_ID_COLUMN).setValue(shopifyOrderId);

  maintainEmptyRowsForBlock_(sheet, insertRow);
}

function findAppendRowInBlock_(sheet, dateRow) {
  const blockInfo = analyzeBlock_(sheet, dateRow);
  if (!blockInfo) throw new Error(`Could not analyze date block at row ${dateRow}`);

  const targetRow = blockInfo.lastFilledRow + 1;

  if (blockInfo.nextDateRow && targetRow >= blockInfo.nextDateRow) {
    sheet.insertRowsBefore(blockInfo.nextDateRow, 1);
    styleEmptyRows_(sheet, blockInfo.nextDateRow, 1);
    return blockInfo.nextDateRow;
  }

  if (targetRow > blockInfo.lastRowInBlock) {
    sheet.insertRowsAfter(blockInfo.lastRowInBlock, 1);
    styleEmptyRows_(sheet, blockInfo.lastRowInBlock + 1, 1);
    return blockInfo.lastRowInBlock + 1;
  }

  return targetRow;
}

function maintainEmptyRowsForBlock_(sheet, editedRow) {
  const dateRow = findDateRowAbove_(sheet, editedRow);
  if (!dateRow) return;

  const blockInfo = analyzeBlock_(sheet, dateRow);
  if (!blockInfo) return;

  const missing = BLOCK_EMPTY_ROWS - blockInfo.trailingEmptyRows;
  if (missing <= 0) return;

  sheet.insertRowsAfter(blockInfo.lastRowInBlock, missing);
  styleEmptyRows_(sheet, blockInfo.lastRowInBlock + 1, missing);
}

function findDateRowAbove_(sheet, row) {
  for (let r = row; r >= 2; r--) {
    const value = String(sheet.getRange(r, 1).getDisplayValue()).trim();
    if (isDateLabel_(value)) return r;
  }
  return null;
}

function analyzeBlock_(sheet, dateRow) {
  const lastRow = Math.max(sheet.getLastRow(), dateRow);
  let nextDateRow = null;

  for (let r = dateRow + 1; r <= lastRow; r++) {
    const value = String(sheet.getRange(r, 1).getDisplayValue()).trim();
    if (isDateLabel_(value)) {
      nextDateRow = r;
      break;
    }
  }

  const blockEnd = nextDateRow ? nextDateRow - 1 : lastRow;
  let lastFilledRow = dateRow;

  for (let r = dateRow + 1; r <= blockEnd; r++) {
    if (!isRowEmpty_(sheet, r)) lastFilledRow = r;
  }

  let trailingEmptyRows = 0;
  for (let r = blockEnd; r >= dateRow + 1; r--) {
    if (isRowEmpty_(sheet, r)) {
      trailingEmptyRows++;
    } else {
      break;
    }
  }

  return {
    nextDateRow,
    lastRowInBlock: blockEnd,
    lastFilledRow,
    trailingEmptyRows,
  };
}

function isRowEmpty_(sheet, row) {
  const values = sheet.getRange(row, 1, 1, TOTAL_COLUMNS).getDisplayValues()[0];
  return values.every(v => String(v).trim() === '');
}

function isDateLabel_(value) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(value || '').trim());
}

function mapShopifyOrder_(order) {
  const shipping = order.shipping_address || {};
  const billing = order.billing_address || {};
  const customer = order.customer || {};

  const primalac = buildCustomerName_(shipping, billing, customer, order);

  const brojTelefona = normalizePhone_(
    shipping.phone ||
    billing.phone ||
    customer.phone ||
    order.phone ||
    ''
  );

  const cityRaw = shipping.city || billing.city || '';
  const zipRaw = shipping.zip || billing.zip || '';
  const grad = normalizeGrad_(cityRaw, zipRaw);

  const adresa = [
    shipping.address1 || billing.address1 || '',
    shipping.address2 || billing.address2 || '',
  ]
    .filter(Boolean)
    .join(', ')
    .trim();

  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];

  const productNames = lineItems
    .map(item => String(item && item.name ? item.name : '').trim())
    .filter(Boolean);

  const combinedProducts = productNames.join(' + ');
  const subtotal = getShopifySubtotal_(order, lineItems);

  const brojPaketa = String(
    lineItems.reduce((sum, item) => {
      const qty = Number(item && item.quantity ? item.quantity : 0);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0)
  );

  return {
    primalac,
    brojTelefona,
    grad,
    adresa,
    artikal: combinedProducts,
    brojPaketa: brojPaketa === '0' ? '' : brojPaketa,
    otkupnina: subtotal,
    vrijednostPosiljke: subtotal,
    dop: '1',
    zamjena: '0',
  };
}

function getShopifySubtotal_(order, lineItems) {
  const directValue = firstMoneyValue_([
    order.current_subtotal_price,
    order.subtotal_price,
    order.total_line_items_price,
    order.current_total_price,
    order.total_price,
  ]);

  if (directValue) return directValue;

  const calculated = lineItems.reduce((sum, item) => {
    const quantity = Number(item && item.quantity ? item.quantity : 0);
    const price = Number(String(item && item.price ? item.price : '').replace(',', '.'));
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return sum;
    return sum + quantity * price;
  }, 0);

  return calculated > 0 ? formatMoney_(calculated) : '';
}

function firstMoneyValue_(values) {
  for (const value of values) {
    const formatted = formatMoney_(value);
    if (formatted) return formatted;
  }
  return '';
}

function formatMoney_(value) {
  const amount = Number(String(value || '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return String(Math.round(amount * 100) / 100);
}

function buildCustomerName_(shipping, billing, customer, order) {
  const shippingName = [
    shipping.first_name || '',
    shipping.last_name || '',
  ].join(' ').trim();

  if (shippingName) return shippingName;

  const billingName = [
    billing.first_name || '',
    billing.last_name || '',
  ].join(' ').trim();

  if (billingName) return billingName;

  const customerName = [
    customer.first_name || '',
    customer.last_name || '',
  ].join(' ').trim();

  if (customerName) return customerName;

  return String(order.name || '').trim();
}

function normalizePhone_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('387')) return digits;
  if (digits.startsWith('0')) return `387${digits.slice(1)}`;
  if (digits.startsWith('6')) return `387${digits}`;
  return digits;
}

function normalizeGrad_(city, zip) {
  const cleanZip = String(zip || '').trim();
  if (/^\d{5}$/.test(cleanZip)) return cleanZip;
  return String(city || '').trim();
}

function orderAlreadyImported_(shopifyOrderKey, legacyShopifyOrderId, shopifyStoreKey) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const lastRow = Math.max(sheet.getLastRow(), 1);
  const values = sheet
    .getRange(1, INTERNAL_ID_COLUMN, lastRow, 1)
    .getDisplayValues()
    .flat();

  return values.some(v => {
    const stored = String(v).trim();
    if (stored === String(shopifyOrderKey).trim()) return true;

    // Older Galago imports stored only the raw Shopify order id before multi-store support.
    return shopifyStoreKey === DEFAULT_SHOPIFY_STORE_KEY &&
      stored === String(legacyShopifyOrderId).trim();
  });
}
