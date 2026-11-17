import type { gmail_v1 } from "googleapis";
import { parseAddressList } from "email-addresses";
import { readFirstWorksheet } from "./excel-workbook";
import { normalizeExpressText } from "./expressone-parser";
import { lookupPlaceByPostalCode } from "./bih-postal";
import { parseOrderAmount } from "./order-amount";
import type { SheetOrderRow } from "./google-sheets";

export type SettlementRow = {
  row: number; recipient: string; city: string; product: string; amount: number; shippedOn: string; shipmentDates?: string[];
};
const norm = (value: unknown) => normalizeExpressText(String(value ?? ""));
const name = (value: string) => norm(value).split(" ").filter(Boolean).sort().join(" ");

export function settlementAttachments(message: gmail_v1.Schema$Message) {
  const header = (key: string) => message.payload?.headers?.find(h => h.name?.toLowerCase() === key)?.value || "";
  const addresses = parseAddressList(header("from"));
  if (!addresses || addresses.length !== 1 || addresses[0].type !== "mailbox" ||
      addresses[0].domain?.toLowerCase() !== "expressone.ba" ||
      !/^galago d o o tabela razduzenog novca\b/.test(norm(header("subject")))) return [];
  const found: gmail_v1.Schema$MessagePart[] = [];
  function walk(part: gmail_v1.Schema$MessagePart, depth: number) {
    if (depth > 12) throw new Error("settlement-format");
    if (/galago/i.test(part.filename || "") && /\.xlsx?$/i.test(part.filename || "")) found.push(part);
    for (const child of part.parts || []) walk(child, depth + 1);
  }
  if (message.payload) walk(message.payload, 0);
  if (found.length > 10) throw new Error("settlement-format");
  return found;
}

function dateKey(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
export function settlementDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 40000 && value < 100000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400_000).toISOString().slice(0, 10);
  }
  const raw = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);
  if (iso) return dateKey(+iso[1], +iso[2], +iso[3]);
  // Express One's settlement workbook uses US month.day.year text, not Bosnian day.month.year.
  const us = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
  if (us) return dateKey(+us[3], +us[1], +us[2]);
  return null;
}

function shipmentDates(value: unknown, receivedAt: number) {
  const date = settlementDate(value);
  if (!date) return [];
  const dates = [date];
  // These reports mix US text with Excel cells converted using day/month locale.
  // Keep both interpretations; the full order history must identify a unique match.
  if (typeof value === "number") {
    const [year, month, day] = date.split("-").map(Number);
    const swapped = dateKey(year, day, month);
    if (swapped) dates.push(swapped);
  }
  return [...new Set(dates)].filter(d => Date.parse(d) <= receivedAt).sort();
}

export async function parseSettlementWorkbook(file: File, receivedAt: number): Promise<SettlementRow[]> {
  if (!/\.xlsx?$/i.test(file.name) || !file.size || file.size > 5 * 1024 * 1024) throw new Error("settlement-format");
  const rows = await readFirstWorksheet(file);
  const headerIndex = rows.findIndex(row => row.some(cell => norm(cell) === "primaoc"));
  if (headerIndex < 0) throw new Error("settlement-format");
  const headers = rows[headerIndex].map(norm);
  const fields = ["datum slanja", "primaoc", "primaoc mjesto", "posiljaoc", "iznos otk", "ref1"];
  if (fields.some(field => !headers.includes(field))) throw new Error("settlement-format");
  const result: SettlementRow[] = [];
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const get = (key: string) => row[headers.indexOf(key)];
    const recipient = String(get("primaoc") ?? "").trim();
    if (!recipient) continue;
    const dates = shipmentDates(get("datum slanja"), receivedAt);
    const shippedOn = dates.at(-1);
    const rawAmount = get("iznos otk");
    const amount = parseOrderAmount(String(rawAmount ?? ""));
    if (norm(get("posiljaoc")) !== "galago d o o" || !shippedOn ||
        rawAmount === null || rawAmount === undefined ||
        !/\d/.test(String(rawAmount)) || !Number.isFinite(amount) || amount < 0) throw new Error("settlement-format");
    result.push({ row: index + 1, recipient, city: String(get("primaoc mjesto") ?? "").trim(),
      product: String(get("ref1") ?? "").trim(), amount, shippedOn, shipmentDates: dates });
    if (result.length > 500) throw new Error("settlement-format");
  }
  if (!result.length) throw new Error("settlement-format");
  return result;
}

const brands = new Set(["lewa", "kibo", "jumbo", "usiku", "serena", "zuri", "mara", "nora", "imara", "tunda", "tanzi", "duma", "zola", "nia", "lulu", "bedly", "nexo", "kiwa"]);
const productBrands = (value: string) => norm(value).replace(/\bjambo\b/g, "jumbo").split(" ").filter(token => brands.has(token));

export function matchSettlement(row: SettlementRow, orders: SheetOrderRow[]) {
  const dates = (row.shipmentDates || [row.shippedOn]).map(d => Date.parse(d));
  // Search closed orders too: an old remittance must never close a repeat purchase instead.
  const candidates = orders.filter(order => {
    if (name(order.primalac) !== name(row.recipient) || order.appStatus.startsWith("duplicate:")) return false;
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(order.dateLabel);
    if (!d) return false;
    if (!dates.some(shipped => {
      const orderDay = Date.parse(`${d[3]}-${d[2]}-${d[1]}`);
      const nextWorkday = new Date(shipped + 86400_000);
      while ([0, 6].includes(nextWorkday.getUTCDay())) nextWorkday.setUTCDate(nextWorkday.getUTCDate() + 1);
      // Orders are grouped by the next shipping cycle; a Sunday label can be Monday in Sheets.
      return orderDay >= shipped - 7 * 86400_000 && orderDay <= nextWorkday.getTime() &&
        (!order.receivedAt || Date.parse(order.receivedAt) < shipped + 86400_000);
    })) return false;
    if (Math.abs(parseOrderAmount(order.otkupnina) - row.amount) >= 0.005 || row.amount <= 0) return false;
    const sourceBrands = productBrands(row.product), orderBrands = productBrands(order.artikal);
    if (sourceBrands.length && orderBrands.length && !sourceBrands.some(b => orderBrands.includes(b))) return false;
    const sourceProduct = norm(row.product), orderProduct = norm(order.artikal);
    const productMatch = sourceBrands.some(b => orderBrands.includes(b)) ||
      (sourceProduct.length >= 4 && orderProduct.length >= 4 && (sourceProduct.includes(orderProduct) || orderProduct.includes(sourceProduct)));
    const city = norm(row.city), location = norm(`${lookupPlaceByPostalCode(order.grad) || order.grad} ${order.adresa}`);
    const cityMatch = city.length >= 3 && (` ${location} `).includes(` ${city} `);
    return productMatch || cityMatch;
  });
  if (candidates.length !== 1) return { reason: candidates.length ? "Vise mogucih narudzbi" : "Nema sigurnog podudaranja" };
  const order = candidates[0];
  if (order.appStatus.startsWith("returned:")) return { reason: "Narudzba je oznacena kao povrat" };
  if (order.appStatus && !order.appStatus.startsWith("delivered:")) return { reason: "Narudzba ima drugi status" };
  return { order, alreadyDelivered: order.deliveredChecked || order.appStatus.startsWith("delivered:") };
}

export function nextSettlementScan(now: number) {
  // Reports normally arrive around 09:00; collect once each afternoon, including weekends.
  for (let time = Math.floor(now / 3600_000) * 3600_000 + 3600_000; time <= now + 27 * 3600_000; time += 3600_000) {
    if (new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sarajevo", hour: "2-digit", hourCycle: "h23" }).format(time) === "15") return time;
  }
  throw new Error("settlement-schedule");
}
