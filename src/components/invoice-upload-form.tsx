"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { uploadInvoiceAction } from "@/app/actions/invoices";

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg bg-sky-300 px-5 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-sky-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Dodajem..." : "Dodaj fakturu"}
    </button>
  );
}

export function InvoiceUploadForm({ defaultMonth }: { defaultMonth: string }) {
  const [fileName, setFileName] = useState("");

  return (
    <form action={uploadInvoiceAction} className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.35fr_0.75fr_auto] lg:items-end">
      <label className="block min-w-0">
        <span className="mb-2 block text-xs font-medium text-neutral-400">Mjesec</span>
        <input
          type="month"
          name="month"
          defaultValue={defaultMonth}
          required
          className="min-h-11 w-full rounded-lg border border-white/10 bg-[#09090b] px-3 py-2.5 text-sm text-white [color-scheme:dark] outline-none transition focus:border-sky-300/40"
        />
      </label>
      <label className="block min-w-0">
        <span className="mb-2 block text-xs font-medium text-neutral-400">Dobavljač ili naziv</span>
        <input
          type="text"
          name="title"
          maxLength={160}
          placeholder="Npr. BH Telecom"
          className="min-h-11 w-full rounded-lg border border-white/10 bg-[#09090b] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-sky-300/40"
        />
      </label>
      <label className="block min-w-0">
        <span className="mb-2 block text-xs font-medium text-neutral-400">Iznos (KM)</span>
        <input
          type="text"
          name="amount"
          inputMode="decimal"
          placeholder="0,00"
          className="min-h-11 w-full rounded-lg border border-white/10 bg-[#09090b] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-sky-300/40"
        />
      </label>
      <UploadButton />

      <label className="block min-w-0 lg:col-span-4">
        <span className="mb-2 block text-xs font-medium text-neutral-400">Dokument</span>
        <span className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-white/15 bg-white/[0.025] px-3 py-2.5 transition hover:border-sky-300/30 hover:bg-white/[0.04]">
          <span className="shrink-0 rounded-md bg-white/[0.07] px-3 py-2 text-xs font-medium text-neutral-200">Odaberi fajl</span>
          <span className="min-w-0 truncate text-xs text-neutral-500">{fileName || "PDF ili slika, do 10 MB"}</span>
        </span>
        <input
          type="file"
          name="document"
          accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
          required
          className="sr-only"
          onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}
        />
      </label>
    </form>
  );
}
