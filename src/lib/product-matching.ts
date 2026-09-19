import Fuse from "fuse.js";

import { normalizeInventoryName } from "./inventory-import.ts";

export type MatchableInventoryProduct = {
  id: number;
  name: string;
  normalizedName: string;
  unitCost: number;
  quantity: number;
};

export type MatchableInventoryAlias = {
  normalizedAlias: string;
  productId: number;
};

export type ProductMatch = {
  sourceLabel: string;
  quantity: number;
  product: MatchableInventoryProduct;
  confidence: number;
  method: "alias" | "exact" | "fuzzy";
};

export type ProductMatchResult = {
  matches: ProductMatch[];
  unmatched: string[];
};

function parseQuantity(value: string | number) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function splitDescription(value: string) {
  return value
    .split(/\s+\+\s+|\s+&\s+|\s+i\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function segmentQuantity(value: string) {
  const leading = value.match(/^\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(.+)$/i);
  if (!leading) return { label: value.trim(), quantity: null as number | null };
  return {
    label: leading[2].trim(),
    quantity: parseQuantity(leading[1]),
  };
}

export class ProductMatcher {
  private products: MatchableInventoryProduct[];
  private productsById: Map<number, MatchableInventoryProduct>;
  private productsByName: Map<string, MatchableInventoryProduct>;
  private aliases: Map<string, MatchableInventoryProduct>;
  private fuse: Fuse<MatchableInventoryProduct>;

  constructor(products: MatchableInventoryProduct[], aliases: MatchableInventoryAlias[] = []) {
    this.products = products;
    this.productsById = new Map(products.map((product) => [product.id, product]));
    this.productsByName = new Map(products.map((product) => [product.normalizedName, product]));
    this.aliases = new Map(
      aliases
        .map((alias) => [alias.normalizedAlias, this.productsById.get(alias.productId)] as const)
        .filter((entry): entry is readonly [string, MatchableInventoryProduct] => Boolean(entry[1])),
    );
    this.fuse = new Fuse(products, {
      keys: ["normalizedName"],
      includeScore: true,
      ignoreLocation: true,
      minMatchCharLength: 3,
      threshold: 0.42,
    });
  }

  private matchOne(sourceLabel: string): Omit<ProductMatch, "quantity"> | null {
    const normalized = normalizeInventoryName(sourceLabel);
    if (!normalized) return null;
    const alias = this.aliases.get(normalized);
    if (alias) return { sourceLabel, product: alias, confidence: 1, method: "alias" };
    const exact = this.productsByName.get(normalized);
    if (exact) return { sourceLabel, product: exact, confidence: 1, method: "exact" };
    const result = this.fuse.search(normalized, { limit: 1 })[0];
    if (!result || result.score === undefined || result.score > 0.42) return null;
    return {
      sourceLabel,
      product: result.item,
      confidence: Math.max(0, Math.round((1 - result.score) * 100) / 100),
      method: "fuzzy",
    };
  }

  match(description: string, orderQuantity: string | number): ProductMatchResult {
    const source = String(description || "").trim();
    if (!source || this.products.length === 0) return { matches: [], unmatched: source ? [source] : [] };
    const totalQuantity = parseQuantity(orderQuantity);
    const parts = splitDescription(source);
    const direct = this.matchOne(source);
    if (parts.length === 1 || (direct && direct.confidence >= 0.82)) {
      return direct
        ? { matches: [{ ...direct, quantity: totalQuantity }], unmatched: [] }
        : { matches: [], unmatched: [source] };
    }

    const matches: ProductMatch[] = [];
    const unmatched: string[] = [];
    const parsedParts = parts.map(segmentQuantity);
    const explicitUnits = parsedParts.reduce((sum, part) => sum + (part.quantity || 0), 0);
    const unspecified = parsedParts.filter((part) => part.quantity === null).length;
    let remainingUnits = Math.max(0, totalQuantity - explicitUnits);

    parsedParts.forEach((part, index) => {
      let quantity = part.quantity;
      if (quantity === null) {
        quantity = remainingUnits > 0 ? 1 : unspecified === 1 ? totalQuantity : 1;
        remainingUnits = Math.max(0, remainingUnits - quantity);
      }
      if (index === 0 && remainingUnits > 0) {
        quantity += remainingUnits;
        remainingUnits = 0;
      }
      const match = this.matchOne(part.label);
      if (match) matches.push({ ...match, quantity });
      else unmatched.push(part.label);
    });

    return { matches, unmatched };
  }
}
