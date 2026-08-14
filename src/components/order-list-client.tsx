"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { moveOrderToReturnsAction } from "@/app/actions/delivery";
import type { SheetOrderRow } from "@/lib/google-sheets";

const PAGE_SIZE = 25;

function parseAmount(value: string) {
  const amount = Number(String(value ?? "").replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : 0;
}

function ReturnSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-10 rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-2 text-xs font-semibold text-fuchsia-100 transition hover:bg-fuchsia-300/15 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Premještam..." : "Povrat"}
    </button>
  );
}

function ReturnOrderForm({ order, fullWidth = false }: { order: SheetOrderRow; fullWidth?: boolean }) {
  return (
    <form
      action={moveOrderToReturnsAction}
      onSubmit={(event) => {
        if (!window.confirm(`Dodati ${order.primalac || "ovu narudžbu"} u Povrate?`)) event.preventDefault();
      }}
      className={fullWidth ? "mt-3 grid" : ""}
    >
      <input
        type="hidden"
        name="order"
        value={JSON.stringify({
          sheetRowNumber: order.sheetRowNumber,
          fingerprint: order.fingerprint,
          dateLabel: order.dateLabel,
        })}
      />
      <ReturnSubmitButton />
    </form>
  );
}

export function OrderListClient({
  orders,
  allowReturns = false,
  searchPlaceholder = "Traži ime, telefon, proizvod, ZIP...",
}: {
  orders: SheetOrderRow[];
  allowReturns?: boolean;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;

    return orders.filter((order) =>
      [order.primalac, order.brojTelefona, order.grad, order.adresa, order.artikal, order.dateLabel]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [orders, query]);

  const visibleOrders = filteredOrders.slice(0, visibleCount);
  const desktopGridClass = allowReturns
    ? "grid-cols-[42px_minmax(120px,1fr)_minmax(112px,0.8fr)_minmax(165px,1.25fr)_minmax(165px,1.4fr)_74px_105px_86px]"
    : "grid-cols-[48px_minmax(130px,1fr)_minmax(120px,0.85fr)_minmax(180px,1.35fr)_minmax(180px,1.5fr)_84px_120px]";

  function toggleExpanded(key: string) {
    setExpandedKeys((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <>
      <div className="mb-3 xl:flex xl:items-center xl:justify-between xl:gap-6">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder={searchPlaceholder}
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/30 xl:max-w-xl xl:rounded-lg"
        />
        <div className="mt-3 hidden shrink-0 items-center gap-5 text-[11px] uppercase tracking-[0.14em] text-neutral-500 xl:flex xl:mt-0">
          <span>Prikazano {visibleOrders.length}</span>
          <span>Ukupno {filteredOrders.length}</span>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-neutral-500 xl:hidden">
        <span>Prikazano {visibleOrders.length}</span>
        <span>Ukupno {filteredOrders.length}</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:hidden">
        {filteredOrders.length === 0 ? (
          <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-neutral-500">
            Nema narudžbi za ovaj prikaz.
          </div>
        ) : (
          visibleOrders.map((order, index) => {
            const key = `${order.dateLabel}-${order.rowNumber}-${order.brojTelefona}`;
            const expanded = !!expandedKeys[key];
            return (
              <article
                key={key}
                className="rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(key)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-white">{order.primalac || "Bez imena"}</p>
                    <p className="mt-1 break-words text-sm text-neutral-400">{order.artikal || "Bez artikla"}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      <span>{order.dateLabel || "-"}</span>
                      <span>•</span>
                      <span>{order.grad || "-"}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full border border-sky-300/10 bg-sky-300/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-sky-200">
                      #{index + 1}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                      {expanded ? "Manje" : "Detalji"}
                    </span>
                  </div>
                </button>

                {expanded ? (
                  <div className="mt-3 grid gap-1.5 text-[13px] text-neutral-300">
                    <p><span className="text-neutral-500">Grad:</span> {order.grad || "-"}</p>
                    <p><span className="text-neutral-500">Adresa:</span> {order.adresa || "-"}</p>
                    <p><span className="text-neutral-500">Telefon:</span> {order.brojTelefona || "-"}</p>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[12px]">
                      <span className="text-neutral-500">Otkupnina</span>
                      <span className="font-medium text-white">{order.otkupnina || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="text-neutral-500">Vrijednost pošiljke</span>
                      <span className="font-medium text-white">{order.vrijednostPosiljke || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="text-neutral-500">Broj paketa</span>
                      <span className="font-medium text-white">{order.brojPaketa || "-"}</span>
                    </div>
                    {allowReturns ? <ReturnOrderForm order={order} fullWidth /> : null}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      {filteredOrders.length > 0 ? (
        <div className="hidden overflow-hidden rounded-lg border border-white/10 xl:block" role="table" aria-label="Lista narudžbi">
          <div
            className={`grid ${desktopGridClass} gap-3 border-b border-white/10 bg-white/[0.04] px-3 py-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-500`}
            role="row"
          >
            <span>#</span>
            <span>Primalac</span>
            <span>Telefon</span>
            <span>Lokacija</span>
            <span>Artikal</span>
            <span>Paketi</span>
            <span>Otkupnina</span>
            {allowReturns ? <span>Akcija</span> : null}
          </div>
          <div className="divide-y divide-white/[0.06]">
            {visibleOrders.map((order, index) => (
              <div
                key={`${order.dateLabel}-${order.rowNumber}-${order.brojTelefona}`}
                className={`grid ${desktopGridClass} items-start gap-3 px-3 py-3 text-sm text-neutral-300 transition hover:bg-white/[0.025]`}
                role="row"
              >
                <span className="text-xs text-neutral-600">{index + 1}</span>
                <div className="min-w-0">
                  <p className="break-words font-semibold text-white">{order.primalac || "Bez imena"}</p>
                  <p className="mt-1 text-xs text-neutral-500">{order.dateLabel || "-"}</p>
                </div>
                <p className="break-all text-neutral-300">{order.brojTelefona || "-"}</p>
                <div className="min-w-0">
                  <p className="break-words font-medium text-white">{order.grad || "-"}</p>
                  <p className="mt-1 break-words text-xs leading-5 text-neutral-500">{order.adresa || "-"}</p>
                </div>
                <p className="min-w-0 break-words leading-5 text-neutral-200">{order.artikal || "Bez artikla"}</p>
                <div>
                  <p className="font-medium text-white">{order.brojPaketa || "-"}</p>
                  <p className="mt-1 text-[11px] leading-4 text-neutral-500">DOP {order.dop || "-"}</p>
                  <p className="text-[11px] leading-4 text-neutral-500">Zamj. {order.zamjena || "-"}</p>
                </div>
                <div>
                  <p className="font-semibold text-emerald-200">{order.otkupnina || "-"}</p>
                  <p className="mt-1 break-words text-[11px] leading-4 text-neutral-500">Vrijednost {order.vrijednostPosiljke || "-"}</p>
                </div>
                {allowReturns ? <ReturnOrderForm order={order} /> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {visibleCount < filteredOrders.length ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
        >
          Učitaj još ({Math.min(PAGE_SIZE, filteredOrders.length - visibleCount)})
        </button>
      ) : null}

      {filteredOrders.length > 0 ? (
        <div className="mt-4 text-center text-[11px] uppercase tracking-[0.14em] text-neutral-500">
          Ukupna otkupnina: {filteredOrders.reduce((sum, order) => sum + parseAmount(order.otkupnina), 0)} KM
        </div>
      ) : null}
    </>
  );
}
