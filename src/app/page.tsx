import Link from "next/link";

import { logoutAction } from "@/app/actions/auth";
import { getActiveOrdersSheetRows, getOrdersSheetRows, getReturnedSheetRows } from "@/lib/google-sheets";
import { getInventoryOverview } from "@/lib/inventory";
import { parseOrderAmount } from "@/lib/order-amount";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function getBannerMessage(params: {
  error?: string;
  success?: string;
}) {
  if (params.error === "missing-order-text") return "Order text is required.";
  if (params.error === "missing-confirmed-fields") return "Fill at least the main order fields before saving.";
  if (params.success === "order-saved") return "Narudžba sačuvana u Orders sheet.";
  return null;
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

function SparklineChart({ counts }: { counts: number[] }) {
  const safeCounts = counts.length > 0 ? counts : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...safeCounts, 1);
  const step = safeCounts.length > 1 ? 280 / (safeCounts.length - 1) : 280;
  const points = safeCounts.map((count, index) => {
    const x = 20 + index * step;
    const y = 128 - (count / max) * 96;
    return `${x} ${y}`;
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point}`).join(" ");
  const areaPath = `${linePath} L300 140 L20 140 Z`;
  const lastPoint = points[points.length - 1]?.split(" ") || ["300", "128"];

  return (
    <svg viewBox="0 0 320 160" className="h-full w-full" fill="none">
      <defs>
        <linearGradient id="ordersArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(56 189 248)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="ordersLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgb(125 211 252)" />
          <stop offset="100%" stopColor="rgb(196 181 253)" />
        </linearGradient>
      </defs>
      <path d="M20 128H300" stroke="rgba(255,255,255,0.08)" strokeDasharray="4 6" />
      <path d="M20 92H300" stroke="rgba(255,255,255,0.06)" strokeDasharray="4 6" />
      <path d="M20 56H300" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 6" />
      <path d={areaPath} fill="url(#ordersArea)" />
      <path d={linePath} stroke="url(#ordersLine)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="5" fill="rgb(196 181 253)" />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="10" fill="rgb(196 181 253)" fillOpacity="0.18" />
    </svg>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const inventory = getInventoryOverview();
  const [activeRows, ordersRows, returnedRows] = await Promise.all([
    getActiveOrdersSheetRows().catch(() => []),
    getOrdersSheetRows().catch(() => []),
    getReturnedSheetRows().catch(() => []),
  ]);

  const totalUndelivered = activeRows.length;
  const totalUndeliveredKm = activeRows.reduce((sum, row) => sum + parseOrderAmount(row.otkupnina), 0);
  const totalReturnedKm = returnedRows.reduce((sum, row) => sum + parseOrderAmount(row.otkupnina), 0);
  const oldestUndelivered = [...activeRows]
    .sort((a, b) => parseDateLabel(a.dateLabel) - parseDateLabel(b.dateLabel))
    .slice(0, 5);

  const currentMonthKey = new Intl.DateTimeFormat("en-GB", {
    month: "2-digit",
    year: "numeric",
  }).format(new Date());

  const currentMonthOrders = ordersRows.filter((row) => row.dateLabel.slice(3) === currentMonthKey);
  const currentMonthByDate = new Map<string, number>();
  for (const row of currentMonthOrders) {
    currentMonthByDate.set(row.dateLabel, (currentMonthByDate.get(row.dateLabel) || 0) + 1);
  }

  const monthlyChartPoints = Array.from(currentMonthByDate.entries())
    .sort((a, b) => parseDateLabel(a[0]) - parseDateLabel(b[0]))
    .slice(-7)
    .map(([date, count]) => ({ date, count }));

  const latestOrdersDate = getLatestSheetDateLabel(ordersRows);
  const latestOrders = latestOrdersDate ? ordersRows.filter((row) => row.dateLabel === latestOrdersDate) : [];
  const chartCounts = monthlyChartPoints.map((point) => point.count);
  const chartLabels = monthlyChartPoints.map((point) => point.date.slice(0, 5));
  const monthlyTotalOrders = currentMonthOrders.length;
  const totalInventoryQuantity = inventory.products.reduce((sum, product) => sum + product.quantity, 0);

  const banner = getBannerMessage(params);

  const cards = [
    {
      title: "Nove narudžbe",
      value: String(latestOrders.length),
      meta: latestOrdersDate || "-",
      href: "/orders",
      tone: "bg-[linear-gradient(135deg,rgba(250,204,21,0.28),rgba(250,204,21,0.1))] border-yellow-300/20",
      glow: "shadow-[0_20px_50px_rgba(250,204,21,0.08)]",
    },
    {
      title: "Na dostavi",
      value: String(totalUndelivered),
      meta: `${totalUndeliveredKm} KM aktivno`,
      href: "/in-transit",
      tone: "bg-[linear-gradient(135deg,rgba(16,185,129,0.22),rgba(16,185,129,0.08))] border-emerald-300/20",
      glow: "shadow-[0_20px_50px_rgba(16,185,129,0.08)]",
    },
    {
      title: "Povrati",
      value: String(returnedRows.length),
      meta: `${totalReturnedKm} KM ukupno`,
      href: "/returns",
      tone: "bg-[linear-gradient(135deg,rgba(192,132,252,0.22),rgba(192,132,252,0.08))] border-fuchsia-300/20",
      glow: "shadow-[0_20px_50px_rgba(192,132,252,0.08)]",
    },
    {
      title: "Lager",
      value: String(inventory.products.length),
      meta: `${new Intl.NumberFormat("bs-BA", { maximumFractionDigits: 3 }).format(totalInventoryQuantity)} komada`,
      href: "/inventory",
      tone: "bg-[linear-gradient(135deg,rgba(56,189,248,0.22),rgba(56,189,248,0.07))] border-sky-300/20",
      glow: "shadow-[0_20px_50px_rgba(56,189,248,0.08)]",
    },
  ];

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/8 px-3 py-1.5 text-[11px] text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.85)]" />
                <span>Live and listening</span>
              </div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-neutral-200 transition hover:bg-white/10"
              >
                Logout
              </button>
            </form>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className={`rounded-[1.5rem] border px-4 py-4 transition active:scale-[0.98] hover:brightness-110 lg:rounded-lg lg:px-5 lg:py-5 ${card.tone} ${card.glow}`}
            >
              <p className="text-[12px] font-medium leading-4 text-neutral-200">{card.title}</p>
              <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{card.value}</p>
              <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">{card.meta}</p>
            </Link>
          ))}
        </section>

        {banner ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-neutral-300">
            {banner}
          </div>
        ) : null}

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <section className="rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
            <div className="flex items-center justify-between gap-4 px-1 pb-3">
              <div>
                <p className="text-lg font-semibold text-white">Na dostavi</p>
                <p className="mt-1 text-sm text-neutral-500">Najstarije aktivne pošiljke</p>
              </div>
              <Link
                href="/in-transit"
                aria-label="Otvori pošiljke na dostavi"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]"
              >
                <ArrowIcon />
              </Link>
            </div>

            <div className="flex flex-col gap-2.5">
              {oldestUndelivered.length === 0 ? (
                <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-neutral-500">
                  Nema aktivnih pošiljki na dostavi.
                </div>
              ) : (
                oldestUndelivered.map((row) => (
                  <div
                    key={`${row.dateLabel}-${row.rowNumber}`}
                    className="flex items-center justify-between gap-4 rounded-[1.2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-white">{row.artikal || "Bez artikla"}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-neutral-500">{row.dateLabel || "-"}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-sky-300/10 bg-sky-300/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-sky-200">
                      Prioritet
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
            <div className="flex items-center justify-between gap-4 px-1 pb-3">
              <div>
                <p className="text-lg font-semibold text-white">Rast narudžbi</p>
                <p className="mt-1 text-sm text-neutral-500">Sve narudžbe iz Orders sheeta za trenutni mjesec</p>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-semibold tracking-tight text-white">{monthlyTotalOrders}</p>
                  <p className="mt-1 text-sm text-neutral-400">Narudžbe ovaj mjesec</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-white">{chartCounts[chartCounts.length - 1] || 0}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-neutral-500">Zadnji dan na chartu</p>
                </div>
              </div>

              <div className="h-36 w-full overflow-hidden rounded-[1.25rem] border border-white/6 bg-black/20 px-2 py-2">
                <SparklineChart counts={chartCounts} />
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                {(chartLabels.length > 0 ? chartLabels : ["--", "--", "--", "--"]).slice(0, 4).map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
            </div>
          </section>
        </div>

      </div>
    </main>
  );
}
