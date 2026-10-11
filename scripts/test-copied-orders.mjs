import assert from "node:assert/strict";

import { findCopiedOrderRows } from "../src/lib/copied-orders.ts";

function row(sheetRowNumber, dateLabel, overrides = {}) {
  return {
    sheetRowNumber,
    dateLabel,
    sourceId: "shopify:123",
    appStatus: "delivered:original",
    receivedAt: "2026-10-03T19:49:52.316Z",
    deliveredChecked: true,
    ...overrides,
  };
}

const original = row(290, "05/10/2026");
const copied = row(88, "09/10/2026", { deliveredChecked: false });
const sameDayCopy = row(291, "05/10/2026", { deliveredChecked: false });
const fullRowSameDayCopy = row(292, "05/10/2026");
const independentlyDelivered = row(18, "12/10/2026", { appStatus: "delivered:new-delivery" });
const newIntake = row(19, "12/10/2026", {
  appStatus: "",
  receivedAt: "2026-10-11T09:19:09.455Z",
  deliveredChecked: false,
});

assert.deepEqual(findCopiedOrderRows([copied, original], new Set(["09/10/2026"])), [copied]);
assert.deepEqual(findCopiedOrderRows([sameDayCopy, original], new Set(["05/10/2026"])), [sameDayCopy]);
assert.deepEqual(findCopiedOrderRows([fullRowSameDayCopy, original], new Set(["05/10/2026"])), [fullRowSameDayCopy]);
assert.deepEqual(findCopiedOrderRows([sameDayCopy, original], new Set(["05/10/2026"])).includes(original), false);
assert.deepEqual(findCopiedOrderRows([original, independentlyDelivered, newIntake], new Set(["12/10/2026"])), []);
assert.deepEqual(findCopiedOrderRows([copied, original], new Set(["12/10/2026"])), []);

const copiedCheckbox = row(20, "12/10/2026");
assert.deepEqual(findCopiedOrderRows([copiedCheckbox, original], new Set(["12/10/2026"])), [copiedCheckbox]);

const returnedOriginal = row(320, "05/10/2026", { appStatus: "returned:return-a" });
const deliveredAgain = row(100, "09/10/2026", { appStatus: "delivered:delivery-b" });
assert.deepEqual(findCopiedOrderRows([deliveredAgain, returnedOriginal], new Set(["09/10/2026"])), []);

console.log("Copied order tests passed.");
