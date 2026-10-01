import { isOrderIncludedInStatistics } from "./daily-statistics.ts";
import type { SheetOrderRow } from "./google-sheets.ts";
import { parseOrderAmount, roundOrderAmount } from "./order-amount.ts";

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Juni",
  "Juli",
  "August",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar",
] as const;

export type StatisticsDateParts = {
  day: number;
  month: number;
  year: number;
  timestamp: number;
};

export function parseStatisticsDateLabel(value: unknown): StatisticsDateParts | null {
  const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;

  return { day, month, year, timestamp };
}

export function getStatisticsYears(orders: SheetOrderRow[]) {
  return Array.from(new Set(
    orders
      .map((order) => parseStatisticsDateLabel(order.dateLabel)?.year)
      .filter((year): year is number => Boolean(year)),
  )).sort((left, right) => right - left);
}

export function getStatisticsMonthName(month: number) {
  return MONTH_NAMES[month - 1] || "Mjesec";
}

export function calculatePeriodStatistics(orders: SheetOrderRow[], year: number) {
  const datedOrders = orders.flatMap((order) => {
    const date = parseStatisticsDateLabel(order.dateLabel);
    return date && date.year === year ? [{ order, date }] : [];
  });
  const includedOrders = datedOrders.filter(({ order }) => isOrderIncludedInStatistics(order));

  const months = MONTH_NAMES.map((name, index) => {
    const month = index + 1;
    const sourceRows = datedOrders.filter((item) => item.date.month === month);
    const includedRows = sourceRows.filter(({ order }) => isOrderIncludedInStatistics(order));
    return {
      month,
      name,
      sourceOrderCount: sourceRows.length,
      orderCount: includedRows.length,
      excludedOrderCount: sourceRows.length - includedRows.length,
      revenue: roundOrderAmount(
        includedRows.reduce((sum, { order }) => sum + parseOrderAmount(order.otkupnina), 0),
      ),
    };
  });

  const days = Array.from(
    datedOrders.reduce((map, item) => {
      const current = map.get(item.order.dateLabel) || {
        dateLabel: item.order.dateLabel,
        timestamp: item.date.timestamp,
        month: item.date.month,
        sourceOrders: [] as SheetOrderRow[],
      };
      current.sourceOrders.push(item.order);
      map.set(item.order.dateLabel, current);
      return map;
    }, new Map<string, {
      dateLabel: string;
      timestamp: number;
      month: number;
      sourceOrders: SheetOrderRow[];
    }>()).values(),
  ).map((day) => {
    const included = day.sourceOrders.filter(isOrderIncludedInStatistics);
    return {
      dateLabel: day.dateLabel,
      timestamp: day.timestamp,
      month: day.month,
      sourceOrderCount: day.sourceOrders.length,
      orderCount: included.length,
      excludedOrderCount: day.sourceOrders.length - included.length,
      revenue: roundOrderAmount(
        included.reduce((sum, order) => sum + parseOrderAmount(order.otkupnina), 0),
      ),
    };
  }).sort((left, right) => right.timestamp - left.timestamp);

  const revenue = roundOrderAmount(
    includedOrders.reduce((sum, { order }) => sum + parseOrderAmount(order.otkupnina), 0),
  );

  return {
    year,
    sourceOrderCount: datedOrders.length,
    orderCount: includedOrders.length,
    excludedOrderCount: datedOrders.length - includedOrders.length,
    revenue,
    averageOrderValue: includedOrders.length > 0
      ? roundOrderAmount(revenue / includedOrders.length)
      : 0,
    months,
    days,
  };
}
