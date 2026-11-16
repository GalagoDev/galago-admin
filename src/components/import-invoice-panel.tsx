"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Clock3, FileText, LoaderCircle, Save, Upload, X } from "lucide-react";
import type { ImportCommand } from "@/app/actions/imports";
import { formatImportMoney, importInvoiceProgress, importSuppliers, type ImportCurrency, type ImportInvoice, type ImportInvoiceDraft, type ImportsOverview, type ImportSupplier } from "@/lib/import-payments-types";

const inputClass = "min-h-11 w-full min-w-0 rounded-md border border-white/15 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-sky-300 focus:outline-none";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40";

export function ImportInvoiceProgress({ invoice, data }: { invoice: ImportInvoice; data: ImportsOverview }) {
  const progress = importInvoiceProgress(invoice, data);
  const overpaid = progress.overpaidMinor > 0;
  const paid = progress.remainingMinor === 0 && !overpaid;
  const StatusIcon = overpaid ? AlertCircle : paid ? CheckCircle2 : progress.paidMinor > 0 ? Clock3 : Circle;
  const status = overpaid ? "Preplaćeno" : paid ? "Plaćeno u cijelosti" : progress.paidMinor > 0 ? "Djelimično plaćeno" : "Nije plaćeno";
  const statusColor = overpaid ? "text-amber-300" : paid ? "text-emerald-300" : "text-sky-200";
  const percent = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(progress.percent);
  const metrics = [
    { label: "Iznos fakture", amount: invoice.totalMinor, color: "text-neutral-100" },
    { label: "Uplaćeno", amount: progress.paidMinor, color: "text-neutral-100" },
    { label: overpaid ? "Preplaćeno" : "Preostalo za uplatu", amount: overpaid ? progress.overpaidMinor : progress.remainingMinor, color: overpaid ? "text-amber-300" : paid ? "text-emerald-300" : "text-sky-200" },
  ];
  return <div className="w-full min-w-0 border-t border-white/10 pt-4">
    <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-3">
      {metrics.map(metric => <div key={metric.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 sm:block">
        <dt className="text-xs text-neutral-400">{metric.label}</dt>
        <dd className={`min-w-0 break-words text-lg font-semibold tabular-nums [overflow-wrap:anywhere] sm:mt-1 sm:text-xl ${metric.color}`}>{formatImportMoney(metric.amount, invoice.currency)}</dd>
      </div>)}
    </dl>
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusColor}`}><StatusIcon size={15} className="shrink-0" />{status}</span>
      <div role="progressbar" aria-label="Plaćenost fakture" aria-valuenow={Math.min(100, progress.percent)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${percent}%`} className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-white/10"><div style={{ width: `${Math.min(100, progress.percent)}%` }} className={`h-full transition-[width] ${overpaid ? "bg-amber-400" : paid ? "bg-emerald-400" : "bg-sky-400"}`} /></div>
      <span className={`text-xs font-medium tabular-nums ${statusColor}`}>{percent}%</span>
    </div>
    {progress.excluded > 0 && <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-200"><AlertCircle size={14} className="shrink-0" />Uplate koje nisu uračunate u fakturu: {progress.excluded}</p>}
  </div>;
}

export function ImportInvoiceEditor({ containerId, invoice, run, pending, close }: {
  containerId: string; invoice?: ImportInvoice; run: (command: ImportCommand) => Promise<boolean>; pending: boolean; close: () => void;
}) {
  const [draft, setDraft] = useState<ImportInvoiceDraft | null>(invoice || null);
  const [uploading, setUploading] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState(false);
  async function upload(file: File | undefined) {
    if (!file || busy.current) return;
    if (file.size > 10 * 1024 * 1024) { setError("PDF može imati najviše 10 MB."); return; }
    busy.current = true; setUploading(true); setError("");
    try {
      const form = new FormData(); form.set("containerId", containerId); form.set("file", file);
      const response = await fetch("/api/imports/invoice", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.draft) throw new Error(result.error || "Faktura nije učitana.");
      setDraft(result.draft);
    } catch (e) { setError(e instanceof Error ? e.message : "Veza je prekinuta."); }
    finally { setUploading(false); busy.current = false; }
  }
  return <div className="border-y border-white/10 py-4">
    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Faktura dobavljača</h3><button type="button" aria-label="Zatvori fakturu" title="Zatvori fakturu" className={buttonClass} disabled={uploading || pending} onClick={close}><X size={16} /></button></div>
    <label className="block text-xs text-neutral-400"><span className="mb-2 flex items-center gap-2">{uploading ? <LoaderCircle size={16} className="animate-spin" /> : <Upload size={16} />}{uploading ? "Čitam fakturu..." : invoice ? "Zamijeni PDF fakturu" : "PDF faktura"}</span><input aria-label="PDF faktura" type="file" accept=".pdf,application/pdf" className={`${inputClass} file:mr-3 file:border-0 file:bg-transparent file:text-neutral-200`} disabled={pending || uploading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
    {error && <p role="alert" className="mt-3 text-sm text-red-200">{error}</p>}
    {draft && <form key={draft.fileId} className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      if (await run({ action: "saveInvoice", containerId, fileId: draft.fileId, number: String(form.get("number")), amount: String(form.get("amount")),
        currency: String(form.get("currency")) as ImportCurrency, supplier: String(form.get("supplier")) as ImportSupplier })) close();
    }}>
      <a href={`/api/imports/invoice/${draft.fileId}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 break-all text-sm text-sky-200 sm:col-span-2"><FileText size={16} className="shrink-0" />{draft.filename}</a>
      {draft.warning && <p className="text-xs text-amber-200 sm:col-span-2">{draft.warning}</p>}
      <label className="space-y-2 text-xs text-neutral-400"><span>Dobavljač fakture</span><select className={inputClass} name="supplier" required defaultValue={draft.supplier || ""}><option value="">Odaberi dobavljača</option>{Object.entries(importSuppliers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="space-y-2 text-xs text-neutral-400"><span>Broj fakture</span><input className={inputClass} name="number" maxLength={100} defaultValue={draft.number} /></label>
      <label className="space-y-2 text-xs text-neutral-400"><span>Ukupan iznos fakture</span><input className={inputClass} name="amount" inputMode="decimal" required defaultValue={draft.totalMinor ? (draft.totalMinor / 100).toFixed(2) : ""} /></label>
      <label className="space-y-2 text-xs text-neutral-400"><span>Valuta fakture</span><select className={inputClass} name="currency" required defaultValue={draft.currency || ""}><option value="">Odaberi valutu</option><option>USD</option><option>EUR</option><option value="BAM">KM</option></select></label>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={pending || uploading} className={`${buttonClass} border-sky-300/30 bg-sky-300 text-neutral-950 hover:bg-sky-200`}><Save size={16} />Potvrdi fakturu</button>{invoice && (remove ? <><button type="button" disabled={pending || uploading} className={`${buttonClass} text-red-200`} onClick={async () => { if (await run({ action: "removeInvoice", containerId })) close(); }}>Potvrdi uklanjanje</button><button type="button" className={buttonClass} onClick={() => setRemove(false)}>Odustani</button></> : <button type="button" className={buttonClass} disabled={pending || uploading} onClick={() => setRemove(true)}>Ukloni fakturu</button>)}</div>
    </form>}
  </div>;
}
