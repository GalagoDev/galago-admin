import {
  cancelPendingAnanasDiscount,
  getAnanasInvoices,
  getAnanasProducts,
  importAnanasProducts,
  lowerActiveAnanasDiscount,
  scheduleAnanasDiscounts,
  updatePendingAnanasDiscount,
  updateAnanasProducts,
} from "@/lib/ananas-client";
import { mapShopifyProductToAnanas } from "@/lib/ananas-mapping";
import {
  claimPendingAnanasJobs,
  clearAnanasDiscount,
  completeAnanasJob,
  failAnanasJob,
  getAnanasLinkByInventoryItemId,
  getAnanasLinkByVariantId,
  markAnanasCatalogSubmitted,
  markAnanasLinkError,
  markAnanasLinkNeedsAttention,
  markAnanasLinkSynced,
  payloadHash,
  saveAnanasInvoice,
  saveAnanasProductId,
  upsertAnanasProductLink,
} from "@/lib/ananas-store";
import type {
  AnanasProductImport,
  MappedAnanasVariant,
  ShopifyInventoryWebhook,
  ShopifyProductWebhook,
} from "@/lib/ananas-types";
import { getShopifyProductsForAnanas } from "@/lib/shopify-admin";

function numberEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function catalogHash(product: AnanasProductImport) {
  const catalog = Object.fromEntries(
    Object.entries(product).filter(([key]) => key !== "basePrice" && key !== "stockLevel"),
  );
  return payloadHash(catalog);
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function sarajevoToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ananasDateKey(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function discountLifecycle(link: ReturnType<typeof getAnanasLinkByVariantId>, today: string) {
  if (!link?.active_discount_id) return "none" as const;
  const from = ananasDateKey(link.discount_date_from);
  const to = ananasDateKey(link.discount_date_to);
  if (to && today > to) return "expired" as const;
  if (from && today < from) return "pending" as const;
  return "active" as const;
}

async function refreshAnanasIds(mapped: MappedAnanasVariant[]) {
  const eans = [...new Set(mapped.map((item) => item.importProduct?.ean).filter((ean): ean is string => Boolean(ean)))];
  for (const batch of chunks(eans, 100)) {
    const products = await getAnanasProducts({ eans: batch });
    for (const product of products) {
      if (product.ean && product.id) saveAnanasProductId(product.ean, product.id);
    }
  }
}

export async function syncShopifyProducts(
  products: ShopifyProductWebhook[],
  options: {
    submitCatalog?: boolean;
    refreshIds?: boolean;
    syncPricesStock?: boolean;
    syncDiscounts?: boolean;
    discountDate?: string;
  } = {},
) {
  const mapped = products.flatMap((product) =>
    mapShopifyProductToAnanas(product, {
      vat: numberEnv("ANANAS_VAT", 17),
      defaultWeightKg: numberEnv("ANANAS_DEFAULT_PACKAGE_WEIGHT_KG", 1),
      defaultBrand: process.env.ANANAS_DEFAULT_BRAND || "Galago",
      untrackedStockLevel: numberEnv("ANANAS_UNTRACKED_STOCK_LEVEL", 0),
      today: options.discountDate,
    }),
  );

  for (const item of mapped) {
    upsertAnanasProductLink({
      shopifyVariantId: item.shopifyVariantId,
      shopifyProductId: item.shopifyProductId,
      shopifyInventoryItemId: item.shopifyInventoryItemId,
      ean: item.importProduct?.ean || null,
      sku: item.importProduct?.sku || null,
      status: item.importProduct ? (item.validationErrors.length ? "needs_attention" : "pending") : "error",
      error: item.validationErrors.join("; ") || null,
    });
  }

  const importItems = options.submitCatalog === false ? [] : mapped.filter((item) => {
    if (!item.importProduct) return false;
    const link = getAnanasLinkByVariantId(item.shopifyVariantId);
    return link?.last_catalog_hash !== catalogHash(item.importProduct);
  });

  if (importItems.length) {
    for (const batch of chunks(importItems, 100)) {
      const result = await importAnanasProducts(batch.map((item) => item.importProduct as AnanasProductImport));
      markAnanasCatalogSubmitted(
        batch.map((item) => ({
          variantId: item.shopifyVariantId,
          catalogHash: catalogHash(item.importProduct as AnanasProductImport),
        })),
        result?.id || null,
      );
    }
  }

  if (options.refreshIds !== false) await refreshAnanasIds(mapped);

  const today = sarajevoToday();
  for (const item of mapped) {
    const link = getAnanasLinkByVariantId(item.shopifyVariantId);
    if (discountLifecycle(link, today) === "expired") clearAnanasDiscount(item.shopifyVariantId);
  }

  const warnings = new Map<string, string[]>();
  const failures = new Map<string, string>();
  const addWarning = (variantId: string, warning: string) => {
    warnings.set(variantId, [...(warnings.get(variantId) || []), warning]);
  };
  for (const item of mapped) {
    for (const warning of item.validationErrors) addWarning(item.shopifyVariantId, warning);
  }

  const updatePlans = options.syncPricesStock === false ? [] : mapped.flatMap((item) => {
    if (!item.importProduct) return [];
    const link = getAnanasLinkByVariantId(item.shopifyVariantId);
    if (!link?.ananas_product_id) return [];
    const lifecycle = discountLifecycle(link, today);
    const priceChanged = link.last_base_price !== item.importProduct.basePrice;
    const stockChanged = link.last_inventory !== item.importProduct.stockLevel;
    const update = { id: link.ananas_product_id, sku: item.importProduct.sku } as {
      id: number;
      sku: string;
      basePrice?: number;
      vat?: number;
      stockLevel?: number;
    };

    if (priceChanged) {
      if (lifecycle === "active") {
        addWarning(item.shopifyVariantId, "Regular price cannot be changed while the Ananas discount is active");
      } else {
        update.basePrice = item.importProduct.basePrice;
        update.vat = item.importProduct.vat;
      }
    }
    if (stockChanged) {
      if (lifecycle === "active" && link.discount_type === "CLEARANCE_SALE") {
        addWarning(item.shopifyVariantId, "Stock cannot be changed while an Ananas clearance sale is active");
      } else {
        update.stockLevel = item.importProduct.stockLevel;
      }
    }

    return update.basePrice === undefined && update.stockLevel === undefined ? [] : [{ item, update }];
  });

  if (updatePlans.length) {
    const results = await updateAnanasProducts(updatePlans.map((plan) => plan.update));
    const unresolved = new Map(updatePlans.map((plan) => [plan.update.id, plan]));
    for (const result of results) {
      const plan = updatePlans.find((candidate) => candidate.update.id === result.myProductId);
      if (!plan) continue;
      unresolved.delete(result.myProductId);
      if (result.status === "FAIL") {
        failures.set(plan.item.shopifyVariantId, (result.errors || ["Ananas update failed"]).join("; "));
        continue;
      }
      markAnanasLinkSynced({
        variantId: plan.item.shopifyVariantId,
        ...(plan.update.basePrice !== undefined ? { basePrice: plan.update.basePrice } : {}),
        ...(plan.update.stockLevel !== undefined ? { inventory: plan.update.stockLevel } : {}),
      });
    }
    for (const plan of unresolved.values()) {
      failures.set(plan.item.shopifyVariantId, "Ananas did not return a result for the product update");
    }
  }

  for (const item of mapped) {
    if (!item.importProduct) continue;
    const link = getAnanasLinkByVariantId(item.shopifyVariantId);
    if (!link?.merchant_inventory_id) continue;
    const lifecycle = discountLifecycle(link, today);

    if (options.syncDiscounts === false) {
      markAnanasLinkSynced({
        variantId: item.shopifyVariantId,
        catalogHash: catalogHash(item.importProduct),
      });
      const failure = failures.get(item.shopifyVariantId);
      const itemWarnings = warnings.get(item.shopifyVariantId) || [];
      if (failure) markAnanasLinkError(item.shopifyVariantId, failure);
      else if (itemWarnings.length) markAnanasLinkNeedsAttention(item.shopifyVariantId, itemWarnings.join("; "));
      continue;
    }

    if (item.discount && lifecycle === "none") {
      const end = ananasDateKey(item.discount.dateTo);
      if (end && end < today) {
        addWarning(item.shopifyVariantId, "Shopify discount end date is in the past");
      } else {
        const response = await scheduleAnanasDiscounts([
          { merchantInventoryId: link.merchant_inventory_id, ...item.discount },
        ]);
        const result = response.scheduleResult[0];
        if (!result?.success || !result.data?.discountId) {
          failures.set(item.shopifyVariantId, result?.error?.errorMessage || "Discount scheduling failed");
        } else {
          markAnanasLinkSynced({
            variantId: item.shopifyVariantId,
            discountPrice: item.discount.discountPrice,
            discountId: result.data.discountId,
            discountDateFrom: item.discount.dateFrom,
            discountDateTo: item.discount.dateTo || null,
            discountType: item.discount.discountType,
          });
        }
      }
    } else if (link.active_discount_id && lifecycle === "pending") {
      if (!item.discount) {
        await cancelPendingAnanasDiscount(link.active_discount_id);
        clearAnanasDiscount(item.shopifyVariantId);
      } else if (
        link.last_discount_price !== item.discount.discountPrice ||
        link.discount_date_from !== item.discount.dateFrom ||
        link.discount_date_to !== (item.discount.dateTo || null) ||
        link.discount_type !== item.discount.discountType
      ) {
        const response = await updatePendingAnanasDiscount({
          discountId: link.active_discount_id,
          discountPrice: item.discount.discountPrice,
          dateFrom: item.discount.dateFrom,
          dateTo: item.discount.dateTo,
          discountType: item.discount.discountType,
        });
        const result = response.updateResult[0];
        if (!result?.success) {
          failures.set(item.shopifyVariantId, result?.error?.errorMessage || "Pending discount update failed");
        } else {
          markAnanasLinkSynced({
            variantId: item.shopifyVariantId,
            discountPrice: item.discount.discountPrice,
            discountDateFrom: item.discount.dateFrom,
            discountDateTo: item.discount.dateTo || null,
            discountType: item.discount.discountType,
          });
        }
      }
    } else if (link.active_discount_id && lifecycle === "active") {
      if (!item.discount) {
        addWarning(item.shopifyVariantId, "An active Ananas discount cannot be cancelled from Shopify");
      } else {
        if (
          link.discount_date_from !== item.discount.dateFrom ||
          link.discount_date_to !== (item.discount.dateTo || null) ||
          link.discount_type !== item.discount.discountType
        ) {
          addWarning(item.shopifyVariantId, "Dates and type cannot be changed while the Ananas discount is active");
        }
        if (link.last_discount_price !== null && item.discount.discountPrice < link.last_discount_price) {
          const response = await lowerActiveAnanasDiscount({
            discountId: link.active_discount_id,
            merchantInventoryId: link.merchant_inventory_id,
            discountPrice: item.discount.discountPrice,
          });
          const result = response.updateResult[0];
          if (!result?.success) {
            failures.set(item.shopifyVariantId, result?.error?.errorMessage || "Active discount price update failed");
          } else {
            markAnanasLinkSynced({ variantId: item.shopifyVariantId, discountPrice: item.discount.discountPrice });
          }
        } else if (link.last_discount_price !== null && item.discount.discountPrice > link.last_discount_price) {
          addWarning(item.shopifyVariantId, "An active Ananas discount price can only be lowered");
        }
      }
    }

    markAnanasLinkSynced({
      variantId: item.shopifyVariantId,
      catalogHash: catalogHash(item.importProduct),
    });
    const failure = failures.get(item.shopifyVariantId);
    const itemWarnings = warnings.get(item.shopifyVariantId) || [];
    if (failure) markAnanasLinkError(item.shopifyVariantId, failure);
    else if (itemWarnings.length) markAnanasLinkNeedsAttention(item.shopifyVariantId, itemWarnings.join("; "));
  }

  return {
    products: products.length,
    variants: mapped.length,
    submittedForImport: importItems.length,
    linked: mapped.filter((item) => getAnanasLinkByVariantId(item.shopifyVariantId)?.ananas_product_id).length,
    needsAttention: new Set([...warnings.keys(), ...failures.keys()]).size,
  };
}

export function syncShopifyProductWebhook(product: ShopifyProductWebhook) {
  return syncShopifyProducts([product]);
}

export async function syncShopifyInventoryWebhook(payload: ShopifyInventoryWebhook) {
  const link = getAnanasLinkByInventoryItemId(String(payload.inventory_item_id));
  if (!link?.ananas_product_id) {
    throw new Error(`No Ananas product mapping for Shopify inventory item ${payload.inventory_item_id}.`);
  }
  const stockLevel = Math.max(0, Math.trunc(payload.available || 0));
  if (discountLifecycle(link, sarajevoToday()) === "active" && link.discount_type === "CLEARANCE_SALE") {
    markAnanasLinkNeedsAttention(
      link.shopify_variant_id,
      "Stock cannot be changed while an Ananas clearance sale is active",
    );
    return {
      variantId: link.shopify_variant_id,
      ananasProductId: link.ananas_product_id,
      stockLevel,
      skipped: true,
    };
  }
  const [result] = await updateAnanasProducts([{ id: link.ananas_product_id, stockLevel }]);
  if (!result || result.status === "FAIL") {
    const error = (result?.errors || ["Ananas did not confirm the inventory update"]).join("; ");
    markAnanasLinkError(link.shopify_variant_id, error);
    throw new Error(error);
  }
  markAnanasLinkSynced({ variantId: link.shopify_variant_id, inventory: stockLevel });
  return { variantId: link.shopify_variant_id, ananasProductId: link.ananas_product_id, stockLevel };
}

export async function runFullAnanasReconciliation(
  limitProducts?: number,
  options: {
    submitCatalog?: boolean;
    refreshIds?: boolean;
    syncPricesStock?: boolean;
    syncDiscounts?: boolean;
    discountDate?: string;
  } = {},
) {
  const products = await getShopifyProductsForAnanas({ limitProducts });
  return syncShopifyProducts(products, options);
}

function invoiceKey(invoice: unknown) {
  const data = invoice as Record<string, unknown>;
  const header = (data.invoiceHeader || {}) as Record<string, unknown>;
  const fiscal = (header.fiscalDetails || {}) as Record<string, unknown>;
  return String(
    data.documentCorrelationId || data.invoiceId || data.id || fiscal.invoiceNumber || fiscal.invoiceCounter || payloadHash(invoice),
  );
}

export async function syncAnanasInvoices(input: { dateFrom: string; dateTo: string; type?: "FISCAL" | "NON_FISCAL" }) {
  const invoices = await getAnanasInvoices(input.dateFrom, input.dateTo, input.type);
  for (const invoice of invoices) saveAnanasInvoice(invoiceKey(invoice), invoice);
  return { saved: invoices.length };
}

export async function processPendingAnanasJobs(limit = 10) {
  const jobs = claimPendingAnanasJobs(limit);
  const results: Array<{ id: number; status: "succeeded" | "failed"; error?: string }> = [];

  for (const job of jobs) {
    try {
      const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
      if (job.job_type === "product_upsert") {
        await syncShopifyProductWebhook(payload as unknown as ShopifyProductWebhook);
      } else if (job.job_type === "inventory_update") {
        await syncShopifyInventoryWebhook(payload as unknown as ShopifyInventoryWebhook);
      } else if (job.job_type === "full_reconcile") {
        await runFullAnanasReconciliation(
          typeof payload.limitProducts === "number" ? payload.limitProducts : undefined,
          {
            submitCatalog: payload.submitCatalog !== false,
            refreshIds: payload.refreshIds !== false,
            syncPricesStock: payload.syncPricesStock !== false,
            syncDiscounts: payload.syncDiscounts !== false,
            discountDate: typeof payload.discountDate === "string" ? payload.discountDate : undefined,
          },
        );
      } else if (job.job_type === "invoice_sync") {
        await syncAnanasInvoices(payload as { dateFrom: string; dateTo: string; type?: "FISCAL" | "NON_FISCAL" });
      }
      completeAnanasJob(job.id);
      results.push({ id: job.id, status: "succeeded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Ananas sync error";
      failAnanasJob(job.id, job.attempts + 1, message);
      results.push({ id: job.id, status: "failed", error: message });
    }
  }
  return results;
}
