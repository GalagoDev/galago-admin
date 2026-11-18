import type { SheetOrderRow } from "./google-sheets.ts";
import { isUsableOrderPhone, normalizeOrderPhone } from "./order-phone.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DUPLICATE_LOOKBACK_DAYS = 14;

export type OrderRiskLevel = "critical" | "warning" | "none";
export type CarrierReturnContact = Pick<SheetOrderRow, "primalac" | "brojTelefona"> & { tracking: string; product?: string; statusAt?: string };
export type RiskOutcome = { label: string; source: string; tone: "good" | "bad" | "neutral" };
export type RiskHistoryEntry = {
  date: string; customer: string; product: string; amount: string; matchedBy: string; outcome: RiskOutcome;
};

export type OrderRiskAssessment = {
  sheetRowNumber: number;
  level: OrderRiskLevel;
  unresolved: boolean;
  approved: boolean;
  excluded: boolean;
  reasons: string[];
  recentMatchCount: number;
  deliveredCount: number;
  returnedCount: number;
  carrierReturnCount: number;
  activeCount: number;
  lastOrderDaysAgo: number | null;
  lastOrderDate: string;
  lastOutcome: string;
  history?: RiskHistoryEntry[];
  unlinkedReturns?: { tracking: string; product: string; date: string; matchedBy: string }[];
};

function normalizePhone(value: string) {
  return isUsableOrderPhone(value) ? normalizeOrderPhone(value) : "";
}

function normalizeName(value: string) {
  const tokens = String(value || "")
    .toLocaleLowerCase("bs-BA")
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  return tokens.length >= 2 ? tokens.join(" ") : "";
}

function dateLabelTime(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12);
}

function orderTime(order: SheetOrderRow) {
  const receivedAt = Date.parse(order.receivedAt);
  return Number.isFinite(receivedAt) ? receivedAt : dateLabelTime(order.dateLabel);
}

function isEarlier(candidate: SheetOrderRow, current: SheetOrderRow) {
  const candidateTime = orderTime(candidate);
  const currentTime = orderTime(current);
  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    if (candidateTime !== currentTime) return candidateTime < currentTime;
  }
  return candidate.sheetRowNumber < current.sheetRowNumber;
}

function matchIdentity(current: Pick<SheetOrderRow, "primalac" | "brojTelefona">, candidate: Pick<SheetOrderRow, "primalac" | "brojTelefona">) {
  const currentPhone = normalizePhone(current.brojTelefona);
  const candidatePhone = normalizePhone(candidate.brojTelefona);
  const currentName = normalizeName(current.primalac);
  const candidateName = normalizeName(candidate.primalac);

  return {
    phone: Boolean(currentPhone && candidatePhone && currentPhone === candidatePhone),
    name: Boolean(currentName && candidateName && currentName === candidateName),
  };
}

function outcome(order: SheetOrderRow) {
  if (order.appStatus.startsWith("returned:")) return "Povrat";
  if (order.appStatus.startsWith("duplicate:")) return "Nije poslano";
  if (order.appStatus.startsWith("delivered:") || order.deliveredChecked) return "Dostavljeno";
  return "Na dostavi";
}

function matchLabel(match: { name: boolean; phone: boolean }) {
  return match.name && match.phone ? "Ime i telefon" : match.phone ? "Isti telefon" : "Isto ime i prezime";
}

function historyEntry(order: SheetOrderRow, match: { name: boolean; phone: boolean }, result: RiskOutcome): RiskHistoryEntry {
  return { date: order.dateLabel, customer: order.primalac, product: order.artikal, amount: order.otkupnina,
    matchedBy: matchLabel(match), outcome: result };
}

function differenceInDays(later: number, earlier: number) {
  return Math.max(0, Math.floor((later - earlier) / DAY_MS));
}

function isApproved(order: SheetOrderRow) {
  return order.riskReview === `approved:${order.fingerprint}`;
}

function isExcluded(order: SheetOrderRow) {
  return order.appStatus === `duplicate:${order.fingerprint}`;
}

export function assessOrderRisks(
  currentOrders: SheetOrderRow[],
  allOrders: SheetOrderRow[],
  returnedOrders: SheetOrderRow[] = [],
  now = new Date(),
  carrierReturns: CarrierReturnContact[] = [],
  readHistoryOutcome?: (order: SheetOrderRow) => RiskOutcome,
) {
  const nowTime = now.getTime();
  const result: Record<number, OrderRiskAssessment> = {};

  for (const current of currentOrders) {
    const currentTime = orderTime(current);
    const previousMatches = allOrders
      .filter((candidate) => candidate.sheetRowNumber !== current.sheetRowNumber)
      .filter((candidate) => isEarlier(candidate, current))
      .map((candidate) => ({ candidate, match: matchIdentity(current, candidate) }))
      .filter(({ match }) => match.phone || match.name)
      .sort((left, right) => orderTime(right.candidate) - orderTime(left.candidate) || right.candidate.sheetRowNumber - left.candidate.sheetRowNumber);

    const recentMatches = previousMatches.filter(({ candidate }) => {
      const previousTime = orderTime(candidate);
      if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return false;
      const age = currentTime - previousTime;
      return age >= 0 && age <= DUPLICATE_LOOKBACK_DAYS * DAY_MS;
    });
    const recentPhoneMatches = recentMatches.filter(({ match }) => match.phone);
    const recentNameMatches = recentMatches.filter(({ match }) => match.name);
    const activePhoneMatches = previousMatches.filter(({ candidate, match }) => match.phone && !candidate.appStatus && !candidate.deliveredChecked);
    const historicalReturns = previousMatches.filter(({ candidate }) => candidate.appStatus.startsWith("returned:"));
    const returnSheetMatches = returnedOrders.filter((candidate) => {
      const match = matchIdentity(current, candidate);
      return match.phone || match.name;
    });
    const carrierMatches = carrierReturns.filter((candidate) => {
      const match = matchIdentity(current, candidate);
      return match.phone || match.name;
    });
    const carrierReturnCount = new Set(carrierMatches.map((candidate) => candidate.tracking)).size;

    const reasons: string[] = [];
    if (activePhoneMatches.length > 0) reasons.push("Isti telefon već ima aktivnu pošiljku.");
    if (recentPhoneMatches.length > 0) {
      const latest = recentPhoneMatches[0]?.candidate;
      const days = latest ? differenceInDays(currentTime, orderTime(latest)) : 0;
      reasons.push(`Isti telefon je korišten prije ${days} ${days === 1 ? "dan" : "dana"}.`);
    } else if (recentNameMatches.length > 0) {
      const latest = recentNameMatches[0]?.candidate;
      const days = latest ? differenceInDays(currentTime, orderTime(latest)) : 0;
      reasons.push(`Isto ime i prezime je korišteno prije ${days} ${days === 1 ? "dan" : "dana"}.`);
    }
    if (historicalReturns.length > 0 || returnSheetMatches.length > 0) {
      reasons.push("Kupac je ranije imao povrat.");
    }
    if (carrierReturnCount > 0) {
      reasons.push("Express One email bilježi povrat za ovog kupca; povezivanje narudžbe čeka provjeru.");
    }

    const hasCriticalRisk = activePhoneMatches.length > 0
      || recentPhoneMatches.length > 0
      || historicalReturns.length > 0
      || returnSheetMatches.length > 0
      || carrierReturnCount > 0;
    const hasWarningRisk = !hasCriticalRisk && recentNameMatches.length > 0;
    const level: OrderRiskLevel = hasCriticalRisk ? "critical" : hasWarningRisk ? "warning" : "none";
    const approved = isApproved(current);
    const excluded = isExcluded(current);
    const latestMatch = previousMatches[0]?.candidate;
    const latestTime = latestMatch ? orderTime(latestMatch) : Number.NaN;
    const returnedCount = previousMatches.filter(({ candidate }) => candidate.appStatus.startsWith("returned:")).length;

    result[current.sheetRowNumber] = {
      sheetRowNumber: current.sheetRowNumber,
      level,
      unresolved: level !== "none" && !current.appStatus && !current.deliveredChecked && !approved && !excluded,
      approved,
      excluded,
      reasons,
      recentMatchCount: recentMatches.length,
      deliveredCount: previousMatches.filter(({ candidate }) => outcome(candidate) === "Dostavljeno").length,
      returnedCount: Math.max(returnedCount, returnSheetMatches.length),
      carrierReturnCount,
      activeCount: previousMatches.filter(({ candidate }) => !candidate.appStatus && !candidate.deliveredChecked).length,
      lastOrderDaysAgo: Number.isFinite(latestTime) ? differenceInDays(nowTime, latestTime) : null,
      lastOrderDate: latestMatch?.dateLabel || "",
      lastOutcome: latestMatch ? outcome(latestMatch) : "",
    };
    if (readHistoryOutcome && level !== "none") {
      const history = previousMatches.map(({ candidate, match }) => historyEntry(candidate, match, readHistoryOutcome(candidate)));
      // Some legacy returns exist only in the returns sheet. Its date is the return date, not the order date.
      for (const archived of returnSheetMatches) {
        if (historicalReturns.some(({ candidate }) => candidate.appStatus === `returned:${archived.sourceId}`)) continue;
        history.push(historyEntry(archived, matchIdentity(current, archived),
          { label: "Povrat", source: "Evidencija povrata · datum povrata", tone: "bad" }));
      }
      result[current.sheetRowNumber].history = history;
      if (carrierMatches.length) result[current.sheetRowNumber].unlinkedReturns = carrierMatches
        .slice().sort((a,b) => (b.statusAt || "").localeCompare(a.statusAt || ""))
        .map(m => ({ tracking: m.tracking, product: m.product || "", date: (m.statusAt || "").slice(0,10).split("-").reverse().join("."),
          matchedBy: matchLabel(matchIdentity(current, m)) }));
    }
  }

  return result;
}

export function unresolvedOrderRisks(risks: Record<number, OrderRiskAssessment>) {
  return Object.values(risks).filter((risk) => risk.unresolved);
}
