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
    .split(/\s*\+\s*|\s+&\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function segmentQuantity(value: string) {
  const leading = value.match(/^\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(.+)$/i);
  if (leading) {
    return {
      label: leading[2].trim(),
      quantity: parseQuantity(leading[1]),
    };
  }
  const trailing = value.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:komada|kom|komad)\s*$/i);
  if (trailing) {
    return {
      label: trailing[1].trim(),
      quantity: parseQuantity(trailing[2]),
    };
  }
  const trailingMultiplier = value.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*[x×]\s*$/i);
  if (trailingMultiplier) {
    return {
      label: trailingMultiplier[1].trim(),
      quantity: parseQuantity(trailingMultiplier[2]),
    };
  }
  return { label: value.trim(), quantity: null as number | null };
}

function cleanProductLabel(value: string) {
  return value
    .replace(/\b(?:sds|km)\s*\d+(?:[.,]\d+)?\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:sds|km)\b/gi, " ")
    .replace(/\bposlati\s+u\s+(?:ponedjeljak|utorak|srijedu|cetvrtak|petak|subotu|nedjelju)\b.*$/i, " ")
    .replace(/\bu\s+(?:ponedjeljak|utorak|srijedu|cetvrtak|petak|subotu|nedjelju)\s+da\s+ide\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_PRODUCT_TOKENS = new Set([
  "artikal", "cm", "dnevni", "i", "komad", "komada", "komoda", "klub", "ladica", "ladice",
  "led", "mekoca", "metalne", "metalnim", "nocni", "nogara", "nogare", "nogarama", "ogledalo",
  "ogledalom", "ormar", "ormaric", "polica", "policama", "rasvjeta", "rasvjetom", "s", "sa", "set",
  "sto", "stol", "stolica", "udobnost", "vrata", "vratima", "za",
]);

const PRODUCT_CATEGORY_TOKENS = new Set(["jastuk", "komoda", "ormar", "ormaric", "pidzama", "set", "sto", "stolica"]);
const PRODUCT_COLOR_TOKENS = new Set(["bijeli", "crni", "hrast", "orah", "smedji", "zlatni"]);

function canonicalProductToken(value: string) {
  if (["bijela", "bijeli", "bijelo", "bijelu", "white"].includes(value)) return "bijeli";
  if (["black", "crna", "crne", "crni", "crno"].includes(value)) return "crni";
  if (["braon", "smedja", "smedji", "smedje"].includes(value)) return "smedji";
  if (["gold", "zlatna", "zlatni", "zlatno"].includes(value)) return "zlatni";
  if (["imama", "imara"].includes(value)) return "imara";
  if (["simaknje", "simkanje", "simnkanje", "sminaknje", "sminkanje"].includes(value)) return "sminkanje";
  if (value === "stol") return "sto";
  return value;
}

function normalizedTokenSet(value: string, allowed: Set<string>) {
  return new Set(
    normalizeInventoryName(value)
      .split(" ")
      .map(canonicalProductToken)
      .filter((token) => allowed.has(token)),
  );
}

function disjointWhenBothPresent(left: Set<string>, right: Set<string>) {
  return left.size > 0 && right.size > 0 && !Array.from(left).some((token) => right.has(token));
}

function semanticProductTokens(value: string) {
  return normalizeInventoryName(value)
    .split(" ")
    .map(canonicalProductToken)
    .filter((token) => token && !GENERIC_PRODUCT_TOKENS.has(token));
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

  private matchAlias(sourceLabel: string): Omit<ProductMatch, "quantity"> | null {
    const normalized = normalizeInventoryName(sourceLabel);
    const product = normalized ? this.aliases.get(normalized) : null;
    return product ? { sourceLabel, product, confidence: 1, method: "alias" } : null;
  }

  private matchMaraSet(sourceLabel: string): Array<Omit<ProductMatch, "quantity">> | null {
    const normalized = normalizeInventoryName(cleanProductLabel(sourceLabel));
    const tokens = normalized.split(" ").map(canonicalProductToken).filter(Boolean);
    if (!tokens.includes("mara") || !tokens.includes("set")) return null;

    const colors = ["bijeli", "hrast", "orah"].filter((color) => tokens.includes(color));
    if (colors.length !== 1) return null;
    const color = colors[0];
    const conjunctionParts = sourceLabel.split(/\s+i\s+/i).map((part) => part.trim()).filter(Boolean);
    if (conjunctionParts.length > 1) {
      const allowedRepeat = conjunctionParts.slice(1).every((part) => {
        const partTokens = semanticProductTokens(part);
        return partTokens.length > 0 && partTokens.every((token) => token === "nora" || token === color);
      });
      if (!allowedRepeat) return null;
    }

    const findComponent = (model: "mara" | "nora") => this.products.find((product) => {
      const productTokens = semanticProductTokens(product.normalizedName);
      const categories = normalizedTokenSet(product.normalizedName, PRODUCT_CATEGORY_TOKENS);
      return categories.has("komoda") && productTokens.includes(model) && productTokens.includes(color);
    });
    const mara = findComponent("mara");
    const nora = findComponent("nora");
    if (!mara || !nora) return null;
    return [mara, nora].map((product) => ({
      sourceLabel,
      product,
      confidence: 1,
      method: "fuzzy" as const,
    }));
  }

  private matchOne(sourceLabel: string): Omit<ProductMatch, "quantity"> | null {
    const rawNormalized = normalizeInventoryName(sourceLabel);
    if (!rawNormalized) return null;
    const rawAlias = this.matchAlias(sourceLabel);
    if (rawAlias) return rawAlias;
    const normalized = normalizeInventoryName(cleanProductLabel(sourceLabel));
    if (!normalized) return null;
    const alias = this.aliases.get(normalized);
    if (alias) return { sourceLabel, product: alias, confidence: 1, method: "alias" };
    const exact = this.productsByName.get(normalized);
    if (exact) return { sourceLabel, product: exact, confidence: 1, method: "exact" };
    const sourceCategories = normalizedTokenSet(normalized, PRODUCT_CATEGORY_TOKENS);
    const sourceTokens = semanticProductTokens(normalized);
    if (sourceCategories.has("sto") && sourceTokens.includes("duma")) {
      const dumaTables = this.products.filter((product) =>
        normalizedTokenSet(product.normalizedName, PRODUCT_CATEGORY_TOKENS).has("sto")
        && semanticProductTokens(product.normalizedName).includes("duma"));
      if (dumaTables.length === 1) {
        return { sourceLabel, product: dumaTables[0], confidence: 0.8, method: "fuzzy" };
      }
    }
    if (sourceTokens.length > 0) {
      const sourceNumbers = new Set(sourceTokens.filter((token) => /^\d+(?:[.,]\d+)?$/.test(token)));
      const sourceColors = normalizedTokenSet(normalized, PRODUCT_COLOR_TOKENS);
      const candidates = this.products
        .map((product) => {
          const productTokens = semanticProductTokens(product.normalizedName);
          const productTokenSet = new Set(productTokens);
          const productNumbers = new Set(productTokens.filter((token) => /^\d+(?:[.,]\d+)?$/.test(token)));
          const productCategories = normalizedTokenSet(product.normalizedName, PRODUCT_CATEGORY_TOKENS);
          const productColors = normalizedTokenSet(product.normalizedName, PRODUCT_COLOR_TOKENS);
          const numberConflict = disjointWhenBothPresent(sourceNumbers, productNumbers);
          const knownVanitySet = sourceCategories.has("set") && productCategories.has("sto")
            && sourceTokens.includes("zola") && productTokens.includes("zola");
          const categoryConflict = disjointWhenBothPresent(sourceCategories, productCategories) && !knownVanitySet;
          const multiCategoryConflict = sourceCategories.has("sto") && sourceCategories.has("stolica")
            && !(productCategories.has("sto") && productCategories.has("stolica"));
          const colorConflict = disjointWhenBothPresent(sourceColors, productColors);
          const overlap = sourceTokens.filter((token) => productTokenSet.has(token)).length;
          return {
            product,
            score: numberConflict || categoryConflict || multiCategoryConflict || colorConflict
              ? 0
              : overlap / Math.min(sourceTokens.length, productTokens.length),
          };
        })
        .filter((candidate) => candidate.score >= 0.6)
        .sort((left, right) => right.score - left.score);
      const best = candidates[0];
      const runnerUp = candidates[1];
      if (best && (!runnerUp || best.score - runnerUp.score >= 0.2)) {
        return {
          sourceLabel,
          product: best.product,
          confidence: Math.round((0.8 + best.score * 0.18) * 100) / 100,
          method: "fuzzy",
        };
      }
    }
    const result = this.fuse.search(normalized, { limit: 1 })[0];
    if (!result || result.score === undefined || result.score > 0.42) return null;
    return {
      sourceLabel,
      product: result.item,
      confidence: Math.max(0, Math.round((1 - result.score) * 100) / 100),
      method: "fuzzy",
    };
  }

  private splitConjunction(value: string) {
    const parts = value.split(/\s+i\s+/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    return parts.every((part) => {
      const label = segmentQuantity(part).label;
      return Boolean(this.matchMaraSet(label) || this.matchOne(label));
    }) ? parts : null;
  }

  private splitImplicitPair(value: string) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length < 4) return null;
    let best: { parts: string[]; confidence: number } | null = null;

    for (let index = 2; index <= words.length - 2; index += 1) {
      const left = words.slice(0, index).join(" ");
      const right = words.slice(index).join(" ");
      const leftMatch = this.matchOne(segmentQuantity(left).label);
      const rightMatch = this.matchOne(segmentQuantity(right).label);
      if (!leftMatch || !rightMatch || leftMatch.product.id === rightMatch.product.id) continue;
      const confidence = Math.min(leftMatch.confidence, rightMatch.confidence);
      if (confidence < 0.58 || (best && confidence <= best.confidence)) continue;
      best = { parts: [left, right], confidence };
    }

    return best?.parts || null;
  }

  match(description: string, orderQuantity: string | number): ProductMatchResult {
    const source = String(description || "").trim();
    if (!source || this.products.length === 0) return { matches: [], unmatched: source ? [source] : [] };
    const totalQuantity = parseQuantity(orderQuantity);
    const sourceSegment = segmentQuantity(source);
    const savedAlias = this.matchAlias(source);
    if (savedAlias) {
      return {
        matches: [{ ...savedAlias, quantity: sourceSegment.quantity || totalQuantity }],
        unmatched: [],
      };
    }
    let parts = splitDescription(source);
    const wholeBundle = parts.length === 1 ? this.matchMaraSet(sourceSegment.label) : null;
    if (wholeBundle) {
      const quantity = sourceSegment.quantity || 1;
      return { matches: wholeBundle.map((match) => ({ ...match, quantity })), unmatched: [] };
    }
    const direct = this.matchOne(sourceSegment.label);
    if (parts.length === 1 && direct?.method !== "alias" && direct?.method !== "exact") {
      parts = this.splitConjunction(source) || this.splitImplicitPair(source) || parts;
    }
    if (parts.length === 1 || (direct && direct.confidence >= 0.82)) {
      return direct
        ? { matches: [{ ...direct, quantity: sourceSegment.quantity || totalQuantity }], unmatched: [] }
        : { matches: [], unmatched: [source] };
    }

    const matches: ProductMatch[] = [];
    const unmatched: string[] = [];
    const parsedParts = parts.map((value) => {
      const part = segmentQuantity(value);
      return { ...part, bundle: this.matchMaraSet(part.label) };
    });
    const explicitUnits = parsedParts.reduce(
      (sum, part) => sum + (part.quantity || 0) * (part.bundle?.length || 1),
      0,
    );
    const unspecifiedUnits = parsedParts.reduce(
      (sum, part) => sum + (part.quantity === null ? part.bundle?.length || 1 : 0),
      0,
    );
    let extraUnits = Math.max(0, totalQuantity - explicitUnits - unspecifiedUnits);

    parsedParts.forEach((part) => {
      let quantity = part.quantity;
      if (quantity === null) {
        quantity = 1;
        if (!part.bundle && extraUnits > 0) {
          quantity += extraUnits;
          extraUnits = 0;
        }
      }
      if (part.bundle) {
        matches.push(...part.bundle.map((match) => ({ ...match, quantity })));
        return;
      }
      const match = this.matchOne(part.label);
      if (match) matches.push({ ...match, quantity });
      else unmatched.push(part.label);
    });

    return { matches, unmatched };
  }
}
