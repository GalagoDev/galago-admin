const PHONE_ERROR = "Broj telefona nedostaje ili nije potpun. Napiši cijeli broj telefona u poruci ili opisu slike i pošalji ponovo.";

function cleanDialText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, "").trim();
}

// Only change dialing prefixes. Never limit length or invent subscriber digits.
export function normalizeOrderPhone(value: unknown): string {
  const raw = cleanDialText(value);
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const international = raw.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("387")) return `387${digits.slice(3).replace(/^0/, "")}`;
  if (international) return digits;
  if (digits.startsWith("0")) return `387${digits.slice(1)}`;
  if (/^[3-6]\d{7,8}$/.test(digits)) return `387${digits}`;
  return digits;
}

export function isUsableOrderPhone(value: unknown): boolean {
  const raw = cleanDialText(value);
  if (!raw || /[^\d+\s()./\-\u2010-\u2014]/u.test(raw)) return false;
  const phone = normalizeOrderPhone(raw);
  // BiH numbering plan: 060, 064 and 067 have seven subscriber digits, not six.
  if (phone.startsWith("387")) return /^387(?:[3-5]\d{7}|6[12356]\d{6}|6[04789]\d{7}|70\d{6})$/.test(phone);
  return /^[1-9]\d{7,14}$/.test(phone);
}

export function phoneCandidatesFromText(text: string): string[] {
  // Horizontal separators only: a price or package count on the next line is not a phone digit.
  const matches = cleanDialText(text)
    .match(/(?<![\p{L}\d])(?:\+\d|00\d|387|0[3-6]|6\d)[\d \t\u00a0()./\-\u2010-\u2014]{3,}\d/gu) || [];
  return matches.flatMap((match) => match.split(/\s*(?:\/|,|;)\s*(?=(?:\+|00|0[3-6])\d)/u));
}

export function resolveOrderPhone(sourceText: string, extractedPhone = "", image = false): string {
  const candidates = phoneCandidatesFromText(sourceText);
  const unique = [...new Set(candidates.map(normalizeOrderPhone))];
  if (unique.length > 1) {
    throw new Error("Pronađeno je više brojeva telefona. Ostavi jedan broj za dostavu i pošalji ponovo.");
  }
  if (candidates.length) {
    if (!candidates.every(isUsableOrderPhone)) throw new Error(PHONE_ERROR);
    return unique[0];
  }
  // A model must never supply or repair digits that were absent from a text order.
  if (!image || !isUsableOrderPhone(extractedPhone)) throw new Error(PHONE_ERROR);
  return normalizeOrderPhone(extractedPhone);
}

export function verifyImagePhone(firstReading: string, secondReading: string): void {
  if (!isUsableOrderPhone(firstReading) || !isUsableOrderPhone(secondReading)
      || normalizeOrderPhone(firstReading) !== normalizeOrderPhone(secondReading)) {
    throw new Error("Broj telefona na slici nije pouzdano pročitan. Napiši cijeli broj u opisu slike i pošalji ponovo.");
  }
}
