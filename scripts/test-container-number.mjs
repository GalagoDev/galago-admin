import assert from "node:assert/strict";

import {
  inferContainerCarrier,
  isValidContainerNumber,
  normalizeContainerNumber,
} from "../src/lib/container-number.ts";

assert.equal(normalizeContainerNumber(" msmu-4017564 "), "MSMU4017564");
assert.equal(isValidContainerNumber("MSMU4017564"), true);
assert.equal(isValidContainerNumber("MSMU4017565"), false);
assert.equal(isValidContainerNumber("MSMU401756"), false);
assert.deepEqual(inferContainerCarrier("MSMU4017564"), { code: "MSC", name: "MSC" });
assert.deepEqual(inferContainerCarrier("TEMU1234567"), { code: "OTHERS", name: "Nepoznat prevoznik" });

console.log("Container number tests passed.");
