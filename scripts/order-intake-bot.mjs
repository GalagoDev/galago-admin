import fs from 'node:fs';
import path from 'node:path';
import TelegramBot from 'node-telegram-bot-api';
import { google } from 'googleapis';

const BOT_TOKEN = process.env.TELEGRAM_ORDERS_BOT_TOKEN;
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

if (!BOT_TOKEN || !SHEET_ID || (!SERVICE_ACCOUNT_JSON && !KEY_PATH)) {
  console.error('Missing TELEGRAM_ORDERS_BOT_TOKEN / GOOGLE_SHEETS_ID / GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH');
  process.exit(1);
}

function getGoogleServiceAccountCredentials() {
  if (SERVICE_ACCOUNT_JSON) {
    return JSON.parse(SERVICE_ACCOUNT_JSON);
  }

  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), KEY_PATH), 'utf8'));
}

const creds = getGoogleServiceAccountCredentials();
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const pending = new Map();
const cities = {
  'sarajevo':'71000','banja luka':'78000','tuzla':'75000','zenica':'72000','mostar':'88000','bijeljina':'76300','brcko':'76100','bihac':'77000','bihać':'77000','cazin':'77220','travnik':'72270','visoko':'71300','gradacac':'76250','gradačac':'76250','gracanica':'75320','gračanica':'75320','konjic':'88400','bugojno':'70230','trebinje':'89101','doboj':'74000','prijedor':'79101','zivinice':'75270','živinice':'75270','kalesija':'75260','lukavac':'75300','kakanj':'72240','rogatica':'73220','grude':'88340','vitez':'72250','jablanica':'88420','banovici':'75290','banovići':'75290','kozarac':'79202','han bila':'72245','čajniče':'73280','cajnice':'73280','han pijesak':'71360','bosanska krupa':'77240','turbe':'72283','laktasi':'78250','laktaši':'78250'
};

function cleanup(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function titleCase(value) { return cleanup(value).split(' ').filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' '); }
function splitSegments(rawText) {
  return String(rawText || '')
    .split(/\n+/)
    .flatMap(line => line.split(/\s+\/\s+/))
    .map(cleanup)
    .filter(Boolean);
}
function normalizePhone(text) { const digits = String(text||'').replace(/\D/g,''); if (!digits) return ''; if (digits.startsWith('387')) return digits; if (digits.startsWith('0')) return `387${digits.slice(1)}`; if (digits.startsWith('6')) return `387${digits}`; return digits; }
function findPhone(text) { const match = text.match(/(\+?387[\d\s\/-]{6,}|06[\d\s\/-]{6,})/i); return match ? normalizePhone(match[1]) : ''; }
function detectPostal(text) {
  const cleaned = cleanup(text);
  const lowered = cleaned.toLowerCase();

  const exactZipCity = cleaned.match(/\b(\d{5})\b\s+([A-Za-zČĆŽŠĐčćžšđ]+(?:\s+[A-Za-zČĆŽŠĐčćžšđ]+)*)$/);
  if (exactZipCity) {
    const zip = exactZipCity[1];
    const cityName = exactZipCity[2].toLowerCase();
    if (cities[cityName] === zip) return { city: titleCase(cityName), postalCode: zip };
  }

  const exactCityZip = cleaned.match(/^([A-Za-zČĆŽŠĐčćžšđ]+(?:\s+[A-Za-zČĆŽŠĐčćžšđ]+)*)\s+(\d{5})$/);
  if (exactCityZip) {
    const cityName = exactCityZip[1].toLowerCase();
    const zip = exactCityZip[2];
    if (cities[cityName] === zip) return { city: titleCase(cityName), postalCode: zip };
  }

  for (const city of Object.keys(cities).sort((a,b)=>b.length-a.length)) {
    if (lowered === city) return { city: titleCase(city), postalCode: cities[city] };
    if (lowered === `${city} ${cities[city]}`) return { city: titleCase(city), postalCode: cities[city] };
    if (lowered === `${cities[city]} ${city}`) return { city: titleCase(city), postalCode: cities[city] };
  }

  return null;
}
function findAmount(text) {
  const normalized = String(text || '').replace(/\//g, ' ');
  const m = normalized.match(/(?:\b(?:sds|km)\b\s*)(\d+(?:[.,]\d+)?)\b|(\d+(?:[.,]\d+)?)\s*(?:\b(?:sds|km)\b)/i);
  const raw = m?.[1] || m?.[2] || '';
  if (!raw) return '';
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? String(value) : '';
}

function parseOrderText(rawText) {
  const lines = splitSegments(rawText);
  const hasLabels = lines.some(line => /^(ime|adresa|grad|mjesto|mob|br tel|br\. tel|telefon)\s*[:\-]/i.test(line));

  if (hasLabels) {
    let primalac='', brojTelefona='', grad='', adresa='';
    const amount = findAmount(rawText);
    for (const line of lines) {
      if (/^ime(?:\s+i\s+prezime)?\s*[:\-]/i.test(line)) primalac = cleanup(line.replace(/^ime(?:\s+i\s+prezime)?\s*[:\-]\s*/i, ''));
      else if (/^(mob|br tel|br\. tel|telefon)\s*[:\-]/i.test(line)) brojTelefona = findPhone(line);
      else if (/^(grad|mjesto)\s*[:\-]/i.test(line)) {
        const value = cleanup(line.replace(/^(grad|mjesto)\s*[:\-]\s*/i, ''));
        const postal = detectPostal(value); grad = postal ? `${postal.postalCode} ${postal.city}`.trim() : value;
      } else if (/^(adresa|ulica)\s*[:\-]/i.test(line)) {
        const value = cleanup(line.replace(/^(adresa|ulica)\s*[:\-]\s*/i, ''));
        const parts = value.split(',').map(cleanup).filter(Boolean);
        if (parts.length >= 2) {
          adresa = parts.slice(0,-1).join(', ');
          const postal = detectPostal(parts[parts.length-1]);
          grad = grad || (postal ? `${postal.postalCode} ${postal.city}`.trim() : titleCase(parts[parts.length-1]));
        } else adresa = value;
      }
    }
    return { primalac, brojTelefona, grad, adresa, artikal: lines[lines.length-1] || '', brojPaketa:'', otkupnina: amount, vrijednostPosiljke: amount, dop:'', zamjena:'' };
  }

  const articleLine = lines.length > 1 ? lines[lines.length-1] : '';
  const amount = findAmount(articleLine || rawText);
  const artikal = articleLine ? cleanup(articleLine.replace(/(?:\b(?:sds|km)\b\s*)?\d+(?:[.,]\d+)?\s*(?:\b(?:sds|km)\b)?/gi,'').replace(/\s{2,}/g,' ')) || articleLine : '';
  const phoneIndex = lines.findIndex(line => !!findPhone(line));

  let primalac='', brojTelefona='', grad='', adresa='';
  if (phoneIndex >= 1 && lines.length >= 4) {
    primalac = titleCase(lines[0] || '');
    brojTelefona = findPhone(lines[phoneIndex]) || '';

    const beforePhone = lines.slice(1, phoneIndex);
    const postalEntries = beforePhone
      .map((part, index) => ({ part, index, postal: detectPostal(part) }))
      .filter(entry => entry.postal);

    if (postalEntries.length > 0) {
      const cityEntry = postalEntries[0];
      grad = `${cityEntry.postal.postalCode}`;
      const addressParts = beforePhone.filter((_, index) => index !== cityEntry.index);
      adresa = cleanup(addressParts.join(' '));
    } else {
      const maybeCity = beforePhone.find(part => /\b\d{5}\b/.test(part)) || beforePhone[beforePhone.length - 1] || '';
      const maybeAddress = beforePhone.filter(part => part !== maybeCity);
      const postal = detectPostal(maybeCity);
      grad = postal ? `${postal.postalCode}` : '';
      adresa = cleanup(maybeAddress.join(' '));
    }
  } else {
    const main = articleLine ? lines.slice(0,-1) : lines;

    if (main.length >= 4) {
      primalac = titleCase(main[0]);
      adresa = cleanup(main[1] || '');
      brojTelefona = findPhone(main[2]) || findPhone(main[3]) || '';

      const cityCandidate = findPhone(main[2]) ? main[3] : main[2];
      const postal = detectPostal(cityCandidate);
      grad = postal ? `${postal.postalCode}` : cleanup(cityCandidate);
    } else {
    const joined = cleanup(main.join(' '));
    brojTelefona = findPhone(joined);
    const postal = detectPostal(joined);
    grad = postal ? `${postal.postalCode}` : '';

      if (main.length >= 2 && postal && cleanup(main[1]).toLowerCase().includes(postal.city.toLowerCase())) {
        primalac = titleCase(main[0]);
        adresa = cleanup(main[1].replace(new RegExp(postal.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ''));
      } else {
        let working = joined;
        if (brojTelefona) working = working.replace(/(\+?387[\d\s\/-]{6,}|06[\d\s\/-]{6,})/i, ' ');
        if (postal?.city) working = working.replace(new RegExp(postal.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
        if (postal?.postalCode) working = working.replace(new RegExp(postal.postalCode, 'g'), ' ');
        working = cleanup(working.replace(/\b(?:mob|br tel|br\. tel|tel|telefon)\b\s*:?/gi, ' '));
        const tokens = working.split(' ').filter(Boolean);
        primalac = tokens.length >= 2 ? titleCase(`${tokens[0]} ${tokens[1]}`) : titleCase(tokens[0] || '');
        adresa = cleanup(working.replace(primalac, ' '));
      }
    }
  }

  return { primalac, brojTelefona, grad, adresa, artikal, brojPaketa:'', otkupnina: amount, vrijednostPosiljke: amount, dop:'', zamjena:'' };
}

function formatPreview(order) {
  return [
    'Provjeri narudžbu:',
    `Primalac: ${order.primalac || '-'}`,
    `Broj telefona: ${order.brojTelefona || '-'}`,
    `Grad: ${order.grad || '-'}`,
    `Adresa: ${order.adresa || '-'}`,
    `Artikal: ${order.artikal || '-'}`,
  ].join('\n');
}
function todayLabel() { return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date()); }
async function appendOrderToSheet(order) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'Orders'!A:Z` });
  const rows = res.data.values || [];
  const today = todayLabel();
  const dateRowIndex = rows.findIndex((row, index) => index > 0 && String(row?.[0] || '').trim() === today);
  if (dateRowIndex === -1) throw new Error(`Today's block (${today}) not found in Orders sheet.`);
  let targetRow = dateRowIndex + 2;
  while (true) {
    const row = rows[targetRow - 1] || [];
    const filled = row.some(cell => String(cell || '').trim() !== '');
    if (!filled) break;
    targetRow += 1;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'Orders'!A${targetRow}:J${targetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[order.primalac, order.brojTelefona, order.grad, order.adresa, order.artikal, order.brojPaketa, order.otkupnina, order.vrijednostPosiljke || order.otkupnina, order.dop, order.zamjena]] }
  });
}

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const order = parseOrderText(msg.text);
  const sent = await bot.sendMessage(msg.chat.id, formatPreview(order), {
    reply_to_message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Confirm', callback_data: `confirm:${msg.chat.id}:${msg.message_id}` },
        { text: '❌ Cancel', callback_data: `cancel:${msg.chat.id}:${msg.message_id}` },
      ]],
    },
  });
  pending.set(`${msg.chat.id}:${msg.message_id}`, { order, previewMessageId: sent.message_id });
});

bot.on('callback_query', async (query) => {
  const data = query.data || '';
  const [, chatId, messageId] = data.split(':');
  const key = `${chatId}:${messageId}`;
  const entry = pending.get(key);
  if (!entry) {
    await bot.answerCallbackQuery(query.id, { text: 'Order draft not found.' });
    return;
  }
  if (data.startsWith('cancel:')) {
    pending.delete(key);
    await bot.editMessageText('Narudžba otkazana.', { chat_id: Number(chatId), message_id: entry.previewMessageId });
    await bot.answerCallbackQuery(query.id);
    return;
  }
  if (data.startsWith('confirm:')) {
    try {
      await appendOrderToSheet(entry.order);
      pending.delete(key);
    } catch (error) {
      await bot.answerCallbackQuery(query.id, { text: 'Save failed.' });
      await bot.sendMessage(Number(chatId), `Greška pri spremanju: ${error.message}`);
      return;
    }
    try {
      await bot.editMessageText('Narudžba potvrđena i sačuvana u Orders sheet.\n\n' + formatPreview(entry.order), { chat_id: Number(chatId), message_id: entry.previewMessageId });
    } catch (error) {
      if (!/message is not modified/i.test(error.message || '')) {
        console.warn('Order was saved, but the Telegram preview could not be updated:', error.message);
      }
    }
    await bot.answerCallbackQuery(query.id, { text: 'Saved.' });
  }
});

console.log('Orders intake bot running...');
