import Link from "next/link";
import { getBazzarFeedStatus, getBazzarFeedUrl } from "@/lib/bazzar-feed";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function date(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Još nije generisan";
}

export default function BazzarIntegrationPage() {
  const status = getBazzarFeedStatus();
  const feedUrl = getBazzarFeedUrl();
  const snapshot = status.snapshot;
  const message = `Poštovani,\n\nPripremili smo Galago XML za automatski import i ažuriranje:\n${feedUrl}\n\nMolimo povežite ovaj stalni link i postavite preuzimanje 2× dnevno, npr. u 08:00 i 20:00 po vremenu BiH.\n\nSve cijene su u BAM. retail_price i discounted_retail_price uključuju PDV 17%. vendor_price je neto veleprodajna cijena bez PDV-a, računata od aktuelne prodajne cijene: cijena × 0,85 ÷ 1,17 (vaša marža 15%).\n\nMolimo uključite automatsku primjenu redovnih i akcijskih cijena iz XML-a, bez ručnog održavanja akcija. Kad discounted_retail_price izostane, potrebno je ukloniti prethodnu akciju i primijeniti retail_price. Ne šaljemo datume akcija: feed prati aktuelnu ponudu na webshopu pri svakom preuzimanju.\n\nstock=0 znači nedostupno; artikli uklonjeni iz izvora više nisu u XML-u. Svaka prodajna varijanta ima zaseban, stabilan id GALAGO-<Shopify variant ID>. Na HTTP grešku, uključujući 503, molimo sačuvajte prethodni katalog i ponovite preuzimanje, bez deaktiviranja artikala.\n\nZa artikle bez težine u Shopifyju opcionalno polje weight je izostavljeno. Ostale težine su u gramima.\n\nMolimo javite kada ulistavanje i automatska sinhronizacija budu aktivni te potvrdite da se završene akcije uklanjaju pri sljedećem preuzimanju. Link sadrži privatni pristupni token; proslijedite ga samo svom IT timu.\n\nLijep pozdrav,\nEdin / Galago.ba`;
  return (
    <main className="min-h-screen bg-[#09090b] px-4 py-6 text-neutral-50 lg:pl-72 lg:pr-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link href="/orders" className="text-sm text-neutral-400 hover:text-white">← Narudžbe</Link>
        <header>
          <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">Galago integracije</p>
          <h1 className="mt-2 text-2xl font-semibold">Bazzar XML</h1>
          <p className="mt-2 text-sm text-neutral-400">Samo Galago · BAM · marža 15% · PDV 17%</p>
        </header>
        <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="font-medium">{status.enabled ? "XML servis je omogućen" : "XML servis je pauziran"}</h2>
          <p className="mt-2 text-sm text-amber-200">Bazzar treba povezati link, podesiti preuzimanje i ulistati artikle. Uspješno generisanje XML-a nije potvrda da su proizvodi objavljeni na Bazzaru.</p>
          <label htmlFor="feed-url" className="mt-5 block text-sm text-neutral-300">Privatni XML link za Bazzar</label>
          <textarea id="feed-url" readOnly value={feedUrl} rows={3} className="mt-2 w-full break-all rounded-lg border border-white/15 bg-black/30 p-3 font-mono text-xs text-neutral-200" />
          <p className="mt-2 text-xs text-neutral-500">Svako preuzimanje čita svježe Shopify podatke. Link ne zahtijeva prijavu, ali sadrži tajni token za čitanje veleprodajnih cijena; ne objavljujte ga javno.</p>
          <a href={feedUrl} rel="noreferrer" target="_blank" className="mt-4 inline-block rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10">Otvori / provjeri XML</a>
        </section>
        <section className="rounded-xl border border-white/10 p-5">
          <h2 className="font-medium">Posljednje generisanje</h2>
          <p className="mt-2 text-sm text-neutral-400">{date(snapshot?.last_success_at)}</p>
          <p className="mt-3 text-sm">Artikala: {snapshot?.offer_count ?? "—"} · Na stanju: {snapshot?.in_stock_count ?? "—"} · S akcijskom cijenom: {snapshot?.discount_count ?? "—"}</p>
          {snapshot?.last_error ? <p role="alert" className="mt-3 text-sm text-red-300">Greška: {snapshot.last_error}. Nepotpuni XML nije isporučen.</p> : null}
          {snapshot?.warnings.length ? <details className="mt-4 text-sm text-amber-200"><summary>Napomene ({snapshot.warnings.length})</summary><ul className="mt-3 list-disc space-y-2 pl-5">{snapshot.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}
        </section>
        <section className="rounded-xl border border-white/10 p-5">
          <h2 className="font-medium">Poruka za Bazzar</h2>
          <p className="mt-2 text-sm text-neutral-400">Kopirajte i pošaljite svom kontaktu. Poruka nije automatski poslana.</p>
          <textarea aria-label="Poruka za Bazzar" readOnly value={message} rows={18} className="mt-4 w-full rounded-lg border border-white/15 bg-black/30 p-4 text-sm leading-6 text-neutral-200" />
          <p className="mt-3 text-xs text-neutral-500">Ovo je slanje kataloga i zaliha. XML ne preuzima Bazzar narudžbe niti automatski skida njihov lager u Shopifyju.</p>
        </section>
      </div>
    </main>
  );
}
