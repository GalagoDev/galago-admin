export const BIH_POSTAL_CODES: Record<string, string> = {
  "sarajevo": "71000",
  "banja luka": "78000",
  "tuzla": "75000",
  "zenica": "72000",
  "mostar": "88000",
  "bijeljina": "76300",
  "brcko": "76100",
  "bihać": "77000",
  "bihac": "77000",
  "cazin": "77220",
  "travnik": "72270",
  "visoko": "71300",
  "gradačac": "76250",
  "gradacac": "76250",
  "gračanica": "75320",
  "gracanica": "75320",
  "konjic": "88400",
  "bugojno": "70230",
  "trebinje": "89101",
  "doboj": "74000",
  "prijedor": "79101",
  "živinice": "75270",
  "zivinice": "75270",
  "kalesija": "75260",
  "lukavac": "75300",
  "kakanj": "72240",
  "rogatica": "73220",
  "grude": "88340",
  "vitez": "72250",
  "jablanica": "88420",
  "banovići": "75290",
  "banovici": "75290",
  "kozarac": "79202",
  "han bila": "72245",
  "čajniče": "73280",
  "cajnice": "73280",
  "han pijesak": "71360",
  "bosanska krupa": "77240",
  "turbe": "72283",
  "orašje": "76270",
  "orasje": "76270",
  "hadžići": "71240",
  "hadzici": "71240",
  "lukavica": "71123",
  "fojnica": "71270",
  "tešanj": "74260",
  "tesanj": "74260",
  "sanski most": "79260",
  "srebrenik": "75350",
  "velika kladuša": "77230",
  "velika kladusa": "77230",
  "goražde": "73000",
  "gorazde": "73000"
};

export function normalizeBosnianText(value: string) {
  return value.toLowerCase().trim();
}

export function lookupPostalCode(value: string) {
  const normalized = normalizeBosnianText(value);
  return BIH_POSTAL_CODES[normalized] || null;
}

export function detectPostalFromText(text: string) {
  const lowered = normalizeBosnianText(text);
  for (const city of Object.keys(BIH_POSTAL_CODES).sort((a, b) => b.length - a.length)) {
    if (lowered.includes(city)) {
      return {
        city,
        postalCode: BIH_POSTAL_CODES[city],
      };
    }
  }
  return null;
}
