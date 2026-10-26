import { ChevronDown } from "lucide-react";
import { getExpressOneScanStatus } from "@/lib/expressone-returns";

function date(value: number) {
  return new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", dateStyle: "short", timeStyle: "short" }).format(value);
}

export function ExpressOneReturnStatus() {
  const { scan, review } = getExpressOneScanStatus();
  const enabled = process.env.EXPRESSONE_RETURNS_SCHEDULER_ENABLED !== "false";
  return (
    <section className="mt-5 border-y border-white/10 py-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-neutral-200">Express One povrati</p>
          <p className="mt-1 text-xs text-neutral-400">{enabled ? "Dnevna provjera u 07:00" : "Automatska provjera je isključena"}</p>
        </div>
        <div className="text-xs text-neutral-400 sm:text-right">
          <p>{scan?.last_success_at ? `Zadnja provjera: ${date(scan.last_success_at)}` : "Još nema završene provjere"}</p>
          {scan?.last_success_at ? <p className="mt-1">Novih povrata: {scan.last_added} · Novih emailova: {scan.last_messages}</p> : null}
          {enabled && scan?.next_run_at ? <p className="mt-1">Sljedeća provjera: {date(scan.next_run_at)}</p> : null}
        </div>
      </div>
      {scan?.last_error ? <p className="mt-3 text-amber-200">{scan.last_error}</p> : null}
      {review.length ? (
        <details className="mt-3 border-t border-amber-300/20 pt-3">
          <summary className="flex cursor-pointer items-center gap-2 text-amber-200">
            <ChevronDown size={16} aria-hidden="true" />Za provjeru: {review.length}
          </summary>
          <ul className="mt-3 divide-y divide-white/10">
            {review.map(item => (
              <li key={item.tracking} className="py-3">
                <p className="font-medium text-neutral-200">{item.recipient} · {item.phone}</p>
                <p className="mt-1 break-words text-xs text-neutral-400">{item.tracking} · {item.product} · {item.statusAt}</p>
                <p className="mt-1 text-xs text-amber-200">{item.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
