export function parseOrderAmount(value: string | number | null | undefined) {
  let normalized = String(value ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!normalized) return 0;

  const commaIndex = normalized.lastIndexOf(",");
  const dotIndex = normalized.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    normalized = normalized.length - commaIndex - 1 === 3
      ? normalized.replace(/,/g, "")
      : normalized.replace(",", ".");
  } else if (dotIndex >= 0 && normalized.length - dotIndex - 1 === 3) {
    normalized = normalized.replace(/\./g, "");
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

export function roundOrderAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
