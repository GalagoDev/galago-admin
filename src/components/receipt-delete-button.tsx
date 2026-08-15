"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { deleteReceiptBatchAction } from "@/app/actions/receipts";

function ConfirmDeleteButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 flex-1 rounded-lg bg-red-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-red-200 disabled:cursor-wait disabled:opacity-60 sm:flex-none"
    >
      {pending ? "Brišem..." : "Potvrdi brisanje"}
    </button>
  );
}

export function ReceiptDeleteButton({ batchId }: { batchId: number }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 w-full rounded-lg border border-red-300/20 bg-red-300/[0.06] px-4 py-2.5 text-sm font-medium text-red-200 transition hover:bg-red-300/10 sm:w-auto"
      >
        Obriši listu
      </button>
    );
  }

  return (
    <form action={deleteReceiptBatchAction} className="flex w-full gap-2 sm:w-auto">
      <input type="hidden" name="batchId" value={batchId} />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="min-h-11 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/[0.08] sm:flex-none"
      >
        Odustani
      </button>
      <ConfirmDeleteButton />
    </form>
  );
}
