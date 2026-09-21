export type AnanasProductImport = {
  name: string;
  description: string;
  coverImage: string;
  ean: string;
  brand: string;
  gallery: string[];
  parentEan: string | null;
  packageWeightValue: number;
  packageWeightUnit: "KG";
  basePrice: number;
  vat: number;
  stockLevel: number;
  sku: string;
  externalId: string;
  productType: string | null;
  category: string | null;
  attributes: Record<string, string[]>;
};

export type AnanasProductUpdate = {
  id: number;
  packageWeightValue?: number;
  packageWeightUnit?: "KG";
  basePrice?: number;
  vat?: number;
  stockLevel?: number;
  sku?: string;
};

export type AnanasProduct = {
  id: number;
  externalId?: string | null;
  ean: string;
  sku?: string | null;
  name?: string;
  newBasePrice?: number | null;
  basePrice?: number | null;
  stockLevel?: number | null;
  status?: string | null;
};

export type AnanasDiscountType = "SALE" | "SEASONAL_SALE" | "CLEARANCE_SALE";

export type AnanasDiscountSchedule = {
  merchantInventoryId: number;
  discountPrice: number;
  discountPriceCurrency: "BAM";
  dateFrom: string;
  dateTo?: string;
  discountType: AnanasDiscountType;
};

export type AnanasDiscountScheduleResult = {
  scheduleResult: Array<{
    success: boolean;
    data?: {
      merchantInventoryId: number;
      discountId: string;
    };
    error?: {
      merchantInventoryId: number;
      errorMessage: string;
    };
  }>;
};

export type ShopifyProductWebhook = {
  id: number;
  title: string;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  status?: string | null;
  handle?: string | null;
  image?: { src?: string | null } | null;
  images?: Array<{ src?: string | null }>;
  variants?: ShopifyVariantInput[];
};

export type ShopifyVariantInput = {
  id: number;
  product_id?: number;
  inventory_item_id?: number | null;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string | number | null;
  compare_at_price?: string | number | null;
  inventory_quantity?: number | null;
  inventory_management?: string | null;
  inventory_tracked?: boolean | null;
  weight?: number | null;
  weight_unit?: string | null;
  image_src?: string | null;
  sale_start?: string | null;
  sale_end?: string | null;
  discount_type?: AnanasDiscountType | string | null;
  selected_options?: Array<{ name: string; value: string }>;
};

export type ShopifyInventoryWebhook = {
  inventory_item_id: number;
  location_id?: number;
  available?: number | null;
  updated_at?: string;
};

export type MappedAnanasVariant = {
  shopifyProductId: string;
  shopifyVariantId: string;
  shopifyInventoryItemId: string | null;
  importProduct: AnanasProductImport | null;
  discount: Omit<AnanasDiscountSchedule, "merchantInventoryId"> | null;
  discountDatesInferred: boolean;
  validationErrors: string[];
};
