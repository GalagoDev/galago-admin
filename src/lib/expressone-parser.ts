import type { gmail_v1 } from "googleapis";
import { parseAddressList } from "email-addresses";
import { parseDocument } from "htmlparser2";
import { findAll, textContent } from "domutils";
import type { SheetOrderRow } from "./google-sheets";

export const EXPRESSONE_SENDER = "cs@expressone.ba";
export type ExpressOneEvent = {
  tracking: string;
  recipient: string;
  phone: string;
  product: string;
  status: string;
  statusAt: string;
  receivedAt: number;
  gmailId: string;
};

export function normalizeExpressText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "dj")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const labels: Record<string, keyof ExpressOneEvent> = {
  "broj posiljke": "tracking", "integracijski kod": "product", "primalac": "recipient",
  "kontakt primaoca": "phone", "zadnji status": "status", "vrijeme statusa": "statusAt",
};

export function parseExpressOneMessage(message: gmail_v1.Schema$Message): ExpressOneEvent | null {
  const from = message.payload?.headers?.find(h => h.name?.toLowerCase() === "from")?.value || "";
  const addresses = parseAddressList(from);
  if (addresses?.length !== 1 || addresses[0].type !== "mailbox" || addresses[0].address.toLowerCase() !== EXPRESSONE_SENDER) return null;
  const receivedAt = Number(message.internalDate);
  if (!message.id || !Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  const fields: Record<string, string> = {};
  let nodes = 0;
  function walk(part: gmail_v1.Schema$MessagePart, depth = 0) {
    if (++nodes > 100 || depth > 12 || part.filename) return;
    if (part.parts) { part.parts.forEach(p => walk(p, depth + 1)); return; }
    if (!part.body?.data || part.mimeType !== "text/html") return;
    const html = Buffer.from(part.body.data.slice(0, 1_000_000), "base64url").toString("utf8");
    const doc = parseDocument(html);
    const rows = findAll(n => n.type === "tag" && n.name === "tr", doc.children);
    for (const row of rows) {
      if (!("children" in row)) continue;
      const cells = row.children.filter(n => n.type === "tag" && ["td", "th"].includes(n.name));
      if (cells.length !== 2) continue;
      const key = labels[normalizeExpressText(textContent(cells[0]))];
      if (key) fields[key] = textContent(cells[1]).replace(/\s+/g, " ").trim().slice(0, 2000);
    }
  }
  if (message.payload) walk(message.payload);
  if (!/^\d{3}-\d{8}$/.test(fields.tracking || "") || !fields.status || !fields.recipient ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fields.statusAt || "")) return null;
  return { tracking: fields.tracking, recipient: fields.recipient, phone: fields.phone || "", product: fields.product || "",
    status: normalizeExpressText(fields.status), statusAt: fields.statusAt, receivedAt, gmailId: message.id };
}

function phone(value: string) {
  return value.replace(/\D/g, "").replace(/^00/, "").replace(/^387/, "").replace(/^0/, "");
}
function name(value: string) { return normalizeExpressText(value).split(" ").filter(Boolean).sort().join(" "); }
function brands(value: string) {
  const known = new Set(["lewa", "kibo", "jumbo", "usiku", "serena", "zuri", "mara", "nora", "imara", "tunda", "tanzi", "duma", "zola", "nia", "lulu", "bedly", "nexo", "kiwa"]);
  return normalizeExpressText(value).split(" ").map(x => x === "jambo" ? "jumbo" : x).filter(x => known.has(x));
}
function orderedOn(order: SheetOrderRow) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(order.receivedAt || "")) return order.receivedAt!.slice(0, 10);
  return /^\d{2}\/\d{2}\/\d{4}$/.test(order.dateLabel)
    ? `${order.dateLabel.slice(6)}-${order.dateLabel.slice(3, 5)}-${order.dateLabel.slice(0, 2)}` : "";
}

export function matchExpressOneReturn(event: ExpressOneEvent, firstStatusAt: string, orders: SheetOrderRow[]) {
  const p = phone(event.phone), n = name(event.recipient), products = brands(event.product);
  if (p.length < 8 || !n) return { reason: "Nedostaje pouzdan telefon ili ime primaoca." };
  let candidates = orders.filter(order => !order.appStatus.startsWith("duplicate:") && orderedOn(order) &&
    orderedOn(order) <= firstStatusAt.slice(0, 10) && phone(order.brojTelefona) === p && name(order.primalac) === n);
  if (products.length) {
    const matched = candidates.filter(order => brands(order.artikal).some(b => products.includes(b)));
    if (!matched.length && candidates.length) return { reason: "Artikal se ne podudara s narudzbom." };
    candidates = matched;
  }
  if (candidates.length !== 1) return { reason: candidates.length ? "Vise narudzbi istog kupca; potrebna provjera." : "Nije pronadjena jednoznacna narudzba po imenu i telefonu." };
  const order = candidates[0];
  if (order.appStatus.startsWith("returned:")) return { order, alreadyReturned: true };
  if (order.appStatus || order.deliveredChecked) return { reason: "Narudzba vec ima drugi status; potrebna provjera." };
  return { order, alreadyReturned: false };
}

export function nextExpressOneScan(now: number) {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sarajevo", hour: "2-digit", hourCycle: "h23" });
  // Sarajevo changes DST on whole hours. Searching UTC hours also covers 23/25-hour days.
  for (let time = Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000; time <= now + 27 * 3_600_000; time += 3_600_000) {
    if (formatter.format(time) === "07") return time;
  }
  throw new Error("Dnevni termin nije odredjen.");
}
