import { OrderListPage } from "@/components/order-list-page";
import { getOrdersSheetRows } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function todayLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

export default async function OrdersPage() {
  const rows = await getOrdersSheetRows().catch(() => []);
  const today = todayLabel();
  const orders = rows.filter((row) => row.dateLabel === today);

  return <OrderListPage title="Nove narudžbe" subtitle="Današnje narudžbe iz Orders sheeta" orders={orders} />;
}
