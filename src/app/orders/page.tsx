import Link from "next/link";
import { Download } from "lucide-react";

import { OrderListPage } from "@/components/order-list-page";
import { getOrdersSheetRows, getReturnedSheetRows } from "@/lib/google-sheets";
import { assessOrderRisks } from "@/lib/order-risk";
import { getOperationalExportWindow } from "@/lib/order-workday";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string; risk?: string; error?: string; count?: string }>;
}) {
  const params = await searchParams;
  const [rows, returnedRows] = await Promise.all([
    getOrdersSheetRows({ fresh: Boolean(params.refresh) }).catch(() => []),
    getReturnedSheetRows({ fresh: Boolean(params.refresh) }).catch(() => []),
  ]);
  const latestDate = getLatestSheetDateLabel(rows);
  const orders = latestDate ? rows.filter((row) => row.dateLabel === latestDate) : [];
  const riskAssessments = assessOrderRisks(orders, rows, returnedRows);
  const exportWindow = getOperationalExportWindow();
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
        <Link
          href="/orders/export"
          prefetch={false}
          aria-label={`Preuzmi Excel: ${exportWindow.startLabel} 08:00 - ${exportWindow.endLabel} 08:00`}
          title={`Preuzmi Excel: ${exportWindow.startLabel} 08:00 - ${exportWindow.endLabel} 08:00`}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60"
        >
          <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Excel do 08:00</span>
        </Link>
      }
    />
  );
}
