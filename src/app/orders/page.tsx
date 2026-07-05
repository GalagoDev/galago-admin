import { OrderListPage } from "@/components/order-list-page";
import { getOrdersSheetRows } from "@/lib/google-sheets";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function OrdersPage() {
  const rows = await getOrdersSheetRows().catch(() => []);
  const latestDate = getLatestSheetDateLabel(rows);
  const orders = latestDate ? rows.filter((row) => row.dateLabel === latestDate) : [];

  return (
    <OrderListPage
      title="Nove narudžbe"
      subtitle={latestDate ? `Zadnji radni dan iz Orders sheeta: ${latestDate}` : "Orders sheet nema narudžbi"}
      orders={orders}
    />
  );
}
