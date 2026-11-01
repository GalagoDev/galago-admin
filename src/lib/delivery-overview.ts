import { isActiveOrderRow, type SheetOrderRow } from "./google-sheets";
import type { CourierOrderState } from "./courier-status";
import { parseOrderAmount, roundOrderAmount } from "./order-amount";

export const DELIVERY_ESTIMATE_DAYS = 14;

export function deliveryOverview(orders: SheetOrderRow[], states: Record<number, CourierOrderState>, now = Date.now()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sarajevo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const day = Date.parse(`${today}T00:00:00Z`);
  const included: SheetOrderRow[] = [], uncertain: SheetOrderRow[] = [], completed: SheetOrderRow[] = [];
  for (const order of orders.filter(isActiveOrderRow)) {
    const state = states[order.sheetRowNumber];
    if (state?.category === "delivered" || state?.category === "returned") { completed.push(order); continue; }
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(order.dateLabel);
    const date = match ? Date.parse(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`) : NaN;
    const age = (day - date) / 86400_000;
    // Old rows stay in the source; only current courier evidence keeps them in this estimate.
    const physicallyActive = state?.category === "active" || state?.parcels.some(parcel => parcel.category === "active");
    if (physicallyActive || (age >= -3 && age <= DELIVERY_ESTIMATE_DAYS)) included.push(order);
    else uncertain.push(order);
  }
  const amount = (rows: SheetOrderRow[]) => roundOrderAmount(rows.reduce((sum, row) => sum + parseOrderAmount(row.otkupnina), 0));
  return { included, uncertain, completed, amount: amount(included), uncertainAmount: amount(uncertain) };
}
