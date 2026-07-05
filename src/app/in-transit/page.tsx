import { OrderListPage } from "@/components/order-list-page";
import { getUndeliveredSheetRows } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function InTransitPage() {
  const orders = await getUndeliveredSheetRows().catch(() => []);

  return <OrderListPage title="Na dostavi" subtitle="Sve aktivne undelivered narudžbe" orders={orders} />;
}
