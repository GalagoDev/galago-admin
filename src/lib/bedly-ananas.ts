import { getDb } from "@/lib/db";
import type { ShopifyProductWebhook } from "@/lib/ananas-types";

// Deliberate allowlist: other Bedly products must never enter Ananas implicitly.
export const BEDLY_ANANAS_PRODUCTS = [
  {
    productId: 9401370804412,
    variantId: 46984210251964,
    handle: "bedly-ergonomski-jastuk",
    inventorySku: "16",
    inventoryName: "Bedly ergonomski jastuk",
    unitsPerPack: 1,
    category: "Jastuci",
  },
  {
    productId: 9409184596156,
    variantId: 47011719217340,
    handle: "bedly-hotel-hotelska-udobnost-kod-kuce",
    inventorySku: "17",
    inventoryName: "Bedly cloud jastuk",
    unitsPerPack: 2,
    category: "Jastuci",
  },
] as const;

type BedlyProductConfig = (typeof BEDLY_ANANAS_PRODUCTS)[number];
type StorefrontProduct = {
  id: number;
  title: string;
  description: string;
  handle: string;
  images: string[];
  variants: Array<{
    id: number;
    price: number;
    compare_at_price: number | null;
    weight: number;
    available: boolean;
  }>;
};
type InventoryRow = { sku: string; name: string; quantity: number; active: number };

// Same merchant-internal EAN convention used for Galago; not a GS1 allocation.
export function bedlyEan(variantId: number) {
  const body = `20${String(variantId).slice(-10)}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${body}${(10 - sum % 10) % 10}`;
}

export function mapBedlySource(
  config: BedlyProductConfig,
  product: StorefrontProduct,
  inventory: InventoryRow | undefined,
): ShopifyProductWebhook {
  if (product.id !== config.productId || product.handle !== config.handle) {
    throw new Error(`Bedly product identity changed: ${config.handle}`);
  }
  if (!inventory || inventory.sku !== config.inventorySku || inventory.name !== config.inventoryName) {
    throw new Error(`Bedly Lager mapping is missing or ambiguous: ${config.inventorySku}`);
  }
  if (!Number.isFinite(inventory.quantity)) throw new Error(`Invalid Bedly Lager quantity: ${config.inventorySku}`);
  const variant = product.variants.find((item) => item.id === config.variantId);
  if (!variant || product.variants.length !== 1) throw new Error(`Bedly variants changed: ${config.handle}`);
  if (!Number.isInteger(variant.price) || variant.price <= 0) throw new Error(`Invalid Bedly price: ${config.handle}`);
  if (variant.compare_at_price != null && (!Number.isInteger(variant.compare_at_price) || variant.compare_at_price < 0)) {
    throw new Error(`Invalid Bedly compare-at price: ${config.handle}`);
  }
  if (!product.title?.trim() || !product.description?.trim() || !product.images?.length) {
    throw new Error(`Incomplete Bedly catalog: ${config.handle}`);
  }
  const images = product.images.map((url) => url.startsWith("//") ? `https:${url}` : url);
  const pack = config.unitsPerPack;
  return {
    source_store: "bedly",
    id: config.productId,
    title: pack > 1 ? `${product.title} – set od ${pack} jastuka` : product.title,
    body_html: pack > 1
      ? `<p>Pakovanje sadrži ${pack} Bedly Cloud jastuka. Navedena cijena odnosi se na cijeli set.</p>${product.description}`
      : product.description,
    vendor: "Bedly",
    product_type: config.category,
    status: "active",
    handle: product.handle,
    image: { src: images[0] },
    images: images.map((src) => ({ src })),
    variants: [{
      id: config.variantId,
      product_id: config.productId,
      title: "Default Title",
      sku: `BEDLY-${config.inventorySku}${pack > 1 ? `-SET${pack}` : ""}`,
      barcode: bedlyEan(config.variantId),
      // Ajax monetary values are minor units, already VAT-inclusive. Do not add VAT.
      price: variant.price / 100,
      compare_at_price: variant.compare_at_price ? variant.compare_at_price / 100 : null,
      inventory_tracked: true,
      inventory_quantity: inventory.active === 1 && variant.available
        ? Math.floor(Math.max(0, inventory.quantity) / pack) : 0,
      weight: variant.weight > 0 ? variant.weight : null,
      weight_unit: "g",
      selected_options: pack > 1 ? [{ name: "Broj komada u pakovanju", value: String(pack) }] : [],
    }],
  };
}

async function storefrontJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://bedly.ba${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Bedly storefront ${path} failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function getBedlyProductsForAnanas() {
  if (process.env.ANANAS_BEDLY_ENABLED?.trim().toLowerCase() === "false") return [];
  const cart = await storefrontJson<{ currency: string }>("/cart.js");
  if (cart.currency !== "BAM") throw new Error(`Bedly storefront currency must be BAM; received ${cart.currency}`);
  const products = await Promise.all(BEDLY_ANANAS_PRODUCTS.map(async (config) => {
    const product = await storefrontJson<StorefrontProduct>(`/products/${config.handle}.js`);
    const rows = getDb().prepare("SELECT sku, name, quantity, active FROM inventory_products WHERE sku = ?")
      .all(config.inventorySku) as InventoryRow[];
    if (rows.length !== 1) throw new Error(`Expected one Bedly Lager row for SKU ${config.inventorySku}`);
    return mapBedlySource(config, product, rows[0]);
  }));
  return products;
}
