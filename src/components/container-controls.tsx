"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import {
  addContainerAction,
  deleteContainerAction,
  refreshAllContainersAction,
  refreshContainerAction,
} from "@/app/actions/containers";

function RefreshIcon({ pending = false }: { pending?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`h-4 w-4 ${pending ? "animate-spin" : ""}`}
    >
      <path d="M20 11a8 8 0 1 0-2.34 5.66" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M5 7h14M9 7V4.5h6V7M8 10.5v7M12 10.5v7M16 10.5v7M6.5 7l.75 13h9.5l.75-13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AddSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 shrink-0 rounded-lg bg-sky-300 px-5 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-sky-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Dodajem..." : "Dodaj kontejner"}
    </button>
  );
}

export function AddContainerForm() {
  return (
    <form action={addContainerAction} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-sm text-neutral-300">
        Broj kontejnera
        <input
          name="containerNumber"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={14}
          placeholder="MSMU4017564"
          required
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-[#09090b] px-3 py-2.5 font-mono text-base uppercase tracking-[0.08em] text-white outline-none transition placeholder:text-neutral-700 focus:border-sky-300/40"
        />
      </label>
      <div className="sm:w-44">
        <p className="mb-2 text-sm text-neutral-300">Odredište</p>
        <div className="flex min-h-11 items-center rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-neutral-300">
          Rijeka (HRRJK)
        </div>
      </div>
      <AddSubmitButton />
    </form>
  );
}

function RefreshAllSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sky-300/20 bg-sky-300/[0.07] px-4 py-2.5 text-sm font-medium text-sky-100 transition hover:bg-sky-300/10 disabled:cursor-wait disabled:opacity-60"
    >
      <RefreshIcon pending={pending} />
      {pending ? "Osvježavam..." : "Osvježi sve"}
    </button>
  );
}

export function RefreshAllContainersButton() {
  return (
    <form action={refreshAllContainersAction}>
      <RefreshAllSubmitButton />
    </form>
  );
}

function RefreshOneButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Osvježi praćenje kontejnera"
      title="Osvježi praćenje"
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-sky-300/15 bg-sky-300/[0.06] text-sky-100 transition hover:bg-sky-300/10 disabled:cursor-wait disabled:opacity-60"
    >
      <RefreshIcon pending={pending} />
    </button>
  );
}

function ConfirmDeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-lg bg-red-300 px-3 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-red-200 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Brišem..." : "Potvrdi"}
    </button>
  );
}

export function ContainerActions({ containerId }: { containerId: number }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <form action={deleteContainerAction} className="flex items-center gap-2">
        <input type="hidden" name="containerId" value={containerId} />
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-11 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/[0.08]"
        >
          Odustani
        </button>
        <ConfirmDeleteButton />
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <form action={refreshContainerAction}>
        <input type="hidden" name="containerId" value={containerId} />
        <RefreshOneButton />
      </form>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Ukloni kontejner"
        title="Ukloni kontejner"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-red-300/15 bg-red-300/[0.05] text-red-200 transition hover:bg-red-300/10"
      >
        <TrashIcon />
      </button>
    </div>
  );
}
