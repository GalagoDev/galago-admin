"use client";

import { useFormStatus } from "react-dom";
import { ChevronDown, Link2, LoaderCircle } from "lucide-react";
import { linkCourierTrackingAction } from "@/app/actions/courier";
import type { CourierOrderState } from "@/lib/courier-status";

const labels = { active: "U postupku dostave", registered: "Samo najavljeno", partial: "Djelimično završeno", review: "Za provjeru", delivered: "Dostavljeno", returned: "Povrat" };
function LinkButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} title="Poveži brojeve paketa" aria-label="Poveži brojeve paketa"
    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-300/30 text-sky-200 disabled:opacity-50">
    {pending ? <LoaderCircle size={16} className="animate-spin" /> : <Link2 size={16} />}
  </button>;
}
export function CourierOrderDetails({ state, canLink }: { state: CourierOrderState; canLink: boolean }) {
  return <details className="mt-2 min-w-0 text-xs">
    <summary className={`flex cursor-pointer items-center gap-1 ${state.category === "review" || state.category === "partial" ? "text-amber-200" : "text-sky-200"}`}>
      <ChevronDown size={12} className="shrink-0" />{labels[state.category]}
    </summary>
    <div className="mt-2 space-y-2 break-words text-neutral-400">
      {state.reason ? <p>{state.reason}</p> : null}
      {state.parcels.map(parcel => <div key={parcel.tracking}>
        <a className="text-sky-200 underline underline-offset-2" href={`https://expressone.ba/bs/track-and-trace?number=001-${parcel.tracking}`} target="_blank" rel="noreferrer">{parcel.tracking}</a>
        <p className="mt-1">{labels[parcel.category]} · {parcel.lastStatus}</p>
      </div>)}
      {state.checkedAt ? <p className="text-[10px] text-neutral-500">{new Intl.DateTimeFormat("bs-BA", { timeZone: "Europe/Sarajevo", dateStyle: "short", timeStyle: "short" }).format(state.checkedAt)}</p> : null}
      {canLink ? <form action={linkCourierTrackingAction} className="flex min-w-0 gap-1 pt-1">
        <input type="hidden" name="orderKey" value={state.key} />
        <input name="trackingNumbers" aria-label="Brojevi paketa" placeholder="Brojevi paketa" required maxLength={3000}
          defaultValue={state.parcels.map(p => p.tracking).join(" ")}
          className="h-10 w-full min-w-0 rounded-lg border border-white/15 bg-black/30 px-2 text-xs text-white" />
        <LinkButton />
      </form> : null}
    </div>
  </details>;
}
