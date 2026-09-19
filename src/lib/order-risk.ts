import type { SheetOrderRow } from "./google-sheets.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DUPLICATE_LOOKBACK_DAYS = 14;

export type OrderRiskLevel = "critical" | "warning" | "none";

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
  activeCount: number;
  lastOrderDaysAgo: number | null;
  lastOrderDate: string;
  lastOutcome: string;
};

function normalizePhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const normalized = digits.startsWith("387")
    ? digits
    : digits.startsWith("0")
      ? `387${digits.slice(1)}`
      : digits.startsWith("6")
        ? `387${digits}`
        : digits;
  return normalized.length >= 8 ? normalized : "";
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

function matchIdentity(current: SheetOrderRow, candidate: SheetOrderRow) {
  const currentPhone = normalizePhone(current.brojTelefona);
  const candidatePhone = normalizePhone(candidate.brojTelefona);
  const currentName = normalizeName(current.primalac);
  const candidateName = normalizeName(candidate.primalac);

  return {
    phone: Boolean(currentPhone && candidatePhone && currentPhone === candidatePhone),
    name: Boolean(currentName && candidateName && currentName === candidateName),
  };
}

function outcome(status: string) {
  if (status.startsWith("delivered:")) return "Dostavljeno";
  if (status.startsWith("returned:")) return "Povrat";
  if (status.startsWith("duplicate:")) return "Nije poslano";
  return "Na dostavi";
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
      .sort((left, right) => orderTime(right.candidate) - orderTime(left.candidate));

    const recentMatches = previousMatches.filter(({ candidate }) => {
      const previousTime = orderTime(candidate);
      if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return false;
      const age = currentTime - previousTime;
      return age >= 0 && age <= DUPLICATE_LOOKBACK_DAYS * DAY_MS;
    });
    const recentPhoneMatches = recentMatches.filter(({ match }) => match.phone);
    const recentNameMatches = recentMatches.filter(({ match }) => match.name);
    const activePhoneMatches = previousMatches.filter(({ candidate, match }) => match.phone && !candidate.appStatus);
    const historicalReturns = previousMatches.filter(({ candidate }) => candidate.appStatus.startsWith("returned:"));
    const returnSheetMatches = returnedOrders.filter((candidate) => {
      const match = matchIdentity(current, candidate);
      return match.phone || match.name;
    });

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

    const hasCriticalRisk = activePhoneMatches.length > 0
      || recentPhoneMatches.length > 0
      || historicalReturns.length > 0
      || returnSheetMatches.length > 0;
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
      unresolved: level !== "none" && !current.appStatus && !approved && !excluded,
      approved,
      excluded,
      reasons,
      recentMatchCount: recentMatches.length,
      deliveredCount: previousMatches.filter(({ candidate }) => candidate.appStatus.startsWith("delivered:")).length,
      returnedCount: Math.max(returnedCount, returnSheetMatches.length),
      activeCount: previousMatches.filter(({ candidate }) => !candidate.appStatus).length,
      lastOrderDaysAgo: Number.isFinite(latestTime) ? differenceInDays(nowTime, latestTime) : null,
      lastOrderDate: latestMatch?.dateLabel || "",
      lastOutcome: latestMatch ? outcome(latestMatch.appStatus) : "",
    };
  }

  return result;
}

export function unresolvedOrderRisks(risks: Record<number, OrderRiskAssessment>) {
  return Object.values(risks).filter((risk) => risk.unresolved);
}
