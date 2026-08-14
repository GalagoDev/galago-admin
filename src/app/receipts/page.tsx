import Link from "next/link";

import { refreshReceiptPhonesAction } from "@/app/actions/receipts";
import { ReceiptListClient } from "@/components/receipt-list-client";
import { ReceiptPdfUpload } from "@/components/receipt-pdf-upload";
import { ReceiptWorkbookUpload } from "@/components/receipt-workbook-upload";
import { getReceiptBatchOverview, getRecentReceiptBatches } from "@/lib/receipt-batches";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Params = {
  batch?: string;
  error?: string;
  imported?: string;
  duplicate?: string;
  pdfs?: string;
  phones?: string;
};

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getNotice(params: Params) {
  const errors: Record<string, string> = {
    "missing-workbook": "Odaberite Excel dokument.",
    "workbook-invalid": "Excel dokument nije ispravan ili nema potrebne kolone.",
    "batch-not-found": "Dnevna lista nije pronađena.",
    "pdf-count": "Broj PDF dokumenata ne odgovara broju kupaca.",
    "pdf-type": "Svi odabrani dokumenti moraju biti ispravni PDF fajlovi.",
    "pdf-size": "Jedan PDF dokument je veći od 10 MB.",
    "pdf-total-size": "PDF dokumenti mogu imati ukupno najviše 50 MB.",
    "pdf-locked": "PDF dokumenti se ne mogu zamijeniti nakon slanja.",
    "pdf-upload-failed": "PDF dokumenti nisu sačuvani.",
    "phone-refresh-failed": "Telefoni nisu osvježeni iz Google Sheetsa.",
  };
  if (params.error) return { tone: "error", text: errors[params.error] ?? "Radnja nije završena. Pokušajte ponovo." };
  if (params.pdfs) return { tone: "success", text: `${params.pdfs} PDF dokumenata povezano sa kupcima.` };
  if (params.phones) return { tone: "success", text: `${params.phones} telefona pronađeno u Orders sheetu.` };
  if (params.imported) return {
    tone: "success",
    text: params.duplicate ? "Ovaj Excel je već uvezen u današnju listu." : "Današnja lista kupaca je kreirana.",
  };
  return null;
}

function formatCollectionDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("bs-BA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const selectedBatchId = Number(params.batch);
  const overview = getReceiptBatchOverview(Number.isInteger(selectedBatchId) && selectedBatchId > 0 ? selectedBatchId : undefined);
  const recentBatches = getRecentReceiptBatches();
  const notice = getNotice(params);

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <p className="mt-2 text-lg font-semibold text-white">Računi</p>
              <p className="mt-1 text-sm text-neutral-400">Dnevna lista naplaćenih pošiljki i PDF računa</p>
            </div>
            <Link href="/" aria-label="Nazad na pregled" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]">
              <ArrowIcon />
            </Link>
          </div>
        </section>

        {notice ? (
          <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100"}`}>
            {notice.text}
          </div>
        ) : null}

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
          <p className="text-lg font-semibold text-white">Nova dnevna lista</p>
          <p className="mt-1 text-sm text-neutral-500">Uvoz izvještaja kurirske službe</p>
          <ReceiptWorkbookUpload />
        </section>

        {overview ? (
          <>
            <section className="mt-5 flex flex-col gap-3 border-y border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-sky-200">Lista za {formatCollectionDate(overview.batch.collectionDate)}</p>
                <p className="mt-1 truncate text-sm text-neutral-500">{overview.batch.originalName}</p>
              </div>
              <form action={refreshReceiptPhonesAction}>
                <input type="hidden" name="batchId" value={overview.batch.id} />
                <button type="submit" className="min-h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-white/[0.08] sm:w-auto">Osvježi telefone</button>
              </form>
            </section>

            <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["Kupci", overview.totals.customers],
                ["Telefoni", `${overview.totals.phones}/${overview.totals.customers}`],
                ["PDF", `${overview.totals.pdfs}/${overview.totals.customers}`],
                ["Poslano", `${overview.totals.sent}/${overview.totals.customers}`],
              ].map(([label, value]) => (
                <article key={label} className="rounded-[1.25rem] border border-white/10 bg-white/[0.035] px-4 py-4 lg:rounded-lg">
                  <p className="text-xs text-neutral-500">{label}</p>
                  <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
                </article>
              ))}
            </section>

            <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
              <p className="text-lg font-semibold text-white">PDF računi</p>
              <p className="mt-1 text-sm text-neutral-500">Dokumenti se povezuju po broju reda</p>
              <ReceiptPdfUpload
                batchId={overview.batch.id}
                recipients={overview.recipients.map((row) => ({ position: row.position, recipient: row.recipient }))}
                existingCount={overview.totals.pdfs}
              />
            </section>

            <section className="mt-5 rounded-[2rem] border border-amber-300/15 bg-amber-300/[0.04] p-4 lg:rounded-lg lg:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-amber-100">Viber Business nije povezan</p>
                  <p className="mt-1 text-sm text-neutral-400">Slanje će biti dostupno nakon aktivacije poslovnog Viber providera.</p>
                </div>
                <button type="button" disabled className="min-h-11 shrink-0 rounded-lg bg-neutral-700 px-4 py-2.5 text-sm font-semibold text-neutral-400 opacity-70">Pošalji račune</button>
              </div>
            </section>

            <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-white">Kupci</p>
                  <p className="mt-1 text-sm text-neutral-500">Redoslijed od najstarijeg do najnovijeg datuma slanja</p>
                </div>
                <p className="shrink-0 text-sm font-medium text-emerald-200">{new Intl.NumberFormat("bs-BA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(overview.totals.amount)} KM</p>
              </div>
              <ReceiptListClient rows={overview.recipients} />
            </section>
          </>
        ) : (
          <section className="mt-5 border-y border-dashed border-white/10 py-8 text-sm text-neutral-500">Još nema dnevne liste računa.</section>
        )}

        {recentBatches.length > 1 ? (
          <section className="mt-5 pb-4">
            <p className="mb-3 text-xs uppercase tracking-[0.16em] text-neutral-500">Prethodne liste</p>
            <div className="flex flex-wrap gap-2">
              {recentBatches.map((batch) => (
                <Link key={batch.id} href={`/receipts?batch=${batch.id}`} className={`rounded-lg border px-3 py-2 text-xs transition ${overview?.batch.id === batch.id ? "border-sky-300/30 bg-sky-300/10 text-sky-100" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:text-white"}`}>
                  {formatCollectionDate(batch.collectionDate)} · #{batch.id}
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
