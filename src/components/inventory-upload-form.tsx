"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { uploadInventoryAction } from "@/app/actions/statistics";

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg bg-sky-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-sky-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Uvozim..." : "Uvezi lager"}
    </button>
  );
}

export function InventoryUploadForm({ date }: { date: string }) {
  const [fileName, setFileName] = useState("");
  return (
    <form action={uploadInventoryAction} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <input type="hidden" name="date" value={date} />
      <label className="block min-w-0">
        <span className="mb-2 block text-xs font-medium text-neutral-400">Lager dokument</span>
        <span className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-2 transition hover:border-sky-300/30">
          <span className="shrink-0 rounded-md bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-neutral-200">Odaberi fajl</span>
          <span className="min-w-0 truncate text-xs text-neutral-500">{fileName || "XLS, XLSX ili CSV"}</span>
        </span>
        <input
          type="file"
          name="inventory"
          accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          required
          className="sr-only"
          onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}
        />
      </label>
      <UploadButton />
    </form>
  );
}
