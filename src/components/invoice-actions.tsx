"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { deleteInvoiceAction, setInvoicePaidAction } from "@/app/actions/invoices";

function StatusButton({ paid }: { paid: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
        paid
          ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-100 hover:bg-amber-300/10"
          : "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100 hover:bg-emerald-300/12"
      }`}
    >
      {pending ? "Čuvam..." : paid ? "Vrati na neplaćeno" : "Označi plaćeno"}
    </button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg bg-red-300 px-3 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-red-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Brišem..." : "Potvrdi"}
    </button>
  );
}

export function InvoiceActions({ invoiceId, paid }: { invoiceId: number; paid: boolean }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
      <form action={setInvoicePaidAction}>
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="paid" value={paid ? "0" : "1"} />
        <StatusButton paid={paid} />
      </form>

      {confirming ? (
        <form action={deleteInvoiceAction} className="flex gap-2">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-11 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-neutral-300 transition hover:bg-white/[0.08]"
          >
            Odustani
          </button>
          <DeleteButton />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-red-300/15 bg-red-300/[0.04] text-red-200 transition hover:bg-red-300/10"
          aria-label="Obriši fakturu"
          title="Obriši fakturu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
            <path d="M5 7h14M9 7V4.5h6V7M8 10.5v6M12 10.5v6M16 10.5v6M7 7l.75 13h8.5L17 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
