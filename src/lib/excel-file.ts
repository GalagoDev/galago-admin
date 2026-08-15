export const EXCEL_FILE_ACCEPT =
  ".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function isExcelWorkbook(fileName: string) {
  return /\.xlsx?$/i.test(fileName);
}
