import Link from "next/link";

import { OrderListClient } from "@/components/order-list-client";
import type { SheetOrderRow } from "@/lib/google-sheets";

function parseAmount(value: string) {
  const amount = Number(String(value ?? "").replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : 0;
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OrderListPage({
  title,
  subtitle,
  orders,
}: {
  title: string;
  subtitle: string;
  orders: SheetOrderRow[];
}) {
  const totalAmount = orders.reduce((sum, order) => sum + parseAmount(order.otkupnina), 0);

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <p className="mt-2 text-lg font-semibold text-white">{title}</p>
              <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>
            </div>
            <Link
              href="/"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]"
            >
              <ArrowIcon />
            </Link>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3">
          <article className="rounded-[1.5rem] border border-sky-300/20 bg-[linear-gradient(135deg,rgba(56,189,248,0.22),rgba(56,189,248,0.08))] px-4 py-4 shadow-[0_20px_50px_rgba(56,189,248,0.08)]">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Ukupno narudžbi</p>
            <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{orders.length}</p>
          </article>
          <article className="rounded-[1.5rem] border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.22),rgba(16,185,129,0.08))] px-4 py-4 shadow-[0_20px_50px_rgba(16,185,129,0.08)]">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Ukupno KM</p>
            <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{totalAmount} KM</p>
          </article>
        </section>

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
          <div className="flex items-center justify-between gap-4 px-1 pb-3">
            <div>
              <p className="text-lg font-semibold text-white">Lista narudžbi</p>
              <p className="mt-1 text-sm text-neutral-500">Velika lista · mobilni prikaz</p>
            </div>
          </div>

          <OrderListClient orders={orders} />
        </section>
      </div>
    </main>
  );
}
