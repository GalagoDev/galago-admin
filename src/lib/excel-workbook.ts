import "server-only";

import { read, utils } from "xlsx";

export async function readFirstWorksheet(file: File): Promise<unknown[][]> {
  const workbook = read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel dokument ne sadrži radni list.");

  return utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}
