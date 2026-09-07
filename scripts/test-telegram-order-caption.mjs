import assert from "node:assert/strict";

import { parseTelegramArticleAndAmount } from "../src/lib/telegram-orders.ts";

const cases = [
  ["SDS 89", { artikal: "SDS", amount: "89" }],
  ["SDS 89 KM", { artikal: "SDS", amount: "89" }],
  ["SDS - 89", { artikal: "SDS", amount: "89" }],
  ["SDS cijena: 89,90 KM", { artikal: "SDS", amount: "89.9" }],
  ["Nexo sto 120x60", { artikal: "Nexo sto 120x60", amount: "" }],
  ["SDS", { artikal: "SDS", amount: "" }],
];

for (const [input, expected] of cases) {
  assert.deepEqual(parseTelegramArticleAndAmount(input), expected, input);
}

console.log(`Telegram caption parsing passed (${cases.length} cases).`);
