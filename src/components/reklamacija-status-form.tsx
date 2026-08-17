"use client";

import { useFormStatus } from "react-dom";

import { updateReklamacijaStatusAction } from "@/app/actions/reklamacije";

const options = [
  ["new", "Nova"],
  ["in_review", "U obradi"],
  ["approved", "Odobrena"],
  ["rejected", "Odbijena"],
  ["resolved", "Završena"],
] as const;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg bg-sky-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-sky-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Čuvam..." : "Sačuvaj"}
    </button>
  );
}

export function ReklamacijaStatusForm({ claimId, status }: { claimId: string; status: string }) {
  return (
    <form action={updateReklamacijaStatusAction} className="flex w-full gap-2 sm:w-auto">
      <input type="hidden" name="claimId" value={claimId} />
      <label className="min-w-0 flex-1 sm:w-40 sm:flex-none">
        <span className="sr-only">Status reklamacije</span>
        <select
          name="status"
          defaultValue={status}
          className="min-h-11 w-full rounded-lg border border-white/10 bg-[#09090b] px-3 py-2.5 text-sm text-white outline-none focus:border-sky-300/35"
        >
          {options.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <SaveButton />
    </form>
  );
}
