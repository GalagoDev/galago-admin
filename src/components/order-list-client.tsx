"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CheckCheck, LoaderCircle } from "lucide-react";

import { moveOrderToReturnsAction, restoreReturnToTransitAction } from "@/app/actions/delivery";
import { approveAllOrderRisksAction, setOrderRiskDecisionAction } from "@/app/actions/order-risk";
import { formatPostalLocation } from "@/lib/bih-postal";
import { parseOrderAmount, roundOrderAmount } from "@/lib/order-amount";
import type { SheetOrderRow } from "@/lib/google-sheets";
import type { OrderRiskAssessment } from "@/lib/order-risk";

const PAGE_SIZE = 25;

function RiskSubmitButton({ children, classes, bulk = false }: { children: ReactNode; classes: string; bulk?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`relative inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${classes}`}
    >
      <span className={`inline-flex items-center justify-center gap-2 ${pending ? "invisible" : ""}`}>
        {bulk ? <CheckCheck className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
        {children}
      </span>
      {pending ? <span className="absolute inset-0 flex items-center justify-center gap-2"><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />Spremam...</span> : null}
    </button>
  );
}

function riskReference(order: SheetOrderRow) {
  return JSON.stringify({
    sheetRowNumber: order.sheetRowNumber,
    fingerprint: order.fingerprint,
    dateLabel: order.dateLabel,
    sourceId: order.sourceId,
  });
}

function RiskDecisionButton({
  order,
  decision,
  children,
  tone,
  riskView,
}: {
  order: SheetOrderRow;
  decision: "approve" | "duplicate" | "restore";
  children: ReactNode;
  tone: "approve" | "duplicate" | "restore";
  riskView?: "export";
}) {
  const classes = tone === "approve"
    ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15"
    : tone === "duplicate"
      ? "border-red-300/20 bg-red-300/10 text-red-100 hover:bg-red-300/15"
      : "border-sky-300/20 bg-sky-300/10 text-sky-100 hover:bg-sky-300/15";

  return (
    <form action={setOrderRiskDecisionAction}>
      <input type="hidden" name="order" value={riskReference(order)} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="view" value={riskView ?? ""} />
      <RiskSubmitButton classes={classes}>{children}</RiskSubmitButton>
    </form>
  );
}

function RiskBadge({ risk }: { risk: OrderRiskAssessment }) {
  if (risk.excluded) {
    return <span className="rounded-full border border-red-300/20 bg-red-300/10 px-2 py-1 text-[10px] font-semibold uppercase text-red-100">Ne šalji</span>;
  }
  if (risk.approved) {
    return <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-100">Provjereno</span>;
  }
  if (risk.level === "critical") {
    return <span className="rounded-full border border-red-300/25 bg-red-300/12 px-2 py-1 text-[10px] font-semibold uppercase text-red-100">Provjeri kupca</span>;
  }
  if (risk.level === "warning") {
    return <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[10px] font-semibold uppercase text-amber-100">Mogući duplikat</span>;
  }
  return null;
}

function RiskDetails({ order, risk, riskView }: { order: SheetOrderRow; risk: OrderRiskAssessment; riskView?: "export" }) {
  if (risk.level === "none" && !risk.excluded) return null;

  return (
    <div className={`mt-3 rounded-lg border p-3 text-xs ${risk.level === "critical" || risk.excluded ? "border-red-300/15 bg-red-300/[0.06]" : "border-amber-300/15 bg-amber-300/[0.05]"}`}>
      {risk.reasons.map((reason) => <p key={reason} className="mb-1 text-neutral-200">{reason}</p>)}
      {risk.lastOrderDaysAgo !== null ? (
        <p className="mt-2 text-neutral-400">
          Zadnja narudžba prije {risk.lastOrderDaysAgo} dana · {risk.lastOutcome || "Nepoznat ishod"}
        </p>
      ) : null}
      <p className="mt-1 text-neutral-500">
        Dostavljeno {risk.deliveredCount} · Povrati {risk.returnedCount} · Aktivno {risk.activeCount}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {risk.unresolved ? (
          <>
            <RiskDecisionButton order={order} riskView={riskView} decision="approve" tone="approve">Provjereno, pošalji</RiskDecisionButton>
            <RiskDecisionButton order={order} riskView={riskView} decision="duplicate" tone="duplicate">Ne šalji – duplikat</RiskDecisionButton>
          </>
        ) : null}
        {risk.excluded ? (
          <RiskDecisionButton order={order} riskView={riskView} decision="restore" tone="restore">Vrati među narudžbe</RiskDecisionButton>
        ) : null}
      </div>
    </div>
  );
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

function RestoreSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-10 rounded-lg border border-sky-300/20 bg-sky-300/10 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-300/15 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Vraćam..." : "Vrati na dostavu"}
    </button>
  );
}

function RestoreOrderForm({ order, fullWidth = false }: { order: SheetOrderRow; fullWidth?: boolean }) {
  return (
    <form action={restoreReturnToTransitAction} className={fullWidth ? "mt-3 grid" : ""}>
      <input
        type="hidden"
        name="order"
        value={JSON.stringify({
          sheetRowNumber: order.sheetRowNumber,
          fingerprint: order.fingerprint,
          dateLabel: order.dateLabel,
        })}
      />
      <RestoreSubmitButton />
    </form>
  );
}

export function OrderListClient({
  orders,
  allowReturns = false,
  allowRestoreToTransit = false,
  searchPlaceholder = "Traži ime, telefon, proizvod, ZIP...",
  riskAssessments,
  riskView,
}: {
  orders: SheetOrderRow[];
  allowReturns?: boolean;
  allowRestoreToTransit?: boolean;
  searchPlaceholder?: string;
  riskAssessments?: Record<number, OrderRiskAssessment>;
  riskView?: "export";
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [showRisksOnly, setShowRisksOnly] = useState(false);

  const riskValues = Object.values(riskAssessments ?? {});
  const unresolvedRisks = riskValues.filter((risk) => risk.unresolved);
  const ordersToApprove = orders.filter((order) => riskAssessments?.[order.sheetRowNumber]?.unresolved);
  const criticalRisks = unresolvedRisks.filter((risk) => risk.level === "critical");
  const excludedRisks = riskValues.filter((risk) => risk.excluded);
  const hasRiskResults = riskValues.some((risk) => risk.level !== "none" || risk.excluded);

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      const risk = riskAssessments?.[order.sheetRowNumber];
      if (showRisksOnly && !risk?.unresolved && !risk?.excluded) return false;
      if (!q) return true;
      return [order.primalac, order.brojTelefona, order.grad, formatPostalLocation(order.grad), order.adresa, order.artikal, order.dateLabel]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [orders, query, riskAssessments, showRisksOnly]);

  const visibleOrders = filteredOrders.slice(0, visibleCount);
  const hasAction = allowReturns || allowRestoreToTransit;
  const desktopGridClass = hasAction
    ? "grid-cols-[42px_minmax(120px,1fr)_minmax(112px,0.8fr)_minmax(165px,1.25fr)_minmax(165px,1.4fr)_74px_105px_118px]"
    : "grid-cols-[48px_minmax(130px,1fr)_minmax(120px,0.85fr)_minmax(180px,1.35fr)_minmax(180px,1.5fr)_84px_120px]";

  function toggleExpanded(key: string) {
    setExpandedKeys((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <>
      {riskAssessments ? (
        <div
          id="risk-alerts"
          className={`mb-4 rounded-lg border p-3 ${hasRiskResults ? "border-red-300/15 bg-red-300/[0.06]" : "border-emerald-300/15 bg-emerald-300/[0.06]"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Kontrola duplih narudžbi</p>
              <p className="mt-1 text-xs text-neutral-400">
                {hasRiskResults
                  ? `Za provjeru ${unresolvedRisks.length} · Crveno ${criticalRisks.length} · Ne šalji ${excludedRisks.length}`
                  : `Aktivno · Skenirano ${riskValues.length} · Nema upozorenja`}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500">Duplikati 14 dana · Povrati cijela historija</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ordersToApprove.length > 0 ? (
                <form action={approveAllOrderRisksAction}>
                  <input type="hidden" name="view" value={riskView ?? ""} />
                  {ordersToApprove.map((order) => (
                    <input key={order.sheetRowNumber} type="hidden" name="order" value={riskReference(order)} />
                  ))}
                  <RiskSubmitButton bulk classes="border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15">
                    Provjereno, pošalji sve ({ordersToApprove.length})
                  </RiskSubmitButton>
                </form>
              ) : null}
              {hasRiskResults ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowRisksOnly((value) => !value);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className="min-h-10 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.08]"
                >
                  {showRisksOnly ? "Prikaži sve" : "Samo upozorenja"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

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
            const risk = riskAssessments?.[order.sheetRowNumber];
            return (
              <article
                key={key}
                className={`rounded-[1.25rem] border px-4 py-3 ${risk?.unresolved ? "border-red-300/20 bg-red-300/[0.05]" : "border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]"}`}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(key)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-white">{order.primalac || "Bez imena"}</p>
                    {risk ? <div className="mt-2"><RiskBadge risk={risk} /></div> : null}
                    <p className="mt-1 break-words text-sm text-neutral-400">{order.artikal || "Bez artikla"}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      <span>{order.dateLabel || "-"}</span>
                      <span>•</span>
                      <span>{formatPostalLocation(order.grad)}</span>
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
                    <p><span className="text-neutral-500">Grad:</span> {formatPostalLocation(order.grad)}</p>
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
                    {allowRestoreToTransit ? <RestoreOrderForm order={order} fullWidth /> : null}
                    {risk ? <RiskDetails order={order} risk={risk} riskView={riskView} /> : null}
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
            {hasAction ? <span>Akcija</span> : null}
          </div>
          <div className="divide-y divide-white/[0.06]">
            {visibleOrders.map((order, index) => {
              const risk = riskAssessments?.[order.sheetRowNumber];
              return (
                <div
                  key={`${order.dateLabel}-${order.rowNumber}-${order.brojTelefona}`}
                  className={`grid ${desktopGridClass} items-start gap-3 px-3 py-3 text-sm text-neutral-300 transition hover:bg-white/[0.025] ${risk?.unresolved ? "bg-red-300/[0.035]" : ""}`}
                  role="row"
                >
                <span className="text-xs text-neutral-600">{index + 1}</span>
                <div className="min-w-0">
                  <p className="break-words font-semibold text-white">{order.primalac || "Bez imena"}</p>
                  {risk ? <div className="mt-2"><RiskBadge risk={risk} /></div> : null}
                  <p className="mt-1 text-xs text-neutral-500">{order.dateLabel || "-"}</p>
                  {risk ? <RiskDetails order={order} risk={risk} riskView={riskView} /> : null}
                </div>
                <p className="break-all text-neutral-300">{order.brojTelefona || "-"}</p>
                <div className="min-w-0">
                  <p className="break-words font-medium text-white">{formatPostalLocation(order.grad)}</p>
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
                {allowRestoreToTransit ? <RestoreOrderForm order={order} /> : null}
                </div>
              );
            })}
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
          Ukupna otkupnina: {roundOrderAmount(
            filteredOrders
              .filter((order) => !order.appStatus.startsWith("duplicate:"))
              .reduce((sum, order) => sum + parseOrderAmount(order.otkupnina), 0),
          )} KM
        </div>
      ) : null}
    </>
  );
}
