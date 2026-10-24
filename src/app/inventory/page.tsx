import Link from "next/link";

import { syncInventoryFromShopifyAction } from "@/app/actions/inventory";
import { getInventoryOverview } from "@/lib/inventory";
import { normalizeInventoryName } from "@/lib/inventory-import";
import { refreshInventoryFromShopifyIfStale } from "@/lib/inventory-shopify-sync";
import { getBedlyOrderSyncStatus } from "@/lib/bedly-ananas-orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Params = {
  q?: string;
  status?: string;
  sync?: string;
  matched?: string;
  catalog?: string;
  unmatched?: string;
};

type StockStatus = "all" | "available" | "low" | "empty";

const LOW_STOCK_LIMIT = 5;

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M12 15V4M8 8l4-4 4 4M5 14v5h14v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M20 11a8 8 0 10-2.34 5.66M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("bs-BA", { maximumFractionDigits: 3 }).format(value);
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat("bs-BA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} KM`;
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

function stockStatus(quantity: number): Exclude<StockStatus, "all"> {
  if (quantity <= 0) return "empty";
  if (quantity <= LOW_STOCK_LIMIT) return "low";
  return "available";
}

function statusLabel(status: Exclude<StockStatus, "all">) {
  if (status === "empty") return "Nema na stanju";
  if (status === "low") return "Pri kraju";
  return "Na stanju";
}

function statusClass(status: Exclude<StockStatus, "all">) {
  if (status === "empty") return "border-red-300/20 bg-red-300/10 text-red-100";
  if (status === "low") return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  return "border-emerald-300/15 bg-emerald-300/[0.08] text-emerald-100";
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  try {
    await refreshInventoryFromShopifyIfStale();
  } catch (error) {
    console.error("Automatic Shopify Lager refresh failed", error);
  }
  const inventory = getInventoryOverview();
  const bedlyOrders = getBedlyOrderSyncStatus();
  const query = String(params.q || "").trim();
  const normalizedQuery = normalizeInventoryName(query);
  const requestedStatus = String(params.status || "all");
  const status: StockStatus = ["available", "low", "empty"].includes(requestedStatus)
    ? requestedStatus as StockStatus
    : "all";

  const products = inventory.products
    .filter((product) => {
      if (normalizedQuery && !normalizeInventoryName(`${product.name} ${product.sku}`).includes(normalizedQuery)) return false;
      return status === "all" || stockStatus(product.quantity) === status;
    })
    .sort((left, right) => {
      const statusRank = { empty: 0, low: 1, available: 2 };
      const statusDifference = statusRank[stockStatus(left.quantity)] - statusRank[stockStatus(right.quantity)];
      return statusDifference || left.name.localeCompare(right.name, "bs");
    });

  const totalQuantity = inventory.products.reduce((sum, product) => sum + product.quantity, 0);
  const totalPurchaseValue = inventory.products.reduce(
    (sum, product) => sum + Math.max(0, product.quantity) * Math.max(0, product.unitCost),
    0,
  );
  const lowStockCount = inventory.products.filter((product) => stockStatus(product.quantity) === "low").length;
  const emptyStockCount = inventory.products.filter((product) => stockStatus(product.quantity) === "empty").length;
  const filters: Array<{ value: StockStatus; label: string }> = [
    { value: "all", label: "Sve" },
    { value: "available", label: "Na stanju" },
    { value: "low", label: "Pri kraju" },
    { value: "empty", label: "Nema" },
  ];
  const syncSuccess = params.sync === "success";
  const syncError = params.sync === "error" || Boolean(inventory.shopifySync?.lastError);
  const stockSourceLabel = inventory.shopifySync?.lastSuccessAt
    ? `Stanje sa Galago Shopifyja · ${formatDateTime(inventory.shopifySync.lastSuccessAt)}`
    : inventory.latestImport
      ? `Stanje iz uvoza · ${formatDateTime(inventory.latestImport.importedAt)}`
      : "Lager još nije uvezen";

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 lg:rounded-lg lg:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <h1 className="mt-2 text-lg font-semibold text-white">Lager</h1>
              <p className="mt-1 text-sm text-neutral-400">{stockSourceLabel}</p>
              <Link href="/integrations/bazzar" className="mt-2 inline-block text-xs text-sky-300 hover:text-sky-200">Bazzar XML integracija →</Link>
              <p className="mt-2 text-xs text-neutral-400">
                Bedly Ananas: {bedlyOrders.enabled ? "automatsko skidanje potvrđenih narudžbi · Cloud −2 / Ergonomski −1" : "automatsko skidanje je pauzirano"}.
                {bedlyOrders.state?.last_success_at ? ` Zadnja provjera: ${formatDateTime(bedlyOrders.state.last_success_at)}.` : ""}
                {bedlyOrders.enabled ? " Ove prodaje nemojte ponovo ručno skidati s lagera." : ""}
              </p>
              {bedlyOrders.enabled && (bedlyOrders.stale || bedlyOrders.state?.last_error || bedlyOrders.negativeStock.length > 0) ? (
                <p role="status" className="mt-2 text-xs text-amber-200">
                  Bedly Ananas zahtijeva provjeru: {bedlyOrders.negativeStock.length > 0
                    ? "negativno stanje lagera."
                    : bedlyOrders.state?.last_error ? "zadnje preuzimanje narudžbi nije uspjelo; sistem će pokušati ponovo."
                      : "čeka se uspješna provjera narudžbi."}
                </p>
              ) : null}
              {inventory.shopifySync?.lastSuccessAt ? (
                <p className="mt-1 text-xs text-neutral-600">
                  Povezano {inventory.shopifySync.matchedProducts} od {inventory.shopifySync.catalogProducts} lager artikala
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <div className="sm:border-r sm:border-white/10 sm:pr-4 sm:text-right">
                <p className="text-xs text-neutral-500">Nabavna vrijednost</p>
                <p className="mt-1 text-xl font-semibold text-emerald-100">{formatMoney(totalPurchaseValue)}</p>
              </div>
              <Link href="/" aria-label="Nazad na pregled" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]">
                <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>

        {syncSuccess ? (
          <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.08] px-4 py-3 text-sm text-emerald-100">
            Lager je osvježen sa Galago Shopifyja. Povezano {params.matched || inventory.shopifySync?.matchedProducts || 0} od {params.catalog || inventory.products.length} artikala.
          </div>
        ) : null}
        {syncError ? (
          <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.08] px-4 py-3 text-sm text-amber-100">
            Shopify količine trenutno nisu osvježene. Posljednje ispravno stanje ostaje sačuvano; pokušajte ponovo.
          </div>
        ) : null}
        {inventory.shopifySync?.lastSuccessAt && inventory.shopifySync.unmatchedVariants > 0 ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-neutral-400">
            {inventory.shopifySync.unmatchedVariants} Shopify varijanti nije sigurno povezano i njihove stare količine nisu prepisane.
          </div>
        ) : null}

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <article className="rounded-[1.25rem] border border-sky-300/20 bg-sky-300/[0.08] p-4 lg:rounded-lg">
            <p className="text-xs text-neutral-400">Artikli</p>
            <p className="mt-3 text-2xl font-semibold text-white">{inventory.products.length}</p>
          </article>
          <article className="rounded-[1.25rem] border border-emerald-300/20 bg-emerald-300/[0.08] p-4 lg:rounded-lg">
            <p className="text-xs text-neutral-400">Ukupno komada</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatQuantity(totalQuantity)}</p>
          </article>
          <article className="rounded-[1.25rem] border border-amber-300/20 bg-amber-300/[0.07] p-4 lg:rounded-lg">
            <p className="text-xs text-neutral-400">Pri kraju</p>
            <p className="mt-3 text-2xl font-semibold text-white">{lowStockCount}</p>
            <p className="mt-2 text-[11px] text-neutral-500">1–{LOW_STOCK_LIMIT} komada</p>
          </article>
          <article className="rounded-[1.25rem] border border-red-300/20 bg-red-300/[0.07] p-4 lg:rounded-lg">
            <p className="text-xs text-neutral-400">Nema na stanju</p>
            <p className="mt-3 text-2xl font-semibold text-white">{emptyStockCount}</p>
          </article>
        </section>

        <section className="mt-5 border-y border-white/10 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <form method="get" className="flex min-w-0 flex-1 gap-2 lg:max-w-xl">
              <input type="hidden" name="status" value={status} />
              <label className="min-w-0 flex-1">
                <span className="sr-only">Pretraži lager</span>
                <input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="Traži artikal ili šifru..."
                  className="min-h-11 w-full rounded-lg border border-white/10 bg-[#111214] px-3 py-2.5 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-sky-300/35"
                />
              </label>
              <button type="submit" className="min-h-11 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/[0.1]">Traži</button>
            </form>
            <div className="flex flex-col gap-2 sm:flex-row">
              <form action={syncInventoryFromShopifyAction}>
                <button type="submit" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.09] px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-300/[0.14] sm:w-auto">
                  <RefreshIcon /> Osvježi sa Galago
                </button>
              </form>
              <Link href="/stats/today" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sky-300/20 bg-sky-300/[0.08] px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-300/[0.13]">
                <UploadIcon /> Uvezi cijene
              </Link>
            </div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {filters.map((filter) => {
              const href = `/inventory?status=${filter.value}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
              return (
                <Link key={filter.value} href={href} className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition ${status === filter.value ? "border-sky-300/30 bg-sky-300/10 text-sky-100" : "border-white/10 bg-white/[0.03] text-neutral-400 hover:text-white"}`}>
                  {filter.label}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Stanje robe</h2>
              <p className="mt-1 text-sm text-neutral-500">Prikazano {products.length} od {inventory.products.length} artikala</p>
            </div>
          </div>

          {products.length === 0 ? (
            <div className="mt-4 border-y border-dashed border-white/10 py-10 text-center text-sm text-neutral-500">Nema artikala za odabrani filter.</div>
          ) : (
            <>
              <div className="mt-4 space-y-2.5 lg:hidden">
                {products.map((product) => {
                  const itemStatus = stockStatus(product.quantity);
                  return (
                    <article key={product.id} className="rounded-[1.25rem] border border-white/10 bg-[#111214] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-white">{product.name}</p>
                          <p className="mt-1 text-xs text-neutral-500">{product.sku || "Bez šifre"}</p>
                        </div>
                        <p className="shrink-0 text-2xl font-semibold text-white">{formatQuantity(product.quantity)}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusClass(itemStatus)}`}>{statusLabel(itemStatus)}</span>
                        <span className="text-xs text-neutral-500">komada</span>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 hidden overflow-hidden rounded-lg border border-white/10 lg:block">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="bg-white/[0.045] text-xs text-neutral-500">
                    <tr>
                      <th className="w-[55%] px-4 py-3 font-medium">Artikal</th>
                      <th className="w-[20%] px-4 py-3 font-medium">Šifra</th>
                      <th className="w-[12%] px-4 py-3 text-right font-medium">Količina</th>
                      <th className="w-[13%] px-4 py-3 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.07] bg-[#111214]">
                    {products.map((product) => {
                      const itemStatus = stockStatus(product.quantity);
                      return (
                        <tr key={product.id} className="hover:bg-white/[0.025]">
                          <td className="px-4 py-3.5 font-medium text-white">{product.name}</td>
                          <td className="break-all px-4 py-3.5 text-neutral-400">{product.sku || "-"}</td>
                          <td className="px-4 py-3.5 text-right text-lg font-semibold text-white">{formatQuantity(product.quantity)}</td>
                          <td className="px-4 py-3.5 text-right"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusClass(itemStatus)}`}>{statusLabel(itemStatus)}</span></td>
                        </tr>
                      );
                    })}
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
