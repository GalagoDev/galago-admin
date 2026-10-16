"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

function RefreshIcon({ pending }: { pending: boolean }) {
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

export function SheetRefreshButton({ path }: { path: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Osvježi podatke iz Google Sheetsa"
      title="Osvježi podatke iz Google Sheetsa"
      onClick={() => {
        startTransition(() => {
          const url = new URL(path, window.location.origin);
          url.searchParams.set("refresh", String(Date.now()));
          router.replace(`${url.pathname}${url.search}`);
        });
      }}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-sky-300/15 bg-sky-300/[0.06] text-sky-200 transition hover:bg-sky-300/10 disabled:cursor-wait disabled:opacity-60"
    >
      <RefreshIcon pending={pending} />
    </button>
  );
}
