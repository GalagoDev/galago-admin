import type { ParsedOrder } from "@/lib/parse-order";

export type ConfirmableOrder = {
  primalac: string;
  brojTelefona: string;
  grad: string;
  adresa: string;
  artikal: string;
  brojPaketa: string;
  otkupnina: string;
  vrijednostPosiljke: string;
  dop: string;
  zamjena: string;
};

export function parsedOrderToConfirmableOrder(parsed: ParsedOrder): ConfirmableOrder {
  const amount = parsed.quantity ? String(parsed.quantity) : "";

  return {
    primalac: parsed.customerName || "",
    brojTelefona: parsed.phone || "",
    grad: parsed.city || "",
    adresa: parsed.address || "",
    artikal: parsed.productSummary || "",
    brojPaketa: "1",
    otkupnina: amount,
    vrijednostPosiljke: amount,
    dop: "1",
    zamjena: "0",
  };
}

export function formatOrderPreview(order: ConfirmableOrder) {
  return [
    `Primalac: ${order.primalac || "-"}`,
    `Broj telefona: ${order.brojTelefona || "-"}`,
    `Grad: ${order.grad || "-"}`,
    `Adresa: ${order.adresa || "-"}`,
    `Artikal: ${order.artikal || "-"}`,
    `Broj paketa: ${order.brojPaketa || "-"}`,
    `Otkupnina: ${order.otkupnina || "-"}`,
    `Vrijednost posiljke: ${order.vrijednostPosiljke || "-"}`,
    `DOP: ${order.dop || "-"}`,
    `Zamjena: ${order.zamjena || "-"}`,
  ].join("\n");
}
