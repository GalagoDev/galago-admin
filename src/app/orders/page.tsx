import { OrderListPage } from "@/components/order-list-page";
import { getOrdersSheetRows } from "@/lib/google-sheets";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string }>;
}) {
  const params = await searchParams;
  const rows = await getOrdersSheetRows({ fresh: Boolean(params.refresh) }).catch(() => []);
  const latestDate = getLatestSheetDateLabel(rows);
  const orders = latestDate ? rows.filter((row) => row.dateLabel === latestDate) : [];

  return (
    <OrderListPage
      title="Nove narudžbe"
      subtitle={latestDate ? `Zadnji radni dan iz Orders sheeta: ${latestDate}` : "Orders sheet nema narudžbi"}
      orders={orders}
      refreshPath="/orders"
    />
  );
}
