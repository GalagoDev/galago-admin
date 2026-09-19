import Link from "next/link";

import { InventoryAliasForm } from "@/components/inventory-alias-form";
import { InventoryUploadForm } from "@/components/inventory-upload-form";
import {
  calculateDailyStatistics,
  displayStatisticsDate,
  normalizeStatisticsDate,
  sarajevoDateKey,
  statisticsDateKeyFromLabel,
} from "@/lib/daily-statistics";
import { getOrdersSheetRows } from "@/lib/google-sheets";
import { getInventoryOverview } from "@/lib/inventory";
import { getMetaAdsDailySpend } from "@/lib/meta-ads";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Params = {
  date?: string;
  refresh?: string;
  inventory?: string;
  count?: string;
  alias?: string;
  error?: string;
};

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDateTime(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("bs-BA", {
    timeZone: "Europe/Sarajevo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function money(value: number | null) {
  if (value === null) return "-";
  return `${new Intl.NumberFormat("bs-BA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} KM`;
}

function percent(value: number) {
  return new Intl.NumberFormat("bs-BA", { maximumFractionDigits: 2 }).format(value * 100);
}

function errorText(code: string) {
  const messages: Record<string, string> = {
    "file-missing": "Odaberite lager dokument.",
    "file-size": "Lager dokument može imati najviše 15 MB.",
    "file-type": "Lager mora biti XLS, XLSX ili CSV dokument.",
    "columns-missing": "Nisu pronađene kolone za naziv artikla, nabavnu cijenu i količinu.",
    "items-missing": "U lager dokumentu nema ispravnih artikala.",
    "alias-invalid": "Povezivanje artikla nije ispravno.",
    "product-not-found": "Odabrani lager artikal nije pronađen.",
  };
  return messages[code] || "Promjena nije sačuvana. Pokušajte ponovo.";
}

export default async function TodayStatisticsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const ordersResult = await getOrdersSheetRows({ fresh: Boolean(params.refresh) })
    .then((orders) => ({ orders, error: "" }))
    .catch((error) => {
      console.error("Daily statistics Sheets read failed", error);
      return { orders: [], error: "Google Sheets podaci trenutno nisu dostupni. Statistika nije izračunata." };
    });
  const latestWorkdayKey = statisticsDateKeyFromLabel(getLatestSheetDateLabel(ordersResult.orders));
  const dateKey = normalizeStatisticsDate(params.date) || latestWorkdayKey || sarajevoDateKey();
  const meta = await getMetaAdsDailySpend(dateKey);
  const inventory = getInventoryOverview();
  const stats = calculateDailyStatistics({
    orders: ordersResult.orders,
    products: inventory.products,
    aliases: inventory.aliases,
    dateKey,
    metaSpendBam: meta.spendBam,
  });
  const sheetsReady = !ordersResult.error;
  const finalProfit = sheetsReady ? stats.profitAfterAds : null;
  const notice = params.inventory === "added"
    ? { tone: "success", text: `Lager je uvezen: ${Number(params.count) || inventory.products.length} artikala.` }
    : params.inventory === "duplicate"
      ? { tone: "neutral", text: "Ovaj lager dokument je već uvezen." }
      : params.alias === "saved"
        ? { tone: "success", text: "Naziv artikla je povezan sa lagerom." }
        : params.error
          ? { tone: "error", text: errorText(params.error) }
          : null;

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Statistika</p>
              <p className="mt-2 text-lg font-semibold text-white">Danas</p>
              <p className="mt-1 text-sm text-neutral-400">Orders blok {displayStatisticsDate(dateKey)} · ista lista kao Nove narudžbe</p>
            </div>
            <Link href="/stats" aria-label="Nazad na statistiku" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]">
              <ArrowIcon />
            </Link>
          </div>
        </section>

        <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-2 block text-xs text-neutral-500">Radni dan</span>
            <input type="date" name="date" defaultValue={dateKey} className="min-h-11 rounded-lg border border-white/10 bg-[#111214] px-3 py-2 text-sm text-white [color-scheme:dark] outline-none focus:border-sky-300/35" />
          </label>
          <button type="submit" className="min-h-11 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-medium text-white hover:bg-white/[0.08]">Prikaži</button>
          <Link href={`/stats/today?date=${dateKey}&refresh=1`} className="inline-flex min-h-11 items-center rounded-lg border border-sky-300/15 bg-sky-300/[0.06] px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-300/10">Osvježi</Link>
        </form>

        {notice ? (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : notice.tone === "error" ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-white/10 bg-white/[0.04] text-neutral-300"}`}>
            {notice.text}
          </div>
        ) : null}

        {ordersResult.error ? (
          <div className="mt-4 rounded-lg border border-red-300/20 bg-red-300/10 px-4 py-3 text-sm text-red-100">
            {ordersResult.error}
          </div>
        ) : null}

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <article className="rounded-[1.25rem] border border-sky-300/20 bg-sky-300/[0.09] p-4 lg:rounded-lg">
            <p className="text-xs text-neutral-400">Narudžbe</p>
            <p className="mt-3 text-2xl font-semibold text-white">{ordersResult.error ? "-" : stats.sourceOrderCount}</p>
            {stats.sourceOrderCount !== stats.orderCount ? <p className="mt-2 text-[11px] text-neutral-500">{stats.orderCount} aktivnih u obračunu</p> : null}
          </article>
          <article className="rounded-[1.25rem] border border-emerald-300/20 bg-emerald-300/[0.08] p-4 lg:rounded-lg">
            <p className="text-xs text-neutral-400">Prihod</p>
            <p className="mt-3 text-2xl font-semibold text-white">{ordersResult.error ? "-" : money(stats.revenue)}</p>
          </article>
          <article className="rounded-[1.25rem] border border-amber-300/20 bg-amber-300/[0.07] p-4 lg:rounded-lg">
            <p className="text-xs text-neutral-400">Meta oglasi</p>
            <p className="mt-3 text-2xl font-semibold text-white">{money(stats.metaSpend)}</p>
          </article>
          <article className={`rounded-[1.25rem] border p-4 lg:rounded-lg ${finalProfit === null ? "border-white/10 bg-white/[0.035]" : finalProfit >= 0 ? "border-emerald-300/20 bg-emerald-300/[0.08]" : "border-red-300/20 bg-red-300/[0.08]"}`}>
            <p className="text-xs text-neutral-400">Dnevna dobit</p>
            <p className="mt-3 text-2xl font-semibold text-white">{money(finalProfit)}</p>
            {finalProfit === null ? (
              <p className="mt-2 text-[11px] text-neutral-500">
                {!sheetsReady ? "Sheets podaci nisu dostupni" : !stats.costComplete ? "Poveži sve artikle sa lagerom" : !meta.complete ? "Poveži Meta Ads" : "Izračun nije dostupan"}
              </p>
            ) : null}
          </article>
        </section>

        <section className="mt-5 border-y border-white/10 py-5">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm lg:grid-cols-5">
            <div><p className="text-xs text-neutral-500">Prihod</p><p className="mt-1 font-medium text-white">{money(sheetsReady ? stats.revenue : null)}</p></div>
            <div><p className="text-xs text-neutral-500">PDV ({percent(stats.vatRate)}%)</p><p className="mt-1 font-medium text-red-200">{sheetsReady ? `-${money(stats.vat)}` : "-"}</p></div>
            <div><p className="text-xs text-neutral-500">Brza pošta ({money(stats.shippingCostPerOrder)})</p><p className="mt-1 font-medium text-red-200">{sheetsReady ? `-${money(stats.shipping)}` : "-"}</p></div>
            <div><p className="text-xs text-neutral-500">Nabavna vrijednost</p><p className="mt-1 font-medium text-red-200">{sheetsReady ? `-${money(stats.costOfGoods)}` : "-"}</p></div>
            <div><p className="text-xs text-neutral-500">Dobit prije oglasa</p><p className="mt-1 font-semibold text-emerald-200">{money(sheetsReady ? stats.profitBeforeAds : null)}</p></div>
          </div>
          {stats.unmatchedLines > 0 ? (
            <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.07] px-3 py-2 text-xs text-amber-100">
              Nabavna vrijednost nije potpuna: {stats.unmatchedLines} naziva artikala nije povezano sa lagerom. Dobit se neće prikazati dok ih ne povežete.
            </p>
          ) : null}
        </section>

        <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
          <div className="min-w-0">
            <div className="mb-3">
              <p className="text-lg font-semibold text-white">Izlaznost artikala</p>
              <p className="mt-1 text-sm text-neutral-500">Rangirano po prodanim komadima</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-white/10">
              {stats.ranking.length > 0 ? stats.ranking.map((item, index) => (
                <div key={item.product.id} className="grid grid-cols-[36px_minmax(0,1fr)_70px_90px] items-center gap-3 border-b border-white/[0.06] px-3 py-3 text-sm last:border-b-0">
                  <span className="text-xs text-neutral-600">#{index + 1}</span>
                  <div className="min-w-0"><p className="break-words font-medium text-white">{item.product.name}</p><p className="mt-1 text-xs text-neutral-500">{item.orderCount} narudžbi</p></div>
                  <span className="text-right font-semibold text-sky-200">{item.units}</span>
                  <span className="text-right text-xs text-neutral-500">{money(item.cost)}</span>
                </div>
              )) : (
                <p className="px-4 py-8 text-center text-sm text-neutral-500">Nema povezanih prodanih artikala za ovaj datum.</p>
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <details className="rounded-lg border border-white/10 bg-white/[0.025]" open={!inventory.latestImport}>
              <summary className="cursor-pointer list-none px-4 py-4 [&::-webkit-details-marker]:hidden">
                <p className="font-semibold text-white">Lager i nabavne cijene</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {inventory.latestImport ? `${inventory.latestImport.itemCount} artikala · ${formatDateTime(inventory.latestImport.importedAt)}` : "Lager još nije uvezen"}
                </p>
              </summary>
              <div className="border-t border-white/8 px-4 pb-4">
                <InventoryUploadForm date={dateKey} />
              </div>
            </details>

            <div className={`rounded-lg border p-4 ${meta.complete ? "border-emerald-300/15 bg-emerald-300/[0.05]" : "border-amber-300/15 bg-amber-300/[0.05]"}`}>
              <p className="font-semibold text-white">Meta Ads</p>
              <p className="mt-1 text-xs text-neutral-400">{meta.complete ? `${meta.accounts.length} računa povezano` : meta.error}</p>
              {meta.accounts.map((account) => (
                <div key={account.accountId} className="mt-3 flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-neutral-300">{account.accountName}</span>
                  <span className="shrink-0 text-neutral-400">{account.spend} {account.currency}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {stats.unmatched.length > 0 ? (
          <section className="mt-5 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] p-4 lg:p-5">
            <p className="text-lg font-semibold text-white">Neprepoznati artikli</p>
            <p className="mt-1 text-sm text-neutral-500">Ručno poveži naziv iz narudžbe sa tačnim artiklom iz lagera.</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {stats.unmatched.map((item) => (
                <article key={item.label} className="rounded-lg border border-white/8 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="break-words text-sm font-medium text-white">{item.label}</p>
                    <span className="rounded-full bg-amber-300/10 px-2 py-1 text-[10px] text-amber-100">{item.count}x</span>
                  </div>
                  {inventory.products.length > 0 ? <InventoryAliasForm alias={item.label} date={dateKey} products={inventory.products} /> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
