import type { SheetOrderRow } from "@/lib/google-sheets";

export function parseSheetDateLabel(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return 0;
  const [, dd, mm, yyyy] = match;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`).getTime();
}

export function getLatestSheetDateLabel(rows: SheetOrderRow[]) {
  return rows
    .map((row) => row.dateLabel)
    .filter(Boolean)
    .sort((a, b) => parseSheetDateLabel(b) - parseSheetDateLabel(a))[0];
}
