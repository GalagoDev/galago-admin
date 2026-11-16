"use client";

import { useRef, useState, useTransition } from "react";
import { Banknote, Check, ChevronRight, Container, FileText, LoaderCircle, Pencil, Plus, RefreshCw, Save, Search, Trash2, Undo2, X } from "lucide-react";
import { updateImportsAction, type ImportCommand } from "@/app/actions/imports";
import { formatImportMoney, importSuppliers, type ImportContainer, type ImportCurrency, type ImportPayment, type ImportSupplier, type ImportsOverview } from "@/lib/import-payments-types";
import { ImportInvoiceEditor, ImportInvoiceProgress } from "@/components/import-invoice-panel";

const inputClass = "min-h-11 w-full min-w-0 rounded-md border border-white/15 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-sky-300 focus:outline-none";
const buttonClass = "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm text-neutral-200 hover:bg-white/5 disabled:cursor-wait disabled:opacity-40";
const primaryClass = `${buttonClass} border-sky-300/30 bg-sky-300 text-neutral-950 hover:bg-sky-200`;
const statuses = { planned: "U pripremi", in_transit: "Na putu", received: "Zaprimljen" };
type Run = (command: ImportCommand) => Promise<boolean>;
const dateLabel = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split("-").reverse().join(".") : date;

function sums(payments: Array<{ amountMinor: number; currency: ImportCurrency }>) {
  const amounts = new Map<ImportCurrency, number>();
  for (const p of payments) amounts.set(p.currency, (amounts.get(p.currency) || 0) + p.amountMinor);
  return [...amounts].sort(([a], [b]) => a.localeCompare(b));
}
function MoneyLines({ rows, empty = "-" }: { rows: ReturnType<typeof sums>; empty?: string }) {
  return rows.length ? <>{rows.map(([currency, amount]) => <span key={currency} className="block tabular-nums">{formatImportMoney(amount, currency)}</span>)}</> : <span className="text-sm font-normal text-neutral-500">{empty}</span>;
}

function ContainerForm({ initial, run, pending, close }: { initial: ImportContainer | null; run: Run; pending: boolean; close: () => void }) {
  return <form className="grid gap-4 border-y border-white/10 py-5 sm:grid-cols-2" onSubmit={async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (await run({ action: "saveContainer", id: initial?.id, name: String(data.get("name")), notes: String(data.get("notes")), status: String(data.get("status")) as ImportContainer["status"] })) close();
  }}>
    <label className="space-y-2 text-xs text-neutral-400"><span>Kontejner / oznaka uvoza</span><input className={inputClass} name="name" defaultValue={initial?.name} maxLength={80} required autoFocus /></label>
    <label className="space-y-2 text-xs text-neutral-400"><span>Status</span><select className={inputClass} name="status" defaultValue={initial?.status || "planned"}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="space-y-2 text-xs text-neutral-400 sm:col-span-2"><span>Napomena / faktura</span><textarea className={inputClass} rows={2} name="notes" maxLength={1000} defaultValue={initial?.notes} /></label>
    <div className="flex gap-2 sm:col-span-2"><button disabled={pending} className={primaryClass}><Save size={16} />Sačuvaj</button><button type="button" className={buttonClass} onClick={close}><X size={16} />Odustani</button></div>
  </form>;
}

function PaymentRow({ payment, data, run, pending }: { payment: ImportPayment; data: ImportsOverview; run: Run; pending: boolean }) {
  const [supplier, setSupplier] = useState(payment.ignored ? "OTHER" : payment.supplier || "");
  const [containerId, setContainerId] = useState("");
  const [amount, setAmount] = useState(((payment.amountMinor - payment.allocatedMinor) / 100).toFixed(2));
  const requestId = useRef<string | null>(null);
  const [showAllocate, setShowAllocate] = useState(false);
  const allocations = data.allocations.filter(a => a.paymentId === payment.id);
  const remaining = payment.amountMinor - payment.allocatedMinor;
  const pdf = payment.fileId && data.companyId
    ? `https://olive-eagle-665977.hostingersite.com/?company=${encodeURIComponent(data.companyId)}&report=finance&finance_file=${encodeURIComponent(payment.fileId)}` : null;

  return <article className="border-b border-white/10 py-4">
    <div className="grid min-w-0 gap-3 xl:grid-cols-[100px_minmax(180px,1fr)_minmax(150px,0.8fr)_160px_140px] xl:items-start">
      <div className="flex items-center justify-between gap-3 xl:block"><span className="text-sm text-neutral-300">{dateLabel(payment.date)}</span><span className="block text-xs text-neutral-500 xl:mt-1">Izvod {payment.statement}</span></div>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${payment.supplier ? "text-white" : "text-amber-200"}`}>{payment.ignored ? "Drugi dobavljač / zanemareno" : payment.supplier ? importSuppliers[payment.supplier] : "Dobavljač nije potvrđen"}</p>
        {payment.partner && <p className="mt-1 break-words text-xs text-neutral-400">{payment.partner}</p>}
        <p className="mt-1 break-words text-xs leading-5 text-neutral-500">{payment.reference}</p>
        <p className="mt-1 text-xs text-neutral-600">{payment.account}</p>
        {!payment.available && <p className="mt-2 text-xs text-red-200">Izvorni zapis je izmijenjen ili uklonjen. Iznos je isključen iz ukupnih iznosa.</p>}
      </div>
      <div className="min-w-0 text-xs text-neutral-400">
        {allocations.length ? allocations.map(a => <div key={a.id} className="mb-2 flex items-center gap-2"><span className="min-w-0 flex-1 break-words">{data.containers.find(c => c.id === a.containerId)?.name}<span className="mt-1 block text-neutral-500">{formatImportMoney(a.amountMinor, payment.currency)}</span></span><button disabled={pending} className={`${buttonClass} min-h-9 px-2`} title="Ukloni raspored" aria-label="Ukloni raspored" onClick={() => void run({ action: "removeAllocation", id: a.id })}><Undo2 size={14} /></button></div>) : <span>Neraspoređeno</span>}
      </div>
      <div className="flex flex-wrap justify-between gap-2 xl:block xl:text-right">
        <p className="text-sm font-semibold tabular-nums text-emerald-200">{formatImportMoney(payment.amountMinor, payment.currency)}</p>
        <p className="text-xs text-neutral-500 xl:mt-1">{payment.kind === "fee" ? "Bankovna provizija" : "Isplata"}</p>
        {remaining > 0 && payment.allocatedMinor > 0 && <p className="mt-1 text-xs text-amber-200">Preostalo {formatImportMoney(remaining, payment.currency)}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        {pdf && <a className={buttonClass} href={pdf} target="_blank" rel="noreferrer" title="Izvorni izvod u Naltu" aria-label="Izvorni izvod u Naltu"><FileText size={16} /></a>}
        {payment.available && payment.supplier && !payment.ignored && remaining > 0 && <button className={buttonClass} disabled={pending || data.containers.length === 0} onClick={() => setShowAllocate(!showAllocate)} title={data.containers.length ? "Rasporedi na kontejner" : "Prvo dodaj kontejner"}><Plus size={16} />Rasporedi</button>}
      </div>
    </div>
    {!payment.sourceSupplier && payment.available && allocations.length === 0 && <form className="mt-3 flex max-w-md flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); await run({ action: "classify", id: payment.id, supplier: supplier as "TADEX" | "SHENGFENG" | "OTHER" | "" }); }}>
      <select aria-label="Dobavljač uplate" className={`${inputClass} flex-1 basis-48`} value={supplier} onChange={e => setSupplier(e.target.value)}>
        <option value="">Nepotvrđen dobavljač</option><option value="TADEX">Tadex</option><option value="SHENGFENG">SHENGFENG E-TEN</option><option value="OTHER">Drugi dobavljač / zanemari</option>
      </select>
      <button disabled={pending} className={buttonClass} title="Potvrdi dobavljača" aria-label="Potvrdi dobavljača"><Check size={16} /></button>
    </form>}
    {showAllocate && <form className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,180px)_auto] sm:items-end" onSubmit={async event => {
      event.preventDefault();
      requestId.current ??= crypto.randomUUID();
      if (await run({ action: "allocate", paymentId: payment.id, containerId, amount, requestId: requestId.current })) setShowAllocate(false);
    }}>
      <label className="space-y-1 text-xs text-neutral-400"><span>Kontejner</span><select aria-label="Kontejner" className={inputClass} value={containerId} onChange={e => { setContainerId(e.target.value); requestId.current = null; }} required><option value="">Odaberi kontejner</option>{data.containers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="space-y-1 text-xs text-neutral-400"><span>Iznos ({payment.currency})</span><input aria-label={`Iznos (${payment.currency})`} className={inputClass} inputMode="decimal" required value={amount} onChange={e => { setAmount(e.target.value); requestId.current = null; }} /></label>
      <button disabled={pending} className={primaryClass}><Save size={16} />Sačuvaj raspored</button>
    </form>}
  </article>;
}

export function ImportsPanel({ initial }: { initial: ImportsOverview }) {
  const [data, setData] = useState(initial);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [editor, setEditor] = useState<ImportContainer | "new" | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [invoiceEditor, setInvoiceEditor] = useState<string | null>(null);
  const [tab, setTab] = useState("payment");
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [assignment, setAssignment] = useState("");
  const [limit, setLimit] = useState(30);
  const run: Run = command => new Promise(resolve => {
    if (busy.current) { resolve(false); return; }
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await updateImportsAction(command);
        if (result.ok) { setData(result.data); setNotice({ error: false, message: result.message }); }
        else setNotice({ error: true, message: result.error });
        resolve(result.ok);
      } catch { setNotice({ error: true, message: "Veza je prekinuta. Pokušajte ponovo." }); resolve(false); }
      finally { busy.current = false; }
    });
  });
  const available = data.payments.filter(p => p.available && !p.ignored);
  const unknown = available.filter(p => !p.supplier);
  const unassigned = available.filter(p => p.supplier && p.allocatedMinor < p.amountMinor);
  const unavailable = data.payments.filter(p => !p.available);
  const visible = data.payments.filter(p => {
    if (tab === "ignored" ? !p.ignored : p.ignored) return false;
    if (tab === "review" && p.supplier && p.available) return false;
    if ((tab === "payment" || tab === "fee") && p.kind !== tab) return false;
    if (supplier && p.supplier !== supplier) return false;
    if (assignment === "unassigned" && p.allocatedMinor >= p.amountMinor) return false;
    if (assignment === "assigned" && p.allocatedMinor === 0) return false;
    const assigned = data.allocations.filter(a => a.paymentId === p.id).map(a => data.containers.find(c => c.id === a.containerId)?.name || "");
    const haystack = [p.partner, p.reference, p.date, p.statement, p.supplier ? importSuppliers[p.supplier] : "", ...assigned].join(" ").toLocaleLowerCase();
    return !search || haystack.includes(search.toLocaleLowerCase());
  });
  const tabItems = [
    ["payment", "Isplate", available.filter(p => p.kind === "payment").length],
    ["fee", "Provizije", available.filter(p => p.kind === "fee").length],
    ["review", "Za potvrdu", unknown.length + unavailable.length],
    ["ignored", "Zanemareno", data.payments.filter(p => p.ignored).length],
  ] as const;

  return <main className="min-h-screen bg-[#09090b] text-neutral-100 lg:pl-60">
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
        <div><p className="text-xs text-neutral-500">Galago Admin</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold"><Container size={23} className="text-sky-300" />Uvozi</h1><p className="mt-2 text-xs text-neutral-400">{data.lastSyncAt ? `Nalto: ${new Intl.DateTimeFormat("hr-HR", { timeZone: "Europe/Sarajevo", dateStyle: "short", timeStyle: "short" }).format(new Date(data.lastSyncAt))}` : "Nalto: podaci još nisu preuzeti"}</p>{data.sourceFrom && data.sourceThrough && <p className="mt-1 text-xs text-neutral-500">Dostupni izvodi: {dateLabel(data.sourceFrom)} - {dateLabel(data.sourceThrough)}</p>}</div>
        <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={pending || !data.configured} onClick={() => void run({ action: "sync" })}>{pending ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}Osvježi uplate</button><button className={primaryClass} onClick={() => setEditor("new")}><Plus size={16} />Novi kontejner</button></div>
      </header>
      {notice && <div role={notice.error ? "alert" : "status"} className={`mt-4 flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm ${notice.error ? "border-red-300/25 bg-red-300/5 text-red-200" : "border-emerald-300/25 bg-emerald-300/5 text-emerald-200"}`}>{notice.message}<button title="Zatvori obavijest" aria-label="Zatvori obavijest" onClick={() => setNotice(null)}><X size={18} /></button></div>}
      {(!data.configured || data.error) && <p role="alert" className="mt-4 text-sm text-amber-200">{data.error || "Nalto izvor uplata nije povezan."}</p>}
      {editor && <ContainerForm key={editor === "new" ? "new" : editor.id} initial={editor === "new" ? null : editor} pending={pending} run={run} close={() => setEditor(null)} />}

      <section aria-label="Uplate po dobavljaču" className="grid gap-6 border-b border-white/10 py-6 sm:grid-cols-2">
        {(Object.entries(importSuppliers) as [ImportSupplier, string][]).map(([key, label]) => {
          const payments = available.filter(p => p.supplier === key);
          return <div key={key} className="min-w-0"><h2 className="flex items-center gap-2 text-sm font-medium text-neutral-300"><Banknote size={17} className="text-emerald-300" />{label}</h2><div className="mt-3 text-xl font-semibold"><MoneyLines rows={sums(payments.filter(p => p.kind === "payment"))} empty="Nema potvrđenih isplata" /></div><div className="mt-3 flex flex-wrap gap-x-8 gap-y-3 text-xs text-neutral-400"><div><p className="mb-1 text-neutral-500">Neraspoređene isplate</p><MoneyLines rows={sums(payments.filter(p => p.kind === "payment" && p.amountMinor > p.allocatedMinor).map(p => ({ ...p, amountMinor: p.amountMinor - p.allocatedMinor })))} /></div><div><p className="mb-1 text-neutral-500">Bankovne provizije</p><MoneyLines rows={sums(payments.filter(p => p.kind === "fee"))} /></div></div></div>;
        })}
      </section>
      {(unknown.length > 0 || unavailable.length > 0) && <p className="border-b border-amber-300/20 py-3 text-sm text-amber-200">{unknown.length > 0 && `${unknown.length} deviznih isplata nema potvrđenog dobavljača. `}{unavailable.length > 0 && `${unavailable.length} izvornih zapisa je izmijenjeno ili uklonjeno. `}Nisu uključeni u potvrđene iznose dobavljača.</p>}

      <section className="py-6" aria-labelledby="container-heading">
        <div className="mb-4 flex items-center justify-between"><h2 id="container-heading" className="text-base font-semibold">Kontejneri <span className="ml-2 text-sm font-normal text-neutral-500">{data.containers.length}</span></h2><span className="text-xs text-neutral-500">Neraspoređenih zapisa: {unassigned.length}</span></div>
        {!data.containers.length && <p className="py-5 text-sm text-neutral-500">Nema dodanih kontejnera.</p>}
        <div className="space-y-3">{data.containers.map(container => {
          const invoice = data.invoices.find(i => i.containerId === container.id);
          const allocations = data.allocations.filter(a => a.containerId === container.id);
          const linked = allocations.flatMap(a => { const p = data.payments.find(p => p.id === a.paymentId); return p ? [{ ...p, amountMinor: a.amountMinor, allocationId: a.id }] : []; });
          return <details key={container.id} className="group rounded-lg border border-white/10 bg-white/[0.02]">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 [&::-webkit-details-marker]:hidden"><ChevronRight size={16} className="shrink-0 text-neutral-500 transition-transform group-open:rotate-90" /><div className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{container.name}</span><span className="mt-1 block text-xs text-neutral-500">{statuses[container.status]} · {allocations.length} rasporeda</span></div>{!invoice && <div className="text-right text-sm text-emerald-200"><MoneyLines rows={sums(linked.filter(p => p.available && !p.ignored && p.kind === "payment"))} /></div>}{invoice && <ImportInvoiceProgress invoice={invoice} data={data} />}</summary>
            <div className="border-t border-white/10 px-4 pb-4"><div className="flex flex-wrap items-start justify-between gap-3 py-4"><p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-neutral-400">{container.notes || "Bez napomene"}</p><div className="flex gap-2"><button className={buttonClass} title="Uredi kontejner" aria-label="Uredi kontejner" onClick={() => setEditor(container)}><Pencil size={16} /></button>{deleteId === container.id ? <><button className={`${buttonClass} text-red-200`} disabled={pending} onClick={async () => { if (await run({ action: "removeContainer", id: container.id })) setDeleteId(null); }}>Obriši</button><button className={buttonClass} title="Odustani od brisanja" aria-label="Odustani od brisanja" onClick={() => setDeleteId(null)}><X size={16} /></button></> : <button className={buttonClass} disabled={allocations.length > 0} title={allocations.length ? "Prvo ukloni raspored uplata" : "Obriši kontejner"} aria-label="Obriši kontejner" onClick={() => setDeleteId(container.id)}><Trash2 size={16} /></button>}</div></div>
              {invoiceEditor === container.id ? <ImportInvoiceEditor containerId={container.id} invoice={invoice} pending={pending} run={run} close={() => setInvoiceEditor(null)} /> : <div className="mb-4 flex flex-wrap gap-2"><button className={buttonClass} onClick={() => setInvoiceEditor(container.id)}><FileText size={16} />{invoice ? "Uredi fakturu" : "Dodaj PDF fakturu"}</button>{invoice && <a className={buttonClass} href={`/api/imports/invoice/${invoice.fileId}`} target="_blank" rel="noreferrer">Otvori PDF</a>}</div>}
              {linked.length ? linked.map(p => <div key={p.allocationId} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 py-3 text-xs"><span className="text-neutral-500">{dateLabel(p.date)}</span><span className="min-w-0 flex-1 break-words">{p.supplier ? importSuppliers[p.supplier] : "Nepotvrđeno"}{p.kind === "fee" ? " · provizija" : ""}{!p.available ? " · izvor izmijenjen" : ""}<span className="mt-1 block break-words text-neutral-500">{p.reference}</span></span><span className="tabular-nums">{formatImportMoney(p.amountMinor, p.currency)}</span><button className={`${buttonClass} min-h-9 px-2`} disabled={pending} title="Ukloni raspored" aria-label="Ukloni raspored" onClick={() => void run({ action: "removeAllocation", id: p.allocationId })}><Undo2 size={14} /></button></div>) : <p className="text-sm text-neutral-500">Nema raspoređenih uplata.</p>}
            </div>
          </details>;
        })}</div>
      </section>

      <section className="border-t border-white/10 pt-5" aria-label="Bankovne isplate">
        <div role="tablist" aria-label="Vrsta zapisa" className="flex flex-wrap gap-1 border-b border-white/10 pb-3">{tabItems.map(([key, label, count]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setLimit(30); }} className={`min-h-11 rounded-md px-3 py-2 text-sm ${tab === key ? "bg-white/10 text-white" : "text-neutral-500 hover:text-neutral-200"}`}>{label}<span className="ml-2 text-xs text-neutral-500">{count}</span></button>)}</div>
        <div className="my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_200px]"><label className="relative block"><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-neutral-500" /><input aria-label="Pretraži uplate" className={`${inputClass} pl-9`} placeholder="Traži nalog, izvod, kontejner..." value={search} onChange={e => { setSearch(e.target.value); setLimit(30); }} /></label><select aria-label="Filter dobavljača" className={inputClass} value={supplier} onChange={e => { setSupplier(e.target.value); setLimit(30); }}><option value="">Svi dobavljači</option>{Object.entries(importSuppliers).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="Filter rasporeda" className={inputClass} value={assignment} onChange={e => { setAssignment(e.target.value); setLimit(30); }}><option value="">Svi rasporedi</option><option value="unassigned">Neraspoređeno</option><option value="assigned">Raspoređeno</option></select></div>
        <div className="hidden grid-cols-[100px_minmax(180px,1fr)_minmax(150px,0.8fr)_160px_140px] gap-3 border-b border-white/10 py-3 text-xs text-neutral-500 xl:grid"><span>Datum / izvod</span><span>Dobavljač / nalog</span><span>Kontejner</span><span className="text-right">Iznos</span><span /></div>
        {visible.slice(0, limit).map(payment => <PaymentRow key={`${payment.id}:${payment.allocatedMinor}:${payment.supplier}:${payment.ignored}:${payment.available}`} payment={payment} data={data} pending={pending} run={run} />)}
        {!visible.length && <p className="py-10 text-center text-sm text-neutral-500">Nema uplata za odabrani prikaz.</p>}
        <div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs text-neutral-500">Prikazano {Math.min(limit, visible.length)} od {visible.length}</span>{visible.length > limit && <button className={buttonClass} onClick={() => setLimit(limit + 30)}>Prikaži više</button>}</div>
      </section>
    </div>
  </main>;
}
