export function normalizeContainerNumber(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 11);
}

function iso6346LetterValue(letter: string) {
  const value = letter.charCodeAt(0) - 55;
  return value + Math.floor((value - 1) / 10);
}

export function isValidContainerNumber(value: string) {
  const number = normalizeContainerNumber(value);
  if (!/^[A-Z]{4}\d{7}$/.test(number)) return false;

  const characters = number.slice(0, 10).split("");
  const total = characters.reduce((sum, character, index) => {
    const value = /\d/.test(character) ? Number(character) : iso6346LetterValue(character);
    return sum + value * 2 ** index;
  }, 0);
  const expected = (total % 11) % 10;
  return expected === Number(number[10]);
}

export function inferContainerCarrier(value: string) {
  const prefix = normalizeContainerNumber(value).slice(0, 4);
  const known: Record<string, { code: string; name: string }> = {
    MSCU: { code: "MSC", name: "MSC" },
    MSMU: { code: "MSC", name: "MSC" },
    MEDU: { code: "MSC", name: "MSC" },
  };
  return known[prefix] || { code: "OTHERS", name: "Nepoznat prevoznik" };
}
