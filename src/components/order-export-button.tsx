"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function OrderExportButton({ label }: { label: string }) {
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => {
    if (download) URL.revokeObjectURL(download.url);
  }, [download]);

  async function exportOrders() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    setDownload(null);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 120_000);

    try {
      const response = await fetch("/orders/export", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: `${XLSX_TYPE}, application/json` },
        signal: abort.signal,
      });

      if (response.redirected && new URL(response.url).pathname === "/login") {
        window.location.assign("/login");
        return;
      }

      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        const result = await response.json();
        if (response.status === 409 && typeof result.redirect === "string" && result.redirect.startsWith("/orders?")) {
          window.location.assign(result.redirect);
          return;
        }
        throw new Error(typeof result.error === "string" ? result.error : "Excel nije preuzet. Pokušajte ponovo.");
      }
      if (!response.ok || !contentType.includes(XLSX_TYPE)) {
        throw new Error("Excel nije preuzet. Server trenutno nije dostupan. Pokušajte ponovo.");
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error("Preuzeta datoteka je prazna. Pokušajte ponovo.");
      const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+\.xlsx)"/)?.[1] ?? "IMPORT-ELKO.xlsx";
      const url = URL.createObjectURL(blob);
      setDownload({ url, filename });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (cause) {
      setError(abort.signal.aborted
        ? "Priprema traje predugo. Excel nije preuzet. Pokušajte ponovo."
        : cause instanceof Error && cause.name !== "TypeError"
          ? cause.message
          : "Veza je prekinuta. Excel nije preuzet. Pokušajte ponovo.");
    } finally {
      window.clearTimeout(timeout);
      controller.current = null;
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={exportOrders}
        disabled={pending}
        aria-busy={pending}
        aria-label={pending ? "Pripremam Excel" : label}
        title={label}
        className="inline-flex h-10 w-44 max-w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="whitespace-nowrap text-sm">{pending ? "Pripremam Excel…" : "Excel do 08:00"}</span>
      </button>
      {error ? <p role="alert" className="order-last basis-full text-sm text-red-200 sm:max-w-72">{error}</p> : null}
      {download ? (
        <p role="status" className="order-last basis-full text-sm text-emerald-200 sm:max-w-72">
          Preuzimanje pokrenuto. <a href={download.url} download={download.filename} className="underline underline-offset-2">Preuzmi ponovo</a>
        </p>
      ) : null}
    </>
  );
}
