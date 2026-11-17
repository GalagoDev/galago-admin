import { OrderListPage } from "@/components/order-list-page";
import { DeliveryReconciliation } from "@/components/delivery-reconciliation";
import { RefreshCw } from "lucide-react";
import { getOrdersSheetRows } from "@/lib/google-sheets";
import { courierTrackingSnapshot, getCourierSyncStatus } from "@/lib/courier-tracking-store";
import { deliveryOverview } from "@/lib/delivery-overview";
import { OrderListClient } from "@/components/order-list-client";
import { refreshCourierStatusesAction } from "@/app/actions/courier";
import { getSettlementScanStatus } from "@/lib/expressone-settlements";

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
  const overview = deliveryOverview(allOrders, courierTrackingSnapshot(allOrders).states);
  const orders = overview.included;
  const sync = getCourierSyncStatus();
  const settlements = getSettlementScanStatus();
  const date = (value: number) => new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", dateStyle: "short", timeStyle: "short" }).format(value);
  const courierErrors: Record<string, string> = {
    "invalid-tracking": "Broj paketa nije ispravan.", "parcel-count": "Unesite po jedan različit broj za svaki paket narudžbe.",
    "tracking-already-linked": "Taj broj paketa već pripada drugoj narudžbi.", "order-changed": "Narudžba je promijenjena. Osvježite podatke.",
    "link-failed": "Povezivanje nije uspjelo. Pokušajte ponovo.",
  };
  const notice = getNotice(params);

  return (
    <OrderListPage
      title="Na dostavi"
      subtitle="Aktivne pošiljke i nove narudžbe koje čekaju slanje"
      orders={orders}
      summaryLabels={{ count: "Narudžbe u procjeni", amount: "Procijenjena otkupnina" }}
      summaryUnavailable={unavailable}
      refreshPath="/in-transit"
      headerAction={<form action={refreshCourierStatusesAction}><button type="submit" title="Provjeri Express One statuse"
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-300/25 px-3 py-2 text-xs text-sky-100"><RefreshCw size={15} />Provjeri statuse</button></form>}
      allowReturns
      workflow={(
        <>
          <div className="mt-3 text-xs text-neutral-400">
            {sync?.running ? <p>Provjera Express One statusa je u toku.</p> : params.sync && sync?.next_run_at === 0 ? <p>Provjera je zakazana.</p> : null}
            <p className="mt-2">Email izvještaji razduženja: {settlements.scan?.last_success_at ? date(settlements.scan.last_success_at) : "Čeka se prva obrada"} · Dnevno u 15:00</p>
            {settlements.latestReportAt ? <p>Najnoviji obrađeni izvještaj: {date(settlements.latestReportAt)}</p> : null}
            {settlements.running ? <p>Obrada email izvještaja je u toku.</p> : null}
          </div>
          {settlements.scan?.last_error ? <p role="alert" className="mt-3 border-l-2 border-amber-300 pl-3 text-sm text-amber-200">{settlements.scan.last_error}</p> : null}
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
      afterList={overview.uncertain.length ? <details className="mt-5 border-y border-white/10 py-4">
        <summary className="cursor-pointer text-sm text-neutral-300">Stariji zapisi bez potvrde: {overview.uncertain.length} · {new Intl.NumberFormat("bs-BA", { maximumFractionDigits: 2 }).format(overview.uncertainAmount)} KM izvan procjene</summary>
        <div className="mt-4"><OrderListClient orders={overview.uncertain} allowReturns /></div>
      </details> : undefined}
    />
  );
}
