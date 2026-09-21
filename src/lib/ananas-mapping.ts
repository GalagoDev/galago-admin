import type {
  AnanasDiscountType,
  MappedAnanasVariant,
  ShopifyProductWebhook,
  ShopifyVariantInput,
} from "./ananas-types";

const ALLOWED_DISCOUNT_TYPES = new Set<AnanasDiscountType>([
  "SALE",
  "SEASONAL_SALE",
  "CLEARANCE_SALE",
]);

function positiveMoney(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function nonNegativeInteger(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value || 0));
}

function tracksInventory(variant: ShopifyVariantInput) {
  if (typeof variant.inventory_tracked === "boolean") return variant.inventory_tracked;
  if (variant.inventory_management !== undefined) return Boolean(variant.inventory_management);
  return true;
}

function packageWeightKg(variant: ShopifyVariantInput, fallbackKg: number) {
  const raw = Number(variant.weight || 0);
  if (!Number.isFinite(raw) || raw <= 0) return fallbackKg;

  switch (String(variant.weight_unit || "kg").toLowerCase()) {
    case "g":
      return raw / 1000;
    case "lb":
    case "lbs":
      return raw * 0.45359237;
    case "oz":
      return raw * 0.0283495231;
    default:
      return raw;
  }
}

function dateForAnanas(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  return null;
}

function sarajevoTodayForAnanas() {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return dateForAnanas(iso) as string;
}

function discountType(value: string | null | undefined): AnanasDiscountType {
  const candidate = String(value || "SALE").toUpperCase() as AnanasDiscountType;
  return ALLOWED_DISCOUNT_TYPES.has(candidate) ? candidate : "SALE";
}

function cleanDescription(value: string | null | undefined) {
  return String(value || "")
    .replace(/<(b|i)(\s[^>]*)?>/gi, "")
    .replace(/<\/(b|i)>/gi, "")
    .trim();
}

function productName(product: ShopifyProductWebhook, variant: ShopifyVariantInput) {
  const variantTitle = String(variant.title || "").trim();
  if (!variantTitle || variantTitle.toLowerCase() === "default title") return product.title.trim();
  return `${product.title.trim()} - ${variantTitle}`;
}

function uniqueHttpsImages(product: ShopifyProductWebhook, variant: ShopifyVariantInput) {
  const candidates = [
    variant.image_src,
    product.image?.src,
    ...(product.images || []).map((image) => image.src),
  ];
  return [...new Set(candidates.filter((value): value is string => Boolean(value?.startsWith("https://"))))];
}

export function mapShopifyProductToAnanas(
  product: ShopifyProductWebhook,
  options: {
    vat?: number;
    defaultWeightKg?: number;
    defaultBrand?: string;
    untrackedStockLevel?: number;
    today?: string;
  } = {},
): MappedAnanasVariant[] {
  const vat = options.vat ?? 17;
  const fallbackWeight = options.defaultWeightKg ?? 1;

  return (product.variants || []).map((variant) => {
    const errors: string[] = [];
    const ean = String(variant.barcode || "").trim();
    const sku = String(variant.sku || variant.id).trim();
    const currentPrice = positiveMoney(variant.price);
    const compareAtPrice = positiveMoney(variant.compare_at_price);
    const onSale = Boolean(currentPrice && compareAtPrice && compareAtPrice > currentPrice);
    const basePrice = onSale ? compareAtPrice : currentPrice;
    const images = uniqueHttpsImages(product, variant);
    const description = cleanDescription(product.body_html);
    const weight = Math.round(packageWeightKg(variant, fallbackWeight) * 1000) / 1000;
    const stockLevel = tracksInventory(variant)
      ? nonNegativeInteger(variant.inventory_quantity)
      : nonNegativeInteger(options.untrackedStockLevel);

    if (!ean) errors.push("Missing EAN/barcode");
    if (!basePrice) errors.push("Missing or invalid price");
    if (!description) errors.push("Missing description");
    if (!images.length) errors.push("Missing HTTPS product image");
    if (!weight || weight <= 0) errors.push("Missing package weight");

    const attributes = Object.fromEntries(
      (variant.selected_options || [])
        .filter((option) => option.name && option.value)
        .map((option) => [option.name, [option.value]]),
    );
    const configuredStart = dateForAnanas(variant.sale_start);
    const configuredEnd = dateForAnanas(variant.sale_end);
    const inferredDailyDiscount = onSale && !variant.sale_start && !variant.sale_end;
    const inferredDate = inferredDailyDiscount
      ? dateForAnanas(options.today) || sarajevoTodayForAnanas()
      : null;
    const start = configuredStart || inferredDate;
    const end = configuredEnd || inferredDate;
    const type = discountType(variant.discount_type);
    const discountErrors: string[] = [];

    if (onSale && !start) discountErrors.push("Sale price exists but sale_start is missing");
    if (onSale && type !== "CLEARANCE_SALE" && !end) {
      discountErrors.push("Sale price exists but sale_end is missing");
    }

    return {
      shopifyProductId: String(product.id),
      shopifyVariantId: String(variant.id),
      shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
      importProduct: errors.length
        ? null
        : {
            name: productName(product, variant),
            description,
            coverImage: images[0],
            ean,
            brand: String(product.vendor || options.defaultBrand || "Galago").trim(),
            gallery: images,
            parentEan: null,
            packageWeightValue: weight,
            packageWeightUnit: "KG",
            basePrice: basePrice as number,
            vat,
            stockLevel,
            sku,
            externalId: String(variant.id),
            productType: product.product_type?.trim() || null,
            category: product.product_type?.trim() || null,
            attributes,
          },
      discount:
        onSale && currentPrice && !discountErrors.length
          ? {
              discountPrice: currentPrice,
              discountPriceCurrency: "BAM",
              dateFrom: start as string,
              ...(end ? { dateTo: end } : {}),
              discountType: type,
            }
          : null,
      discountDatesInferred: inferredDailyDiscount,
      validationErrors: [...errors, ...discountErrors],
    };
  });
}
