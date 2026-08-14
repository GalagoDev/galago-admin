import { OrderListPage } from "@/components/order-list-page";
import { DeliveryReconciliation } from "@/components/delivery-reconciliation";
import { getUndeliveredSheetRows } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function getNotice(params: { delivered?: string; returned?: string; skipped?: string; error?: string }) {
  if (params.error === "no-delivery-selection") return { tone: "error", text: "Odaberite najmanje jednu dostavljenu narudžbu." };
  if (params.error === "invalid-order-selection") return { tone: "error", text: "Narudžba više nije važeća. Osvježite stranicu." };
  if (params.error === "delivery-update-failed") return { tone: "error", text: "Dostavljene narudžbe nisu sačuvane. Pokušajte ponovo." };
  if (params.error === "return-update-failed") return { tone: "error", text: "Povrat nije sačuvan. Pokušajte ponovo." };
  if (params.delivered) return { tone: "success", text: `${params.delivered} narudžbi označeno kao dostavljeno.${params.skipped && params.skipped !== "0" ? ` Preskočeno: ${params.skipped}.` : ""}` };
  if (params.returned) return { tone: "success", text: `${params.returned} narudžba premještena u Povrate.` };
  return null;
}

export default async function InTransitPage({
  searchParams,
}: {
  searchParams: Promise<{ delivered?: string; returned?: string; skipped?: string; error?: string }>;
}) {
  const params = await searchParams;
  const orders = await getUndeliveredSheetRows().catch(() => []);
  const notice = getNotice(params);

  return (
    <OrderListPage
      title="Na dostavi"
      subtitle="Aktivne pošiljke koje čekaju ishod dostave"
      orders={orders}
      allowReturns
      workflow={(
        <>
          {notice ? (
            <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100"}`}>
              {notice.text}
            </div>
          ) : null}
          <DeliveryReconciliation />
        </>
      )}
    />
  );
}
