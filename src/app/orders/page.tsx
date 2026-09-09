import Link from "next/link";

import { OrderListPage } from "@/components/order-list-page";
import { getOrdersSheetRows } from "@/lib/google-sheets";
import { getLatestCompletedExportWindow } from "@/lib/order-workday";
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
  searchParams: Promise<{ refresh?: string }>;
}) {
  const params = await searchParams;
  const rows = await getOrdersSheetRows({ fresh: Boolean(params.refresh) }).catch(() => []);
  const latestDate = getLatestSheetDateLabel(rows);
  const orders = latestDate ? rows.filter((row) => row.dateLabel === latestDate) : [];
  const exportWindow = getLatestCompletedExportWindow();

  return (
    <OrderListPage
      title="Nove narudžbe"
      subtitle={latestDate ? `Zadnji radni dan iz Orders sheeta: ${latestDate}` : "Orders sheet nema narudžbi"}
      orders={orders}
      refreshPath="/orders"
      headerAction={
        latestDate && orders.length > 0 ? (
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
        ) : null
      }
    />
  );
}
