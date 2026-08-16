import Link from "next/link";

import {
  AddContainerForm,
  ContainerActions,
  RefreshAllContainersButton,
} from "@/components/container-controls";
import {
  getContainerStats,
  getTrackedContainers,
  isContainerTrackingConfigured,
  type TrackedContainer,
} from "@/lib/containers";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Params = {
  q?: string;
  error?: string;
  added?: string;
  duplicate?: string;
  number?: string;
  tracking?: string;
  refreshed?: string;
  removed?: string;
  checked?: string;
  updated?: string;
  failed?: string;
};

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" strokeLinecap="round" />
    </svg>
  );
}

function formatDateTime(value: string, includeTime = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("bs-BA", {
    timeZone: "Europe/Sarajevo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function statusPresentation(container: TrackedContainer) {
  if (container.trackingStatus === "arrived") {
    return { label: container.statusLabel || "Stigao", className: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" };
  }
  if (container.trackingStatus === "tracking") {
    return { label: container.statusLabel || "Na putu", className: "border-sky-300/20 bg-sky-300/10 text-sky-100" };
  }
  if (container.trackingStatus === "error") {
    return { label: "Provjeriti", className: "border-red-300/20 bg-red-300/10 text-red-100" };
  }
  if (container.trackingStatus === "not_configured") {
    return { label: "Čeka API", className: "border-amber-300/20 bg-amber-300/10 text-amber-100" };
  }
  return { label: "Čeka podatke", className: "border-white/10 bg-white/[0.05] text-neutral-300" };
}

function isRijeka(value: string) {
  return !value || /rijeka|hrrjk/i.test(value);
}

function getNotice(params: Params) {
  const errors: Record<string, string> = {
    "invalid-number": "Broj kontejnera nije ispravan. Potrebna su 4 slova i 7 brojeva sa ispravnom kontrolnom cifrom.",
    "not-found": "Kontejner nije pronađen.",
    "not-configured": "Automatsko praćenje čeka ShipsGo API ključ.",
    "tracking-failed": "Zadnje poznate informacije su sačuvane, ali novo osvježenje trenutno nije uspjelo.",
    "provider-error": "Servis za praćenje trenutno nije prihvatio zahtjev.",
    "provider-response": "Servis za praćenje nije vratio očekivane podatke.",
    "action-failed": "Radnja nije završena. Pokušajte ponovo.",
  };
  if (params.error) return { tone: "error", text: errors[params.error] || errors["action-failed"] };
  if (params.removed) return { tone: "success", text: "Kontejner je uklonjen iz panela." };
  if (params.duplicate) return { tone: "neutral", text: `${params.number || "Kontejner"} je već na listi.` };
  if (params.added) {
    return {
      tone: params.tracking ? "neutral" : "success",
      text: params.tracking
        ? `${params.number || "Kontejner"} je dodat. Praćenje će se ponovo pokušati pri sljedećem osvježenju.`
        : `${params.number || "Kontejner"} je dodat.`,
    };
  }
  if (params.refreshed) return { tone: "success", text: "Podaci kontejnera su osvježeni." };
  if (params.checked) {
    return {
      tone: Number(params.failed || 0) > 0 ? "neutral" : "success",
      text: `Provjereno ${params.checked}, osvježeno ${params.updated || 0}, bez novih podataka ${params.failed || 0}.`,
    };
  }
  return null;
}

function ContainerCard({ container, trackingConfigured }: { container: TrackedContainer; trackingConfigured: boolean }) {
  const status = statusPresentation(container);
  const wrongDestination = !isRijeka(container.reportedDestinationPort);
  const rijekaEta = wrongDestination ? "" : container.eta;

  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-4 lg:rounded-lg lg:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="break-all font-mono text-lg font-semibold tracking-[0.08em] text-white sm:text-xl">
              {container.containerNumber}
            </h2>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${status.className}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {container.carrierName || container.carrierCode} · {container.destinationPort} ({container.destinationUnlocode})
          </p>
        </div>
        <ContainerActions containerId={container.id} />
      </div>

      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-white/8 bg-white/8 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-h-24 bg-[#0d0e10] p-4">
          <p className="text-xs text-neutral-500">ETA Rijeka</p>
          <p className="mt-3 text-xl font-semibold text-white">{formatDateTime(rijekaEta)}</p>
          {container.delayDays !== null ? (
            <p className={`mt-1 text-xs ${container.delayDays > 0 ? "text-amber-200" : "text-emerald-200"}`}>
              {container.delayDays > 0 ? `Kašnjenje ${container.delayDays} dana` : "Prema planu"}
            </p>
          ) : null}
        </div>
        <div className="min-h-24 bg-[#0d0e10] p-4">
          <p className="text-xs text-neutral-500">Ruta</p>
          <p className="mt-3 break-words text-sm font-medium text-white">{container.departurePort || "Polazište čeka podatke"}</p>
          <p className="mt-1 text-xs text-neutral-500">do Rijeke</p>
        </div>
        <div className="min-h-24 bg-[#0d0e10] p-4">
          <p className="text-xs text-neutral-500">Brod / putovanje</p>
          <p className="mt-3 break-words text-sm font-medium text-white">{container.vesselName || "-"}</p>
          <p className="mt-1 text-xs text-neutral-500">{container.voyageNumber || "Broj još nije dostupan"}</p>
        </div>
        <div className="min-h-24 bg-[#0d0e10] p-4">
          <p className="text-xs text-neutral-500">Zadnja lokacija</p>
          <p className="mt-3 break-words text-sm font-medium text-white">{container.lastLocation || "-"}</p>
          <p className="mt-1 text-xs text-neutral-500">Provjera {formatDateTime(container.lastCheckedAt, true)}</p>
        </div>
      </div>

      {wrongDestination ? (
        <p className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2.5 text-xs text-amber-100">
          Provider trenutno prijavljuje odredište {container.reportedDestinationPort}, a ovaj panel prati dolazak u Rijeku.
        </p>
      ) : null}

      {trackingConfigured && container.lastError ? (
        <p className="mt-3 rounded-lg border border-red-300/15 bg-red-300/[0.05] px-3 py-2.5 text-xs text-red-100">
          {container.lastError}
        </p>
      ) : null}

      {container.updates.length > 0 ? (
        <details className="mt-4 border-t border-white/8 pt-3">
          <summary className="cursor-pointer select-none text-sm font-medium text-neutral-300">
            Historija ažuriranja ({container.updates.length})
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            {container.updates.map((update) => (
              <div key={update.id} className="grid gap-1 rounded-lg bg-black/20 px-3 py-2.5 text-xs sm:grid-cols-[150px_1fr_auto] sm:items-center sm:gap-3">
                <span className="text-neutral-500">{formatDateTime(update.providerUpdatedAt || update.createdAt, true)}</span>
                <span className="break-words text-neutral-200">{update.statusLabel || update.location || "Novi podaci"}</span>
                <span className="text-neutral-400">ETA {formatDateTime(update.eta)}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

export default async function ContainersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = String(params.q || "").trim();
  const containers = getTrackedContainers(query);
  const stats = getContainerStats();
  const trackingConfigured = isContainerTrackingConfigured();
  const notice = getNotice(params);

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <p className="mt-2 text-lg font-semibold text-white">Kontejneri</p>
              <p className="mt-1 text-sm text-neutral-400">Kontejneri na putu prema Rijeci</p>
            </div>
            <Link href="/" aria-label="Nazad na pregled" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]">
              <ArrowIcon />
            </Link>
          </div>
        </section>

        {notice ? (
          <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : notice.tone === "error" ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-sky-300/15 bg-sky-300/[0.06] text-sky-100"}`}>
            {notice.text}
          </div>
        ) : null}

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
          <p className="text-lg font-semibold text-white">Dodaj kontejner</p>
          <p className="mt-1 text-sm text-neutral-500">Odredište je uvijek luka Rijeka</p>
          <AddContainerForm />
        </section>

        {!trackingConfigured ? (
          <section className="mt-5 rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-4 py-3">
            <p className="text-sm font-medium text-amber-100">Automatsko praćenje čeka povezivanje</p>
            <p className="mt-1 text-xs text-neutral-400">Kontejneri se mogu dodavati odmah; ETA će se pojaviti nakon dodavanja ShipsGo API ključa.</p>
          </section>
        ) : null}

        <section className="mt-5 grid grid-cols-3 gap-3">
          {[
            ["Na putu", stats.active],
            ["Sljedeći ETA", stats.nextEta ? formatDateTime(stats.nextEta) : "-"],
            ["Kašnjenje", stats.delayed],
          ].map(([label, value]) => (
            <article key={label} className="min-w-0 rounded-[1.25rem] border border-white/10 bg-white/[0.035] px-3 py-4 lg:rounded-lg lg:px-4">
              <p className="text-[11px] text-neutral-500 sm:text-xs">{label}</p>
              <p className="mt-3 break-words text-lg font-semibold text-white sm:text-xl">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <form method="get" className="flex min-w-0 flex-1 gap-2 lg:max-w-xl">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Pretraži kontejnere</span>
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-500"><SearchIcon /></span>
                <input
                  name="q"
                  defaultValue={query}
                  type="search"
                  placeholder="Broj kontejnera, prevoznik ili brod"
                  className="min-h-11 w-full rounded-lg border border-white/10 bg-[#111214] py-2.5 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-sky-300/35"
                />
              </label>
              <button type="submit" className="min-h-11 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-white/[0.08]">
                Traži
              </button>
            </form>
            {trackingConfigured && stats.total > 0 ? <RefreshAllContainersButton /> : null}
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {containers.length > 0 ? (
              containers.map((container) => <ContainerCard key={container.id} container={container} trackingConfigured={trackingConfigured} />)
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 py-10 text-center text-sm text-neutral-500">
                {query ? "Nema kontejnera za ovu pretragu." : "Još nema kontejnera na listi."}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
