export type ParsedInventoryItem = {
  sku: string;
  name: string;
  normalizedName: string;
  unitCost: number;
  quantity: number;
};

export class InventoryParseError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryParseError";
    this.code = code;
  }
}

export function normalizeInventoryName(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("bs-BA")
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  let normalized = String(value ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!normalized) return Number.NaN;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

const HEADER_ALIASES = {
  name: ["naziv artikla", "naziv proizvoda", "artikal", "proizvod", "naziv", "product", "item", "description", "opis"],
  cost: ["nabavna cijena", "nabavna cena", "cijena nabave", "ulazna cijena", "nab cijena", "purchase price", "unit cost", "cost", "cijena"],
  quantity: ["kolicina", "stanje lagera", "stanje", "lager", "zaliha", "stock", "quantity", "qty"],
  sku: ["sifra artikla", "sifra", "sku", "ean", "barcode", "kod artikla", "kod"],
} as const;

function findColumn(headers: string[], aliases: readonly string[]) {
  for (const alias of aliases) {
    const exact = headers.findIndex((header) => header === alias);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const partial = headers.findIndex((header) => header.includes(alias));
    if (partial >= 0) return partial;
  }
  return -1;
}

export function parseInventoryRows(rows: unknown[][]) {
  let detected: { rowIndex: number; name: number; cost: number; quantity: number; sku: number } | null = null;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const headers = (rows[rowIndex] || []).map(normalizeInventoryName);
    const name = findColumn(headers, HEADER_ALIASES.name);
    const cost = findColumn(headers, HEADER_ALIASES.cost);
    const quantity = findColumn(headers, HEADER_ALIASES.quantity);
    const sku = findColumn(headers, HEADER_ALIASES.sku);
    if (name >= 0 && cost >= 0 && quantity >= 0) {
      detected = { rowIndex, name, cost, quantity, sku };
      break;
    }
  }

  if (!detected) {
    throw new InventoryParseError(
      "columns-missing",
      "Lager mora imati kolone za naziv artikla, nabavnu cijenu i količinu.",
    );
  }

  const items = new Map<string, ParsedInventoryItem>();
  for (const row of rows.slice(detected.rowIndex + 1)) {
    const name = String(row?.[detected.name] ?? "").trim().replace(/\s+/g, " ");
    const normalizedName = normalizeInventoryName(name);
    if (!normalizedName) continue;
    const unitCost = parseNumber(row?.[detected.cost]);
    const quantity = parseNumber(row?.[detected.quantity]);
    if (!Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(quantity) || quantity < 0) continue;
    items.set(normalizedName, {
      sku: detected.sku >= 0 ? String(row?.[detected.sku] ?? "").trim().slice(0, 120) : "",
      name: name.slice(0, 240),
      normalizedName,
      unitCost: Math.round(unitCost * 100) / 100,
      quantity: Math.round(quantity * 1000) / 1000,
    });
  }

  if (items.size === 0) {
    throw new InventoryParseError("items-missing", "Nijedan ispravan artikal nije pronađen u lageru.");
  }

  return {
    headerRowNumber: detected.rowIndex + 1,
    items: Array.from(items.values()),
  };
}
