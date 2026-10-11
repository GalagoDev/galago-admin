import type { SheetOrderRow } from "./google-sheets.ts";

type TrackedOrder = Pick<SheetOrderRow, "sheetRowNumber" | "dateLabel" | "sourceId" | "appStatus" | "receivedAt" | "deliveredChecked">;

function dateKey(label: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(label);
  return match ? `${match[3]}${match[2]}${match[1]}` : "";
}

function hasCopiedTracking(current: TrackedOrder, previous: TrackedOrder) {
  if (current.appStatus && previous.appStatus && current.appStatus !== previous.appStatus) return false;
  if (current.appStatus && current.appStatus === previous.appStatus) return true;
  return Boolean(current.sourceId && current.receivedAt
    && current.sourceId === previous.sourceId
    && current.receivedAt === previous.receivedAt);
}

export function findCopiedOrderRows<T extends TrackedOrder>(rows: T[], eligibleDates: Set<string>): T[] {
  return rows.filter((current) => {
    if (!eligibleDates.has(current.dateLabel)) return false;
    const currentDate = dateKey(current.dateLabel);
    if (!currentDate) return false;

    return rows.some((previous) => {
      if (previous.sheetRowNumber === current.sheetRowNumber) return false;
      const previousDate = dateKey(previous.dateLabel);
      if (!previousDate || !hasCopiedTracking(current, previous)) return false;
      if (previousDate < currentDate) return true;
      return previousDate === currentDate
        && (previous.deliveredChecked && !current.deliveredChecked
          || previous.sheetRowNumber < current.sheetRowNumber && !(current.deliveredChecked && !previous.deliveredChecked));
    });
  });
}
