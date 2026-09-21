import assert from "node:assert/strict";

import { getOperationalExportWindow, getTargetWorkdayLabel, getWorkdayCycle } from "../src/lib/order-workday.ts";

function iso(value) {
  return new Date(value);
}

{
  const window = getOperationalExportWindow(iso("2026-09-09T10:00:00Z"));
  assert.equal(window.start.toISOString(), "2026-09-08T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-09T06:00:00.000Z");
  assert.equal(window.endLabel, "09/09/2026");
}

{
  const window = getOperationalExportWindow(iso("2026-09-09T05:59:00Z"));
  assert.equal(window.start.toISOString(), "2026-09-08T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-09T06:00:00.000Z");
}

{
  const window = getOperationalExportWindow(iso("2026-09-14T10:00:00Z"));
  assert.equal(window.start.toISOString(), "2026-09-11T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-14T06:00:00.000Z");
}

{
  const beforeMondayCutoff = getOperationalExportWindow(iso("2026-09-14T05:59:00Z"));
  assert.equal(beforeMondayCutoff.start.toISOString(), "2026-09-11T06:00:00.000Z");
  assert.equal(beforeMondayCutoff.end.toISOString(), "2026-09-14T06:00:00.000Z");

  const atMondayCutoff = getOperationalExportWindow(iso("2026-09-14T06:00:00Z"));
  assert.equal(atMondayCutoff.start.toISOString(), "2026-09-11T06:00:00.000Z");
  assert.equal(atMondayCutoff.end.toISOString(), "2026-09-14T06:00:00.000Z");
  assert.equal(atMondayCutoff.startLabel, "11/09/2026");
  assert.equal(atMondayCutoff.endLabel, "14/09/2026");
}

for (const weekendTime of ["2026-09-12T05:59:00Z", "2026-09-12T10:00:00Z", "2026-09-13T10:00:00Z"]) {
  const window = getOperationalExportWindow(iso(weekendTime));
  assert.equal(window.start.toISOString(), "2026-09-11T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-14T06:00:00.000Z");
}

assert.equal(getTargetWorkdayLabel(iso("2026-09-09T05:59:00Z")), "09/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-09T06:00:00Z")), "10/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-11T06:00:00Z")), "14/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-12T05:59:00Z")), "14/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-12T10:00:00Z")), "14/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-13T10:00:00Z")), "14/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-14T05:59:00Z")), "14/09/2026");
assert.equal(getTargetWorkdayLabel(iso("2026-09-14T06:00:00Z")), "15/09/2026");

{
  const cycle = getWorkdayCycle("2026-09-22");
  assert.equal(cycle.start.toISOString(), "2026-09-21T06:00:00.000Z");
  assert.equal(cycle.end.toISOString(), "2026-09-22T06:00:00.000Z");
  assert.deepEqual(cycle.metaDateKeys, ["2026-09-21"]);
  assert.equal(cycle.spansWeekend, false);
}

{
  const cycle = getWorkdayCycle("2026-09-21");
  assert.equal(cycle.start.toISOString(), "2026-09-18T06:00:00.000Z");
  assert.equal(cycle.end.toISOString(), "2026-09-21T06:00:00.000Z");
  assert.deepEqual(cycle.metaDateKeys, ["2026-09-18", "2026-09-19", "2026-09-20"]);
  assert.equal(cycle.spansWeekend, true);
}

console.log("Order export window tests passed.");
