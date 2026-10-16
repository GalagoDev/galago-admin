import Link from "next/link";
import { Download } from "lucide-react";

import { OrderListPage } from "@/components/order-list-page";
import { getOrdersSheetRows, getReturnedSheetRows, isActiveOrderRow } from "@/lib/google-sheets";
import { assessOrderRisks, unresolvedOrderRisks } from "@/lib/order-risk";
import { getOperationalExportWindow, isOrderInOperationalExportWindow } from "@/lib/order-workday";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string; risk?: string; error?: string; count?: string; view?: string; exportError?: string }>;
}) {
  const params = await searchParams;
  const exportReview = params.view === "export";
  const [rows, returnedRows] = await Promise.all([
    getOrdersSheetRows({ fresh: Boolean(params.refresh) }).catch(() => []),
    getReturnedSheetRows({ fresh: Boolean(params.refresh) }).catch(() => []),
  ]);
  const latestDate = getLatestSheetDateLabel(rows);
  const exportWindow = getOperationalExportWindow();
  const orders = exportReview
    ? rows.filter(isActiveOrderRow).filter((row) => isOrderInOperationalExportWindow(row, exportWindow))
    : latestDate ? rows.filter((row) => row.dateLabel === latestDate) : [];
  const riskAssessments = assessOrderRisks(orders, rows, returnedRows);
  const pendingRows = new Set(unresolvedOrderRisks(riskAssessments).map((risk) => risk.sheetRowNumber));
  const pendingNames = orders.filter((order) => pendingRows.has(order.sheetRowNumber)).slice(0, 8).map((order) => order.primalac).join(", ");
  const notice = params.error
    ? { tone: "error", text: params.error === "invalid-risk-decision" ? "Nevažeći odabir narudžbe." : "Odluka nije sačuvana. Osvježite listu i pokušajte ponovo." }
    : params.risk === "approve-all"
      ? { tone: "success", text: `Potvrđeno za slanje: ${Math.max(0, Math.min(1000, Number(params.count) || 0))} narudžbi.` }
      : params.risk === "approve"
        ? { tone: "success", text: "Narudžba je provjerena i ostaje u exportu." }
        : params.risk === "duplicate"
          ? { tone: "success", text: "Dupla narudžba je sačuvana u historiji i isključena iz slanja." }
          : params.risk === "restore"
            ? { tone: "success", text: "Narudžba je vraćena među aktivne narudžbe." }
            : exportReview && params.exportError === "review"
              ? pendingRows.size > 0
                ? { tone: "error", text: `Excel čeka provjeru (${pendingRows.size}): ${pendingNames}.` }
                : { tone: "success", text: "Sve narudžbe za ovaj izvoz su provjerene. Excel je spreman za preuzimanje." }
              : null;

  return (
    <OrderListPage
      title={exportReview ? "Provjera Excel izvoza" : "Nove narudžbe"}
      subtitle={exportReview
        ? `${exportWindow.startLabel} 08:00 - ${exportWindow.endLabel} 08:00`
        : latestDate ? `Zadnji radni dan iz Orders sheeta: ${latestDate}` : "Orders sheet nema narudžbi"}
      orders={orders}
      riskAssessments={riskAssessments}
      riskView={exportReview ? "export" : undefined}
      refreshPath={exportReview ? "/orders?view=export" : "/orders"}
      workflow={
        <>
          {exportReview ? <Link href="/orders" className="mt-5 self-start text-sm text-sky-200 hover:underline">Nove narudžbe</Link> : null}
          {notice ? (
            <div role="status" className={`mt-5 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100"}`}>
              {notice.text}
            </div>
          ) : null}
        </>
      }
      headerAction={
        <a
          href="/orders/export"
          aria-label={`Preuzmi Excel: ${exportWindow.startLabel} 08:00 - ${exportWindow.endLabel} 08:00`}
          title={`Preuzmi Excel: ${exportWindow.startLabel} 08:00 - ${exportWindow.endLabel} 08:00`}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
        >
          <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Excel do 08:00</span>
        </a>
      }
    />
  );
}
