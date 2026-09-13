import assert from "node:assert/strict";

import {
  bosniaPostalCodes,
  getTelegramArticleOverrideText,
  normalizeTelegramPostalCode,
  parseTelegramArticleAndAmount,
  resolveTelegramPostalCode,
} from "../src/lib/telegram-orders.ts";
import { parseOrderAmount } from "../src/lib/order-amount.ts";

const cases = [
  ["Komoda serena\nSds 139", { artikal: "Komoda serena", amount: "139" }],
  ["Komoda serena SDS: 139 KM", { artikal: "Komoda serena", amount: "139" }],
  ["Komoda Kibo 129 sds", { artikal: "Komoda Kibo", amount: "129" }],
  ["SDS 89", { artikal: "", amount: "89" }],
  ["Komoda serena - 139", { artikal: "Komoda serena", amount: "139" }],
  ["Komoda serena cijena: 89,90 KM", { artikal: "Komoda serena", amount: "89.9" }],
  ["Nexo sto 120x60", { artikal: "Nexo sto 120x60", amount: "" }],
];

for (const [input, expected] of cases) {
  assert.deepEqual(parseTelegramArticleAndAmount(input), expected, input);
}

assert.equal(
  getTelegramArticleOverrideText("ZINETA ZVIRAC\nSAFETA ZAJKE 226 71000 SARAJEVO\nBR.TFN. 062 541 141\nLewa gold\nSds 95"),
  "Lewa gold\nSds 95",
);
assert.deepEqual(
  parseTelegramArticleAndAmount(getTelegramArticleOverrideText("Kozarska Dubica, Studenička ulica 066 998 073\n\nMara white\nSds 119")),
  { artikal: "Mara white", amount: "119" },
);

const postalCases = [
  ["Foča", "73300"],
  ["Foca", "73300"],
  ["Donji Vakuf", "70220"],
  ["Sanski Most", "79260"],
  ["79260 Sanski Most", "79260"],
  ["Jasmina Ikeljic Gornji Vojići bb Ključ (79280) broj 061-823-185", "79280"],
  ["Ključ", "79280"],
  ["Kozarska Dubica", "79240"],
  ["KoprivnaDonja Osoje", "74489"],
  ["Nikić Vida 066065991 KoprivnaDonja Osoje", "74489"],
  ["Gornji Podgradci", "78405"],
  ["Medjuvodje", "79247"],
  ["Nepoznato mjesto", ""],
];

for (const [input, expected] of postalCases) {
  assert.equal(normalizeTelegramPostalCode(input), expected, input);
}

assert.equal(
  resolveTelegramPostalCode("", "Gornji Vojići bb Ključ", "Jasmina Ikeljic Gornji Vojići bb Ključ (79280) broj 061-823-185"),
  "79280",
  "falls back to the original Telegram message when OpenAI leaves Grad empty",
);

assert.ok(Object.keys(bosniaPostalCodes).length >= 400);

assert.equal(parseOrderAmount("129.00"), 129);
assert.equal(parseOrderAmount("129,50 KM"), 129.5);
assert.equal(parseOrderAmount("1.250,50 KM"), 1250.5);
assert.equal(parseOrderAmount("1,250.50 KM"), 1250.5);

console.log(`Telegram parsing passed (${cases.length} caption and ${postalCases.length} ZIP cases).`);
