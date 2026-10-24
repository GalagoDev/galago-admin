import type { ShopifyProductWebhook, ShopifyVariantInput } from "./ananas-types";

export type BazzarOffer = {
  id: string;
  title: string;
  brand: string;
  stock: number;
  ean: string | null;
  weight: number | null;
  description: string;
  category: string | null;
  specification: string | null;
  retailPrice: string;
  discountedRetailPrice: string | null;
  vendorPrice: string;
  images: string[];
};

function moneyCents(value: unknown): number {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Invalid Shopify price");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1_000_000_000) throw new Error("Shopify price out of range");
  return cents;
}

function amount(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function bazzarPrices(price: unknown, compareAtPrice: unknown) {
  const current = moneyCents(price);
  const comparison = compareAtPrice == null || String(compareAtPrice).trim() === "" || Number(compareAtPrice) === 0 ? null : moneyCents(compareAtPrice);
  const regular = comparison && comparison > current ? comparison : current;
  // Net vendor amount = VAT-inclusive actual selling price × 85 / 117.
  // Integer arithmetic rounds once, to the nearest cent (half up).
  const vendorCents = Math.floor((current * 85 + 58) / 117);
  if (vendorCents <= 0) throw new Error("Bazzar vendor price must be positive");
  return {
    retailPrice: amount(regular),
    discountedRetailPrice: regular > current ? amount(current) : null,
    vendorPrice: amount(vendorCents),
  };
}

function cleanXml(value: string) {
  return [...value].filter((character) => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
  }).join("");
}

export function escapeXml(value: string | number) {
  return cleanXml(String(value)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function weightGrams(variant: ShopifyVariantInput) {
  if (variant.weight == null || variant.weight === 0) return null;
  if (!Number.isFinite(variant.weight) || variant.weight < 0) throw new Error("Invalid Shopify weight");
  const factor = { g: 1, kg: 1000, lb: 453.59237, lbs: 453.59237, oz: 28.349523125 }[String(variant.weight_unit || "kg").toLowerCase()];
  if (!factor) throw new Error("Unknown Shopify weight unit");
  return Math.max(1, Math.round(variant.weight * factor));
}

export function mapBazzarCatalog(products: ShopifyProductWebhook[]) {
  const offers: BazzarOffer[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const eans = new Set<string>();
  for (const product of products) {
    if (product.source_store) throw new Error("Bazzar feed received a non-Galago catalog source");
    if (product.status !== "active") continue;
    if (!/^galago(?:\.ba)?$/i.test(product.vendor?.trim() || "")) {
      warnings.push(`Proizvod ${product.id}: nije Galago brend i nije uključen.`);
      continue;
    }
    if (!product.variants?.length) throw new Error(`Product ${product.id} has no variants`);
    for (const variant of product.variants) {
      if (!Number.isSafeInteger(variant.id) || variant.id <= 0) throw new Error("Invalid Shopify variant ID");
      const id = `GALAGO-${variant.id}`;
      if (ids.has(id)) throw new Error(`Duplicate Bazzar ID: ${id}`);
      ids.add(id);
      const variantTitle = variant.title?.trim();
      const title = cleanXml(`${product.title?.trim() || ""}${variantTitle && variantTitle.toLowerCase() !== "default title" ? ` - ${variantTitle}` : ""}`);
      if (!product.title?.trim()) throw new Error(`${id}: missing product title`);
      const description = cleanXml(product.body_html?.trim() || "");
      if (!description) throw new Error(`${id}: missing description`);
      const images = [...new Set([variant.image_src, product.image?.src, ...(product.images || []).map((image) => image.src)]
        .filter((value): value is string => Boolean(value?.startsWith("https://"))))];
      if (!images.length) throw new Error(`${id}: missing HTTPS product image`);
      for (const url of images) {
        if (url.length > 255 || new URL(url).username || new URL(url).password) throw new Error(`${id}: invalid image URL`);
      }
      const tracked = variant.inventory_tracked === true || (variant.inventory_tracked == null && Boolean(variant.inventory_management));
      if (tracked && (!Number.isSafeInteger(variant.inventory_quantity) || variant.inventory_quantity == null)) throw new Error(`${id}: invalid stock`);
      const stock = tracked ? Math.max(0, variant.inventory_quantity!) : 0;
      if (!tracked) warnings.push(`${id}: lager se ne prati u Shopifyju; šalje se 0.`);
      const ean = variant.barcode?.trim() || null;
      if (ean && (!/^\d{8,14}$/.test(ean) || eans.has(ean))) throw new Error(`${id}: invalid or duplicate EAN`);
      if (ean) eans.add(ean);
      else warnings.push(`${id}: EAN nije unesen u Shopifyju.`);
      const weight = weightGrams(variant);
      if (weight == null) warnings.push(`${id} (${product.title}): težina nije unesena; XML ne šalje izmišljenu težinu.`);
      if ([...title].length > 120) warnings.push(`${id}: naziv skraćen na 120 znakova.`);
      offers.push({
        id, title: [...title].slice(0, 120).join(""), brand: product.vendor!.trim().slice(0, 120),
        stock, ean, weight, description, images,
        category: product.product_type?.trim() || null,
        specification: (variant.selected_options || []).filter((option) => option.name !== "Title" && option.value !== "Default Title")
          .map((option) => `${option.name}: ${option.value}`).join("|") || null,
        ...bazzarPrices(variant.price, variant.compare_at_price),
      });
    }
  }
  // An empty or partially invalid feed could deactivate the entire marketplace catalog.
  if (!offers.length) throw new Error("Empty Galago catalog refused; do not deactivate Bazzar products on a source failure");
  return { offers, warnings };
}

export function renderBazzarXml(offers: BazzarOffer[]) {
  if (!offers.length) throw new Error("Refusing an empty Bazzar XML");
  const tag = (name: string, value: string | number) => `    <${name}>${escapeXml(value)}</${name}>`;
  return `<?xml version="1.0" encoding="utf-8"?>\n<products>\n${offers.map((offer) => [
    "  <product>", tag("id", offer.id), tag("title", offer.title), tag("brand", offer.brand), tag("stock", offer.stock),
    ...(offer.ean ? [tag("ean", offer.ean)] : []), ...(offer.weight == null ? [] : [tag("weight", offer.weight)]),
    tag("description", offer.description), ...(offer.specification ? [tag("specification", offer.specification)] : []),
    tag("retail_price", offer.retailPrice),
    ...(offer.discountedRetailPrice ? [tag("discounted_retail_price", offer.discountedRetailPrice)] : []),
    tag("vendor_price", offer.vendorPrice),
    "    <images>", ...offer.images.map((url) => `      <image>${escapeXml(url)}</image>`), "    </images>",
    ...(offer.category ? [tag("category", offer.category)] : []), "  </product>",
  ].join("\n")).join("\n")}\n</products>\n`;
}
