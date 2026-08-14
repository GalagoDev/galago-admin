import Link from "next/link";

import { OrderListClient } from "@/components/order-list-client";
import { getUndeliveredSheetRows } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function parseAmount(value: string) {
  const amount = Number(String(value ?? "").replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : 0;
}

function parseDateLabel(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const [, dd, mm, yyyy] = match;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`).getTime();
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function UndeliveredPage() {
  const orders = await getUndeliveredSheetRows().catch(() => []);

  const sortedOrders = [...orders].sort((a, b) => parseDateLabel(a.dateLabel) - parseDateLabel(b.dateLabel));
  const totalOrders = sortedOrders.length;
  const totalOtkupnina = sortedOrders.reduce((sum, order) => sum + parseAmount(order.otkupnina), 0);
  const oldestDate = sortedOrders[0]?.dateLabel || "-";

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Nedostavljene narudžbe</p>
              <p className="mt-2 text-lg font-semibold text-white">Prioritet za dostavu</p>
              <p className="mt-1 text-sm text-neutral-400">Najstarije po datumu slanja</p>
            </div>
            <Link
              href="/"
              aria-label="Nazad na pregled"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]"
            >
              <ArrowIcon />
            </Link>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <article className="rounded-[1.5rem] border border-sky-300/20 bg-[linear-gradient(135deg,rgba(56,189,248,0.22),rgba(56,189,248,0.08))] px-4 py-4 shadow-[0_20px_50px_rgba(56,189,248,0.08)] lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Ukupno redova</p>
            <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{totalOrders}</p>
            <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Aktivni undelivered</p>
          </article>

          <article className="rounded-[1.5rem] border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.22),rgba(16,185,129,0.08))] px-4 py-4 shadow-[0_20px_50px_rgba(16,185,129,0.08)] lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Na dostavi</p>
            <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{totalOtkupnina} KM</p>
            <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Ukupna otkupnina</p>
          </article>

          <article className="col-span-2 rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-4 lg:col-span-1 lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Najstariji datum</p>
            <p className="mt-3 text-xl font-semibold tracking-tight text-white">{oldestDate}</p>
          </article>
        </section>

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
          <div className="flex items-center justify-between gap-4 px-1 pb-3">
            <div>
              <p className="text-lg font-semibold text-white">Lista za dostavu</p>
              <p className="mt-1 text-sm text-neutral-500">Pretraga i pregled svih detalja dostave</p>
            </div>
          </div>

          <OrderListClient orders={sortedOrders} />
        </section>
      </div>
    </main>
  );
}
