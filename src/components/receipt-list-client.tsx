"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { updateReceiptManualSendStatusAction } from "@/app/actions/receipts";

const PAGE_SIZE = 25;

export type ReceiptListRow = {
  id: number;
  position: number;
  recipient: string;
  city: string;
  amount: number | null;
  reference: string;
  phone: string;
  matchStatus: string;
  matchReason: string;
  pdfOriginalName: string;
  downloadPath: string;
  sendStatus: string;
  provider: string;
};

function formatAmount(value: number | null) {
  if (value === null) return "-";
  const [whole, decimals] = value.toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimals} KM`;
}

function statusLabel(row: ReceiptListRow) {
  if (row.sendStatus === "sent") {
    return row.provider === "manual_viber"
      ? { text: "Poslano ručno", className: "text-emerald-200" }
      : { text: "Poslano", className: "text-emerald-200" };
  }
  if (!row.phone) return { text: "Nema telefona", className: "text-amber-200" };
  if (!row.pdfOriginalName) return { text: "Čeka PDF", className: "text-neutral-500" };
  if (!row.downloadPath) return { text: "Link istekao", className: "text-amber-200" };
  if (row.sendStatus === "failed") return { text: "Greška", className: "text-red-200" };
  return { text: "Spremno", className: "text-sky-200" };
}

function ManualStatusSubmitButton({ undo = false }: { undo?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-10 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${undo ? "border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]" : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15"}`}
    >
      {pending ? "Čuvam..." : undo ? "Vrati u spremno" : "Označi poslano"}
    </button>
  );
}

export function ReceiptListClient({ rows }: { rows: ReceiptListRow[] }) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [copyResult, setCopyResult] = useState<{ id: number; kind: "phone" | "message"; success: boolean } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  function toggleViberControls(id: number) {
    setExpandedRows((current) => ({ ...current, [id]: !current[id] }));
  }

  function receiptMessage(row: ReceiptListRow) {
    const link = new URL(row.downloadPath, window.location.origin).toString();
    return `Dobar dan, ${row.recipient}.\n\nVaš PDF račun je spreman:\n${link}\n\nHvala,\nGalago`;
  }

  async function copyForViber(row: ReceiptListRow, kind: "phone" | "message") {
    try {
      const value = kind === "phone" ? `+${row.phone}` : receiptMessage(row);
      await navigator.clipboard.writeText(value);
      setCopyResult({ id: row.id, kind, success: true });
      window.open("viber://", "_self");
    } catch {
      setCopyResult({ id: row.id, kind, success: false });
    }
    window.setTimeout(() => setCopyResult((current) => current?.id === row.id ? null : current), 2200);
  }

  function viberControls(row: ReceiptListRow) {
    const manuallySent = row.sendStatus === "sent" && row.provider === "manual_viber";
    const phoneResult = copyResult?.id === row.id && copyResult.kind === "phone" ? copyResult : null;
    const messageResult = copyResult?.id === row.id && copyResult.kind === "message" ? copyResult : null;

    return (
      <div className="mt-2.5 space-y-2 rounded-lg border border-white/[0.08] bg-black/20 p-2.5">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void copyForViber(row, "phone")}
            className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-medium transition ${phoneResult && !phoneResult.success ? "border-red-300/25 bg-red-300/10 text-red-100" : "border-violet-300/20 bg-violet-300/10 text-violet-100 hover:bg-violet-300/15"}`}
          >
            {phoneResult ? (phoneResult.success ? "Broj kopiran" : "Greška") : "1. Broj + Viber"}
          </button>
          <button
            type="button"
            onClick={() => void copyForViber(row, "message")}
            className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-medium transition ${messageResult && !messageResult.success ? "border-red-300/25 bg-red-300/10 text-red-100" : "border-sky-300/20 bg-sky-300/10 text-sky-100 hover:bg-sky-300/15"}`}
          >
            {messageResult ? (messageResult.success ? "Poruka kopirana" : "Greška") : "2. Poruka + Viber"}
          </button>
        </div>
        <form action={updateReceiptManualSendStatusAction}>
          <input type="hidden" name="recipientId" value={row.id} />
          <input type="hidden" name="status" value={manuallySent ? "ready" : "sent"} />
          <ManualStatusSubmitButton undo={manuallySent} />
        </form>
      </div>
    );
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => [row.recipient, row.city, row.reference, row.phone].join(" ").toLowerCase().includes(normalized));
  }, [query, rows]);
  const visible = filtered.slice(0, visibleCount);

  return (
    <>
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder="Traži ime, mjesto, telefon ili Ref1..."
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/30 xl:max-w-xl xl:rounded-lg"
        />
        <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">Prikazano {visible.length} od {filtered.length}</p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:hidden">
        {visible.map((row) => {
          const status = statusLabel(row);
          return (
            <article key={row.id} className="rounded-[1.25rem] border border-white/8 bg-white/[0.025] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-white">{row.recipient}</p>
                  <p className="mt-1 break-words text-xs text-neutral-400">{row.city || "-"}</p>
                </div>
                <span className="shrink-0 text-xs text-neutral-600">#{row.position}</span>
              </div>
              <dl className="mt-3 grid grid-cols-[86px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-neutral-500">Iznos</dt><dd className="font-medium text-emerald-200">{formatAmount(row.amount)}</dd>
                <dt className="text-neutral-500">Ref1</dt><dd className="break-words text-neutral-300">{row.reference || "-"}</dd>
                <dt className="text-neutral-500">Telefon</dt><dd className={row.phone ? "break-all text-neutral-200" : "text-amber-200"}>{row.phone ? `+${row.phone}` : "Nije pronađen"}</dd>
                <dt className="text-neutral-500">Status</dt><dd className={status.className}>{status.text}</dd>
              </dl>
              {row.downloadPath ? (
                <>
                  <div className={`mt-3 grid gap-2 border-t border-white/[0.06] pt-3 ${row.phone ? "grid-cols-2" : "grid-cols-1"}`}>
                    {row.phone ? (
                      <button
                        type="button"
                        aria-expanded={Boolean(expandedRows[row.id])}
                        onClick={() => toggleViberControls(row.id)}
                        className="min-h-11 rounded-lg border border-violet-300/20 bg-violet-300/10 px-3 text-xs font-semibold text-violet-100 transition hover:bg-violet-300/15"
                      >
                        {expandedRows[row.id] ? "Zatvori Viber" : "Viber"}
                      </button>
                    ) : null}
                    <a
                      href={row.downloadPath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-300 px-3 text-xs font-semibold text-neutral-950 transition hover:bg-sky-200"
                    >
                      Otvori PDF
                    </a>
                  </div>
                  {row.phone && expandedRows[row.id] ? viberControls(row) : null}
                </>
              ) : null}
            </article>
          );
        })}
      </div>

      {visible.length > 0 ? (
        <div className="hidden overflow-hidden rounded-lg border border-white/10 xl:block" role="table" aria-label="Lista računa">
          <div className="grid grid-cols-[44px_minmax(150px,1.2fr)_minmax(110px,.85fr)_105px_minmax(130px,1fr)_130px_190px] gap-3 border-b border-white/10 bg-white/[0.04] px-3 py-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-500" role="row">
            <span>#</span><span>Primalac</span><span>Primaoc mjesto</span><span>Iznos otk.</span><span>Ref1</span><span>Telefon</span><span>Status / račun</span>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {visible.map((row) => {
              const status = statusLabel(row);
              return (
                <div key={row.id} className="grid grid-cols-[44px_minmax(150px,1.2fr)_minmax(110px,.85fr)_105px_minmax(130px,1fr)_130px_190px] items-start gap-3 px-3 py-3 text-sm transition hover:bg-white/[0.025]" role="row">
                  <span className="text-xs text-neutral-600">{row.position}</span>
                  <span className="break-words font-semibold text-white">{row.recipient}</span>
                  <span className="break-words text-neutral-300">{row.city || "-"}</span>
                  <span className="font-medium text-emerald-200">{formatAmount(row.amount)}</span>
                  <span className="break-words text-neutral-300">{row.reference || "-"}</span>
                  <span className={row.phone ? "break-all text-neutral-200" : "text-amber-200"}>{row.phone ? `+${row.phone}` : "Nije pronađen"}</span>
                  <div className="min-w-0">
                    <span className={`block text-xs ${status.className}`} title={row.matchReason}>{status.text}</span>
                    {row.downloadPath ? (
                      <div className="mt-2">
                        <div className={`grid gap-2 ${row.phone ? "grid-cols-2" : "grid-cols-1"}`}>
                          {row.phone ? (
                            <button
                              type="button"
                              aria-expanded={Boolean(expandedRows[row.id])}
                              onClick={() => toggleViberControls(row.id)}
                              className="min-h-10 rounded-lg border border-violet-300/20 bg-violet-300/10 px-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-300/15"
                            >
                              {expandedRows[row.id] ? "Zatvori" : "Viber"}
                            </button>
                          ) : null}
                          <a
                            href={row.downloadPath}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-sky-300 px-3 text-xs font-semibold text-neutral-950 transition hover:bg-sky-200"
                          >
                            Otvori
                          </a>
                        </div>
                        {row.phone && expandedRows[row.id] ? viberControls(row) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-neutral-500">Nema kupaca za ovaj prikaz.</div>
      )}

      {visibleCount < filtered.length ? (
        <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08] xl:rounded-lg">
          Učitaj još ({Math.min(PAGE_SIZE, filtered.length - visibleCount)})
        </button>
      ) : null}
    </>
  );
}
