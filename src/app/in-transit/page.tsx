import { OrderListPage } from "@/components/order-list-page";
import { DeliveryReconciliation } from "@/components/delivery-reconciliation";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { getOrdersSheetRows, isActiveOrderRow } from "@/lib/google-sheets";
import { courierTrackingSnapshot, getCourierSyncStatus } from "@/lib/courier-tracking-store";
import { refreshCourierStatusesAction } from "@/app/actions/courier";
import type { CourierCategory } from "@/lib/courier-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function getNotice(params: { delivered?: string; returned?: string; skipped?: string; error?: string; refresh?: string }) {
  if (params.error === "no-delivery-selection") return { tone: "error", text: "Odaberite najmanje jednu dostavljenu narudžbu." };
  if (params.error === "invalid-order-selection") return { tone: "error", text: "Narudžba više nije važeća. Osvježite stranicu." };
  if (params.error === "delivery-update-failed") return { tone: "error", text: "Dostavljene narudžbe nisu sačuvane. Pokušajte ponovo." };
  if (params.error === "return-update-failed") return { tone: "error", text: "Povrat nije sačuvan. Pokušajte ponovo." };
  if (params.delivered) return { tone: "success", text: `${params.delivered} narudžbi označeno kao dostavljeno.${params.skipped && params.skipped !== "0" ? ` Preskočeno: ${params.skipped}.` : ""}` };
  if (params.returned) return { tone: "success", text: `${params.returned} narudžba premještena u Povrate.` };
  return null;
}

export default async function InTransitPage({
  searchParams,
}: {
  searchParams: Promise<{ delivered?: string; returned?: string; skipped?: string; error?: string; refresh?: string; view?: string; sync?: string; courierError?: string }>;
}) {
  const params = await searchParams;
  // The background courier worker can update Sheets outside this page's cache instance.
  const [source] = await Promise.allSettled([getOrdersSheetRows({ fresh: true })]);
  const unavailable = source.status === "rejected";
  const allOrders = source.status === "fulfilled" ? source.value : [];
  const { states, links } = courierTrackingSnapshot(allOrders);
  const views: { key: CourierCategory; label: string }[] = [
    { key: "active", label: "Na dostavi" }, { key: "registered", label: "Najavljene" }, { key: "partial", label: "Djelimične" },
    { key: "review", label: "Za provjeru" }, { key: "delivered", label: "Dostavljene" }, { key: "returned", label: "Vraćene" },
  ];
  const selected = views.find(v => v.key === params.view) || views[0];
  const grouped = Object.fromEntries(views.map(v => [v.key, allOrders.filter(order => {
    const state = states[order.sheetRowNumber];
    if (isActiveOrderRow(order)) return state.category === v.key;
    if (!links.has(state.key)) return false;
    return v.key === "delivered" ? order.appStatus.startsWith("delivered:") : v.key === "returned" && order.appStatus.startsWith("returned:");
  })])) as Record<CourierCategory, typeof allOrders>;
  const orders = grouped[selected.key];
  const sync = getCourierSyncStatus();
  const date = (value: number) => new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", dateStyle: "short", timeStyle: "short" }).format(value);
  const parcelCount = selected.key === "review" ? orders.reduce((sum, o) => sum + states[o.sheetRowNumber].expectedPackages, 0)
    : orders.reduce((sum, o) => sum + states[o.sheetRowNumber].parcels.filter(p => selected.key === "partial" || p.category === selected.key).length, 0);
  const courierErrors: Record<string, string> = {
    "invalid-tracking": "Broj paketa nije ispravan.", "parcel-count": "Unesite po jedan različit broj za svaki paket narudžbe.",
    "tracking-already-linked": "Taj broj paketa već pripada drugoj narudžbi.", "order-changed": "Narudžba je promijenjena. Osvježite podatke.",
    "link-failed": "Povezivanje nije uspjelo. Pokušajte ponovo.",
  };
  const notice = getNotice(params);

  return (
    <OrderListPage
      title={selected.label}
      subtitle={selected.key === "active" ? "Potvrđeni Express One statusi dostave, transporta i skladišta" : "Express One pregled po statusu pošiljke"}
      orders={orders}
      courierStates={states}
      summaryUnavailable={unavailable}
      summaryExtra={<article className="col-span-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 lg:col-span-1">
        <p className="text-[12px] text-neutral-200">{selected.key === "active" ? "Paketa u postupku" : selected.key === "review" ? "Evidentiranih paketa" : "Paketa"}</p>
        <p className="mt-4 text-[30px] font-semibold leading-none">{unavailable ? "-" : parcelCount}</p>
      </article>}
      refreshPath="/in-transit"
      headerAction={<form action={refreshCourierStatusesAction}><button type="submit" title="Provjeri Express One statuse"
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-300/25 px-3 py-2 text-xs text-sky-100"><RefreshCw size={15} />Provjeri statuse</button></form>}
      allowReturns={!["delivered", "returned"].includes(selected.key)}
      workflow={(
        <>
          <nav aria-label="Statusi pošiljki" className="mt-5 flex flex-wrap gap-1 border-b border-white/10 pb-2">
            {views.map(view => <Link key={view.key} href={`/in-transit?view=${view.key}`} aria-current={selected.key === view.key ? "page" : undefined}
              className={`border-b-2 px-3 py-2 text-sm ${selected.key === view.key ? "border-sky-300 text-sky-100" : "border-transparent text-neutral-400 hover:text-white"}`}>
              {view.label} <span className="ml-1 text-xs text-neutral-500">{unavailable ? "-" : grouped[view.key].length}</span>
            </Link>)}
          </nav>
          <div className="mt-3 text-xs text-neutral-400">
            {sync?.running ? <p>Provjera Express One statusa je u toku.</p> : params.sync && sync?.next_run_at === 0 ? <p>Provjera je zakazana.</p> : null}
            <p>{sync?.last_success_at ? `Zadnja provjera: ${date(sync.last_success_at)}` : "Još nema završene provjere"} · Dnevno u 07:15</p>
            {sync?.next_run_at ? <p className="mt-1">Sljedeća provjera: {date(sync.next_run_at)}</p> : null}
          </div>
          {unavailable || sync?.last_error || params.courierError ? <p role="alert" className="mt-3 border-l-2 border-amber-300 pl-3 text-sm text-amber-200">
            {unavailable ? "Orders podaci trenutno nisu dostupni. Ukupni iznosi nisu potvrđeni." : params.courierError ? courierErrors[params.courierError] || courierErrors["link-failed"] : sync?.last_error}
          </p> : null}
          {notice ? (
            <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100"}`}>
              {notice.text}
            </div>
          ) : null}
          <details className="mt-4 border-y border-white/10 py-3"><summary className="cursor-pointer text-sm text-neutral-300">Uvezi izvještaj dostavljenih pošiljki</summary><DeliveryReconciliation /></details>
        </>
      )}
    />
  );
}
