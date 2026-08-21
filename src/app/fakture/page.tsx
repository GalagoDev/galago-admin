import Link from "next/link";

import { InvoiceActions } from "@/components/invoice-actions";
import { InvoiceUploadForm } from "@/components/invoice-upload-form";
import {
  currentInvoiceMonth,
  getInvoiceMonths,
  getInvoiceOverview,
  normalizeInvoiceMonth,
  shiftInvoiceMonth,
} from "@/lib/invoices";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Params = {
  month?: string;
  error?: string;
  added?: string;
  duplicate?: string;
};

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M7 3.5h8l3 3V20.5H7V3.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3.5v3h3M10 11h5M10 15h5" strokeLinecap="round" />
    </svg>
  );
}

function formatMonth(value: string) {
  const date = new Date(`${value}-01T12:00:00`);
  return new Intl.DateTimeFormat("bs-BA", { month: "long", year: "numeric" }).format(date);
}

function formatAmount(value: number) {
  return `${new Intl.NumberFormat("bs-BA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} KM`;
}

function formatDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("bs-BA", {
    timeZone: "Europe/Sarajevo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getNotice(params: Params) {
  const errors: Record<string, string> = {
    "file-missing": "Odaberite dokument fakture.",
    "file-size": "Dokument može imati najviše 10 MB.",
    "file-type": "Dokument mora biti PDF, JPG, PNG ili WEBP.",
    "month-invalid": "Odabrani mjesec nije ispravan.",
    "amount-invalid": "Iznos nije ispravan.",
    "upload-failed": "Faktura nije sačuvana. Pokušajte ponovo.",
  };
  if (params.error) return { tone: "error", text: errors[params.error] || "Radnja nije završena." };
  if (params.duplicate) return { tone: "info", text: "Isti dokument je već dodan u ovaj mjesec." };
  if (params.added) return { tone: "success", text: "Faktura je dodana." };
  return null;
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const month = normalizeInvoiceMonth(params.month) || currentInvoiceMonth();
  const overview = getInvoiceOverview(month);
  const months = getInvoiceMonths();
  const previousMonth = shiftInvoiceMonth(month, -1);
  const nextMonth = shiftInvoiceMonth(month, 1);
  const notice = getNotice(params);

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-28 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <h1 className="mt-2 text-lg font-semibold text-white">Fakture</h1>
              <p className="mt-1 text-sm text-neutral-400">Mjesečne obaveze i evidencija plaćanja</p>
            </div>
            <Link href="/" aria-label="Nazad na pregled" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]">
              <ArrowIcon direction="left" />
            </Link>
          </div>
        </section>

        {notice ? (
          <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${
            notice.tone === "success"
              ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
              : notice.tone === "info"
                ? "border-sky-300/20 bg-sky-300/10 text-sky-100"
                : "border-red-300/20 bg-red-300/10 text-red-100"
          }`}>
            {notice.text}
          </div>
        ) : null}

        <section className="mt-5 border-y border-white/10 py-4">
          <div className="flex items-center justify-between gap-3">
            <Link href={`/fakture?month=${previousMonth}`} aria-label="Prethodni mjesec" title="Prethodni mjesec" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]">
              <ArrowIcon direction="left" />
            </Link>
            <div className="min-w-0 text-center">
              <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">Odabrani mjesec</p>
              <p className="mt-1 truncate text-base font-semibold capitalize text-white">{formatMonth(month)}</p>
            </div>
            <Link href={`/fakture?month=${nextMonth}`} aria-label="Sljedeći mjesec" title="Sljedeći mjesec" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]">
              <ArrowIcon direction="right" />
            </Link>
          </div>
          <form method="get" className="mt-4 flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Izaberi mjesec</span>
              <input type="month" name="month" defaultValue={month} className="min-h-11 w-full rounded-lg border border-white/10 bg-[#09090b] px-3 py-2.5 text-sm text-white [color-scheme:dark] outline-none focus:border-sky-300/40" />
            </label>
            <button type="submit" className="min-h-11 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-white/[0.1]">Prikaži</button>
          </form>
          {months.length > 0 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {months.map((item) => (
                <Link key={item} href={`/fakture?month=${item}`} className={`shrink-0 rounded-lg border px-3 py-2 text-xs capitalize transition ${item === month ? "border-sky-300/30 bg-sky-300/10 text-sky-100" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:text-white"}`}>
                  {formatMonth(item)}
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Fakture", overview.totals.count, "text-white"],
            ["Plaćeno", overview.totals.paid, "text-emerald-200"],
            ["Nije plaćeno", overview.totals.unpaid, "text-amber-200"],
            ["Ukupno", formatAmount(overview.totals.totalAmount), "text-sky-200"],
          ].map(([label, value, tone]) => (
            <article key={String(label)} className="rounded-[1.25rem] border border-white/10 bg-white/[0.035] px-4 py-4 lg:rounded-lg">
              <p className="text-xs text-neutral-500">{label}</p>
              <p className={`mt-3 break-words text-2xl font-semibold ${tone}`}>{value}</p>
            </article>
          ))}
        </section>

        {overview.totals.count > 0 ? (
          <section className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="border-l-2 border-emerald-300/35 px-3 py-2">
              <p className="text-xs text-neutral-500">Plaćeni iznos</p>
              <p className="mt-1 font-semibold text-emerald-100">{formatAmount(overview.totals.paidAmount)}</p>
            </div>
            <div className="border-l-2 border-amber-300/35 px-3 py-2">
              <p className="text-xs text-neutral-500">Za platiti</p>
              <p className="mt-1 font-semibold text-amber-100">{formatAmount(overview.totals.unpaidAmount)}</p>
            </div>
          </section>
        ) : null}

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
          <h2 className="text-lg font-semibold text-white">Dodaj fakturu</h2>
          <p className="mt-1 text-sm text-neutral-500">PDF ili fotografija računa</p>
          <InvoiceUploadForm defaultMonth={month} />
        </section>

        <section className="mt-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Fakture za {formatMonth(month)}</h2>
              <p className="mt-1 text-sm text-neutral-500">Neplaćene obaveze su prikazane prve</p>
            </div>
          </div>

          {overview.invoices.length === 0 ? (
            <div className="mt-4 border-y border-dashed border-white/10 py-9 text-sm text-neutral-500">Nema faktura za ovaj mjesec.</div>
          ) : (
            <>
              <div className="mt-4 space-y-3 lg:hidden">
                {overview.invoices.map((invoice) => (
                  <article key={invoice.id} className="rounded-[1.25rem] border border-white/10 bg-[#111214] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-semibold text-white">{invoice.title}</p>
                        <p className="mt-1 break-all text-xs text-neutral-500">{invoice.originalName}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${invoice.paid ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`}>
                        {invoice.paid ? "Plaćeno" : "Nije plaćeno"}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-y border-white/10 py-3 text-sm">
                      <div>
                        <p className="text-xs text-neutral-500">Iznos</p>
                        <p className="mt-1 font-semibold text-white">{invoice.amount === null ? "Nije unesen" : formatAmount(invoice.amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-500">Dodano</p>
                        <p className="mt-1 text-neutral-300">{formatDate(invoice.createdAt)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <Link href={`/fakture/files/${invoice.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-sky-100 transition hover:bg-white/[0.08]">
                        <DocumentIcon /> Otvori · {formatBytes(invoice.sizeBytes)}
                      </Link>
                    </div>
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <InvoiceActions invoiceId={invoice.id} paid={invoice.paid} />
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-4 hidden overflow-hidden rounded-lg border border-white/10 lg:block">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="bg-white/[0.045] text-xs text-neutral-500">
                    <tr>
                      <th className="w-[30%] px-4 py-3 font-medium">Dobavljač / naziv</th>
                      <th className="w-[14%] px-4 py-3 font-medium">Iznos</th>
                      <th className="w-[14%] px-4 py-3 font-medium">Status</th>
                      <th className="w-[14%] px-4 py-3 font-medium">Dokument</th>
                      <th className="w-[28%] px-4 py-3 text-right font-medium">Radnje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-[#111214]">
                    {overview.invoices.map((invoice) => (
                      <tr key={invoice.id} className="align-middle">
                        <td className="px-4 py-4">
                          <p className="break-words font-semibold text-white">{invoice.title}</p>
                          <p className="mt-1 break-all text-xs text-neutral-500">{invoice.originalName} · {formatDate(invoice.createdAt)}</p>
                        </td>
                        <td className="px-4 py-4 font-semibold text-neutral-200">{invoice.amount === null ? "—" : formatAmount(invoice.amount)}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${invoice.paid ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`}>
                            {invoice.paid ? "Plaćeno" : "Nije plaćeno"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <Link href={`/fakture/files/${invoice.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-sky-100 transition hover:bg-white/[0.08]">
                            <DocumentIcon /> {formatBytes(invoice.sizeBytes)}
                          </Link>
                        </td>
                        <td className="px-4 py-4"><InvoiceActions invoiceId={invoice.id} paid={invoice.paid} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
