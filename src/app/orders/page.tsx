import Link from "next/link";

import { OrderListPage } from "@/components/order-list-page";
import { getOrdersSheetRows, getReturnedSheetRows } from "@/lib/google-sheets";
import { assessOrderRisks, unresolvedOrderRisks } from "@/lib/order-risk";
import { getOperationalExportWindow } from "@/lib/order-workday";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M12 3v11" strokeLinecap="round" />
      <path d="m8 10 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" strokeLinecap="round" />
    </svg>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string; risk?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [rows, returnedRows] = await Promise.all([
    getOrdersSheetRows({ fresh: Boolean(params.refresh) }).catch(() => []),
    getReturnedSheetRows({ fresh: Boolean(params.refresh) }).catch(() => []),
  ]);
  const latestDate = getLatestSheetDateLabel(rows);
  const orders = latestDate ? rows.filter((row) => row.dateLabel === latestDate) : [];
  const riskAssessments = assessOrderRisks(orders, rows, returnedRows);
  const unresolvedRisks = unresolvedOrderRisks(riskAssessments);
  const exportWindow = getOperationalExportWindow();
  const notice = params.error
    ? { tone: "error", text: params.error === "invalid-risk-decision" ? "Nevažeći odabir narudžbe." : "Odluka nije sačuvana. Osvježite listu i pokušajte ponovo." }
    : params.risk === "approve"
      ? { tone: "success", text: "Narudžba je provjerena i ostaje u exportu." }
      : params.risk === "duplicate"
        ? { tone: "success", text: "Dupla narudžba je sačuvana u historiji i isključena iz slanja." }
        : params.risk === "restore"
          ? { tone: "success", text: "Narudžba je vraćena među aktivne narudžbe." }
          : null;

  return (
    <OrderListPage
      title="Nove narudžbe"
      subtitle={latestDate ? `Zadnji radni dan iz Orders sheeta: ${latestDate}` : "Orders sheet nema narudžbi"}
      orders={orders}
      riskAssessments={riskAssessments}
      refreshPath="/orders"
      workflow={notice ? (
        <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100"}`}>
          {notice.text}
        </div>
      ) : null}
      headerAction={
        latestDate && orders.length > 0 ? (
          unresolvedRisks.length > 0 ? (
            <a
              href="#risk-alerts"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-300/20 bg-red-300/10 px-3 text-sm font-medium text-red-100 transition hover:bg-red-300/15"
            >
              <span>Provjeri {unresolvedRisks.length}</span>
            </a>
          ) : (
            <Link
              href="/orders/export"
              prefetch={false}
              aria-label={`Preuzmi Excel: ${exportWindow.startLabel} 08:00 - ${exportWindow.endLabel} 08:00`}
              title={`Preuzmi Excel: ${exportWindow.startLabel} 08:00 - ${exportWindow.endLabel} 08:00`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
            >
              <DownloadIcon />
              <span className="hidden sm:inline">Excel do 08:00</span>
            </Link>
          )
        ) : null
      }
    />
  );
}
