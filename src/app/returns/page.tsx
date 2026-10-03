import { OrderListPage } from "@/components/order-list-page";
import { ReturnOrderPicker } from "@/components/return-order-picker";
import { getOrdersSheetRows, getReturnedSheetRows, isActiveOrderRow } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function getNotice(params: { returned?: string; restored?: string; skipped?: string; error?: string; refresh?: string }) {
  if (params.error === "invalid-order-selection") return { tone: "error", text: "Narudžba više nije važeća. Osvježite stranicu." };
  if (params.error === "invalid-return-selection") return { tone: "error", text: "Povrat više nije važeći. Osvježite stranicu." };
  if (params.error === "return-update-failed") return { tone: "error", text: "Povrat nije sačuvan. Pokušajte ponovo." };
  if (params.error === "restore-update-failed") return { tone: "error", text: "Narudžba nije vraćena na dostavu. Pokušajte ponovo." };
  if (params.restored === "0") return { tone: "error", text: "Narudžba nije vraćena. Osvježite stranicu i pokušajte ponovo." };
  if (params.restored) return {
    tone: "success",
    text: `${params.restored} narudžba vraćena u Na dostavi.${params.skipped && params.skipped !== "0" ? ` Preskočeno: ${params.skipped}.` : ""}`,
  };
  if (params.returned === "0") return { tone: "error", text: "Narudžba nije premještena. Osvježite stranicu i pokušajte ponovo." };
  if (params.returned) return {
    tone: "success",
    text: `${params.returned} narudžba premještena u Povrate.${params.skipped && params.skipped !== "0" ? ` Preskočeno: ${params.skipped}.` : ""}`,
  };
  return null;
}

function packageCount(value: string) {
  const count = Number(value.trim().replace(",", "."));
  return Number.isInteger(count) && count > 0 ? count : 1;
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ returned?: string; restored?: string; skipped?: string; error?: string; refresh?: string }>;
}) {
  const params = await searchParams;
  const fresh = Boolean(params.returned || params.restored || params.refresh);
  const [returnsResult, ordersResult] = await Promise.allSettled([
    getReturnedSheetRows({ fresh }),
    getOrdersSheetRows({ fresh }),
  ]);
  const orders = returnsResult.status === "fulfilled" ? returnsResult.value : [];
  const allOrders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
  const totalsAvailable = returnsResult.status === "fulfilled" && ordersResult.status === "fulfilled";
  const activeOrders = allOrders.filter(isActiveOrderRow);
  const recordedPackages = allOrders
    .filter((order) => !order.appStatus.startsWith("duplicate:"))
    .reduce((sum, order) => sum + packageCount(order.brojPaketa), 0);
  const returnedPackages = orders
    .filter((order) => !order.appStatus.startsWith("duplicate:"))
    .reduce((sum, order) => sum + packageCount(order.brojPaketa), 0);
  const returnRate = totalsAvailable && recordedPackages > 0
    ? (returnedPackages / recordedPackages) * 100
    : null;
  const notice = getNotice(params);

  return (
    <OrderListPage
      title="Povrati"
      subtitle="Vraćene pošiljke izdvojene iz Na dostavi"
      orders={orders}
      refreshPath="/returns"
      allowRestoreToTransit
      summaryExtra={(
        <article className="col-span-2 rounded-[1.5rem] border border-rose-300/20 bg-rose-300/10 px-4 py-4 lg:col-span-1 lg:rounded-lg">
          <p className="text-[12px] font-medium leading-4 text-neutral-200">Stopa povrata</p>
          <p className="mt-4 text-[30px] font-semibold leading-none text-white">
            {returnRate === null
              ? "—"
              : `${new Intl.NumberFormat("bs-BA", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(returnRate)}%`}
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            {totalsAvailable
              ? `${returnedPackages} od ${recordedPackages} evidentiranih paketa`
              : "Podaci iz Sheets trenutno nisu dostupni"}
          </p>
          {totalsAvailable ? <p className="mt-1 text-[11px] text-neutral-500">Uključuje i narudžbe na dostavi</p> : null}
        </article>
      )}
      listTitle="Evidentirani povrati"
      listSubtitle="Pošiljke koje su već premještene u Povrate"
      searchPlaceholder="Traži među evidentiranim povratima..."
      workflow={(
        <>
          {notice ? (
            <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100"}`}>
              {notice.text}
            </div>
          ) : null}
          <ReturnOrderPicker orders={activeOrders} />
        </>
      )}
    />
  );
}
