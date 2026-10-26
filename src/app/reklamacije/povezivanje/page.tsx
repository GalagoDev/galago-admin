import Link from "next/link";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import { getClaimMessagingStatus } from "@/lib/claim-messaging-store";

export const dynamic = "force-dynamic";
export default async function ClaimConnectionsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const params = await searchParams;
  const state = getClaimMessagingStatus();
  return (
    <main className="min-h-screen bg-[#09090b] px-4 py-6 text-neutral-100 lg:pl-72 lg:pr-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center gap-4 border-b border-white/10 pb-5">
          <Link href="/reklamacije" title="Nazad na reklamacije" aria-label="Nazad na reklamacije" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/15"><ArrowLeft size={18} /></Link>
          <h1 className="text-lg font-semibold">Reklamacije: povezivanje</h1>
        </header>
        {params.gmail === "connected" && <p role="status" className="mt-4 text-sm text-emerald-300">Gmail je povezan.</p>}
        {params.gmail === "error" && <p role="alert" className="mt-4 text-sm text-red-300">Novo Gmail odobrenje nije završeno. Prethodna veza nije izmijenjena.</p>}
        <section className="border-b border-white/10 py-6">
          <h2 className="flex items-center gap-2 font-medium"><MessageCircle size={18} /> Telegram</h2>
          <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-neutral-400">Grupa</dt><dd>Galago reklamacije</dd>
            <dt className="text-neutral-400">Obavijesti</dt><dd>{state.enabled ? "Aktivne" : "Nisu povezane"}</dd>
            <dt className="text-neutral-400">Na čekanju</dt><dd>{state.pending}</dd>
            <dt className="text-neutral-400">Neuspjelo slanje</dt><dd className={state.failed ? "text-red-300" : ""}>{state.failed}</dd>
          </dl>
        </section>
        <section className="border-b border-white/10 py-6">
          <h2 className="flex items-center gap-2 font-medium"><Mail size={18} /> Gmail</h2>
          <p className="mt-4 break-all text-sm">{state.gmail || "galagodoo@gmail.com: nije povezan"}</p>
          <form action="/api/reklamacije/gmail/connect" method="post" className="mt-4">
            <input type="hidden" name="readReplies" value={state.readEnabled ? "1" : "0"} />
            <button type="submit" disabled={!state.gmailReady} className="flex min-h-10 items-center gap-2 rounded-lg bg-sky-300 px-4 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40">
              <Mail size={16} />{state.gmail ? "Ponovo poveži Gmail" : "Poveži Gmail"}
            </button>
          </form>
          <dl className="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-neutral-400">Odgovori kupaca</dt><dd>{state.readEnabled ? "Aktivno · svaka 2 sata" : "Nije povezano"}</dd>
            <dt className="text-neutral-400">Zadnja provjera</dt><dd>{state.inboxCheckedAt ? new Date(state.inboxCheckedAt + "Z").toLocaleString("bs-BA", { timeZone: "Europe/Sarajevo" }) : "-"}</dd>
          </dl>
          {!!state.inboxErrors && <p role="alert" className="mt-3 text-sm text-amber-200">Provjera odgovora nije uspjela za {state.inboxErrors} razgovora. Provjerite Gmail povezivanje.</p>}
          {!state.readEnabled && <form action="/api/reklamacije/gmail/connect" method="post" className="mt-4">
            <input type="hidden" name="readReplies" value="1" />
            <button type="submit" disabled={!state.gmailReady} className="flex min-h-10 items-center gap-2 rounded-lg border border-sky-300/40 px-4 py-2 text-sm text-sky-200 disabled:opacity-40"><Mail size={16} />Poveži odgovore kupaca</button>
          </form>}
          {!state.gmailReady && <p className="mt-3 text-sm text-amber-200">Google OAuth postavke još nisu dodane.</p>}
          <nav aria-label="Informacije o Gmail povezivanju" className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-400">
            <a href="/galago-reklamacije.html" className="underline underline-offset-4">O aplikaciji</a>
            <a href="/galago-reklamacije-privatnost.html" className="underline underline-offset-4">Privatnost</a>
            <a href="/galago-reklamacije-uslovi.html" className="underline underline-offset-4">Uslovi korištenja</a>
          </nav>
        </section>
      </div>
    </main>
  );
}
