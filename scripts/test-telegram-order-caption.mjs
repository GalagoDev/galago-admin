import assert from "node:assert/strict";

import {
  bosniaPostalCodes,
  getTelegramArticleOverrideText,
  normalizeTelegramPostalCode,
  parseTelegramArticleAndAmount,
  parseTelegramPackageCount,
  resolveTelegramPostalCode,
} from "../src/lib/telegram-orders.ts";
import { formatPostalLocation, lookupPlaceByPostalCode } from "../src/lib/bih-postal.ts";
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
assert.equal(
  getTelegramArticleOverrideText("Mihajlovic Sanja\n066-097-765\nUlice 7/12 Zvornik\nZola set\nSDS 209\nPaketa 2"),
  "Zola set\nSDS 209",
);
assert.deepEqual(
  parseTelegramArticleAndAmount(getTelegramArticleOverrideText("Zola set\nSDS 209\nPaketa 2")),
  { artikal: "Zola set", amount: "209" },
);

const packageCases = [
  ["Paketa 2", "2"],
  ["paket: 3", "3"],
  ["Broj paketa 4", "4"],
  ["2 paketa", "2"],
  ["Zola set SDS 209", ""],
];

for (const [input, expected] of packageCases) {
  assert.equal(parseTelegramPackageCount(input), expected, input);
}

const postalCases = [
  ["Foča", "73300"],
  ["Foca", "73300"],
  ["Goražde", "73000"],
  ["Gorazde", "73000"],
  ["Kadric Tarik Zaima Imamovica 27 Gorazde 067 129 6610", "73000"],
  ["Donji Vakuf", "70220"],
  ["Sanski Most", "79260"],
  ["79260 Sanski Most", "79260"],
  ["Jasmina Ikeljic Gornji Vojići bb Ključ (79280) broj 061-823-185", "79280"],
  ["Ključ", "79280"],
  ["Kozarska Dubica", "79240"],
  ["KoprivnaDonja Osoje", "74489"],
  ["Nikić Vida 066065991 KoprivnaDonja Osoje", "74489"],
  ["Gornji Podgradci", "78405"],
  ["Podgajevi Kršići", "75272"],
  ["Đurđevik", "75272"],
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
assert.equal(
  resolveTelegramPostalCode("Kršići", "Podgajevi", "Jahic asmira podgajevi krsici 062767215 Tanzi 89 sds"),
  "75272",
  "resolves Podgajevi from the original message even when the model returns only Kršići",
);

assert.ok(Object.keys(bosniaPostalCodes).length >= 400);

assert.equal(lookupPlaceByPostalCode("71000"), "Sarajevo");
assert.equal(formatPostalLocation("75000"), "75000 - Tuzla");
assert.equal(formatPostalLocation("73000"), "73000 - Goražde");
assert.equal(formatPostalLocation("75272"), "75272 - Đurđevik");
assert.equal(formatPostalLocation("78430"), "78430 - Prnjavor");
assert.equal(formatPostalLocation("88000"), "88000 - Mostar");
assert.equal(formatPostalLocation("88363"), "88363 - Berkovići");
assert.equal(formatPostalLocation("99999"), "99999");

assert.equal(parseOrderAmount("129.00"), 129);
assert.equal(parseOrderAmount("129,50 KM"), 129.5);
assert.equal(parseOrderAmount("1.250,50 KM"), 1250.5);
assert.equal(parseOrderAmount("1,250.50 KM"), 1250.5);

console.log(`Telegram parsing passed (${cases.length} caption and ${postalCases.length} ZIP cases).`);
