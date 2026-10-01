import Link from "next/link";

import { DailyStatisticsAccessCard } from "@/components/daily-statistics-access-card";
import { statisticsDateKeyFromLabel } from "@/lib/daily-statistics";
import { getOrdersSheetRows } from "@/lib/google-sheets";
import {
  calculatePeriodStatistics,
  getStatisticsMonthName,
  getStatisticsYears,
  parseStatisticsDateLabel,
} from "@/lib/period-statistics";
import { getWorkdayCycle } from "@/lib/order-workday";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("bs-BA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function requestedNumber(value: string | undefined) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const query = await searchParams;
  const rows = await getOrdersSheetRows().catch(() => []);
  const latestDate = getLatestSheetDateLabel(rows);
  const latestDateParts = parseStatisticsDateLabel(latestDate);
  const latestDateKey = statisticsDateKeyFromLabel(latestDate);
  const latestCycle = latestDateKey ? getWorkdayCycle(latestDateKey) : null;
  const years = getStatisticsYears(rows);
  const fallbackYear = latestDateParts?.year || years[0] || new Date().getFullYear();
  const requestedYear = requestedNumber(query.year);
  const selectedYear = requestedYear && years.includes(requestedYear) ? requestedYear : fallbackYear;
  const statistics = calculatePeriodStatistics(rows, selectedYear);
  const monthsWithOrders = statistics.months.filter((month) => month.sourceOrderCount > 0);
  const fallbackMonth = selectedYear === latestDateParts?.year
    ? latestDateParts.month
    : monthsWithOrders.at(-1)?.month || 1;
  const requestedMonth = requestedNumber(query.month);
  const selectedMonth = requestedMonth && requestedMonth >= 1 && requestedMonth <= 12
    ? requestedMonth
    : fallbackMonth;
  const selectedMonthStats = statistics.months[selectedMonth - 1];
  const selectedMonthDays = statistics.days.filter((day) => day.month === selectedMonth);
  const todayRows = latestDate ? rows.filter((row) => row.dateLabel === latestDate) : [];
  const availableYears = years.length > 0 ? years : [selectedYear];

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <p className="mt-2 text-lg font-semibold text-white">Statistika</p>
              <p className="mt-1 text-sm text-neutral-400">Godišnji i mjesečni pregled prodaje</p>
            </div>
            <Link
              href="/"
              aria-label="Nazad na pregled"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]"
            >
              <ArrowIcon />
            </Link>
          </div>

          <form method="get" className="mt-5 flex max-w-xs items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-neutral-500">
              Godina
              <select
                name="year"
                defaultValue={selectedYear}
                className="mt-1 h-11 w-full rounded-lg border border-white/10 bg-[#0b0c0e] px-3 text-sm text-white outline-none focus:border-sky-300/50"
              >
                {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <button
              type="submit"
              className="h-11 rounded-lg border border-sky-300/25 bg-sky-300/10 px-4 text-sm font-medium text-sky-100 transition hover:bg-sky-300/15"
            >
              Prikaži
            </button>
          </form>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DailyStatisticsAccessCard
            count={todayRows.length}
            dateLabel={latestCycle
              ? `${latestCycle.startLabel.slice(0, 5)} 08:00 - ${latestCycle.endLabel.slice(0, 5)} 08:00`
              : latestDate}
          />

          <article className="rounded-[1.5rem] border border-sky-300/20 bg-sky-300/10 px-4 py-4 lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Narudžbe {selectedYear}</p>
            <p className="mt-4 text-[30px] font-semibold leading-none text-white">{statistics.orderCount}</p>
            {statistics.excludedOrderCount > 0 ? (
              <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                {statistics.excludedOrderCount} izuzeto
              </p>
            ) : null}
          </article>

          <article className="rounded-[1.5rem] border border-emerald-300/20 bg-emerald-300/10 px-4 py-4 lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Prihod {selectedYear}</p>
            <p className="mt-3 break-words text-[22px] font-semibold leading-tight text-white lg:text-[26px]">{formatMoney(statistics.revenue)} KM</p>
          </article>

          <article className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-4 lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Prosjek narudžbe</p>
            <p className="mt-3 break-words text-[22px] font-semibold leading-tight text-white lg:text-[26px]">{formatMoney(statistics.averageOrderValue)} KM</p>
          </article>
        </section>

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
          <div className="px-1 pb-3">
            <p className="text-lg font-semibold text-white">Mjeseci {selectedYear}</p>
            <p className="mt-1 text-sm text-neutral-500">Klikni mjesec za dnevni pregled</p>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {statistics.months.map((month) => {
              const active = month.month === selectedMonth;
              return (
                <Link
                  key={month.month}
                  href={`/stats?year=${selectedYear}&month=${String(month.month).padStart(2, "0")}`}
                  className={`grid min-h-16 grid-cols-[minmax(0,1fr)_48px_100px] items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                    active
                      ? "border-sky-300/45 bg-sky-300/10"
                      : "border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{month.name}</p>
                    {month.excludedOrderCount > 0 ? (
                      <p className="mt-1 text-[10px] text-neutral-500">{month.excludedOrderCount} izuzeto</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">{month.orderCount}</p>
                    <p className="text-[10px] text-neutral-500">nar.</p>
                  </div>
                  <p className="text-right text-sm font-medium text-emerald-200">{formatMoney(month.revenue)} KM</p>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
          <div className="flex items-end justify-between gap-4 px-1 pb-3">
            <div>
              <p className="text-lg font-semibold text-white">{getStatisticsMonthName(selectedMonth)} {selectedYear}</p>
              <p className="mt-1 text-sm text-neutral-500">Dnevni blokovi iz Orders sheeta</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-white">{selectedMonthStats.orderCount} narudžbi</p>
              <p className="mt-1 text-xs text-emerald-200">{formatMoney(selectedMonthStats.revenue)} KM</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {selectedMonthDays.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-neutral-500">
                Nema narudžbi za ovaj mjesec.
              </div>
            ) : (
              selectedMonthDays.map((day) => (
                <article
                  key={day.dateLabel}
                  className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-white/8 bg-black/20 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{day.dateLabel}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      {day.orderCount} narudžbi
                      {day.excludedOrderCount > 0 ? ` · ${day.excludedOrderCount} izuzeto` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-emerald-200">{formatMoney(day.revenue)} KM</span>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
