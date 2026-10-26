import Image from "next/image";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { getClaimIncoming, getClaimReplies } from "@/lib/claim-messaging-store";

import { ReklamacijaDeleteButton } from "@/components/reklamacija-delete-button";
import { ReklamacijaStatusForm } from "@/components/reklamacija-status-form";
import {
  getCustomerReturnClaims,
  getCustomerReturnClaimStats,
  type CustomerReturnClaim,
} from "@/lib/reklamacije";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Params = {
  q?: string;
  updated?: string;
  deleted?: string;
  error?: string;
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

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M7 3.5h8l3 3V20.5H7V3.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3.5v3h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDateTime(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("bs-BA", {
    timeZone: "Europe/Sarajevo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusPresentation(status: string) {
  const statuses: Record<string, { label: string; className: string }> = {
    new: { label: "Nova", className: "border-amber-300/20 bg-amber-300/10 text-amber-100" },
    in_review: { label: "U obradi", className: "border-sky-300/20 bg-sky-300/10 text-sky-100" },
    approved: { label: "Odobrena", className: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" },
    rejected: { label: "Odbijena", className: "border-red-300/20 bg-red-300/10 text-red-100" },
    resolved: { label: "Završena", className: "border-white/10 bg-white/[0.06] text-neutral-300" },
  };
  return statuses[status] || { label: status || "Nepoznat", className: "border-white/10 bg-white/[0.06] text-neutral-300" };
}

function ClaimCard({ claim }: { claim: CustomerReturnClaim }) {
  const status = statusPresentation(claim.status);
  const replies = getClaimReplies(claim.id);
  const incoming = getClaimIncoming(claim.id);
  const replyLabels: Record<string, string> = { queued: "Na čekanju", sending: "Šalje se", sent: "Poslano", failed: "Nije poslano", unknown: "Provjeriti u Gmailu" };

  return (
    <details className="group rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] lg:rounded-lg">
      <summary className="flex min-h-24 cursor-pointer list-none items-center justify-between gap-4 p-4 transition hover:bg-white/[0.025] [&::-webkit-details-marker]:hidden lg:min-h-20 lg:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="break-words font-mono text-sm font-semibold text-white sm:text-base">{claim.reference}</h2>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${status.className}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-400">{claim.requestType}</p>
          <p className="mt-2 break-words text-xs text-neutral-500">
            <span className="font-medium text-neutral-300">{claim.customerName || "Bez imena"}</span>
            <span className="mx-2 text-neutral-700">·</span>
            {claim.phone || "Bez telefona"}
            <span className="mx-2 text-neutral-700">·</span>
            {formatDateTime(claim.createdAt)}
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-400 transition group-open:rotate-180 group-open:text-white">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
            <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>

      <div className="border-t border-white/8 px-4 pb-4 pt-4 lg:px-5 lg:pb-5">
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <ReklamacijaStatusForm claimId={claim.id} status={claim.status} />
          <ReklamacijaDeleteButton claimId={claim.id} />
        </div>

        <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-white/8 bg-white/8 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-h-24 bg-[#0d0e10] p-4">
          <p className="text-xs text-neutral-500">Kupac</p>
          <p className="mt-3 break-words text-sm font-medium text-white">{claim.customerName || "-"}</p>
          <p className="mt-1 break-words text-xs text-neutral-500">{claim.city || "-"}</p>
        </div>
        <div className="min-h-24 bg-[#0d0e10] p-4">
          <p className="text-xs text-neutral-500">Narudžba</p>
          <p className="mt-3 break-words text-sm font-medium text-white">{claim.orderNumber || "-"}</p>
        </div>
        <div className="min-h-24 bg-[#0d0e10] p-4">
          <p className="text-xs text-neutral-500">Telefon</p>
          <a href={`tel:${claim.phone.replace(/[^\d+]/g, "")}`} className="mt-3 block break-words text-sm font-medium text-sky-200 hover:text-sky-100">
            {claim.phone || "-"}
          </a>
        </div>
        <div className="min-h-24 bg-[#0d0e10] p-4">
          <p className="text-xs text-neutral-500">Email</p>
          <a href={`mailto:${claim.email}`} className="mt-3 block break-all text-sm font-medium text-sky-200 hover:text-sky-100">
            {claim.email || "-"}
          </a>
        </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        <div>
          <p className="text-xs text-neutral-500">Adresa</p>
          <p className="mt-2 break-words text-sm leading-6 text-neutral-200">{[claim.address, claim.city].filter(Boolean).join(", ") || "-"}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Opis zahtjeva</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-200">{claim.description || "-"}</p>
        </div>
        </div>

        {claim.companyName || claim.companyIdNumber || claim.companyVatNumber || claim.companyAddress ? (
          <div className="mt-4 rounded-lg border border-orange-300/15 bg-orange-300/[0.06] p-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-orange-200">Podaci pravnog lica</p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-neutral-500">Naziv firme</dt>
              <dd className="mt-1 break-words text-neutral-100">{claim.companyName || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">ID broj / JIB</dt>
              <dd className="mt-1 break-words text-neutral-100">{claim.companyIdNumber || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">PDV broj</dt>
              <dd className="mt-1 break-words text-neutral-100">{claim.companyVatNumber || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Adresa firme</dt>
              <dd className="mt-1 break-words text-neutral-100">{claim.companyAddress || "-"}</dd>
            </div>
          </dl>
          </div>
        ) : null}

        {incoming.length > 0 && <section className="mt-5 border-t border-white/10 pt-4">
          <h3 className="text-sm font-medium">Odgovori kupca</h3>
          <ol className="mt-3 divide-y divide-white/10">{incoming.map(reply => <li key={reply.gmail_id} className="py-3">
            <p className="break-all text-xs text-sky-200">{reply.sender} · {formatDateTime(reply.received_at)}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-200">{reply.body || "Email bez tekstualnog sadržaja."}</p>
            {!!reply.attachment_count && <p className="mt-2 text-xs text-neutral-400">Prilozi u Gmailu: {reply.attachment_count}</p>}
          </li>)}</ol>
        </section>}
        {replies.length > 0 && <section className="mt-5 border-t border-white/10 pt-4">
          <h3 className="text-sm font-medium">Email odgovori</h3>
          <ol className="mt-3 divide-y divide-white/10">
            {replies.map((reply) => <li key={reply.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="break-all text-neutral-400">{reply.sender_name} · {formatDateTime(reply.sent_at || reply.created_at)} · {reply.recipient}</span>
                <span className={reply.status === "sent" ? "text-emerald-300" : "text-amber-200"}>{replyLabels[reply.status] || reply.status}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-200">{reply.body}</p>
              {reply.last_error && <p className="mt-2 text-xs text-red-300">{reply.last_error}</p>}
            </li>)}
          </ol>
        </section>}
        {claim.files.length > 0 ? (
          <div className="mt-5 border-t border-white/8 pt-4">
          <p className="mb-3 text-xs text-neutral-500">Prilozi ({claim.files.length})</p>
          <div className="flex flex-wrap gap-3">
            {claim.files.map((file) => {
              const href = `/reklamacije/files/${encodeURIComponent(file.id)}`;
              const isImage = file.mimeType.startsWith("image/");
              return (
                <Link
                  key={file.id}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-20 w-full items-center gap-3 overflow-hidden rounded-lg border border-white/10 bg-black/20 p-2 transition hover:bg-white/[0.05] sm:w-72"
                >
                  {isImage ? (
                    <Image src={href} alt="Prilog reklamacije" width={72} height={72} unoptimized className="h-16 w-16 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-neutral-400"><FileIcon /></span>
                  )}
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-neutral-200">{file.originalName}</span>
                    <span className="mt-1 block text-xs text-neutral-500">{formatFileSize(file.sizeBytes)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default async function ReklamacijePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = String(params.q || "").trim();
  const claims = getCustomerReturnClaims(query);
  const stats = getCustomerReturnClaimStats();
  const notice = params.updated
    ? { tone: "success", text: "Status reklamacije je ažuriran." }
    : params.deleted
      ? { tone: "success", text: "Reklamacija i njeni prilozi su obrisani." }
    : params.error
      ? { tone: "error", text: params.error === "not-found" ? "Reklamacija nije pronađena." : "Promjena nije sačuvana." }
      : null;

  return (
    <main className="min-h-screen bg-[#09090b] text-neutral-50 lg:pl-60">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-4 sm:max-w-lg sm:px-5 lg:max-w-[1480px] lg:px-8 lg:pt-8 2xl:px-10">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:rounded-lg lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-neutral-500">Galago control panel</p>
              <p className="mt-2 text-lg font-semibold text-white">Reklamacije</p>
              <p className="mt-1 text-sm text-neutral-400">Podrška, reklamacije i zahtjevi za pravna lica</p>
              <Link href="/reklamacije/povezivanje" className="mt-3 inline-flex items-center gap-2 text-sm text-sky-200 hover:text-sky-100"><Settings2 size={16} /> Telegram i Gmail</Link>
            </div>
            <Link href="/" aria-label="Nazad na pregled" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-neutral-300 transition hover:bg-white/[0.08]">
              <ArrowIcon />
            </Link>
          </div>
        </section>

        {notice ? (
          <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-red-300/20 bg-red-300/10 text-red-100"}`}>
            {notice.text}
          </div>
        ) : null}

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Ukupno", stats.total],
            ["Nove", stats.new],
            ["U obradi", stats.inReview],
            ["Zatvorene", stats.closed],
          ].map(([label, value]) => (
            <article key={label} className="rounded-[1.25rem] border border-white/10 bg-white/[0.035] px-4 py-4 lg:rounded-lg">
              <p className="text-xs text-neutral-500">{label}</p>
              <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-5">
          <form method="get" className="flex gap-2 lg:max-w-xl">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Pretraži zahtjeve</span>
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-500"><SearchIcon /></span>
              <input
                name="q"
                defaultValue={query}
                type="search"
                placeholder="Kupac, firma, telefon ili referenca"
                className="min-h-11 w-full rounded-lg border border-white/10 bg-[#111214] py-2.5 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-sky-300/35"
              />
            </label>
            <button type="submit" className="min-h-11 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-white/[0.08]">
              Traži
            </button>
          </form>

          <div className="mt-4 flex flex-col gap-3">
            {claims.length > 0 ? (
              claims.map((claim) => <ClaimCard key={claim.id} claim={claim} />)
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 py-10 text-center text-sm text-neutral-500">
                {query ? "Nema zahtjeva za ovu pretragu." : "Još nema zaprimljenih zahtjeva."}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
