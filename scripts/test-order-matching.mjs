import assert from "node:assert/strict";

import { matchCourierDeliveries } from "../src/lib/order-matching.ts";

function order(sheetRowNumber, primalac, otkupnina = "", artikal = "", adresa = "") {
  return {
    rowNumber: sheetRowNumber,
    sheetRowNumber,
    fingerprint: `fingerprint-${sheetRowNumber}`,
    dateLabel: "14/08/2026",
    primalac,
    brojTelefona: "",
    grad: "",
    adresa,
    artikal,
    brojPaketa: "1",
    otkupnina,
    vrijednostPosiljke: otkupnina,
    dop: "1",
    zamjena: "0",
  };
}

const result = matchCourierDeliveries(
  [
    { sourceRowNumber: 2, recipient: "SANELA KUVAC", city: "BANJA LUKA", amount: 690, product: "10 NOMA" },
    { sourceRowNumber: 3, recipient: "Zecic Nazir", city: "KONJIC", amount: 109, product: "VELIKA MINKA" },
    { sourceRowNumber: 4, recipient: "Edina", city: "SARAJEVO", amount: 179, product: "GAMING 120" },
    { sourceRowNumber: 5, recipient: "Nepoznat Kupac", city: "", amount: null, product: "" },
  ],
  [
    order(8, "Sanela Kuvač", "690 KM", "10 NOMA BE SPORUKA 1", "Banja Luka"),
    order(9, "Nazir Zecić", "109 KM", "Velika Minka", "Konjic"),
    order(10, "Edina", "89 KM", "Mala Minka", "Sarajevo"),
    order(11, "Edina", "179 KM", "Gaming 120", "Sarajevo"),
  ],
);

assert.equal(result.matches.length, 3);
assert.equal(result.matches[0].order.sheetRowNumber, 8);
assert.equal(result.matches[1].order.sheetRowNumber, 9);
assert.equal(result.matches[2].order.sheetRowNumber, 11);
assert.deepEqual(result.unmatched.map((entry) => entry.recipient), ["Nepoznat Kupac"]);
assert.equal(result.ambiguous.length, 0);

console.log("Order matching tests passed.");
