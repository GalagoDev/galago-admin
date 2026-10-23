import type {
  AnanasDiscountSchedule,
  AnanasDiscountScheduleResult,
  AnanasProduct,
  AnanasProductImport,
  AnanasProductUpdate,
} from "@/lib/ananas-types";

type TokenResponse = {
  access_token: string;
  expires_in: string | number;
  token_type: string;
};

type CachedToken = {
  value: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

function env(name: string, fallback?: string) {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function config() {
  return {
    baseUrl: env("ANANAS_API_BASE_URL", "https://api.ananas.rs").replace(/\/$/, ""),
    apiKey: process.env.ANANAS_API_KEY?.trim() || "",
    clientId: env("ANANAS_CLIENT_ID"),
    clientSecret: env("ANANAS_CLIENT_SECRET"),
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function apiError(method: string, path: string, status: number, payload: unknown) {
  const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Error(`Ananas API ${method} ${path} failed (${status}): ${detail.slice(0, 1000)}`);
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const settings = config();
  const path = "/iam/api/v1/auth/token";
  const response = await fetch(`${settings.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
    },
    body: JSON.stringify({
      grantType: "CLIENT_CREDENTIALS",
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      scope: "public_api/full_access",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await readJson(response);
  if (!response.ok) throw apiError("POST", path, response.status, payload);

  const token = payload as TokenResponse;
  if (!token?.access_token) throw new Error("Ananas token response did not include access_token.");
  const expiresIn = Number(token.expires_in || 900);
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  };
  return cachedToken.value;
}

async function ananasRequest<T>(method: string, path: string, body?: unknown) {
  const settings = config();
  const token = await getAccessToken();
  const response = await fetch(`${settings.baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    if (response.status === 401) cachedToken = null;
    throw apiError(method, path, response.status, payload);
  }
  return payload as T;
}

export function importAnanasProducts(products: AnanasProductImport[]) {
  if (!products.length) return Promise.resolve(null);
  return ananasRequest<{ id: string }>("POST", "/product/api/v1/merchant-integration/import", products);
}

export function checkAnanasEans(eans: string[]) {
  if (!eans.length) return Promise.resolve({} as Record<string, boolean>);
  return ananasRequest<Record<string, boolean>>(
    "POST",
    "/product/api/v1/merchant-integration/ean/exists",
    eans,
  );
}

export function updateAnanasProducts(products: AnanasProductUpdate[]) {
  if (!products.length) return Promise.resolve([]);
  return ananasRequest<Array<{ status: string; errors?: string[]; myProductId: number }>>(
    "PUT",
    "/product/api/v1/merchant-integration/product/bulk",
    products,
  );
}

export async function getAnanasProducts(options: { eans?: string[]; modifiedAfter?: string } = {}) {
  const all: AnanasProduct[] = [];
  const size = 200;

  for (let page = 0; ; page += 1) {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    for (const ean of options.eans || []) params.append("ean", ean);
    if (options.modifiedAfter) params.set("date-modified-after", options.modifiedAfter);
    const batch = await ananasRequest<AnanasProduct[]>(
      "GET",
      `/product/api/v1/merchant-integration/products?${params.toString()}`,
    );
    all.push(...batch);
    if (batch.length < size || options.eans?.length) break;
  }
  return all;
}

export function scheduleAnanasDiscounts(discounts: AnanasDiscountSchedule[]) {
  if (!discounts.length) return Promise.resolve({ scheduleResult: [] });
  return ananasRequest<AnanasDiscountScheduleResult>(
    "POST",
    "/payment/api/v1/merchant-integration/discounts",
    { discounts },
  );
}

export function lowerActiveAnanasDiscount(input: {
  discountId: string;
  merchantInventoryId: number;
  discountPrice: number;
}) {
  return ananasRequest<AnanasDiscountUpdateResult>("PUT", "/payment/api/v1/merchant-integration/discounts", {
    discounts: [
      {
        discountId: input.discountId,
        merchantInventoryId: input.merchantInventoryId,
        newDiscountPrice: input.discountPrice,
        newDiscountPriceCurrency: "BAM",
        newDateFrom: null,
        newDateTo: null,
        newDiscountType: null,
      },
    ],
  });
}

type AnanasDiscountUpdateResult = {
  updateResult: Array<{
    success: boolean;
    data?: { discountId: string };
    error?: { discountId: string; errorMessage: string };
  }>;
};

export function updatePendingAnanasDiscount(input: {
  discountId: string;
  discountPrice: number;
  dateFrom: string;
  dateTo?: string;
  discountType: string;
}) {
  return ananasRequest<AnanasDiscountUpdateResult>("PUT", "/payment/api/v1/merchant-integration/discounts", {
    discounts: [
      {
        discountId: input.discountId,
        newDiscountPrice: input.discountPrice,
        newDiscountPriceCurrency: "BAM",
        newDateFrom: input.dateFrom,
        newDateTo: input.dateTo || null,
        newDiscountType: input.discountType,
      },
    ],
  });
}

export function cancelPendingAnanasDiscount(discountId: string) {
  return ananasRequest<unknown>(
    "PUT",
    `/payment/api/v1/merchant-integration/discounts/${encodeURIComponent(discountId)}/cancellations`,
  );
}

export function getAnanasInvoices(dateFrom: string, dateTo: string, type?: "FISCAL" | "NON_FISCAL") {
  const params = new URLSearchParams({ dateFrom, dateTo });
  if (type) params.set("type", type);
  return ananasRequest<unknown[]>("GET", `/order/api/v1/merchant-integration/invoices?${params.toString()}`);
}

export function getAnanasMerchantWarehouses() {
  return ananasRequest<unknown>("GET", "/order/api/v1/merchant-integration/merchant-warehouses");
}

export type AnanasOrderItem = {
  productEan: string;
  productSku: string;
  quantity: number;
};
export type AnanasOrder = { id: string; createdDate: string; items: AnanasOrderItem[] };
export type AnanasShipment = {
  orderId: string;
  suborderId: string;
  status: string;
  items: Array<{
    productEan: string;
    productSku: string;
    orderedQuantity: number;
    confirmedQuantity: number | null;
    packedQuantity: number | null;
  }>;
};

async function orderPages<T>(path: string, parameters: Record<string, string>) {
  const rows: T[] = [];
  for (let page = 0; page < 1000; page++) {
    const query = new URLSearchParams({ ...parameters, page: String(page), size: "100" });
    const result = await ananasRequest<{ content: T[]; last: boolean; number: number }>("GET", `${path}?${query}`);
    if (!Array.isArray(result.content) || typeof result.last !== "boolean" || result.number !== page) {
      throw new Error("Invalid Ananas order pagination; refusing an incomplete inventory snapshot");
    }
    rows.push(...result.content);
    if (result.last) return rows;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Ananas order pagination limit reached");
}

export function getAnanasOrders(dateFrom: string, dateTo: string) {
  return orderPages<AnanasOrder>("/order/api/v1/merchant-integration/orders", { dateFrom, dateTo });
}

export function getAnanasOrderShipments(orderId: string) {
  return orderPages<AnanasShipment>("/order/api/v1/merchant-integration/outbound-orders/shipments", { search: orderId });
}

export function resetAnanasTokenCache() {
  cachedToken = null;
}
