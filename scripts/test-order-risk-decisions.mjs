import assert from "node:assert/strict";

import { planOrderRiskDecisions } from "../src/lib/order-risk-decisions.ts";
import { parseSheetOrderRows } from "../src/lib/sheet-order-parser.ts";
import { assessOrderRisks } from "../src/lib/order-risk.ts";

const header = ["Primalac", "Telefon", "Grad", "Adresa", "Artikal", "Paketa", "Otkupnina", "Vrijednost", "DOP", "Zamjena", "Source", "Status", "Received at", "Export marker", "Risk review", "Dostavljeno"];
const row = (name, id, status = "", delivered = false) => [name, "061111222", "71000", "Adresa bb", "Artikal", "1", "95", "95", "1", "0", id, status, "2026-10-14T06:00:00.000Z", "", "", delivered];
const rows = [header, [], ["14/10/2026"], [], row("Kupac A", "a"), row("Kupac B", "b")];
const orders = parseSheetOrderRows("Orders", rows);
const reference = (order) => ({ sheetRowNumber: order.sheetRowNumber, fingerprint: order.fingerprint, dateLabel: order.dateLabel, sourceId: order.sourceId });
const references = orders.map(reference);
assert.equal(orders.length, 2);
assert.equal(orders[0].sheetRowNumber, 5);
assert.equal(orders[0].dateLabel, "14/10/2026");

const approved = planOrderRiskDecisions(orders, references, "approve");
assert.equal(approved.length, 2);
assert.ok(approved.every((update) => update.changeReview && !update.changeStatus && update.appStatus === ""));
assert.equal(approved[0].riskReview, `approved:${orders[0].fingerprint}`);
assert.equal(orders[0].riskReview, "", "planning does not mutate cached orders");

const alreadyApproved = orders.map((order) => ({ ...order, riskReview: `approved:${order.fingerprint}` }));
assert.ok(planOrderRiskDecisions(alreadyApproved, references, "approve").every((update) => !update.changeReview && !update.changeStatus));

const moved = orders.map((order) => ({ ...order, sheetRowNumber: order.sheetRowNumber + 8 }));
assert.deepEqual(planOrderRiskDecisions(moved, references, "approve").map((update) => update.sheetRowNumber), [13, 14]);
const olderCopy = { ...orders[0], dateLabel: "13/10/2026", sheetRowNumber: 20, appStatus: "delivered:old" };
assert.equal(planOrderRiskDecisions([olderCopy, ...orders], [references[0]], "approve")[0].sheetRowNumber, 5);

assert.throws(() => planOrderRiskDecisions(orders, [], "approve"), /Invalid/);
assert.throws(() => planOrderRiskDecisions(orders, [references[0], references[0]], "approve"), /more than once/);
assert.throws(() => planOrderRiskDecisions(orders, [references[0], { ...references[1], fingerprint: "changed" }], "approve"), /changed/);
assert.throws(() => planOrderRiskDecisions(orders, [{ ...references[0], sourceId: "other" }], "approve"), /changed/);
assert.throws(() => planOrderRiskDecisions(orders, [{ ...references[0], dateLabel: "13/10/2026" }], "approve"), /changed/);
assert.throws(() => planOrderRiskDecisions([moved[0], { ...moved[0], sheetRowNumber: 30 }], [references[0]], "approve"), /changed/);

for (const status of ["delivered:x", "returned:x", `duplicate:${orders[1].fingerprint}`]) {
  assert.throws(() => planOrderRiskDecisions([orders[0], { ...orders[1], appStatus: status }], references, "approve"), /active order/);
}
const checked = { ...orders[1], deliveredChecked: true };
assert.throws(() => planOrderRiskDecisions([orders[0], checked], references, "approve"), /active order/);
const checkedRisk = assessOrderRisks([checked], [orders[0], checked], [], new Date("2026-10-14T07:00:00Z"));
assert.equal(checkedRisk[checked.sheetRowNumber].unresolved, false);

const duplicate = planOrderRiskDecisions(orders, [references[0]], "duplicate")[0];
assert.equal(duplicate.appStatus, `duplicate:${orders[0].fingerprint}`);
assert.ok(duplicate.changeStatus);
const restored = planOrderRiskDecisions([{ ...orders[0], ...duplicate }], [references[0]], "restore")[0];
assert.equal(restored.appStatus, "");
assert.equal(restored.riskReview, "");
assert.throws(() => planOrderRiskDecisions(orders, [references[0]], "restore"), /not marked/);

const manyOrders = Array.from({ length: 60 }, (_, index) => ({ ...orders[0], sheetRowNumber: index + 4, sourceId: `source-${index}` }));
assert.equal(planOrderRiskDecisions(manyOrders, manyOrders.map(reference), "approve").length, 60, "bulk selection is not limited to a visible page");

const parsedChecked = parseSheetOrderRows("Orders", [header, ["14/10/2026"], row("Kupac", "id", "", "TRUE")]);
assert.equal(parsedChecked[0].deliveredChecked, true);
assert.equal(parseSheetOrderRows("Povrati", [header, ["14/10/2026"], row("Kupac", "restored:id")]).length, 0);
const zeroAmount = row("Kupac", "id");
zeroAmount[6] = "0";
assert.equal(parseSheetOrderRows("Orders", [header, ["14/10/2026"], zeroAmount])[0].otkupnina, "0");

console.log("Order risk batch decisions and sheet parsing tests passed.");
