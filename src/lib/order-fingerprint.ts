import { createHash } from "node:crypto";

export type OrderIdentity = {
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

export function createOrderFingerprint(order: OrderIdentity) {
  const value = [
    order.primalac,
    order.brojTelefona,
    order.grad,
    order.adresa,
    order.artikal,
    order.brojPaketa,
    order.otkupnina,
    order.vrijednostPosiljke,
    order.dop,
    order.zamjena,
  ]
    .map((entry) => entry.trim())
    .join("\u001f");

  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
