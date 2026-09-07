import assert from "node:assert/strict";

import { normalizeTelegramPostalCode, parseTelegramArticleAndAmount } from "../src/lib/telegram-orders.ts";

const cases = [
  ["Komoda serena\nSds 139", { artikal: "Komoda serena", amount: "139" }],
  ["Komoda serena SDS: 139 KM", { artikal: "Komoda serena", amount: "139" }],
  ["SDS 89", { artikal: "", amount: "89" }],
  ["Komoda serena - 139", { artikal: "Komoda serena", amount: "139" }],
  ["Komoda serena cijena: 89,90 KM", { artikal: "Komoda serena", amount: "89.9" }],
  ["Nexo sto 120x60", { artikal: "Nexo sto 120x60", amount: "" }],
];

for (const [input, expected] of cases) {
  assert.deepEqual(parseTelegramArticleAndAmount(input), expected, input);
}

const postalCases = [
  ["Foča", "73300"],
  ["Foca", "73300"],
  ["Donji Vakuf", "70220"],
  ["Sanski Most", "79260"],
  ["79260 Sanski Most", "79260"],
  ["Nepoznato mjesto", ""],
];

for (const [input, expected] of postalCases) {
  assert.equal(normalizeTelegramPostalCode(input), expected, input);
}

console.log(`Telegram parsing passed (${cases.length} caption and ${postalCases.length} ZIP cases).`);
