import Link from "next/link";

import { getOrdersSheetRows } from "@/lib/google-sheets";
import { parseOrderAmount } from "@/lib/order-amount";
import { getLatestSheetDateLabel } from "@/lib/sheet-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function parseDateLabel(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return 0;
  const [, dd, mm, yyyy] = match;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`).getTime();
}

function currentMonthKey() {
  return new Intl.DateTimeFormat("en-GB", {
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function StatsPage() {
  const rows = await getOrdersSheetRows().catch(() => []);
  const latestDate = getLatestSheetDateLabel(rows);
  const month = currentMonthKey();

  const todayRows = latestDate ? rows.filter((row) => row.dateLabel === latestDate) : [];
  const monthRows = rows.filter((row) => row.dateLabel.slice(3) === month);
  const monthTotal = monthRows.reduce((sum, row) => sum + parseOrderAmount(row.otkupnina), 0);

  const byDate = new Map<string, { count: number; amount: number }>();
  for (const row of monthRows) {
    const current = byDate.get(row.dateLabel) || { count: 0, amount: 0 };
    current.count += 1;
    current.amount += parseOrderAmount(row.otkupnina);
    byDate.set(row.dateLabel, current);
  }

  const recentDays = Array.from(byDate.entries())
    .sort((a, b) => parseDateLabel(b[0]) - parseDateLabel(a[0]))
    .slice(0, 7);

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <p className="mt-2 text-lg font-semibold text-white">Statistika</p>
              <p className="mt-1 text-sm text-neutral-400">Orders sheet pregled</p>
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
          <Link href="/stats/today" className="rounded-[1.5rem] border border-yellow-300/20 bg-[linear-gradient(135deg,rgba(250,204,21,0.24),rgba(250,204,21,0.08))] px-4 py-4 transition hover:border-yellow-200/35 hover:bg-yellow-300/15 lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Danas</p>
            <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{todayRows.length}</p>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500"><span>{latestDate || "-"}</span><span>Otvori →</span></div>
          </Link>

          <article className="rounded-[1.5rem] border border-sky-300/20 bg-[linear-gradient(135deg,rgba(56,189,248,0.22),rgba(56,189,248,0.08))] px-4 py-4 lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Ovaj mjesec</p>
            <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight text-white">{monthRows.length}</p>
            <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">{month}</p>
          </article>

          <article className="col-span-2 rounded-[1.5rem] border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.22),rgba(16,185,129,0.08))] px-4 py-4 lg:col-span-1 lg:rounded-lg lg:px-5">
            <p className="text-[12px] font-medium leading-4 text-neutral-200">Otkupnina ovaj mjesec</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{monthTotal} KM</p>
          </article>
        </section>

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
          <div className="px-1 pb-3">
            <p className="text-lg font-semibold text-white">Zadnji dani</p>
            <p className="mt-1 text-sm text-neutral-500">Kompaktan pregled iz Orders sheeta</p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {recentDays.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-neutral-500">
                Nema narudžbi za ovaj mjesec.
              </div>
            ) : (
              recentDays.map(([date, stats]) => (
                <article
                  key={date}
                  className="flex items-center justify-between gap-4 rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{date}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-neutral-500">{stats.count} narudžbi</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-emerald-200">{stats.amount} KM</span>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
