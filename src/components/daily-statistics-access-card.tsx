"use client";

import { useActionState, useState } from "react";

import { unlockDailyStatisticsAction } from "@/app/actions/statistics";

export function DailyStatisticsAccessCard({ count, dateLabel }: { count: number; dateLabel: string }) {
  const [openNonce, setOpenNonce] = useState("");
  const [unlockState, unlockAction, unlockPending] = useActionState(unlockDailyStatisticsAction, { deniedNonce: "" });
  const open = Boolean(openNonce) && unlockState.deniedNonce !== openNonce;

  return (
    <div className="rounded-[1.5rem] border border-yellow-300/20 bg-[linear-gradient(135deg,rgba(250,204,21,0.24),rgba(250,204,21,0.08))] transition hover:border-yellow-200/35 hover:bg-yellow-300/15 lg:rounded-lg">
      <button
        type="button"
        aria-label="Otvori dnevnu statistiku"
        onClick={() => setOpenNonce(crypto.randomUUID())}
        className="block w-full px-4 py-4 text-left lg:px-5"
      >
        <span className="block text-[12px] font-medium leading-4 text-neutral-200">Danas</span>
        <span className="mt-4 block text-[30px] font-semibold leading-none tracking-tight text-white">{count}</span>
        <span className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
          <span>{dateLabel || "-"}</span>
          <span>Otvori →</span>
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pristup dnevnoj statistici"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpenNonce("");
          }}
        >
          <form action={unlockAction} className="flex w-full max-w-xs gap-2 rounded-lg border border-white/10 bg-[#111214] p-3 shadow-2xl shadow-black/60">
            <input type="hidden" name="nonce" value={openNonce} />
            <input
              type="password"
              name="password"
              autoFocus
              aria-label="Šifra"
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpenNonce("");
              }}
              className="min-h-12 min-w-0 flex-1 rounded-lg border border-white/15 bg-black/35 px-3 text-base text-white outline-none focus:border-yellow-200/45"
            />
            <button type="submit" disabled={unlockPending} className="min-h-12 rounded-lg bg-yellow-200 px-5 text-sm font-semibold text-neutral-950 transition hover:bg-yellow-100 disabled:cursor-wait disabled:opacity-60">
              OK
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
