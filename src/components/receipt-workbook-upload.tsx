"use client";

import { useFormStatus } from "react-dom";

import { uploadReceiptWorkbookAction } from "@/app/actions/receipts";

function ImportButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-sky-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Uvozim..." : "Kreiraj listu"}
    </button>
  );
}

export function ReceiptWorkbookUpload() {
  return (
    <form action={uploadReceiptWorkbookAction} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
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
      <ImportButton />
    </form>
  );
}
