import type { ImportCurrency, ImportInvoiceDraft } from "@/lib/import-payments-types";

export type InvoiceExtraction = Pick<ImportInvoiceDraft, "totalMinor" | "currency" | "supplier" | "number" | "warning">;

export function parseImportInvoiceLines(lines: string[]): InvoiceExtraction {
  const text = lines.join("\n");
  const supplier = /SHENGFENG[\s-]+E[\s-]*TEN/i.test(text) ? "SHENGFENG" : /\bTADEX\b/i.test(text) ? "TADEX" : null;
  const number = text.match(/\bINVOICE\s*(?:NO\.?|NUMBER|#)\s*[:：]?\s*([\w/-]+)/i)?.[1] || "";
  const candidates: Array<{ amount: number; currency: ImportCurrency | null }> = [];
  for (const line of lines) {
    // Only explicit final-total rows, never goods totals, balances, deposits or subtotals.
    const match = line.trim().match(/^(?:GRAND\s+TOTAL|TOTAL\s+AMOUNT(?:\s+PAYABLE)?|INVOICE\s+TOTAL|TOTAL)(?:\s*\((USD|EUR|BAM)\))?\s*[:：]?\s+(.+)$/i);
    if (!match) continue;
    const body = match[2].trim();
    if (!/^(?:(?:USD|US\$|EUR|BAM|KM|\$|€)\s*)?\d[\d,.\s]*(?:\s*(?:USD|US\$|EUR|BAM|KM|\$|€))?$/i.test(body)) continue;
    const raw = body.replace(/USD|US\$|EUR|BAM|KM|\$|€/gi, "").replace(/\s/g, "");
    let normalized: string;
    if (/^\d{1,3}(?:,\d{3})*(?:\.\d{2})$/.test(raw) || /^\d+\.\d{2}$/.test(raw)) normalized = raw.replaceAll(",", "");
    else if (/^\d{1,3}(?:\.\d{3})*(?:,\d{2})$/.test(raw) || /^\d+,\d{2}$/.test(raw)) normalized = raw.replaceAll(".", "").replace(",", ".");
    else if (/^\d+$/.test(raw)) normalized = raw;
    else continue;
    const [whole, cents = "00"] = normalized.split(".");
    const amount = Number(whole) * 100 + Number(cents);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000_000) continue;
    const currencyText = `${match[1] || ""} ${body}`;
    let currency: ImportCurrency | null = /EUR|€/i.test(currencyText) ? "EUR" : /BAM|\bKM\b/i.test(currencyText) ? "BAM" : /USD|US\$/i.test(currencyText) ? "USD" : null;
    if (!currency && body.includes("$") && /\bUSD\b|US\s+DOLLARS?/i.test(text) && !/\b(?:CAD|AUD|HKD|SGD|NZD)\b/.test(text)) currency = "USD";
    candidates.push({ amount, currency });
  }
  const unique = [...new Map(candidates.map(c => [`${c.amount}:${c.currency}`, c])).values()];
  const total = unique.length === 1 ? unique[0] : null;
  const warnings: string[] = [];
  if (!total) warnings.push("Ukupan iznos nije jednoznačno očitan. Potrebna je ručna provjera.");
  else if (!total.currency) warnings.push("Valuta nije jednoznačno očitana.");
  if (/price\s+is\s+an?\s+estimate|only\s+an?\s+estimate|estimated\s+(?:freight|price|cost)/i.test(text)) warnings.push("Faktura sadrži procijenjeni trošak koji se može promijeniti.");
  return { totalMinor: total?.amount ?? null, currency: total?.currency ?? null, supplier, number, warning: warnings.join(" ") };
}
