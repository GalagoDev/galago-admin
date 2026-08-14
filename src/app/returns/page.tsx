import { OrderListPage } from "@/components/order-list-page";
import { getReturnedSheetRows } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function ReturnsPage() {
  const orders = await getReturnedSheetRows().catch(() => []);
  return <OrderListPage title="Povrati" subtitle="Vraćene pošiljke izdvojene iz Na dostavi" orders={orders} />;
}
