"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  applyDeliveredMatchesAction,
  previewDeliveryWorkbookAction,
  type DeliveryPreviewState,
} from "@/app/actions/delivery";

const INITIAL_STATE: DeliveryPreviewState = {
  status: "idle",
  fileName: "",
  totalRows: 0,
  matches: [],
  ambiguous: [],
  unmatched: [],
  error: "",
};

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M12 15V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 14v4.25A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V14" strokeLinecap="round" />
    </svg>
  );
}

function PreviewButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-sky-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-sky-200 disabled:cursor-wait disabled:opacity-60"
    >
      <UploadIcon />
      {pending ? "Čitam dokument..." : "Provjeri dokument"}
    </button>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Premještam..." : "Potvrdi dostavljene"}
    </button>
  );
}

export function DeliveryReconciliation() {
  const [state, action] = useActionState(previewDeliveryWorkbookAction, INITIAL_STATE);

  return (
    <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
      <div>
        <p className="text-lg font-semibold text-white">Uvezi dostavljene</p>
        <p className="mt-1 text-sm text-neutral-500">Excel izvještaj kurirske službe</p>
      </div>

      <form action={action} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-sm text-neutral-300">
          <span className="mb-2 block">Excel dokument</span>
          <input
            type="file"
            name="workbook"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="block min-h-11 w-full cursor-pointer rounded-lg border border-white/10 bg-black/20 text-sm text-neutral-400 file:mr-3 file:min-h-11 file:border-0 file:border-r file:border-white/10 file:bg-white/[0.06] file:px-4 file:text-sm file:font-medium file:text-white hover:file:bg-white/[0.1]"
          />
        </label>
        <PreviewButton />
      </form>

      {state.status === "error" ? (
        <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {state.error}
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="mt-5 border-t border-white/10 pt-5">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-white/[0.04] px-3 py-3">
              <p className="text-2xl font-semibold text-white">{state.matches.length}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-emerald-200">Pronađeno</p>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-3 py-3">
              <p className="text-2xl font-semibold text-white">{state.unmatched.length}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-neutral-500">Bez para</p>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-3 py-3">
              <p className="text-2xl font-semibold text-white">{state.ambiguous.length}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-yellow-200">Nejasno</p>
            </div>
          </div>

          {state.matches.length > 0 ? (
            <form action={applyDeliveredMatchesAction} className="mt-4">
              <div className="max-h-80 overflow-y-auto rounded-lg border border-white/10">
                {state.matches.map((match) => (
                  <label
                    key={`${match.source.sourceRowNumber}-${match.order.sheetRowNumber}`}
                    className="flex cursor-pointer items-start gap-3 border-b border-white/[0.06] px-3 py-3 last:border-b-0 hover:bg-white/[0.025]"
                  >
                    <input
                      type="checkbox"
                      name="matches"
                      defaultChecked
                      value={JSON.stringify({
                        sheetRowNumber: match.order.sheetRowNumber,
                        fingerprint: match.order.fingerprint,
                        dateLabel: match.order.dateLabel,
                      })}
                      className="mt-1 h-5 w-5 shrink-0 accent-emerald-300"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold text-white">{match.order.primalac}</span>
                      <span className="mt-1 block break-words text-xs text-neutral-400">
                        {match.order.artikal || match.source.product || "Bez artikla"}
                      </span>
                      <span className="mt-1 block text-[11px] text-neutral-500">
                        {match.source.city || "-"} · {match.source.amount ?? "-"} KM · {match.reason}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-neutral-500">Označene narudžbe će biti arhivirane i uklonjene iz Na dostavi.</p>
                <ConfirmButton />
              </div>
            </form>
          ) : null}

          {state.unmatched.length > 0 || state.ambiguous.length > 0 ? (
            <details className="mt-4 rounded-lg border border-yellow-300/15 bg-yellow-300/[0.05] px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-yellow-100">Kupci koji nisu automatski označeni</summary>
              <div className="mt-3 space-y-2 text-sm text-neutral-400">
                {state.unmatched.map((name, index) => <p key={`unmatched-${index}`}>{name} · nije pronađen</p>)}
                {state.ambiguous.map((entry, index) => (
                  <p key={`ambiguous-${index}`}>{entry.recipient} · više mogućih rezultata: {entry.candidates.join(", ")}</p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
