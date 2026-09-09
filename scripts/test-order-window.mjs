import assert from "node:assert/strict";

import { getLatestCompletedExportWindow, getTargetWorkdayLabel } from "../src/lib/order-workday.ts";

function iso(value) {
  return new Date(value);
}

{
  const window = getLatestCompletedExportWindow(iso("2026-09-09T10:00:00Z"));
  assert.equal(window.start.toISOString(), "2026-09-08T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-09T06:00:00.000Z");
  assert.equal(window.endLabel, "09/09/2026");
}

{
  const window = getLatestCompletedExportWindow(iso("2026-09-09T05:59:00Z"));
  assert.equal(window.start.toISOString(), "2026-09-07T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-08T06:00:00.000Z");
}

{
  const window = getLatestCompletedExportWindow(iso("2026-09-14T10:00:00Z"));
  assert.equal(window.start.toISOString(), "2026-09-11T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-14T06:00:00.000Z");
}

assert.equal(getTargetWorkdayLabel(iso("2026-09-09T05:59:00Z")), "09/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-09T06:00:00Z")), "10/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-11T06:00:00Z")), "14/09/2026");

console.log("Order export window tests passed.");
