import type { SheetOrderRow } from "./google-sheets.ts";
import { createOrderFingerprint } from "./order-fingerprint.ts";

export function parseSheetOrderRows(sheetName: string, rows: unknown[][]): SheetOrderRow[] {
  const result: SheetOrderRow[] = [];
  let currentDate = "";

  for (const [sourceIndex, row] of rows.slice(1).entries()) {
    const cells = row.map((cell) => String(cell ?? "").trim());
    const filled = cells.slice(0, 10).filter(Boolean);
    if (filled.length === 0) continue;
    if (filled.length === 1 && /^\d{2}\/\d{2}\/\d{4}$/.test(cells[0] ?? "")) {
      currentDate = cells[0];
      continue;
    }
    if (sheetName === "Povrati" && cells[10]?.startsWith("restored:")) continue;

    const order = {
      rowNumber: result.length + 1,
      sheetRowNumber: sourceIndex + 2,
      dateLabel: currentDate,
      primalac: cells[0] ?? "",
      brojTelefona: cells[1] ?? "",
      grad: cells[2] ?? "",
      adresa: cells[3] ?? "",
      artikal: cells[4] ?? "",
      brojPaketa: cells[5] ?? "",
      otkupnina: cells[6] || cells[7] || "",
      vrijednostPosiljke: cells[7] || cells[6] || "",
      dop: cells[8] ?? "",
      zamjena: cells[9] ?? "",
      sourceId: cells[10] ?? "",
      appStatus: cells[11] ?? "",
      receivedAt: cells[12] ?? "",
      riskReview: cells[14] ?? "",
      deliveredChecked: sheetName === "Orders" && cells[15]?.toUpperCase() === "TRUE",
    };
    result.push({ ...order, fingerprint: createOrderFingerprint(order) });
  }
  return result;
}
