"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { uploadReceiptPdfsAction } from "@/app/actions/receipts";

type PairingRecipient = {
  position: number;
  recipient: string;
};

function UploadButton({ valid, replacing }: { valid: boolean; replacing: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={!valid || pending}
      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Spremam PDF..." : replacing ? "Zamijeni PDF dokumente" : "Poveži PDF dokumente"}
    </button>
  );
}

export function ReceiptPdfUpload({
  batchId,
  recipients,
  existingCount,
}: {
  batchId: number;
  recipients: PairingRecipient[];
  existingCount: number;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const collator = useMemo(() => new Intl.Collator("bs", { numeric: true, sensitivity: "base" }), []);
  const sortedFiles = useMemo(() => [...files].sort((a, b) => collator.compare(a.name, b.name)), [files, collator]);
  const valid = sortedFiles.length === recipients.length && recipients.length > 0;
  const previewCount = Math.min(sortedFiles.length, recipients.length, 8);

  return (
    <form action={uploadReceiptPdfsAction} className="mt-4">
      <input type="hidden" name="batchId" value={batchId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-sm text-neutral-300">
          <span className="mb-2 flex items-center justify-between gap-3">
            <span>PDF dokumenti</span>
            <span className={valid ? "text-emerald-200" : "text-neutral-500"}>
              Odabrano {sortedFiles.length}/{recipients.length}
            </span>
          </span>
          <input
            type="file"
            name="pdfs"
            accept="application/pdf,.pdf"
            multiple
            required
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            className="block min-h-11 w-full cursor-pointer rounded-lg border border-white/10 bg-black/20 text-sm text-neutral-400 file:mr-3 file:min-h-11 file:border-0 file:border-r file:border-white/10 file:bg-white/[0.06] file:px-4 file:text-sm file:font-medium file:text-white hover:file:bg-white/[0.1]"
          />
        </label>
        <UploadButton valid={valid} replacing={existingCount > 0} />
      </div>

      {sortedFiles.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
          {Array.from({ length: previewCount }, (_, index) => (
            <div key={`${sortedFiles[index].name}-${index}`} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b border-white/[0.06] px-3 py-2.5 text-xs last:border-b-0 sm:grid-cols-[32px_minmax(120px,0.8fr)_minmax(120px,1fr)]">
              <span className="text-neutral-600">{index + 1}</span>
              <span className="truncate font-medium text-white">{recipients[index]?.recipient ?? "Nema kupca"}</span>
              <span className="col-start-2 truncate text-neutral-500 sm:col-start-auto">{sortedFiles[index].name}</span>
            </div>
          ))}
          {sortedFiles.length > previewCount ? (
            <p className="px-3 py-2.5 text-xs text-neutral-500">Još {sortedFiles.length - previewCount} parova</p>
          ) : null}
        </div>
      ) : null}

      {sortedFiles.length > 0 && !valid ? (
        <p className="mt-3 text-sm text-amber-200">Broj PDF dokumenata mora biti tačno {recipients.length}.</p>
      ) : null}
    </form>
  );
}
