import { OrderListPage } from "@/components/order-list-page";

export default async function ReturnsPage() {
  return <OrderListPage title="Povrati" subtitle="Povrati će biti povezani kasnije" orders={[]} />;
}
