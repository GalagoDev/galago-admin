import type { SheetOrderRow } from "./google-sheets.ts";
import type { InventoryAlias, InventoryProduct } from "./inventory.ts";
import { parseOrderAmount, roundOrderAmount } from "./order-amount.ts";
import { ProductMatcher } from "./product-matching.ts";

const DEFAULT_VAT_RATE = 0.145;
const DEFAULT_SHIPPING_COST = 8.5;

function configuredNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isReplacementOrder(order: SheetOrderRow) {
  return /\bzamjena\b/i.test(order.artikal)
    || !/^(?:0+(?:[.,]0+)?|)$/.test(order.zamjena.trim());
}

export function sarajevoDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function normalizeStatisticsDate(value: unknown) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function displayStatisticsDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

export function statisticsDateKeyFromLabel(value: unknown) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function calculateDailyStatistics(input: {
  orders: SheetOrderRow[];
  products: InventoryProduct[];
  aliases?: InventoryAlias[];
  dateKey: string;
  metaSpendBam?: number | null;
}) {
  const vatRate = configuredNumber(process.env.STATISTICS_VAT_RATE, DEFAULT_VAT_RATE);
  const shippingCostPerOrder = configuredNumber(process.env.STATISTICS_SHIPPING_COST_BAM, DEFAULT_SHIPPING_COST);
  const workdayLabel = displayStatisticsDate(input.dateKey);
  const workdayOrders = input.orders.filter((order) => order.dateLabel === workdayLabel);
  const orders = workdayOrders.filter(
    (order) => !order.appStatus.startsWith("duplicate:")
      && !order.appStatus.startsWith("returned:")
      && !isReplacementOrder(order),
  );
  const matcher = new ProductMatcher(input.products, input.aliases || []);
  const ranking = new Map<number, { product: InventoryProduct; units: number; cost: number; orderCount: number }>();
  const missingCosts = new Map<number, { product: InventoryProduct; units: number; orderCount: number }>();
  const unmatched = new Map<string, { label: string; count: number }>();
  let costOfGoods = 0;
  let matchedLines = 0;
  let unmatchedLines = 0;

  for (const order of orders) {
    const result = matcher.match(order.artikal, order.brojPaketa);
    const seenProducts = new Set<number>();
    for (const match of result.matches) {
      const cost = match.product.unitCost * match.quantity;
      costOfGoods += cost;
      matchedLines += 1;
      const current = ranking.get(match.product.id) || {
        product: match.product as InventoryProduct,
        units: 0,
        cost: 0,
        orderCount: 0,
      };
      current.units += match.quantity;
      current.cost += cost;
      if (!seenProducts.has(match.product.id)) current.orderCount += 1;
      seenProducts.add(match.product.id);
      ranking.set(match.product.id, current);
      if (match.product.unitCost <= 0) {
        const missing = missingCosts.get(match.product.id) || {
          product: match.product as InventoryProduct,
          units: 0,
          orderCount: 0,
        };
        missing.units += match.quantity;
        missing.orderCount = current.orderCount;
        missingCosts.set(match.product.id, missing);
      }
    }
    for (const label of result.unmatched) {
      unmatchedLines += 1;
      const key = label.toLocaleLowerCase("bs-BA").trim();
      const current = unmatched.get(key) || { label, count: 0 };
      current.count += 1;
      unmatched.set(key, current);
    }
  }

  const revenue = roundOrderAmount(orders.reduce((sum, order) => sum + parseOrderAmount(order.otkupnina), 0));
  const vat = roundOrderAmount(revenue * vatRate);
  const shipping = roundOrderAmount(orders.length * shippingCostPerOrder);
  costOfGoods = roundOrderAmount(costOfGoods);
  const costComplete = unmatchedLines === 0 && missingCosts.size === 0;
  const estimatedProfitBeforeAds = roundOrderAmount(revenue - vat - shipping - costOfGoods);
  const profitBeforeAds = costComplete ? estimatedProfitBeforeAds : null;
  const metaSpend = input.metaSpendBam === null || input.metaSpendBam === undefined
    ? null
    : roundOrderAmount(input.metaSpendBam);

  return {
    dateKey: input.dateKey,
    workdayLabel,
    sourceOrderCount: workdayOrders.length,
    orderCount: orders.length,
    revenue,
    vat,
    vatRate,
    shipping,
    shippingCostPerOrder,
    costOfGoods,
    costComplete,
    metaSpend,
    estimatedProfitBeforeAds,
    profitBeforeAds,
    profitAfterAds: metaSpend === null || profitBeforeAds === null ? null : roundOrderAmount(profitBeforeAds - metaSpend),
    matchedLines,
    unmatchedLines,
    missingCostProducts: Array.from(missingCosts.values())
      .map((item) => ({ ...item, units: Math.round(item.units * 1000) / 1000 }))
      .sort((left, right) => right.units - left.units || left.product.name.localeCompare(right.product.name, "bs")),
    ranking: Array.from(ranking.values())
      .map((item) => ({ ...item, units: Math.round(item.units * 1000) / 1000, cost: roundOrderAmount(item.cost) }))
      .sort((left, right) => right.units - left.units || right.orderCount - left.orderCount),
    unmatched: Array.from(unmatched.values()).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "bs")),
  };
}
