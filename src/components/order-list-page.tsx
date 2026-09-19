import Link from "next/link";
import type { ReactNode } from "react";

import { OrderListClient } from "@/components/order-list-client";
import { parseOrderAmount, roundOrderAmount } from "@/lib/order-amount";
import type { OrderRiskAssessment } from "@/lib/order-risk";
import { SheetRefreshButton } from "@/components/sheet-refresh-button";
import type { SheetOrderRow } from "@/lib/google-sheets";

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
  workflow,
  allowReturns = false,
  allowRestoreToTransit = false,
  listTitle = "Lista narudžbi",
  listSubtitle = "Pretraga i pregled svih detalja narudžbe",
  searchPlaceholder,
  refreshPath,
  headerAction,
  riskAssessments,
}: {
  title: string;
  subtitle: string;
  orders: SheetOrderRow[];
  workflow?: ReactNode;
  allowReturns?: boolean;
  allowRestoreToTransit?: boolean;
  listTitle?: string;
  listSubtitle?: string;
  searchPlaceholder?: string;
  refreshPath?: string;
  headerAction?: ReactNode;
  riskAssessments?: Record<number, OrderRiskAssessment>;
}) {
  const activeOrders = orders.filter((order) => !order.appStatus.startsWith("duplicate:"));
  const totalAmount = roundOrderAmount(
    activeOrders.reduce((sum, order) => sum + parseOrderAmount(order.otkupnina), 0),
  );

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <p className="mt-2 text-lg font-semibold text-white">{title}</p>
              <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAction}
              {refreshPath ? <SheetRefreshButton path={refreshPath} /> : null}
              <Link
                href="/"
                aria-label="Nazad na pregled"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]"
              >
                <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:max-w-2xl">
          <article className="rounded-[1.5rem] border border-sky-300/20 bg-[linear-gradient(135deg,rgba(56,189,248,0.22),rgba(56,189,248,0.08))] px-4 py-4 shadow-[0_20px_50px_rgba(56,189,248,0.08)] lg:rounded-lg">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Ukupno narudžbi</p>
            <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{activeOrders.length}</p>
          </article>
          <article className="rounded-[1.5rem] border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.22),rgba(16,185,129,0.08))] px-4 py-4 shadow-[0_20px_50px_rgba(16,185,129,0.08)] lg:rounded-lg">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Ukupno KM</p>
            <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{totalAmount} KM</p>
          </article>
        </section>

        {workflow}

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
          <div className="flex items-center justify-between gap-4 px-1 pb-3">
            <div>
              <p className="text-lg font-semibold text-white">{listTitle}</p>
              <p className="mt-1 text-sm text-neutral-500">{listSubtitle}</p>
            </div>
          </div>

          <OrderListClient
            orders={orders}
            allowReturns={allowReturns}
            allowRestoreToTransit={allowRestoreToTransit}
            searchPlaceholder={searchPlaceholder}
            riskAssessments={riskAssessments}
          />
        </section>
      </div>
    </main>
  );
}
