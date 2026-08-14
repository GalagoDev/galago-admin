"use client";

import { useId, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { moveOrderToReturnsAction } from "@/app/actions/delivery";
import type { SheetOrderRow } from "@/lib/google-sheets";

const MAX_SUGGESTIONS = 12;

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("bs")
    .trim();
}

function ReturnButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="min-h-11 w-full rounded-lg bg-fuchsia-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-fuchsia-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-neutral-500 sm:w-auto"
    >
      {pending ? "Premještam..." : "Dodaj u Povrate"}
    </button>
  );
}

export function ReturnOrderPicker({ orders }: { orders: SheetOrderRow[] }) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<SheetOrderRow | null>(null);

  const suggestions = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    return orders
      .filter((order) => {
        if (!normalizedQuery) return true;
        return normalizeSearch(`${order.primalac} ${order.brojTelefona}`).includes(normalizedQuery);
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [orders, query]);

  function selectOrder(order: SheetOrderRow) {
    setSelectedOrder(order);
    setQuery(order.primalac);
    setIsOpen(false);
    setActiveIndex(0);
  }

  return (
    <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111214] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)] lg:rounded-lg lg:p-5">
      <div>
        <p className="text-lg font-semibold text-white">Dodaj povrat</p>
        <p className="mt-1 text-sm text-neutral-500">Pronađite kupca među aktivnim pošiljkama</p>
      </div>

      <form
        action={moveOrderToReturnsAction}
        className="mt-4"
      >
        <div className="relative max-w-2xl">
          <label htmlFor={`${listboxId}-input`} className="mb-2 block text-sm text-neutral-300">
            Kupac iz Na dostavi
          </label>
          <input
            id={`${listboxId}-input`}
            type="text"
            value={query}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={isOpen}
            aria-activedescendant={isOpen && suggestions[activeIndex] ? `${listboxId}-${suggestions[activeIndex].sheetRowNumber}` : undefined}
            placeholder="Počni upisivati ime kupca..."
            onFocus={() => setIsOpen(true)}
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedOrder(null);
              setActiveIndex(0);
              setIsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIsOpen(true);
                if (suggestions.length > 0) {
                  setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
                }
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && isOpen && suggestions[activeIndex]) {
                event.preventDefault();
                selectOrder(suggestions[activeIndex]);
              } else if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
            className="min-h-12 w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-base text-white outline-none placeholder:text-neutral-600 focus:border-sky-400/50"
          />

          {isOpen ? (
            <div
              id={listboxId}
              role="listbox"
              className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#17181b] shadow-2xl shadow-black/60"
            >
              {suggestions.length > 0 ? suggestions.map((order, index) => (
                <button
                  key={`${order.sheetRowNumber}-${order.fingerprint}`}
                  id={`${listboxId}-${order.sheetRowNumber}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOrder(order)}
                  className={`block w-full border-b border-white/[0.06] px-4 py-3 text-left last:border-b-0 ${index === activeIndex ? "bg-sky-300/10" : "hover:bg-white/[0.04]"}`}
                >
                  <span className="block break-words text-sm font-semibold text-white">{order.primalac || "Bez imena"}</span>
                  <span className="mt-1 block break-words text-xs text-neutral-400">{order.artikal || "Bez artikla"}</span>
                  <span className="mt-1 block text-[11px] text-neutral-500">
                    {order.grad || "Bez ZIP-a"} · {order.dateLabel || "Bez datuma"} · {order.otkupnina || "-"} KM
                  </span>
                </button>
              )) : (
                <p className="px-4 py-5 text-sm text-neutral-500">Nema aktivnog kupca s tim imenom ili telefonom.</p>
              )}
            </div>
          ) : null}
        </div>

        {selectedOrder ? (
          <div className="mt-4 flex max-w-2xl flex-col gap-3 rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-white">{selectedOrder.primalac}</p>
              <p className="mt-1 break-words text-xs text-neutral-400">
                {selectedOrder.artikal || "Bez artikla"} · {selectedOrder.grad || "Bez ZIP-a"}
              </p>
            </div>
            <ReturnButton disabled={false} />
          </div>
        ) : (
          <div className="mt-4 max-w-2xl">
            <ReturnButton disabled />
          </div>
        )}

        <input type="hidden" name="returnTo" value="/returns" />
        <input
          type="hidden"
          name="order"
          value={selectedOrder ? JSON.stringify({
            sheetRowNumber: selectedOrder.sheetRowNumber,
            fingerprint: selectedOrder.fingerprint,
            dateLabel: selectedOrder.dateLabel,
          }) : ""}
        />
      </form>
    </section>
  );
}
