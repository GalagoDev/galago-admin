import type { SheetOrderRow } from "./google-sheets.ts";

export type OrderRiskDecision = "approve" | "duplicate" | "restore";
export type OrderRiskReference = {
  sheetRowNumber: number;
  fingerprint: string;
  dateLabel: string;
  sourceId?: string;
};

export function planOrderRiskDecisions(
  orders: SheetOrderRow[],
  references: OrderRiskReference[],
  decision: OrderRiskDecision,
) {
  if (references.length === 0 || references.length > 1000) throw new Error("Invalid order selection.");
  const selectedRows = new Set<number>();

  // Resolve and validate the whole selection before making any sheet writes.
  return references.map((reference) => {
    const matches = orders.filter((order) => order.fingerprint === reference.fingerprint
      && order.dateLabel === reference.dateLabel
      && order.sourceId === (reference.sourceId || ""));
    const order = matches.find((candidate) => candidate.sheetRowNumber === reference.sheetRowNumber)
      ?? (matches.length === 1 ? matches[0] : undefined);
    if (!order) throw new Error("Order changed or no longer exists.");
    if (selectedRows.has(order.sheetRowNumber)) throw new Error("Order selected more than once.");
    selectedRows.add(order.sheetRowNumber);

    let appStatus = order.appStatus;
    let riskReview = "";
    if (decision === "restore") {
      if (appStatus !== `duplicate:${order.fingerprint}` || order.deliveredChecked) {
        throw new Error("This order is not marked as duplicate.");
      }
      appStatus = "";
    } else {
      if (appStatus || order.deliveredChecked) throw new Error("Only an active order can be reviewed.");
      riskReview = `${decision === "approve" ? "approved" : "duplicate"}:${order.fingerprint}`;
      if (decision === "duplicate") appStatus = riskReview;
    }
    return {
      sheetRowNumber: order.sheetRowNumber,
      appStatus,
      riskReview,
      changeStatus: appStatus !== order.appStatus,
      changeReview: riskReview !== order.riskReview,
    };
  });
}
