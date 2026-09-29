import type { ShopifyProductWebhook, ShopifyVariantInput } from "./ananas-types.ts";
import { normalizeInventoryName } from "./inventory-import.ts";
import type { MatchableInventoryAlias, MatchableInventoryProduct } from "./product-matching.ts";
import { ProductMatcher } from "./product-matching.ts";

type StockCandidate = {
  inventoryProductId: number;
  shopifyProductId: string;
  quantity: number;
  label: string;
  method: "identifier" | "name";
};

export type ShopifyInventoryMatchResult = {
  updates: Array<{
    productId: number;
    quantity: number;
    sourceLabels: string[];
    method: "identifier" | "name";
  }>;
  totalVariants: number;
  trackedVariants: number;
  matchedVariants: number;
  unmatchedLabels: string[];
  ambiguousLabels: string[];
  untrackedLabels: string[];
};

function normalizeIdentifier(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("bs-BA").replace(/\s+/g, "");
}

function inventoryIdentifiers(value: string) {
  return value
    .split(/[,;|/\n]+/)
    .map(normalizeIdentifier)
    .filter(Boolean);
}

function shopifyIdentifiers(variant: ShopifyVariantInput) {
  return [variant.sku, variant.barcode].map(normalizeIdentifier).filter(Boolean);
}

function canonicalTitleToken(value: string) {
  if (["bijela", "bijeli", "bijelo", "bijelu", "white"].includes(value)) return "bijeli";
  if (["black", "crna", "crne", "crni", "crno"].includes(value)) return "crni";
  if (["braon", "smedja", "smedji", "smedje"].includes(value)) return "smedji";
  if (["gold", "zlatna", "zlatni", "zlatno"].includes(value)) return "zlatni";
  if (["simaknje", "simkanje", "simnkanje", "sminaknje", "sminkanje"].includes(value)) return "sminkanje";
  if (value === "stol") return "sto";
  return value;
}

function titleTokens(value: string) {
  return normalizeInventoryName(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map(canonicalTitleToken)
    .filter(Boolean);
}

function uniqueTitleMatch(products: MatchableInventoryProduct[], label: string) {
  const sourceTokens = new Set(titleTokens(label));
  const candidates = products.filter((product) => {
    const productTokens = titleTokens(product.name);
    return productTokens.length >= 2 && productTokens.every((token) => sourceTokens.has(token));
  });
  return candidates.length === 1
    ? { product: candidates[0], ambiguous: false }
    : { product: null, ambiguous: candidates.length > 1 };
}

const COLOR_TOKENS = new Set(["bijeli", "crni", "hrast", "orah", "smedji", "zlatni"]);

function unsafeNameMatch(label: string, product: MatchableInventoryProduct) {
  const sourceTokens = new Set(titleTokens(label));
  const productTokens = new Set(titleTokens(product.name));
  const sourceColors = [...sourceTokens].filter((token) => COLOR_TOKENS.has(token));
  const productColors = [...productTokens].filter((token) => COLOR_TOKENS.has(token));
  const colorConflict = sourceColors.length > 0
    && productColors.length > 0
    && !sourceColors.some((color) => productColors.includes(color));
  const setMappedToComponent = sourceTokens.has("set") && !productTokens.has("set");
  return colorConflict || setMappedToComponent;
}

function variantLabel(product: ShopifyProductWebhook, variant: ShopifyVariantInput) {
  const title = String(variant.title || "").trim();
  if (!title || title.toLocaleLowerCase("bs-BA") === "default title") return product.title.trim();
  return `${product.title.trim()} - ${title}`;
}

function trackedQuantity(variant: ShopifyVariantInput) {
  const tracked = typeof variant.inventory_tracked === "boolean"
    ? variant.inventory_tracked
    : Boolean(variant.inventory_management);
  if (!tracked) return null;
  const quantity = Number(variant.inventory_quantity);
  return Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0;
}

export function matchShopifyInventory(
  products: MatchableInventoryProduct[],
  aliases: MatchableInventoryAlias[],
  shopifyProducts: ShopifyProductWebhook[],
): ShopifyInventoryMatchResult {
  const identifierMatches = new Map<string, number | null>();
  for (const product of products) {
    for (const identifier of inventoryIdentifiers((product as MatchableInventoryProduct & { sku?: string }).sku || "")) {
      const existing = identifierMatches.get(identifier);
      identifierMatches.set(identifier, existing === undefined || existing === product.id ? product.id : null);
    }
  }

  const matcher = new ProductMatcher(products, aliases);
  const candidates: StockCandidate[] = [];
  const unmatchedLabels: string[] = [];
  const ambiguousLabels: string[] = [];
  const untrackedLabels: string[] = [];
  let totalVariants = 0;
  let trackedVariants = 0;

  for (const shopifyProduct of shopifyProducts) {
    for (const variant of shopifyProduct.variants || []) {
      totalVariants += 1;
      const label = variantLabel(shopifyProduct, variant);
      const quantity = trackedQuantity(variant);
      if (quantity === null) {
        untrackedLabels.push(label);
        continue;
      }
      trackedVariants += 1;

      const identifierProductIds = new Set(
        shopifyIdentifiers(variant)
          .map((identifier) => identifierMatches.get(identifier))
          .filter((productId): productId is number => typeof productId === "number"),
      );
      if (identifierProductIds.size === 1) {
        candidates.push({
          inventoryProductId: [...identifierProductIds][0],
          shopifyProductId: String(shopifyProduct.id),
          quantity,
          label,
          method: "identifier",
        });
        continue;
      }
      if (identifierProductIds.size > 1) {
        ambiguousLabels.push(label);
        continue;
      }

      const titleMatch = uniqueTitleMatch(products, label);
      if (titleMatch.ambiguous) {
        ambiguousLabels.push(label);
        continue;
      }
      if (titleMatch.product) {
        candidates.push({
          inventoryProductId: titleMatch.product.id,
          shopifyProductId: String(shopifyProduct.id),
          quantity,
          label,
          method: "name",
        });
        continue;
      }

      const matched = matcher.match(label, 1);
      if (
        matched.unmatched.length
        || matched.matches.length !== 1
        || matched.matches[0].confidence < 0.8
        || unsafeNameMatch(label, matched.matches[0].product)
      ) {
        unmatchedLabels.push(label);
        continue;
      }
      candidates.push({
        inventoryProductId: matched.matches[0].product.id,
        shopifyProductId: String(shopifyProduct.id),
        quantity,
        label,
        method: "name",
      });
    }
  }

  const candidatesByProduct = new Map<number, StockCandidate[]>();
  for (const candidate of candidates) {
    candidatesByProduct.set(candidate.inventoryProductId, [
      ...(candidatesByProduct.get(candidate.inventoryProductId) || []),
      candidate,
    ]);
  }

  const updates: ShopifyInventoryMatchResult["updates"] = [];
  let matchedVariants = 0;
  for (const [productId, productCandidates] of candidatesByProduct) {
    const identifierCandidates = productCandidates.filter((candidate) => candidate.method === "identifier");
    const selected = identifierCandidates.length ? identifierCandidates : productCandidates;
    const sourceProductIds = new Set(selected.map((candidate) => candidate.shopifyProductId));
    if (sourceProductIds.size !== 1) {
      ambiguousLabels.push(...selected.map((candidate) => candidate.label));
      continue;
    }
    matchedVariants += selected.length;
    updates.push({
      productId,
      quantity: selected.reduce((sum, candidate) => sum + candidate.quantity, 0),
      sourceLabels: selected.map((candidate) => candidate.label),
      method: identifierCandidates.length ? "identifier" : "name",
    });
  }

  return {
    updates,
    totalVariants,
    trackedVariants,
    matchedVariants,
    unmatchedLabels: [...new Set(unmatchedLabels)],
    ambiguousLabels: [...new Set(ambiguousLabels)],
    untrackedLabels: [...new Set(untrackedLabels)],
  };
}
