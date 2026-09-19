import assert from "node:assert/strict";

import { assessOrderRisks, unresolvedOrderRisks } from "../src/lib/order-risk.ts";

function order({
  row,
  name,
  phone,
  receivedAt,
  dateLabel = "10/09/2026",
  appStatus = "",
  riskReview = "",
}) {
  return {
    rowNumber: row,
    sheetRowNumber: row,
    fingerprint: `fp-${row}`,
    dateLabel,
    primalac: name,
    brojTelefona: phone,
    grad: "71000",
    adresa: "Adresa bb",
    artikal: "Artikal",
    brojPaketa: "1",
    otkupnina: "100",
    vrijednostPosiljke: "100",
    dop: "1",
    zamjena: "0",
    sourceId: `source-${row}`,
    appStatus,
    receivedAt,
    riskReview,
  };
}

const delivered = order({
  row: 10,
  name: "Amra Hadžić",
  phone: "061 111 222",
  receivedAt: "2026-09-08T08:00:00.000Z",
  appStatus: "delivered:one",
});
const current = order({
  row: 20,
  name: "Hadzic Amra",
  phone: "38761111222",
  receivedAt: "2026-09-10T08:00:00.000Z",
});
const returned = order({
  row: 5,
  name: "Jasmin Kovačević",
  phone: "062333444",
  receivedAt: "2026-08-01T08:00:00.000Z",
  appStatus: "returned:two",
});
const returnRepeat = order({
  row: 30,
  name: "Kovacevic Jasmin",
  phone: "38762333444",
  receivedAt: "2026-09-19T08:00:00.000Z",
});
const firstToday = order({
  row: 40,
  name: "Lejla Alić",
  phone: "063555666",
  receivedAt: "2026-09-19T09:00:00.000Z",
});
const secondToday = order({
  row: 41,
  name: "Lejla Alic",
  phone: "38763555666",
  receivedAt: "2026-09-19T10:00:00.000Z",
});
const oneWordName = order({
  row: 50,
  name: "Amra",
  phone: "",
  receivedAt: "2026-09-19T11:00:00.000Z",
});
const otherOneWordName = order({
  row: 51,
  name: "Amra",
  phone: "",
  receivedAt: "2026-09-19T11:30:00.000Z",
});

const all = [delivered, current, returned, returnRepeat, firstToday, secondToday, oneWordName, otherOneWordName];
const risks = assessOrderRisks([current, returnRepeat, firstToday, secondToday, otherOneWordName], all, [], new Date("2026-09-19T12:00:00.000Z"));

assert.equal(risks[20].level, "critical");
assert.equal(risks[20].deliveredCount, 1);
assert.match(risks[20].reasons.join(" "), /prije 2 dana/);
assert.equal(risks[30].level, "critical");
assert.match(risks[30].reasons.join(" "), /ranije imao povrat/);
assert.equal(risks[40].level, "none");
assert.equal(risks[41].level, "critical");
assert.equal(risks[51].level, "none");
assert.equal(unresolvedOrderRisks(risks).length, 3);

current.riskReview = `approved:${current.fingerprint}`;
const reviewed = assessOrderRisks([current], all, [], new Date("2026-09-19T12:00:00.000Z"));
assert.equal(reviewed[20].approved, true);
assert.equal(reviewed[20].unresolved, false);

console.log("Order risk tests passed.");
