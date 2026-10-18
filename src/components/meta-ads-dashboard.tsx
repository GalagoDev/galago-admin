"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ChevronDown, Clock3, Info, Megaphone, RefreshCw, TriangleAlert } from "lucide-react";

import type { AdsPeriodKind, AdsSummary } from "@/lib/ads-types";
import type { MetaAdsDashboardData, MetaAdsEntity, MetaAdsReport } from "@/lib/meta-ads-types";

export type AdsPeriodSelection = { kind: AdsPeriodKind; date: string; from: string; to: string };
export type AdsPeriodSelectionProps = {
  period: AdsPeriodSelection;
  onPeriodChange: Dispatch<SetStateAction<AdsPeriodSelection>>;
};

const panel = "rounded-2xl border border-white/10 bg-[#111214] lg:rounded-xl";
const input = "mt-1.5 h-11 w-full min-w-0 rounded-lg border border-white/15 bg-[#0b0c0e] px-3 text-sm text-white outline-none focus:border-sky-300/60 [color-scheme:dark]";
const numbers = new Intl.NumberFormat("bs-BA", { maximumFractionDigits: 2 });
const amounts = new Intl.NumberFormat("bs-BA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dates = new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDates = new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", day: "2-digit", month: "2-digit" });
const periodOptions: Array<{ value: AdsPeriodKind; label: string }> = [
  { value: "workday", label: "Radni dan" },
  { value: "weekend", label: "Vikend" },
  { value: "7days", label: "7 dana" },
  { value: "30days", label: "30 dana" },
  { value: "custom", label: "Odaberi period" },
];

function number(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : numbers.format(value);
}

function money(value: number | null | undefined, currency = "KM") {
  return value == null || !Number.isFinite(value) ? "—" : `${amounts.format(value)} ${currency}`;
}

function roas(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${amounts.format(value)}×`;
}

function dateTime(value: string | null | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? dates.format(new Date(value)) : "—";
}

function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sarajevo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function statusLabel(status: string | null) {
  if (!status) return "Status nije dostupan";
  return ({ ACTIVE: "Aktivna", PAUSED: "Pauzirana", CAMPAIGN_PAUSED: "Kampanja pauzirana", ADSET_PAUSED: "Skup oglasa pauziran", DELETED: "Uklonjena", ARCHIVED: "Arhivirana", DISAPPROVED: "Odbijena", PENDING_REVIEW: "Na pregledu", WITH_ISSUES: "Potrebna provjera", IN_PROCESS: "U obradi" } as Record<string, string>)[status] || status.replaceAll("_", " ");
}

function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  const Icon = warning ? TriangleAlert : Info;
  return <div className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-xs leading-5 ${warning ? "border-amber-300/20 bg-amber-300/[0.07] text-amber-100" : "border-sky-300/15 bg-sky-300/[0.05] text-sky-100/85"}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div>{children}</div></div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className={`${panel} p-4 lg:p-5`}><p className="text-xs font-medium text-neutral-400">{label}</p><p className="mt-3 break-words text-[25px] font-semibold tracking-tight text-white sm:text-3xl">{value}</p><p className="mt-2 text-[11px] leading-4 text-neutral-500">{detail}</p></article>;
}

type SortOrder = "spend" | "revenue" | "roas-high" | "roas-low" | "purchases";

function sortedEntities(rows: MetaAdsEntity[], order: SortOrder) {
  const field = order === "spend" ? "spendBam" : order === "revenue" ? "revenueBam" : order === "purchases" ? "purchases" : "roas";
  return [...rows].sort((a, b) => {
    const left = a[field];
    const right = b[field];
    if (left == null && right != null) return 1;
    if (right == null && left != null) return -1;
    return (left == null || right == null ? 0 : order === "roas-low" ? left - right : right - left) || a.name.localeCompare(b.name, "bs");
  });
}

function PerformanceNumbers({ metrics }: { metrics: AdsSummary }) {
  return <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
    <div><dt className="text-[10px] text-neutral-500">Potrošnja</dt><dd className="mt-0.5 tabular-nums text-neutral-200">{money(metrics.spendBam)}</dd></div>
    <div><dt className="text-[10px] text-neutral-500">Promet s weba</dt><dd className="mt-0.5 tabular-nums text-neutral-200">{money(metrics.revenueBam)}</dd></div>
    <div><dt className="text-[10px] text-neutral-500">ROAS</dt><dd className="mt-0.5 font-semibold tabular-nums text-white">{roas(metrics.roas)}</dd></div>
    <div><dt className="text-[10px] text-neutral-500">Web kupovine</dt><dd className="mt-0.5 tabular-nums text-neutral-200">{number(metrics.purchases)}</dd></div>
  </dl>;
}

function EntityTable({ rows, level, periodLabel }: { rows: MetaAdsEntity[]; level: "campaigns" | "ads"; periodLabel: string }) {
  const [sort, setSort] = useState<SortOrder>("spend");
  const ordered = sortedEntities(rows, sort);
  const title = level === "campaigns" ? "Kampanje" : "Pojedinačni oglasi";
  const context = (row: MetaAdsEntity) => [level === "ads" ? row.campaignName : null, level === "ads" ? row.adSetName : null, row.accountName].filter(Boolean).join(" · ");

  return <section className={`${panel} overflow-hidden`} aria-labelledby={`meta-${level}-title`}>
    <div className="flex flex-wrap items-start justify-between gap-3 p-4 lg:p-5"><div><h2 id={`meta-${level}-title`} className="text-base font-semibold text-white">{title}<span className="ml-2 text-xs font-normal text-neutral-500">{number(rows.length)}</span></h2><p className="mt-1 text-xs leading-5 text-neutral-500">{periodLabel}</p></div><label className="flex max-w-full items-center gap-2 text-[11px] text-neutral-500">Poredaj<select aria-label={`Poredaj: ${title}`} value={sort} onChange={(event) => setSort(event.target.value as SortOrder)} className="h-10 min-w-0 rounded-lg border border-white/10 bg-[#0b0c0e] px-2 text-xs text-neutral-300 outline-none focus:border-sky-300/60"><option value="spend">Potrošnja ↓</option><option value="revenue">Web promet ↓</option><option value="roas-high">ROAS ↓</option><option value="roas-low">ROAS ↑</option><option value="purchases">Web kupovine ↓</option></select></label></div>
    {ordered.length === 0 ? <p className="px-5 pb-6 text-sm text-neutral-500">Nema aktivnosti u odabranom periodu.</p> : <>
      <div className="space-y-2 px-4 pb-4 lg:hidden">{ordered.map((row) => <article key={`${row.accountId}:${row.id}`} className="rounded-xl border border-white/10 bg-black/15 p-3.5"><h3 className="break-words text-sm font-medium text-white">{row.name}</h3><p className="mt-1 break-words text-[10px] leading-4 text-neutral-500">{context(row)}</p>{row.status ? <p className={`mt-1.5 text-[10px] ${row.status === "ACTIVE" ? "text-emerald-200/80" : "text-neutral-400"}`}>{statusLabel(row.status)}</p> : null}<PerformanceNumbers metrics={row} /><p className="mt-3 border-t border-white/[0.06] pt-2 text-[10px] text-neutral-500">{number(row.clicks)} klikova · {number(row.impressions)} prikaza</p></article>)}</div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[880px] text-left text-xs"><thead className="border-y border-white/8 bg-black/15 text-[10px] uppercase tracking-wider text-neutral-500"><tr><th scope="col" className="px-5 py-3 font-medium">{level === "campaigns" ? "Kampanja" : "Oglas"}</th>{["Potrošnja", "Promet s weba", "ROAS", "Web kupovine", "Klikovi", "Prikazi"].map((label) => <th key={label} scope="col" className="px-3 py-3 text-right font-medium last:pr-5">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.06]">{ordered.map((row) => <tr key={`${row.accountId}:${row.id}`} className="hover:bg-white/[0.02]"><th scope="row" className="max-w-xs px-5 py-4 font-medium"><span className="block break-words text-white">{row.name}</span><span className="mt-1 block break-words text-[10px] font-normal leading-4 text-neutral-500">{context(row)}</span>{row.status ? <span className={`mt-1 block text-[10px] font-normal ${row.status === "ACTIVE" ? "text-emerald-200/80" : "text-neutral-400"}`}>{statusLabel(row.status)}</span> : null}</th><td className="whitespace-nowrap px-3 py-4 text-right tabular-nums text-neutral-200">{money(row.spendBam)}</td><td className="whitespace-nowrap px-3 py-4 text-right tabular-nums text-neutral-200">{money(row.revenueBam)}</td><td className="px-3 py-4 text-right font-semibold tabular-nums text-white">{roas(row.roas)}</td><td className="px-3 py-4 text-right tabular-nums text-neutral-300">{number(row.purchases)}</td><td className="px-3 py-4 text-right tabular-nums text-neutral-300">{number(row.clicks)}</td><td className="px-3 py-4 pr-5 text-right tabular-nums text-neutral-300">{number(row.impressions)}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}

function Timeline({ timeline }: { timeline: MetaAdsReport["timeline"] }) {
  if (!timeline.length) return null;
  const maximum = Math.max(1, ...timeline.flatMap((day) => [day.spendBam ?? 0, day.revenueBam ?? 0]));
  return <section className={`${panel} p-4 lg:p-5`} aria-labelledby="meta-timeline-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="meta-timeline-title" className="text-base font-semibold text-white">Potrošnja i promet s weba</h2><div className="flex gap-4 text-[11px] text-neutral-400"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-sky-300" />Potrošnja</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-300" />Web promet</span></div></div>
    <div className="mt-5 max-h-[26rem] space-y-3 overflow-y-auto pr-1" role="list" aria-label="Dnevna Meta potrošnja i prodaja">{timeline.map((day) => <div key={day.date} role="listitem" className="grid grid-cols-[2.75rem_minmax(0,1fr)_5.75rem] items-center gap-x-2 gap-y-1 sm:grid-cols-[3.25rem_minmax(0,1fr)_7rem] sm:gap-x-4"><p className="row-span-2 text-xs tabular-nums text-neutral-400">{shortDates.format(new Date(`${day.date}T12:00:00Z`))}</p><div className="h-2 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true"><div className="h-full rounded-full bg-sky-300" style={{ width: `${Math.max(0, day.spendBam ?? 0) / maximum * 100}%` }} /></div><p className="text-right text-[11px] tabular-nums text-sky-200"><span className="sr-only">Potrošnja: </span>{money(day.spendBam)}</p><div className="h-2 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${Math.max(0, day.revenueBam ?? 0) / maximum * 100}%` }} /></div><p className="text-right text-[11px] tabular-nums text-emerald-200"><span className="sr-only">Prodaja: </span>{money(day.revenueBam)}</p></div>)}</div>
  </section>;
}

export function MetaAdsDashboard({ onGoogle, period, onPeriodChange }: AdsPeriodSelectionProps & { onGoogle: () => void }) {
  const { kind, date, from, to } = period;
  const [payload, setPayload] = useState<{ query: string; data: MetaAdsDashboardData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ query: string; message: string } | null>(null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const customInvalid = kind === "custom" && (!from || !to || from > to);
  const parameters = new URLSearchParams({ kind });
  if (date && kind !== "weekend" && kind !== "custom") parameters.set("date", date);
  if (kind === "custom") { parameters.set("from", from); parameters.set("to", to); }
  const query = parameters.toString();
  const data = payload?.query === query && !customInvalid ? payload.data : null;
  const report = data?.report;
  const summary = report?.summary;
  const displayError = (error?.query === query ? error.message : null) || data?.error;

  const refresh = useCallback(async (manual = false) => {
    if (customInvalid) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/ads/meta?${query}${manual ? "&refresh=1" : ""}`, { cache: "no-store", signal: controller.signal });
      if (response.status === 401) throw new Error("Sesija je istekla. Prijavi se ponovo pa osvježi pregled.");
      const next = await response.json().catch(() => null) as MetaAdsDashboardData | { error?: string } | null;
      if (controller.signal.aborted || request !== requestRef.current) return;
      if (!response.ok) {
        if (response.status === 400) setPayload(null);
        throw new Error(next?.error || "Meta podatke trenutno nije moguće učitati.");
      }
      if (!next || !("connection" in next) || !("period" in next)) throw new Error("Meta izvještaj nije dostupan. Pokušaj ponovo.");
      setPayload({ query, data: next });
      setError(null);
    } catch (failure) {
      if (!controller.signal.aborted && request === requestRef.current) setError({ query, message: failure instanceof Error ? failure.message : "Meta pregled nije dostupan." });
    } finally {
      if (!controller.signal.aborted && request === requestRef.current) setLoading(false);
    }
  }, [query, customInvalid]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); controllerRef.current?.abort(); requestRef.current += 1; };
  }, [refresh]);

  return <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60"><div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pb-10 pt-4 sm:px-5 lg:max-w-[1480px] lg:gap-5 lg:px-8 lg:pt-8 2xl:px-10">
    <header className={`${panel} p-4 lg:p-6`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[0.22em] text-neutral-500">Galago Admin</p><h1 className="mt-2 flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-white"><Megaphone className="h-5 w-5 text-sky-300" aria-hidden="true" />Reklame</h1><p className="mt-2 text-xs leading-5 text-neutral-400 sm:text-sm">Vidi koliko ulažeš i koliko reklame donose.</p></div><button type="button" onClick={() => void refresh(true)} disabled={loading || customInvalid || data?.connection.configured === false} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-medium text-neutral-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40" title="Osvježi Meta izvještaj"><RefreshCw className={`h-4 w-4 ${loading && !customInvalid ? "animate-spin" : ""}`} aria-hidden="true" />{loading && !customInvalid ? "Osvježavanje…" : "Osvježi"}</button></div>
      <div role="group" aria-label="Platforma reklama" className="mt-5 flex flex-wrap items-center gap-2"><button type="button" aria-pressed="false" onClick={onGoogle} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-neutral-400 transition hover:bg-white/[0.04] hover:text-white">Google Ads</button><button type="button" aria-pressed="true" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/10 px-3 py-2 text-xs font-semibold text-sky-100"><span className="h-1.5 w-1.5 rounded-full bg-sky-300" />Meta Ads</button></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/[0.07] pt-3 text-[10px] leading-5 text-neutral-500"><span>{data ? data.connection.configured ? data.accounts.map((account) => account.name).join(" · ") || "Meta Ads računi" : "Meta Ads nije povezan" : loading ? "Učitavanje podataka…" : "Podaci nisu dostupni"}</span><span aria-live="polite">Meta podaci: <span className="text-neutral-400">{dateTime(data?.fetchedAt)}</span> · provjera svake minute</span></div>
    </header>

    {displayError ? <div role="alert"><Notice warning>{displayError}{report ? " Prikazani su posljednji dostupni podaci." : ""} <button type="button" className="ml-1 underline underline-offset-2" onClick={() => void refresh(true)}>Pokušaj ponovo</button></Notice></div> : null}
    {data?.connection.configured === false && !displayError ? <Notice>Meta Ads nije povezan. Poveži oglasne račune da vidiš potrošnju i rezultate.</Notice> : null}

    <section className={`${panel} p-4 lg:p-5`} aria-label="Period prikaza"><div className="flex flex-wrap gap-1.5">{periodOptions.map((option) => <button key={option.value} type="button" aria-pressed={kind === option.value} onClick={() => onPeriodChange((previous) => ({ ...previous, kind: option.value, from: option.value === "custom" && !previous.from ? today() : previous.from, to: option.value === "custom" && !previous.to ? today() : previous.to }))} className={`min-h-11 rounded-lg border px-3 text-xs font-medium transition ${kind === option.value ? "border-sky-300/30 bg-sky-300/10 text-sky-100" : "border-white/10 text-neutral-400 hover:bg-white/[0.04]"}`}>{option.label}</button>)}</div>
      <div className="mt-3 flex flex-wrap items-end gap-3">{kind === "custom" ? <><label className="min-w-0 flex-1 text-xs text-neutral-500 sm:max-w-48">Od<input type="date" value={from} onChange={(event) => { const value = event.target.value; onPeriodChange((previous) => ({ ...previous, from: value })); }} className={input} /></label><label className="min-w-0 flex-1 text-xs text-neutral-500 sm:max-w-48">Do<input type="date" value={to} min={from || undefined} onChange={(event) => { const value = event.target.value; onPeriodChange((previous) => ({ ...previous, to: value })); }} className={input} /></label></> : kind !== "weekend" ? <label className="w-full min-w-0 text-xs text-neutral-500 sm:max-w-52">{kind === "workday" ? "Datum završetka radnog ciklusa" : "Završni datum"}<input type="date" value={date} onChange={(event) => { const value = event.target.value; onPeriodChange((previous) => ({ ...previous, date: value })); }} className={input} /><span className="mt-1 block text-[10px]">Prazno = trenutni period</span></label> : null}<p className="text-[11px] leading-5 text-neutral-500">{kind === "workday" ? "Radni ciklus: 08:00–08:00; ponedjeljak uključuje vikend." : kind === "weekend" ? "Posljednji započeti vikend: petak 08:00 – ponedjeljak 08:00." : "Kalendarski dani, uključujući početni i završni datum."}<br />Vremenska zona: Sarajevo.</p></div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3 text-xs"><span className="text-neutral-300">{customInvalid ? "Odaberi ispravan početni i završni datum." : data?.period.label || (loading ? "Učitavanje perioda…" : "Podaci za period nisu dostupni")}</span>{data && !data.period.complete ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-200"><Clock3 className="h-3 w-3" aria-hidden="true" />Period još traje</span> : null}</div>
    </section>

    <section className="grid grid-cols-2 gap-3 xl:grid-cols-3" aria-label="Meta rezultati odabranog perioda" aria-busy={loading && !customInvalid}>
      <Metric label="Potrošnja reklama" value={money(summary?.spendBam)} detail={summary?.spendEur == null ? "Meta Ads · iznos još nije dostupan" : `${money(summary.spendEur, "€")} protivvrijednost`} />
      <Metric label="Promet s weba" value={money(summary?.revenueBam)} detail={summary?.revenueBam == null ? "Vrijednost web kupovina nije dostupna" : "Web kupovine pripisane Meta oglasima"} />
      <Metric label="Povrat na potrošnju · ROAS" value={roas(summary?.roas)} detail={summary?.roas == null ? "Čeka poznati web promet i potrošnju" : "Web promet ÷ potrošnja"} />
      <Metric label="Web kupovine" value={number(summary?.purchases)} detail={summary?.cpaBam == null ? "Kupovine pripisane Meta oglasima" : `${money(summary.cpaBam)} po kupovini`} />
      <Metric label="Prikazi reklama" value={number(summary?.impressions)} detail="Koliko puta su se reklame prikazale" />
      <Metric label="Klikovi" value={number(summary?.clicks)} detail={`CTR ${summary?.ctr == null ? "—" : `${number(summary.ctr * 100)}%`} · CPC ${money(summary?.cpcBam)}`} />
    </section>

    {report?.attribution ? <p className="px-1 text-[11px] leading-5 text-neutral-500">{report.attribution}</p> : null}
    {report?.warnings.map((warning) => <Notice key={warning} warning>{warning}</Notice>)}
    {report ? <><Timeline timeline={report.timeline} /><EntityTable rows={report.campaigns} level="campaigns" periodLabel={report.period.label} /><EntityTable rows={report.ads} level="ads" periodLabel={report.period.label} /></> : !displayError && data?.connection.configured !== false ? <section className={`${panel} px-5 py-10 text-center`}><p className="text-sm text-neutral-400">{loading && !customInvalid ? "Učitavanje Meta rezultata…" : "Meta rezultati još nisu dostupni."}</p></section> : null}

    {data?.accounts.length ? <details className={`${panel} group p-4 lg:p-5`}><summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm font-medium text-neutral-200 [&::-webkit-details-marker]:hidden">Povezani Meta računi<ChevronDown className="ml-auto h-4 w-4 text-neutral-500 transition group-open:rotate-180" aria-hidden="true" /></summary><dl className="mt-4 grid gap-3 sm:grid-cols-2">{data.accounts.map((account) => <div key={account.id} className="rounded-lg border border-white/[0.07] p-3"><dt className="text-xs font-medium text-neutral-300">{account.name}</dt><dd className="mt-1 break-words text-[11px] leading-5 text-neutral-500">{account.id} · {account.currency} · {account.timeZone}</dd></div>)}</dl></details> : null}
  </div></main>;
}
