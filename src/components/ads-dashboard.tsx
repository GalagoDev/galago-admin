"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Clock3, Info, Megaphone, RefreshCw, Settings2, TriangleAlert } from "lucide-react";

import type { AdsDashboardData, AdsPeriodKind, AdsRecommendation, AdsReport, AdsSettings, AdsSummary } from "@/lib/ads-types";

const panel = "rounded-2xl border border-white/10 bg-[#111214] lg:rounded-xl";
const input = "mt-1.5 h-11 w-full min-w-0 rounded-lg border border-white/15 bg-[#0b0c0e] px-3 text-sm text-white outline-none focus:border-sky-300/60 [color-scheme:dark]";
const numberFormat = new Intl.NumberFormat("bs-BA", { maximumFractionDigits: 2 });
const moneyFormat = new Intl.NumberFormat("bs-BA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTimeFormat = new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDateFormat = new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", day: "2-digit", month: "2-digit" });
const periodOptions: Array<{ value: AdsPeriodKind; label: string }> = [
  { value: "workday", label: "Radni dan" },
  { value: "weekend", label: "Vikend" },
  { value: "7days", label: "7 dana" },
  { value: "30days", label: "30 dana" },
  { value: "custom", label: "Odaberi period" },
];

function number(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : numberFormat.format(value);
}

function money(value: number | null | undefined, currency = "KM") {
  return value == null || !Number.isFinite(value) ? "—" : `${moneyFormat.format(value)} ${currency}`;
}

function roas(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${moneyFormat.format(value)}×`;
}

function dateTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return dateTimeFormat.format(new Date(value));
}

function shortDate(value: string) {
  return shortDateFormat.format(new Date(`${value}T12:00:00Z`));
}

function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sarajevo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function statusLabel(status: string) {
  return ({ ENABLED: "Aktivna", PAUSED: "Pauzirana", REMOVED: "Uklonjena" } as Record<string, string>)[status] || status;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new Error("Sesija je istekla. Prijavi se ponovo pa osvježi pregled.");
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "Podatke trenutno nije moguće učitati. Pokušaj ponovo.");
  if (payload == null) throw new Error("Server nije vratio podatke. Pokušaj ponovo.");
  return payload as T;
}

function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  const Icon = warning ? TriangleAlert : Info;
  return <div className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-xs leading-5 ${warning ? "border-amber-300/20 bg-amber-300/[0.07] text-amber-100" : "border-sky-300/15 bg-sky-300/[0.05] text-sky-100/85"}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div>{children}</div></div>;
}

function Metric({ label, value, detail, highlight = false }: { label: string; value: string; detail: string; highlight?: boolean }) {
  return <article className={`rounded-xl border p-4 lg:p-5 ${highlight ? "border-emerald-300/25 bg-emerald-300/[0.08]" : "border-white/10 bg-[#111214]"}`}><p className="text-xs font-medium text-neutral-400">{label}</p><p className={`mt-3 break-words text-[25px] font-semibold tracking-tight sm:text-3xl ${highlight ? "text-emerald-200" : "text-white"}`}>{value}</p><p className="mt-2 text-[11px] leading-4 text-neutral-500">{detail}</p></article>;
}

function RecommendationBadge({ recommendation }: { recommendation: AdsRecommendation }) {
  const styles = {
    keep: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
    review: "border-amber-300/20 bg-amber-300/10 text-amber-200",
    wait: "border-sky-300/20 bg-sky-300/10 text-sky-200",
    tracking: "border-rose-300/20 bg-rose-300/10 text-rose-200",
    inactive: "border-white/10 bg-white/5 text-neutral-400",
  };
  const Icon = recommendation.decision === "keep" ? ArrowUpRight : recommendation.decision === "review" ? ArrowDownRight : recommendation.decision === "tracking" ? TriangleAlert : Clock3;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${styles[recommendation.decision]}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{recommendation.label}</span>;
}

function Timeline({ timeline }: { timeline: AdsReport["timeline"] }) {
  const maximum = Math.max(1, ...timeline.flatMap((day) => [day.spendBam ?? 0, day.revenueBam ?? 0]));
  return <section className={`${panel} p-4 lg:p-5`} aria-labelledby="ads-timeline-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="ads-timeline-title" className="text-base font-semibold text-white">Potrošnja i Google prodaja</h2><p className="mt-1 text-xs leading-5 text-neutral-500">Po datumima unutar odabranog perioda, u KM.</p></div><div className="flex gap-4 text-[11px] text-neutral-400"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-sky-300" />Potrošnja</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-300" />Prodaja</span></div></div>
    {timeline.length === 0 ? <p className="py-10 text-center text-sm text-neutral-500">Nema podataka za ovaj period.</p> : <div className="mt-5 max-h-[26rem] space-y-3 overflow-y-auto pr-1" role="list" aria-label="Dnevna potrošnja i prodaja">
      {timeline.map((day) => <div key={day.date} role="listitem" className="grid grid-cols-[2.75rem_minmax(0,1fr)_5.75rem] items-center gap-x-2 gap-y-1 sm:grid-cols-[3.25rem_minmax(0,1fr)_7rem] sm:gap-x-4">
        <p className="row-span-2 text-xs tabular-nums text-neutral-400">{shortDate(day.date)}</p>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true"><div className="h-full rounded-full bg-sky-300" style={{ width: `${Math.max(0, day.spendBam ?? 0) / maximum * 100}%` }} /></div><p className="text-right text-[11px] tabular-nums text-sky-200"><span className="sr-only">Potrošnja: </span>{money(day.spendBam)}</p>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${Math.max(0, day.revenueBam ?? 0) / maximum * 100}%` }} /></div><p className="text-right text-[11px] tabular-nums text-emerald-200"><span className="sr-only">Prodaja: </span>{money(day.revenueBam)}</p>
      </div>)}
    </div>}
  </section>;
}

function PerformanceNumbers({ metrics }: { metrics: AdsSummary }) {
  return <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
    <div><span className="block text-[10px] text-neutral-500">Potrošnja</span><span className="mt-0.5 block tabular-nums text-neutral-200">{money(metrics.spendBam)}</span></div>
    <div><span className="block text-[10px] text-neutral-500">Google prodaja</span><span className="mt-0.5 block tabular-nums text-neutral-200">{money(metrics.revenueBam)}</span></div>
    <div><span className="block text-[10px] text-neutral-500">ROAS</span><span className="mt-0.5 block font-semibold tabular-nums text-white">{roas(metrics.roas)}</span></div>
    <div><span className="block text-[10px] text-neutral-500">Kupovine · klikovi</span><span className="mt-0.5 block tabular-nums text-neutral-200">{number(metrics.purchases)} · {number(metrics.clicks)}</span></div>
  </div>;
}

function Campaigns({ report }: { report: AdsReport }) {
  return <section className={`${panel} overflow-hidden`} aria-labelledby="ads-campaigns-title">
    <div className="p-4 lg:p-5"><h2 id="ads-campaigns-title" className="text-base font-semibold text-white">Kampanje</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{report.period.label} · isti period kao gornji pokazatelji</p></div>
    {report.campaigns.length === 0 ? <p className="px-5 pb-7 text-sm text-neutral-500">Nema aktivnosti kampanja u ovom periodu.</p> : <>
      <div className="space-y-2 px-4 pb-4 lg:hidden">{report.campaigns.map((campaign) => <article key={campaign.id} className="rounded-xl border border-white/10 bg-black/15 p-3"><div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-sm font-medium text-white">{campaign.name}</h3><span className="shrink-0 text-[10px] text-neutral-500">{statusLabel(campaign.status)}</span></div><PerformanceNumbers metrics={campaign} /><p className="mt-2 text-[10px] text-neutral-500">{number(campaign.impressions)} prikaza · CTR {campaign.ctr == null ? "—" : `${number(campaign.ctr * 100)}%`}</p></article>)}</div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[790px] text-left text-xs"><thead className="border-y border-white/8 bg-black/15 text-[10px] uppercase tracking-wider text-neutral-500"><tr><th scope="col" className="px-5 py-3 font-medium">Kampanja</th>{["Potrošnja", "Google prodaja", "ROAS", "Kupovine", "Klikovi", "Prikazi"].map((label) => <th key={label} scope="col" className="px-3 py-3 text-right font-medium last:pr-5">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.06]">{report.campaigns.map((campaign) => <tr key={campaign.id} className="hover:bg-white/[0.02]"><th scope="row" className="max-w-xs px-5 py-4 font-medium"><span className="block break-words text-white">{campaign.name}</span><span className="mt-1 block text-[10px] font-normal text-neutral-500">{statusLabel(campaign.status)} · {campaign.channel.replaceAll("_", " ")}</span></th><td className="whitespace-nowrap px-3 py-4 text-right tabular-nums text-neutral-200">{money(campaign.spendBam)}</td><td className="whitespace-nowrap px-3 py-4 text-right tabular-nums text-neutral-200">{money(campaign.revenueBam)}</td><td className="px-3 py-4 text-right font-semibold tabular-nums text-white">{roas(campaign.roas)}</td><td className="px-3 py-4 text-right tabular-nums text-neutral-300">{number(campaign.purchases)}</td><td className="px-3 py-4 text-right tabular-nums text-neutral-300">{number(campaign.clicks)}</td><td className="px-3 py-4 pr-5 text-right tabular-nums text-neutral-300">{number(campaign.impressions)}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}

function AdsRecommendations({ report, settings, stale }: { report: AdsReport; settings: AdsSettings; stale: boolean }) {
  // A cached successful response may age while refresh requests fail. Apply the
  // freshness guard locally too, so old actionable badges cannot survive offline.
  const ads = stale ? report.ads.map((ad) => ({
    ...ad,
    recommendation: ad.recommendation.decision === "inactive" ? ad.recommendation : {
      decision: "wait" as const,
      label: "Osvježi podatke",
      reason: "Podaci su stariji od šest sati. Osvježi ih prije odluke o zadržavanju ili pauziranju oglasa.",
    },
  })) : report.ads;
  const sorted = [...ads].sort((a, b) => {
    const order = { review: 0, tracking: 1, keep: 2, wait: 3, inactive: 4 };
    return order[a.recommendation.decision] - order[b.recommendation.decision] || (b.spendBam ?? 0) - (a.spendBam ?? 0);
  });
  return <section className={`${panel} p-4 lg:p-5`} aria-labelledby="ads-recommendations-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="ads-recommendations-title" className="text-base font-semibold text-white">Koje reklame ostaviti?</h2><p className="mt-1 text-xs leading-5 text-neutral-500">Pojedinačni oglasi · {report.recommendationPeriod.label}</p></div><span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-neutral-400">{settings.targetRoas == null ? "Ciljni ROAS nije postavljen" : `Ciljni ROAS ${roas(settings.targetRoas)}`}</span></div>
    <p className="mt-3 text-xs leading-5 text-neutral-400">Preporuke koriste zaseban period od 14 završenih dana i izostavljaju danas i prethodnih {settings.attributionLagDays} dana zbog kašnjenja konverzija. Oglasi imaju dnevne podatke, pa ovaj pregled ne prati radni rez u 08:00. Preporuke se provode ručno u Google Ads računu.</p>
    {settings.targetRoas == null ? <div className="mt-3"><Notice>Postavi ciljni ROAS u postavkama ispod da dobiješ preporuke prema svojoj marži.</Notice></div> : null}
    {sorted.length === 0 ? <p className="py-8 text-center text-sm text-neutral-500">Još nema podataka o pojedinačnim oglasima za procjenu.</p> : <>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:hidden">{sorted.map((ad) => <article key={ad.id} className="rounded-xl border border-white/10 bg-black/15 p-3.5"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 flex-1 break-words text-sm font-medium text-white">{ad.name}</h3><RecommendationBadge recommendation={ad.recommendation} /></div><p className="mt-1 break-words text-[11px] leading-4 text-neutral-500">{ad.campaignName} · {ad.adGroupName} · {statusLabel(ad.status)}</p><PerformanceNumbers metrics={ad} /><p className="mt-3 border-t border-white/[0.06] pt-2.5 text-xs leading-5 text-neutral-400">{ad.recommendation.reason}</p></article>)}</div>
      <div className="mt-4 hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[840px] text-left text-xs">
          <thead className="border-y border-white/8 bg-black/15 text-[10px] uppercase tracking-wider text-neutral-500"><tr>
            <th scope="col" className="px-3 py-3 font-medium">Oglas</th>
            {["Potrošnja", "Google prodaja", "ROAS", "Kupovine"].map((label) => <th key={label} scope="col" className="px-3 py-3 text-right font-medium">{label}</th>)}
            <th scope="col" className="px-3 py-3 font-medium">Preporuka</th>
          </tr></thead>
          <tbody className="divide-y divide-white/[0.06]">{sorted.map((ad) => <tr key={ad.id} className="align-top hover:bg-white/[0.02]">
            <th scope="row" className="max-w-56 px-3 py-4 font-medium"><span className="block break-words text-white">{ad.name}</span><span className="mt-1 block break-words text-[10px] font-normal leading-4 text-neutral-500">{ad.campaignName} · {ad.adGroupName}<br />{statusLabel(ad.status)} · {number(ad.clicks)} klikova</span></th>
            <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums text-neutral-200">{money(ad.spendBam)}</td>
            <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums text-neutral-200">{money(ad.revenueBam)}</td>
            <td className="px-3 py-4 text-right font-semibold tabular-nums text-white">{roas(ad.roas)}</td>
            <td className="px-3 py-4 text-right tabular-nums text-neutral-300">{number(ad.purchases)}</td>
            <td className="w-[32%] min-w-64 px-3 py-4"><RecommendationBadge recommendation={ad.recommendation} /><p className="mt-2 text-[11px] leading-5 text-neutral-400">{ad.recommendation.reason}</p></td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}

function SettingsForm({ settings, onSaved }: { settings: AdsSettings; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = String(form.get("targetRoas") || "").trim();
    const next: AdsSettings = {
      targetRoas: target ? Number(target) : null,
      minimumSpendBam: Number(form.get("minimumSpendBam")),
      minimumClicks: Number(form.get("minimumClicks")),
      minimumPurchases: Number(form.get("minimumPurchases")),
      attributionLagDays: Number(form.get("attributionLagDays")),
    };
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSaving(true);
    setFeedback(null);
    try {
      await readResponse(await fetch("/api/ads/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next), signal: controller.signal }));
      if (controller.signal.aborted) return;
      setFeedback({ error: false, message: "Postavke su sačuvane." });
      onSaved();
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ error: true, message: error instanceof Error ? error.message : "Postavke nije moguće sačuvati." });
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <form onSubmit={save} className="mt-4">
    <p className="text-xs leading-5 text-neutral-400">Cilj postavi prema marži, dostavi, povratima i ostalim troškovima. ROAS sam po sebi ne pokazuje zaradu. Minimalni uzorak sprečava prerane preporuke; kašnjenje daje kupovinama vremena da budu evidentirane.</p>
    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <label className="col-span-2 text-xs text-neutral-400 sm:col-span-1">Ciljni ROAS (×)<input className={input} name="targetRoas" type="number" min="0.1" max="1000" step="0.1" defaultValue={settings.targetRoas ?? ""} placeholder="Postavi prema marži" /><span className="mt-1 block text-[10px] leading-4 text-neutral-500">Prazno = bez preporuka uspješnosti</span></label>
      <label className="text-xs text-neutral-400">Min. potrošnja (KM)<input className={input} name="minimumSpendBam" type="number" min="1" max="1000000" step="0.01" required defaultValue={settings.minimumSpendBam} /></label>
      <label className="text-xs text-neutral-400">Min. klikova<input className={input} name="minimumClicks" type="number" min="1" max="100000" step="1" required defaultValue={settings.minimumClicks} /></label>
      <label className="text-xs text-neutral-400">Min. kupovina<input className={input} name="minimumPurchases" type="number" min="1" max="10000" step="1" required defaultValue={settings.minimumPurchases} /></label>
      <label className="text-xs text-neutral-400">Kašnjenje (dani)<input className={input} name="attributionLagDays" type="number" min="1" max="30" step="1" required defaultValue={settings.attributionLagDays} /></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/10 px-4 text-sm font-medium text-sky-100 transition hover:bg-sky-300/15 disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" />{saving ? "Spremanje…" : "Sačuvaj postavke"}</button><p role="status" className={`text-xs ${feedback?.error ? "text-rose-200" : "text-emerald-200"}`}>{feedback?.message}</p></div>
  </form>;
}

export function AdsDashboard() {
  const [kind, setKind] = useState<AdsPeriodKind>("workday");
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [payload, setPayload] = useState<{ query: string; data: AdsDashboardData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [checkedAt, setCheckedAt] = useState(0);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const syncControllerRef = useRef<AbortController | null>(null);
  const customInvalid = kind === "custom" && (!from || !to || from > to);
  const parameters = new URLSearchParams({ kind });
  if (date && kind !== "weekend" && kind !== "custom") parameters.set("date", date);
  if (kind === "custom") { parameters.set("from", from); parameters.set("to", to); }
  const query = parameters.toString();
  const data = payload?.query === query && !customInvalid ? payload.data : null;
  const report = data?.report;
  const summary = report?.summary;

  const refresh = useCallback(async () => {
    if (customInvalid) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/ads?${query}`, { cache: "no-store", signal: controller.signal });
      if (response.status === 400) {
        const failure = await response.json() as { error?: string; data?: AdsDashboardData };
        if (controller.signal.aborted || request !== requestRef.current) return;
        if (failure.data) setPayload({ query, data: failure.data });
        else setPayload(null);
        setError(failure.error || "Odabrani period nije dostupan.");
        return;
      }
      const next = await readResponse<AdsDashboardData>(response);
      if (controller.signal.aborted || request !== requestRef.current) return;
      setPayload({ query, data: next });
      setError(null);
    } catch (error) {
      if (!controller.signal.aborted && request === requestRef.current) setError(error instanceof Error ? error.message : "Pregled nije dostupan.");
    } finally {
      if (!controller.signal.aborted && request === requestRef.current) { setLoading(false); setCheckedAt(Date.now()); }
    }
  }, [query, customInvalid]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); controllerRef.current?.abort(); requestRef.current += 1; };
  }, [refresh, refreshVersion]);

  useEffect(() => () => syncControllerRef.current?.abort(), []);

  async function sync() {
    syncControllerRef.current?.abort();
    const controller = new AbortController();
    syncControllerRef.current = controller;
    setSyncing(true);
    setSyncError(null);
    try {
      await readResponse(await fetch("/api/ads/sync", { method: "POST", signal: controller.signal }));
    } catch (error) {
      if (!controller.signal.aborted) setSyncError(error instanceof Error ? error.message : "Osvježavanje nije uspjelo.");
    } finally {
      if (!controller.signal.aborted) { setSyncing(false); setRefreshVersion((version) => version + 1); }
    }
  }

  const stale = data?.sync.lastSuccessAt ? checkedAt - Date.parse(data.sync.lastSuccessAt) > 6 * 60 * 60 * 1000 : false;
  const busy = syncing || !!data?.sync.running;
  const displayError = error || syncError || data?.sync.error;
  const fixedPurchaseValues = Boolean(data?.tracking?.fixedValueActions?.length);
  const valueSettingsPending = Boolean(data?.tracking?.configured && data.tracking.valueSettingsChecked !== true);
  const revenueDetail = fixedPurchaseValues
    ? "Fiksna vrijednost kupovine; stvarna prodaja nije poznata"
    : valueSettingsPending ? "Postavke vrijednosti čekaju provjeru pri osvježavanju"
      : summary?.revenueBam == null ? "Vrijednost prodaje još nije dostupna"
        : "Vrijednost kupovina pripisanih reklamama";
  const roasDetail = fixedPurchaseValues
    ? "Čeka stvarne iznose i valutu kupovina"
    : valueSettingsPending ? "Osvježi podatke za provjeru vrijednosti"
      : summary?.roas == null ? "Za izračun trebaju poznati prihod i potrošnja"
        : data?.settings.targetRoas == null ? "Cilj postavi u postavkama" : `Tvoj cilj: ${roas(data.settings.targetRoas)}`;

  return <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60"><div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pb-10 pt-4 sm:px-5 lg:max-w-[1480px] lg:gap-5 lg:px-8 lg:pt-8 2xl:px-10">
    <header className={`${panel} p-4 lg:p-6`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[0.22em] text-neutral-500">Galago Admin</p><h1 className="mt-2 flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-white"><Megaphone className="h-5 w-5 text-sky-300" aria-hidden="true" />Reklame</h1><p className="mt-2 text-xs leading-5 text-neutral-400 sm:text-sm">Vidi koliko ulažeš i koliko reklame donose.</p></div><button type="button" onClick={() => void sync()} disabled={busy || !data?.connection.configured} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-medium text-neutral-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40" title="Preuzmi nove podatke iz Google Ads"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />{busy ? "Osvježavanje…" : "Osvježi"}</button></div>
      <div className="mt-5 flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/10 px-3 py-2 text-xs font-semibold text-sky-100"><span className="h-1.5 w-1.5 rounded-full bg-sky-300" />Google Ads</span><span className="inline-flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2 text-xs text-neutral-500">Meta Ads<span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase">Kasnije</span></span></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/[0.07] pt-3 text-[10px] leading-5 text-neutral-500"><span>{data ? data.connection.configured ? `${data.account?.name || "Google Ads račun"}${data.account?.id ? ` · ${data.account.id}` : ""}` : "Google Ads nije povezan" : loading ? "Učitavanje podataka…" : "Podaci nisu dostupni"}</span><span aria-live="polite">Posljednja sinhronizacija: <span className={stale ? "text-amber-200" : "text-neutral-400"}>{dateTime(data?.sync.lastSuccessAt)}</span> · pregled se osvježava svake minute</span></div>
    </header>

    {displayError ? <div role="alert"><Notice warning>{displayError}{report ? " Prikazani su posljednji dostupni podaci." : ""} <button type="button" className="ml-1 underline underline-offset-2" onClick={() => void refresh()}>Pokušaj ponovo</button></Notice></div> : null}
    {stale && !displayError ? <Notice warning>Posljednji podaci su stariji od šest sati. Osvježi sinhronizaciju prije procjene učinka.</Notice> : null}
    {data && !data.connection.configured ? <section className={`${panel} p-5 lg:p-6`}><div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-300/10 text-sky-200"><Megaphone className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="text-base font-semibold text-white">Poveži Google Ads za prvi pregled</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Nakon povezivanja ovdje će se prikazivati stvarna potrošnja, kupovine i vrijednost prodaje koju Google pripiše reklamama.</p><ol className="mt-3 list-decimal space-y-1 pl-4 text-xs leading-5 text-neutral-500"><li>Omogući pristup svom Google Ads računu za čitanje podataka.</li><li>Dovrši povezivanje računa i odobrenje API pristupa.</li><li>Provjeri da kupovina šalje vrijednost i valutu u Google Ads.</li></ol><a href="#ads-settings" className="mt-4 inline-flex min-h-10 items-center gap-2 text-xs font-medium text-sky-200">Detalji povezivanja i postavke<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></a></div></div></section> : data && !report ? <Notice>Račun je konfigurisan. {busy ? "Prva sinhronizacija je u toku." : "Pokreni osvježavanje da preuzmeš prve podatke."}</Notice> : null}

    <section className={`${panel} p-4 lg:p-5`} aria-label="Period prikaza"><div className="flex flex-wrap gap-1.5">{periodOptions.map((option) => <button key={option.value} type="button" aria-pressed={kind === option.value} onClick={() => { setKind(option.value); if (option.value === "custom") { if (!from) setFrom(today()); if (!to) setTo(today()); } }} className={`min-h-11 rounded-lg border px-3 text-xs font-medium transition ${kind === option.value ? "border-sky-300/30 bg-sky-300/10 text-sky-100" : "border-white/10 text-neutral-400 hover:bg-white/[0.04]"}`}>{option.label}</button>)}</div>
      <div className="mt-3 flex flex-wrap items-end gap-3">{kind === "custom" ? <><label className="min-w-0 flex-1 text-xs text-neutral-500 sm:max-w-48">Od<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={input} /></label><label className="min-w-0 flex-1 text-xs text-neutral-500 sm:max-w-48">Do<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className={input} /></label></> : kind !== "weekend" ? <label className="w-full min-w-0 text-xs text-neutral-500 sm:max-w-52">{kind === "workday" ? "Datum završetka radnog ciklusa" : "Završni datum"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={input} /><span className="mt-1 block text-[10px]">Prazno = trenutni period</span></label> : null}<p className="text-[11px] leading-5 text-neutral-500">{kind === "workday" ? "Radni ciklus: 08:00–08:00; ponedjeljak uključuje vikend." : kind === "weekend" ? "Posljednji započeti vikend: petak 08:00 – ponedjeljak 08:00." : "Kalendarski dani, uključujući početni i završni datum."}<br />Vremenska zona: Sarajevo.</p></div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3 text-xs"><span className="text-neutral-300">{customInvalid ? "Odaberi ispravan početni i završni datum." : report?.period.label || (loading ? "Učitavanje perioda…" : "Podaci za period nisu dostupni")}</span>{report && !report.period.complete ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-200"><Clock3 className="h-3 w-3" aria-hidden="true" />Period još traje</span> : null}{loading && data ? <RefreshCw className="ml-auto h-3 w-3 animate-spin text-neutral-500" aria-label="Učitavanje" /> : null}</div>
    </section>

    <section className="grid grid-cols-2 gap-3 xl:grid-cols-3" aria-label="Rezultati odabranog perioda" aria-busy={loading && !customInvalid}>
      <Metric label="Potrošnja reklama" value={money(summary?.spendBam)} detail={summary?.spendEur == null ? "Google Ads · iznos još nije dostupan" : `${money(summary.spendEur, "€")} · 1 € = 1,95583 KM`} />
      <Metric label="Google prodaja" value={money(summary?.revenueBam)} detail={revenueDetail} />
      <Metric label="Povrat na potrošnju · ROAS" value={roas(summary?.roas)} detail={roasDetail} highlight={!fixedPurchaseValues && !valueSettingsPending && summary?.roas != null && data?.settings.targetRoas != null && summary.roas >= data.settings.targetRoas} />
      <Metric label="Kupovine" value={number(summary?.purchases)} detail={summary?.cpaBam == null ? "Google konverzije tipa kupovina" : `${money(summary.cpaBam)} po kupovini`} />
      <Metric label="Prikazi reklama" value={number(summary?.impressions)} detail="Koliko puta su se reklame prikazale" />
      <Metric label="Klikovi" value={number(summary?.clicks)} detail={`CTR ${summary?.ctr == null ? "—" : `${number(summary.ctr * 100)}%`} · CPC ${money(summary?.cpcBam)}`} />
    </section>

    <p className="px-1 text-[11px] leading-5 text-neutral-500">ROAS = Google prodaja ÷ potrošnja u istoj valuti. Primjer: 5 € potrošnje i 100 KM prodaje = 10,23×. Za profitni ROI potrebni su marža i ostali troškovi. Google prikazuje prodaju prema datumu interakcije s reklamom; konverzije mogu kasniti. Ovo nije ukupan promet prodavnice.</p>
    {report?.warnings.map((warning) => <Notice key={warning} warning>{warning}</Notice>)}
    {report ? <><Timeline timeline={report.timeline} /><Campaigns report={report} /><AdsRecommendations report={report} settings={data!.settings} stale={stale} /></> : <section className={`${panel} px-5 py-10 text-center`}><p className="text-sm text-neutral-400">{loading && !customInvalid ? "Učitavanje rezultata reklama…" : "Rezultati će se pojaviti kada podaci budu dostupni."}</p><p className="mt-2 text-xs text-neutral-600">Potrošnja, prodaja i preporuke prikazuju se iz povezanog računa.</p></section>}

    <details id="ads-settings" className={`${panel} group scroll-mt-20 p-4 lg:p-5`}><summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm font-medium text-neutral-200 [&::-webkit-details-marker]:hidden"><Settings2 className="h-4 w-4 text-neutral-500" aria-hidden="true" />Postavke i povezivanje<ChevronDown className="ml-auto h-4 w-4 text-neutral-500 transition group-open:rotate-180" aria-hidden="true" /></summary>
      {payload?.data.settings ? <SettingsForm settings={payload.data.settings} onSaved={() => setRefreshVersion((version) => version + 1)} /> : <p className="mt-4 text-xs text-neutral-500">Postavke će biti dostupne nakon učitavanja.</p>}
      {payload?.data ? <div className="mt-5 border-t border-white/10 pt-4">
        <h3 className="text-xs font-medium text-neutral-300">Status povezivanja</h3>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-neutral-500">Google Ads račun</dt><dd className="mt-1 text-neutral-300">{payload.data.account?.id || payload.data.connection.customerId || "Nije postavljen"}</dd></div>
          <div><dt className="text-neutral-500">Cilj kupovine</dt><dd className="mt-1 text-neutral-300">{payload.data.tracking ? payload.data.tracking.configured ? "Pronađen u Google Ads" : "Kupovine nisu podešene" : "Još nije provjereno"}</dd></div>
          <div><dt className="text-neutral-500">Vrijednosti kupovina</dt><dd className={`mt-1 leading-5 ${payload.data.tracking?.fixedValueActions?.length ? "text-amber-200" : "text-neutral-300"}`}>
            {payload.data.tracking?.fixedValueActions?.length ? "Fiksna vrijednost — potreban je stvarni iznos narudžbe"
              : payload.data.tracking?.valueSettingsChecked === true ? "Postavke pročitane; potvrdi iznos probnom kupovinom"
                : "Postavke vrijednosti još nisu provjerene"}
          </dd></div>
          {payload.data.account ? <><div><dt className="text-neutral-500">Valuta računa</dt><dd className="mt-1 text-neutral-300">{payload.data.account.currency}</dd></div><div><dt className="text-neutral-500">Vremenska zona računa</dt><dd className="mt-1 text-neutral-300">{payload.data.account.timeZone}</dd></div></> : null}
        </dl>
        {payload.data.tracking?.actions.length ? <p className="mt-3 break-words text-[11px] text-neutral-500">Pronađeni ciljevi kupovine: {payload.data.tracking.actions.join(", ")}</p> : null}
        {payload.data.tracking?.fixedValueActions?.length ? <p className="mt-3 text-xs leading-5 text-amber-100/85">Ciljevi s fiksnom vrijednošću: {payload.data.tracking.fixedValueActions.join(", ")}. Za svaku kupovinu treba slati stvarni iznos narudžbe i valutu te koristiti različite vrijednosti po konverziji. Potvrdi iznos probnom kupovinom. Promjena postavke ne ispravlja ranije vrijednosti konverzija; i njih treba provjeriti prije procjene historijskog ROAS-a. Dok je postavljena fiksna vrijednost, prodaja i ROAS ostaju nepoznati.</p> : null}
        {payload.data.tracking?.configured ? <p className="mt-3 text-[11px] leading-5 text-neutral-500">Postojanje cilja kupovine ne potvrđuje da se kupovine i njihovi stvarni iznosi ispravno bilježe.</p> : null}
        {payload.data.connection.missing.length ? <p className="mt-3 break-words text-[11px] leading-5 text-neutral-500">Za administratora povezivanja — nedostaje konfiguracija: {payload.data.connection.missing.join(", ")}. Pristupni podaci se postavljaju na serveru.</p> : null}
        <p className="mt-3 text-[11px] leading-5 text-neutral-500">Ovaj pregled čita rezultate reklama. Promjenu budžeta i statusa oglasa obavljaš u Google Ads računu.</p>
      </div> : null}
    </details>
  </div></main>;
}
