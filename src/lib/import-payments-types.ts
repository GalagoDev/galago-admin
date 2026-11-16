export const importSuppliers = { TADEX: "Tadex", SHENGFENG: "SHENGFENG E-TEN" } as const;
export type ImportSupplier = keyof typeof importSuppliers;
export type ImportCurrency = "BAM" | "EUR" | "USD";
export type ImportPaymentKind = "payment" | "fee";

export type SourcePayment = {
  id: string;
  date: string;
  partner: string;
  reference: string;
  amountMinor: number;
  currency: ImportCurrency;
  kind: ImportPaymentKind;
  supplier: ImportSupplier | null;
  statement: string;
  account: string;
  fileId: string | null;
  excluded?: boolean;
};
export type ImportContainer = {
  id: string;
  name: string;
  notes: string;
  status: "planned" | "in_transit" | "received";
};
export type ImportInvoice = {
  containerId: string;
  fileId: string;
  filename: string;
  number: string;
  totalMinor: number;
  currency: ImportCurrency;
  supplier: ImportSupplier;
  warning: string;
};
export type ImportInvoiceDraft = Omit<ImportInvoice, "totalMinor" | "currency" | "supplier"> & {
  totalMinor: number | null;
  currency: ImportCurrency | null;
  supplier: ImportSupplier | null;
};
export type ImportAllocation = {
  id: string;
  paymentId: string;
  containerId: string;
  amountMinor: number;
};
export type ImportPayment = SourcePayment & {
  supplier: ImportSupplier | null;
  sourceSupplier: ImportSupplier | null;
  ignored: boolean;
  available: boolean;
  allocatedMinor: number;
};
export type ImportsOverview = {
  containers: ImportContainer[];
  payments: ImportPayment[];
  allocations: ImportAllocation[];
  invoices: ImportInvoice[];
  lastSyncAt: string | null;
  sourceThrough: string | null;
  sourceFrom: string | null;
  error: string | null;
  configured: boolean;
  companyId: string | null;
};

export function importInvoiceProgress(invoice: ImportInvoice, data: Pick<ImportsOverview, "payments" | "allocations">) {
  const payments = new Map(data.payments.map(p => [p.id, p]));
  let paidMinor = 0;
  let excluded = 0;
  for (const a of data.allocations) {
    if (a.containerId !== invoice.containerId) continue;
    const p = payments.get(a.paymentId);
    if (!p || p.kind !== "payment") continue;
    if (p.available && !p.ignored && p.supplier === invoice.supplier && p.currency === invoice.currency) paidMinor += a.amountMinor;
    else excluded++;
  }
  return { paidMinor, remainingMinor: Math.max(0, invoice.totalMinor - paidMinor), overpaidMinor: Math.max(0, paidMinor - invoice.totalMinor),
    percent: invoice.totalMinor > 0 ? Math.round(paidMinor / invoice.totalMinor * 1000) / 10 : 0, excluded };
}

export function formatImportMoney(minor: number, currency: ImportCurrency) {
  return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency === "BAM" ? "KM" : currency}`;
}

export function parseImportMoney(input: string): number {
  let value = input.trim().replace(/[\s\u00a0]/g, "");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) value = value.replaceAll(".", "");
  value = value.replace(",", ".");
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) throw new Error("Unesite ispravan iznos, npr. 1.250,50.");
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Iznos mora biti veći od nule.");
  return result;
}
