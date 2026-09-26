import { OFFICIAL_BIH_POSTAL_DIRECTORY } from "./bih-postal-directory.ts";

const PREFERRED_POSTAL_CODES: Record<string, string> = {
  sarajevo: "71000",
  "banja luka": "78000",
  tuzla: "75000",
  zenica: "72000",
  mostar: "88000",
  bijeljina: "76300",
  brcko: "76000",
  bihac: "77000",
  cazin: "77220",
  travnik: "72270",
  visoko: "71300",
  gradacac: "76250",
  gracanica: "75320",
  konjic: "88400",
  bugojno: "70230",
  trebinje: "89101",
  doboj: "74000",
  prijedor: "79101",
  zivinice: "75270",
  kalesija: "75260",
  lukavac: "75300",
  kakanj: "72240",
  maglaj: "74250",
  rogatica: "73220",
  grude: "88340",
  vitez: "72250",
  jablanica: "88420",
  banovici: "75290",
  kozarac: "79202",
  "han bila": "72245",
  cajnice: "73280",
  "han pijesak": "71360",
  "bosanska krupa": "77240",
  "donji vakuf": "70220",
  foca: "73300",
  gorazde: "73000",
  "sanski most": "79260",
  turbe: "72283",
  laktasi: "78250",
  kljuc: "79280",
  "kozarska dubica": "79240",
  "koprivna donja": "74489",
  koprivnadonja: "74489",
  "donja koprivna": "77222",
};

export function normalizeBosnianText(value: string) {
  return String(value || "")
    .toLocaleLowerCase("bs-BA")
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const officialEntries = OFFICIAL_BIH_POSTAL_DIRECTORY.map(([place, postalCode]) => ({
  place,
  normalized: normalizeBosnianText(place),
  postalCode,
}));

const primaryPlaceLabels = new Map<string, string>();
const postalCodes: Record<string, string> = {};

for (const entry of officialEntries) {
  if (!entry.normalized || postalCodes[entry.normalized]) continue;
  postalCodes[entry.normalized] = entry.postalCode;
  primaryPlaceLabels.set(entry.normalized, entry.place);
}

for (const [place, postalCode] of Object.entries(PREFERRED_POSTAL_CODES)) {
  const normalized = normalizeBosnianText(place);
  postalCodes[normalized] = postalCode;
  if (!primaryPlaceLabels.has(normalized)) primaryPlaceLabels.set(normalized, place);
}

export const BIH_POSTAL_CODES: Record<string, string> = Object.freeze(postalCodes);

const placeByPostalCode = new Map<string, string>();
for (const entry of officialEntries) {
  if (!placeByPostalCode.has(entry.postalCode)) placeByPostalCode.set(entry.postalCode, entry.place);
}
for (const [place, postalCode] of Object.entries(PREFERRED_POSTAL_CODES)) {
  const normalized = normalizeBosnianText(place);
  placeByPostalCode.set(postalCode, primaryPlaceLabels.get(normalized) || place);
}

const searchablePlaces = Object.keys(BIH_POSTAL_CODES).sort((left, right) => right.length - left.length);

export function lookupPostalCode(value: string) {
  return BIH_POSTAL_CODES[normalizeBosnianText(value)] || null;
}

export function lookupPlaceByPostalCode(value: string) {
  const postalCode = String(value || "").match(/\b\d{5}\b/)?.[0];
  return postalCode ? placeByPostalCode.get(postalCode) || null : null;
}

export function formatPostalLocation(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const postalCode = raw.match(/\b\d{5}\b/)?.[0];
  if (!postalCode) return raw;
  const place = lookupPlaceByPostalCode(postalCode);
  return place ? `${postalCode} - ${place}` : postalCode;
}

export function detectPostalFromText(text: string) {
  const normalizedText = normalizeBosnianText(text);
  if (!normalizedText) return null;

  const exactPostalCode = BIH_POSTAL_CODES[normalizedText];
  if (exactPostalCode) {
    return {
      city: primaryPlaceLabels.get(normalizedText) || normalizedText,
      postalCode: exactPostalCode,
    };
  }

  const paddedText = ` ${normalizedText} `;
  for (const place of searchablePlaces) {
    if (paddedText.includes(` ${place} `)) {
      return {
        city: primaryPlaceLabels.get(place) || place,
        postalCode: BIH_POSTAL_CODES[place],
      };
    }
  }

  const textParts = normalizedText.split(" ");
  for (const place of searchablePlaces) {
    const compactPlace = place.replace(/ /g, "");
    if (compactPlace.length < 8) continue;
    if (textParts.some((part) => part.includes(compactPlace))) {
      return {
        city: primaryPlaceLabels.get(place) || place,
        postalCode: BIH_POSTAL_CODES[place],
      };
    }
  }

  return null;
}
