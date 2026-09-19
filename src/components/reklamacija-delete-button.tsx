"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { deleteReklamacijaAction } from "@/app/actions/reklamacije";

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-10 rounded-lg bg-red-300 px-3 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-red-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Brišem..." : "Potvrdi brisanje"}
    </button>
  );
}

export function ReklamacijaDeleteButton({ claimId }: { claimId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <form action={deleteReklamacijaAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="claimId" value={claimId} />
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-neutral-300 transition hover:bg-white/[0.08]"
        >
          Odustani
        </button>
        <DeleteButton />
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-300/15 bg-red-300/[0.04] text-red-200 transition hover:bg-red-300/10"
      aria-label="Obriši reklamaciju"
      title="Obriši reklamaciju"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
        <path d="M5 7h14M9 7V4.5h6V7M8 10.5v6M12 10.5v6M16 10.5v6M7 7l.75 13h8.5L17 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
