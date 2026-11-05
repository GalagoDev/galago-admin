import { detectPostalFromText } from "@/lib/bih-postal";
import { isUsableOrderPhone, normalizeOrderPhone, phoneCandidatesFromText } from "@/lib/order-phone";

export type ParsedOrder = {
  customerName: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  productSummary: string | null;
  quantity: number | null;
  notes: string | null;
  confidence: "low" | "medium" | "high";
};

function cleanup(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function splitLines(rawText: string) {
  return rawText
    .split(/\n+/)
    .map((line) => cleanup(line))
    .filter(Boolean);
}

function findPhone(text: string) {
  const candidates = phoneCandidatesFromText(text);
  return candidates.length === 1 && isUsableOrderPhone(candidates[0]) ? normalizeOrderPhone(candidates[0]) : null;
}

function findAmount(text: string) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:km|sds)\b/i);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function findQuantity(text: string) {
  const match = text.match(/(?:kolicina|količina|kom|x)\s*[:\-]?\s*(\d{1,3})/i);
  if (match) return Number(match[1]);
  const simple = text.match(/\b(\d{1,2})\s*(kom|x)\b/i);
  return simple ? Number(simple[1]) : null;
}

function extractAddress(mainText: string, name: string | null, phone: string | null, city: string | null) {
  let working = mainText;
  if (name) working = working.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  if (phone) working = working.replace(phone, " ");
  if (city) working = working.replace(new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  working = working.replace(/\b\d{5}\b/g, " ");
  working = cleanup(working.replace(/\b(?:mob|br tel|br\. tel|tel|telefon)\b\s*:?/gi, " "));
  return working || null;
}

function extractNameFromMainLine(mainLine: string) {
  const phone = findPhone(mainLine);
  const postal = detectPostalFromText(mainLine);
  let working = mainLine;
  if (phone) working = working.replace(/(\+?387[\d\s\/-]{6,}|06[\d\s\/-]{6,})/i, " ");
  if (postal?.city) working = working.replace(new RegExp(postal.city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  if (postal?.postalCode) working = working.replace(new RegExp(postal.postalCode, "g"), " ");
  working = cleanup(working.replace(/\b(?:mob|br tel|br\. tel|tel|telefon)\b\s*:?/gi, " "));
  const tokens = working.split(" ").filter(Boolean);
  if (tokens.length >= 2) return titleCase(`${tokens[0]} ${tokens[1]}`);
  return tokens.length === 1 ? titleCase(tokens[0]) : null;
}

function parseLabeledMessage(lines: string[]): ParsedOrder | null {
  const hasLabels = lines.some((line) => /^(ime|adresa|grad|mjesto|mob|br tel|br\. tel|telefon)\s*[:\-]/i.test(line));
  if (!hasLabels) return null;

  let customerName: string | null = null;
  let phone: string | null = null;
  let city: string | null = null;
  let address: string | null = null;

  for (const line of lines) {
    if (/^ime(?:\s+i\s+prezime)?\s*[:\-]/i.test(line)) {
      customerName = cleanup(line.replace(/^ime(?:\s+i\s+prezime)?\s*[:\-]\s*/i, "")) || customerName;
      continue;
    }

    if (/^(mob|br tel|br\. tel|telefon)\s*[:\-]/i.test(line)) {
      phone = findPhone(line) || phone;
      continue;
    }

    if (/^(grad|mjesto)\s*[:\-]/i.test(line)) {
      const gradRaw = cleanup(line.replace(/^(grad|mjesto)\s*[:\-]\s*/i, ""));
      const postal = detectPostalFromText(gradRaw);
      city = postal ? `${postal.postalCode} ${titleCase(postal.city)}` : gradRaw || city;
      continue;
    }

    if (/^(adresa|ulica)\s*[:\-]/i.test(line)) {
      const addressRaw = cleanup(line.replace(/^(adresa|ulica)\s*[:\-]\s*/i, ""));
      const postal = detectPostalFromText(addressRaw);
      const parts = addressRaw.split(",").map((part) => cleanup(part)).filter(Boolean);
      if (parts.length >= 2) {
        address = parts.slice(0, -1).join(", ");
        if (!city) {
          const lastPart = parts[parts.length - 1];
          const postal2 = detectPostalFromText(lastPart);
          city = postal2 ? `${postal2.postalCode} ${titleCase(postal2.city)}` : titleCase(lastPart);
        }
      } else {
        address = addressRaw || address;
        if (!city && postal) city = `${postal.postalCode} ${titleCase(postal.city)}`;
      }
      continue;
    }
  }

  const productSummary = lines[lines.length - 1] || null;
  const amount = findAmount(lines.join(" "));
  const quantity = amount ?? findQuantity(lines.join(" "));
  const filledCount = [customerName, phone, city, address, productSummary].filter(Boolean).length;
  const confidence = filledCount >= 4 ? "high" : filledCount >= 3 ? "medium" : "low";

  return {
    customerName,
    phone,
    city,
    address,
    productSummary,
    quantity,
    notes: confidence === "low" ? "Needs review" : null,
    confidence,
  };
}

function parseMessageStyle(rawText: string): ParsedOrder {
  const lines = splitLines(rawText);
  const labeled = parseLabeledMessage(lines);
  if (labeled) return labeled;

  const productLine = lines.length > 1 ? lines[lines.length - 1] : "";
  const amount = findAmount(productLine || rawText);
  const productSummary = productLine ? cleanup(productLine.replace(/\b\d+(?:[.,]\d+)?\s*(?:km|sds)\b/gi, "")) || productLine : null;
  const mainLines = productLine ? lines.slice(0, -1) : lines;

  let customerName: string | null = null;
  let phone: string | null = null;
  let city: string | null = null;
  let address: string | null = null;

  if (mainLines.length >= 4) {
    customerName = titleCase(mainLines[0]);
    address = mainLines[1] || null;
    const postal = detectPostalFromText(mainLines[2]);
    city = postal ? `${postal.postalCode} ${titleCase(postal.city)}` : titleCase(mainLines[2] || "") || null;
    phone = findPhone(mainLines[3]);
  } else {
    const mainText = cleanup(mainLines.join(" "));
    phone = findPhone(mainText);
    const postal = detectPostalFromText(mainText);
    city = postal ? `${postal.postalCode}` : null;
    customerName = extractNameFromMainLine(mainText);

    if (mainLines.length >= 2) {
      const firstLine = cleanup(mainLines[0]);
      const secondLine = cleanup(mainLines[1]);
      if (postal && secondLine.toLowerCase().includes(postal.city.toLowerCase())) {
        address = firstLine;
      } else {
        address = extractAddress(mainText, customerName, phone, city);
      }
    } else {
      address = extractAddress(mainText, customerName, phone, city);
    }
  }

  const quantity = amount ?? findQuantity(rawText);
  const filledCount = [customerName, phone, city, address, productSummary].filter(Boolean).length;
  const confidence = filledCount >= 4 ? "high" : filledCount >= 3 ? "medium" : "low";

  return {
    customerName,
    phone,
    city,
    address,
    productSummary,
    quantity,
    notes: confidence === "low" ? "Needs review" : null,
    confidence,
  };
}

export function parseOrderText(rawText: string): ParsedOrder {
  return parseMessageStyle(rawText);
}
