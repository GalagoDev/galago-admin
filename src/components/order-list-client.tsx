"use client";

import { useMemo, useState } from "react";

import type { SheetOrderRow } from "@/lib/google-sheets";

const PAGE_SIZE = 25;

function parseAmount(value: string) {
  const amount = Number(String(value ?? "").replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : 0;
}

export function OrderListClient({ orders }: { orders: SheetOrderRow[] }) {
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

  function toggleExpanded(key: string) {
    setExpandedKeys((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <>
      <div className="mb-3">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder="Traži ime, telefon, proizvod, ZIP..."
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/30"
        />
      </div>

      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-neutral-500">
        <span>Prikazano {visibleOrders.length}</span>
        <span>Ukupno {filteredOrders.length}</span>
      </div>

      <div className="flex flex-col gap-2.5">
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
                    <p className="truncate text-sm font-semibold text-white">{order.primalac || "Bez imena"}</p>
                    <p className="mt-1 truncate text-sm text-neutral-400">{order.artikal || "Bez artikla"}</p>
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
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>

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
