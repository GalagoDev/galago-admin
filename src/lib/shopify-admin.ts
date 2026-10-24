import type { AnanasDiscountType, ShopifyProductWebhook, ShopifyVariantInput } from "@/lib/ananas-types";

type GraphQlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type VariantNode = {
  legacyResourceId: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number;
  inventoryItem: {
    legacyResourceId: string;
    tracked: boolean;
    measurement?: { weight?: { value: number; unit: string } | null } | null;
  };
  selectedOptions: Array<{ name: string; value: string }>;
  saleStart?: { value: string } | null;
  saleEnd?: { value: string } | null;
  discountType?: { value: string } | null;
  media: {
    nodes: Array<{ image?: { url: string } | null }>;
  };
  product: {
    legacyResourceId: string;
    title: string;
    descriptionHtml: string;
    vendor: string;
    productType: string;
    status: string;
    handle: string;
    featuredMedia?: { image?: { url: string } | null } | null;
    media: {
      nodes: Array<{ image?: { url: string } | null }>;
    };
  };
};

type VariantPage = {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: VariantNode[];
  };
};

let cachedShopifyToken: { value: string; expiresAt: number } | null = null;

function shopifyConfig() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) throw new Error("SHOPIFY_STORE_DOMAIN is not configured.");
  return {
    domain,
    legacyToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim() || "",
    clientId: process.env.SHOPIFY_CLIENT_ID?.trim() || "",
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET?.trim() || "",
    apiVersion: process.env.SHOPIFY_ADMIN_API_VERSION?.trim() || "2026-07",
  };
}

async function getShopifyAccessToken() {
  const settings = shopifyConfig();
  if (settings.legacyToken) return settings.legacyToken;
  if (cachedShopifyToken && cachedShopifyToken.expiresAt > Date.now() + 60_000) {
    return cachedShopifyToken.value;
  }
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are not configured.");
  }

  const response = await fetch(`https://${settings.domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Shopify token request failed (${response.status}): ${payload.error || "missing access_token"}`);
  }
  cachedShopifyToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 86_399) * 1000,
  };
  return cachedShopifyToken.value;
}

async function shopifyGraphQl<T>(query: string, variables: Record<string, unknown>) {
  const settings = shopifyConfig();
  const token = await getShopifyAccessToken();
  const response = await fetch(`https://${settings.domain}/admin/api/${settings.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-shopify-access-token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json()) as GraphQlResponse<T>;
  if (!response.ok || payload.errors?.length || !payload.data) {
    const detail = payload.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new Error(`Shopify Admin API request failed (${response.status}): ${detail}`);
  }
  return payload.data;
}

function weightUnit(unit: string | undefined) {
  switch (unit) {
    case "GRAMS":
      return "g";
    case "POUNDS":
      return "lb";
    case "OUNCES":
      return "oz";
    default:
      return "kg";
  }
}

function imageUrls(node: VariantNode) {
  const values = [
    node.media.nodes[0]?.image?.url,
    node.product.featuredMedia?.image?.url,
    ...node.product.media.nodes.map((media) => media.image?.url),
  ];
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function groupVariants(nodes: VariantNode[]) {
  const products = new Map<string, ShopifyProductWebhook>();
  for (const node of nodes) {
    const productId = String(node.product.legacyResourceId);
    const images = imageUrls(node);
    const variant: ShopifyVariantInput = {
      id: Number(node.legacyResourceId),
      product_id: Number(productId),
      inventory_item_id: Number(node.inventoryItem.legacyResourceId),
      title: node.title,
      sku: node.sku,
      barcode: node.barcode,
      price: node.price,
      compare_at_price: node.compareAtPrice,
      inventory_quantity: node.inventoryQuantity,
      inventory_tracked: node.inventoryItem.tracked,
      weight: node.inventoryItem.measurement?.weight?.value || null,
      weight_unit: weightUnit(node.inventoryItem.measurement?.weight?.unit),
      image_src: images[0] || null,
      sale_start: node.saleStart?.value || null,
      sale_end: node.saleEnd?.value || null,
      discount_type: (node.discountType?.value as AnanasDiscountType | undefined) || null,
      selected_options: node.selectedOptions,
    };
    const existing = products.get(productId);
    if (existing) {
      existing.variants?.push(variant);
      continue;
    }
    products.set(productId, {
      id: Number(productId),
      title: node.product.title,
      body_html: node.product.descriptionHtml,
      vendor: node.product.vendor,
      product_type: node.product.productType,
      status: node.product.status.toLowerCase(),
      handle: node.product.handle,
      image: images[0] ? { src: images[0] } : null,
      images: images.map((src) => ({ src })),
      variants: [variant],
    });
  }
  return [...products.values()];
}

const VARIANTS_QUERY = `#graphql
  query GalagoAnanasVariants($after: String, $query: String!) {
    productVariants(first: 100, after: $after, query: $query, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        legacyResourceId
        title
        sku
        barcode
        price
        compareAtPrice
        inventoryQuantity
        selectedOptions { name value }
        inventoryItem {
          legacyResourceId
          tracked
          measurement { weight { value unit } }
        }
        saleStart: metafield(namespace: "ananas", key: "sale_start") { value }
        saleEnd: metafield(namespace: "ananas", key: "sale_end") { value }
        discountType: metafield(namespace: "ananas", key: "discount_type") { value }
        media(first: 1) { nodes { ... on MediaImage { image { url } } } }
        product {
          legacyResourceId
          title
          descriptionHtml
          vendor
          productType
          status
          handle
          featuredMedia { ... on MediaImage { image { url } } }
          media(first: 20) { nodes { ... on MediaImage { image { url } } } }
        }
      }
    }
  }
`;

export async function getShopifyProductsForAnanas(options: { limitProducts?: number } = {}) {
  const nodes: VariantNode[] = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();
  const seenVariants = new Set<string>();

  for (;;) {
    const data: VariantPage = await shopifyGraphQl<VariantPage>(VARIANTS_QUERY, {
      after,
      query: "product_status:active",
    });
    for (const node of data.productVariants.nodes) {
      if (seenVariants.has(node.legacyResourceId)) throw new Error("Duplicate Shopify variant in paginated catalog");
      seenVariants.add(node.legacyResourceId);
      nodes.push(node);
    }
    const grouped = groupVariants(nodes);
    if (options.limitProducts && grouped.length >= options.limitProducts) {
      return grouped.slice(0, options.limitProducts);
    }
    if (!data.productVariants.pageInfo.hasNextPage) return grouped;
    const next = data.productVariants.pageInfo.endCursor;
    if (!next || seenCursors.has(next) || data.productVariants.nodes.length === 0) throw new Error("Incomplete Shopify catalog pagination");
    seenCursors.add(next);
    after = next;
  }
}

export async function getShopifyProductsForBazzar() {
  if (shopifyConfig().domain !== "wktcnu-i5.myshopify.com") throw new Error("Bazzar source must be the Galago Shopify store");
  const data = await shopifyGraphQl<{ shop: { currencyCode: string } }>("query BazzarCurrency { shop { currencyCode } }", {});
  if (data.shop.currencyCode !== "BAM") throw new Error("Bazzar prices require Shopify currency BAM");
  // Full catalog, including zero-stock products; never use a product limit here.
  return getShopifyProductsForAnanas();
}
