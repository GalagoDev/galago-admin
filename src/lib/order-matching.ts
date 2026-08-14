import type { SheetOrderRow } from "@/lib/google-sheets";

export type CourierDeliveryRow = {
  sourceRowNumber: number;
  recipient: string;
  city: string;
  amount: number | null;
  product: string;
};

export type DeliveryMatch = {
  source: CourierDeliveryRow;
  order: SheetOrderRow;
  reason: string;
};

export type DeliveryMatchResult = {
  matches: DeliveryMatch[];
  ambiguous: Array<{ source: CourierDeliveryRow; candidates: string[] }>;
  unmatched: CourierDeliveryRow[];
};

export function normalizeMatchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeNameTokens(value: string) {
  return normalizeMatchText(value).split(" ").filter(Boolean).sort().join(" ");
}

function parseAmount(value: string) {
  const amount = Number(value.replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : null;
}

function candidateScore(source: CourierDeliveryRow, order: SheetOrderRow) {
  let score = 0;
  const orderAmount = parseAmount(order.otkupnina);
  if (source.amount !== null && orderAmount !== null && Math.abs(source.amount - orderAmount) < 0.01) score += 4;

  const product = normalizeMatchText(source.product);
  const orderProduct = normalizeMatchText(order.artikal);
  if (product && orderProduct && (product.includes(orderProduct) || orderProduct.includes(product))) score += 2;

  const city = normalizeMatchText(source.city);
  const location = normalizeMatchText(`${order.grad} ${order.adresa}`);
  if (city && location.includes(city)) score += 1;

  return score;
}

export function matchCourierDeliveries(sourceRows: CourierDeliveryRow[], orders: SheetOrderRow[]): DeliveryMatchResult {
  const matches: DeliveryMatch[] = [];
  const ambiguous: DeliveryMatchResult["ambiguous"] = [];
  const unmatched: CourierDeliveryRow[] = [];
  const usedOrderRows = new Set<number>();

  for (const source of sourceRows) {
    const normalizedRecipient = normalizeMatchText(source.recipient);
    const recipientTokens = normalizeNameTokens(source.recipient);
    const candidates = orders.filter((order) => {
      if (usedOrderRows.has(order.sheetRowNumber)) return false;
      const normalizedOrderName = normalizeMatchText(order.primalac);
      return normalizedOrderName === normalizedRecipient || normalizeNameTokens(order.primalac) === recipientTokens;
    });

    if (candidates.length === 0) {
      unmatched.push(source);
      continue;
    }

    if (candidates.length === 1) {
      const order = candidates[0];
      usedOrderRows.add(order.sheetRowNumber);
      matches.push({ source, order, reason: "Ime se podudara" });
      continue;
    }

    const scored = candidates
      .map((order) => ({ order, score: candidateScore(source, order) }))
      .sort((a, b) => b.score - a.score);
    const winner = scored[0];
    const runnerUp = scored[1];

    if (winner.score > runnerUp.score) {
      usedOrderRows.add(winner.order.sheetRowNumber);
      matches.push({
        source,
        order: winner.order,
        reason: winner.score >= 4 ? "Ime i iznos se podudaraju" : "Ime i dodatni podaci se podudaraju",
      });
      continue;
    }

    ambiguous.push({ source, candidates: candidates.map((order) => order.primalac) });
  }

  return { matches, ambiguous, unmatched };
}
