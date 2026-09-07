export type TelegramOrderDraft = {
  primalac: string;
  brojTelefona: string;
  grad: string;
  adresa: string;
  artikal: string;
  brojPaketa: string;
  otkupnina: string;
  vrijednostPosiljke: string;
  dop: string;
  zamjena: string;
};

export const bosniaPostalCodes: Record<string, string> = {
  sarajevo: "71000",
  "banja luka": "78000",
  tuzla: "75000",
  zenica: "72000",
  mostar: "88000",
  bijeljina: "76300",
  brcko: "76100",
  bihac: "77000",
  "bihać": "77000",
  cazin: "77220",
  travnik: "72270",
  visoko: "71300",
  gradacac: "76250",
  "gradačac": "76250",
  gracanica: "75320",
  "gračanica": "75320",
  konjic: "88400",
  bugojno: "70230",
  trebinje: "89101",
  doboj: "74000",
  prijedor: "79101",
  zivinice: "75270",
  "živinice": "75270",
  kalesija: "75260",
  lukavac: "75300",
  kakanj: "72240",
  maglaj: "74250",
  rogatica: "73220",
  grude: "88340",
  vitez: "72250",
  jablanica: "88420",
  banovici: "75290",
  "banovići": "75290",
  kozarac: "79202",
  "han bila": "72245",
  "čajniče": "73280",
  cajnice: "73280",
  "han pijesak": "71360",
  "bosanska krupa": "77240",
  "donji vakuf": "70220",
  foca: "73300",
  "foča": "73300",
  "sanski most": "79260",
  turbe: "72283",
  laktasi: "78250",
  "laktaši": "78250",
};

function cleanup(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return cleanup(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function splitSegments(rawText: string) {
  return String(rawText || "")
    .split(/\n+/)
    .flatMap((line) => line.split(/\s+\/\s+/))
    .map(cleanup)
    .filter(Boolean);
}

export function normalizePhone(text: string) {
  const digits = String(text || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("387")) return digits;
  if (digits.startsWith("0")) return `387${digits.slice(1)}`;
  if (digits.startsWith("6")) return `387${digits}`;
  return digits;
}

function findPhone(text: string) {
  const match = text.match(/(\+?387[\d\s/-]{6,}|06[\d\s/-]{6,})/i);
  return match ? normalizePhone(match[1] || "") : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectPostal(text: string) {
  const cleaned = cleanup(text);
  const lowered = cleaned.toLowerCase();

  const exactZipCity = cleaned.match(/\b(\d{5})\b\s+([A-Za-zČĆŽŠĐčćžšđ]+(?:\s+[A-Za-zČĆŽŠĐčćžšđ]+)*)$/);
  if (exactZipCity) {
    const zip = exactZipCity[1] || "";
    const cityName = (exactZipCity[2] || "").toLowerCase();
    if (bosniaPostalCodes[cityName] === zip) return { city: titleCase(cityName), postalCode: zip };
  }

  const exactCityZip = cleaned.match(/^([A-Za-zČĆŽŠĐčćžšđ]+(?:\s+[A-Za-zČĆŽŠĐčćžšđ]+)*)\s+(\d{5})$/);
  if (exactCityZip) {
    const cityName = (exactCityZip[1] || "").toLowerCase();
    const zip = exactCityZip[2] || "";
    if (bosniaPostalCodes[cityName] === zip) return { city: titleCase(cityName), postalCode: zip };
  }

  for (const city of Object.keys(bosniaPostalCodes).sort((a, b) => b.length - a.length)) {
    if (lowered === city) return { city: titleCase(city), postalCode: bosniaPostalCodes[city] };
    if (lowered === `${city} ${bosniaPostalCodes[city]}`) return { city: titleCase(city), postalCode: bosniaPostalCodes[city] };
    if (lowered === `${bosniaPostalCodes[city]} ${city}`) return { city: titleCase(city), postalCode: bosniaPostalCodes[city] };
  }

  return null;
}

export function normalizeTelegramPostalCode(value: string) {
  const cleaned = cleanup(value);
  const explicitZip = cleaned.match(/\b\d{5}\b/)?.[0] || "";
  if (explicitZip) return explicitZip;

  return detectPostal(cleaned)?.postalCode || "";
}

function findAmount(text: string) {
  const normalized = String(text || "").replace(/\//g, " ");
  const match = normalized.match(/(?:\b(?:sds|km)\b\s*)(\d+(?:[.,]\d+)?)\b|(\d+(?:[.,]\d+)?)\s*(?:\b(?:sds|km)\b)/i);
  const raw = match?.[1] || match?.[2] || "";
  if (!raw) return "";
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? String(value) : "";
}

function normalizeAmount(value: string) {
  const match = cleanup(value).match(/\d+(?:[.,]\d{1,2})?/);
  if (!match) return "";

  const amount = Number(match[0].replace(",", "."));
  return Number.isFinite(amount) ? String(amount) : "";
}

export function parseTelegramArticleAndAmount(value: string) {
  const cleaned = cleanup(value);
  if (!cleaned) return { artikal: "", amount: "" };

  const sdsAmount = cleaned.match(/^(.*?)\s*\bsds\b\s*[:=-]?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:km)?$/i);
  if (sdsAmount) {
    return {
      artikal: cleanup(sdsAmount[1]).replace(/\s*[-|,:]\s*$/g, ""),
      amount: normalizeAmount(sdsAmount[2] || ""),
    };
  }

  const labelled = cleaned.match(
    /^(.+?)(?:\s*[-|,:]\s*|\s+)(?:cijena|iznos|ukupno)\s*:?[ ]*(\d+(?:[.,]\d{1,2})?)\s*(?:km)?$/i
  );
  const trailing = labelled || cleaned.match(/^(.+?)(?:\s*[-|,:]\s*|\s+)(\d+(?:[.,]\d{1,2})?)\s*(?:km)?$/i);

  if (!trailing) return { artikal: cleaned, amount: "" };

  return {
    artikal: cleanup(trailing[1]).replace(/\s*[-|,:]\s*$/g, ""),
    amount: normalizeAmount(trailing[2] || ""),
  };
}

function emptyDraft(): TelegramOrderDraft {
  return {
    primalac: "",
    brojTelefona: "",
    grad: "",
    adresa: "",
    artikal: "",
    brojPaketa: "",
    otkupnina: "",
    vrijednostPosiljke: "",
    dop: "1",
    zamjena: "0",
  };
}

export function parseTelegramOrderText(rawText: string): TelegramOrderDraft {
  const lines = splitSegments(rawText);
  const hasLabels = lines.some((line) => /^(ime|adresa|grad|mjesto|mob|br tel|br\. tel|telefon)\s*[:-]/i.test(line));

  if (hasLabels) {
    const order = emptyDraft();
    const amount = findAmount(rawText);
    order.otkupnina = amount;
    order.vrijednostPosiljke = amount;

    for (const line of lines) {
      if (/^ime(?:\s+i\s+prezime)?\s*[:-]/i.test(line)) {
        order.primalac = cleanup(line.replace(/^ime(?:\s+i\s+prezime)?\s*[:-]\s*/i, ""));
      } else if (/^(mob|br tel|br\. tel|telefon)\s*[:-]/i.test(line)) {
        order.brojTelefona = findPhone(line);
      } else if (/^(grad|mjesto)\s*[:-]/i.test(line)) {
        const value = cleanup(line.replace(/^(grad|mjesto)\s*[:-]\s*/i, ""));
        const postal = detectPostal(value);
        order.grad = postal ? postal.postalCode : value;
      } else if (/^(adresa|ulica)\s*[:-]/i.test(line)) {
        const value = cleanup(line.replace(/^(adresa|ulica)\s*[:-]\s*/i, ""));
        const parts = value.split(",").map(cleanup).filter(Boolean);
        if (parts.length >= 2) {
          order.adresa = parts.slice(0, -1).join(", ");
          const postal = detectPostal(parts[parts.length - 1] || "");
          order.grad ||= postal ? postal.postalCode : "";
        } else {
          order.adresa = value;
        }
      }
    }

    const article = parseTelegramArticleAndAmount(lines[lines.length - 1] || "");
    order.artikal = article.artikal;
    order.otkupnina = article.amount || order.otkupnina;
    order.vrijednostPosiljke = article.amount || order.vrijednostPosiljke;
    return order;
  }

  const articleLine = lines.length > 1 ? lines[lines.length - 1] || "" : "";
  const amount = findAmount(articleLine || rawText);
  const order = emptyDraft();
  order.otkupnina = amount;
  order.vrijednostPosiljke = amount;
  order.artikal = articleLine
    ? cleanup(articleLine.replace(/(?:\b(?:sds|km)\b\s*)?\d+(?:[.,]\d+)?\s*(?:\b(?:sds|km)\b)?/gi, "").replace(/\s{2,}/g, " ")) || articleLine
    : "";

  const phoneIndex = lines.findIndex((line) => !!findPhone(line));
  if (phoneIndex >= 1 && lines.length >= 4) {
    order.primalac = titleCase(lines[0] || "");
    order.brojTelefona = findPhone(lines[phoneIndex] || "");

    const beforePhone = lines.slice(1, phoneIndex);
    const postalEntries = beforePhone
      .map((part, index) => ({ part, index, postal: detectPostal(part) }))
      .filter((entry) => entry.postal);

    if (postalEntries.length > 0) {
      const cityEntry = postalEntries[0];
      order.grad = cityEntry?.postal?.postalCode || "";
      order.adresa = cleanup(beforePhone.filter((_, index) => index !== cityEntry?.index).join(" "));
    } else {
      const maybeCity = beforePhone.find((part) => /\b\d{5}\b/.test(part)) || beforePhone[beforePhone.length - 1] || "";
      const maybeAddress = beforePhone.filter((part) => part !== maybeCity);
      const postal = detectPostal(maybeCity);
      order.grad = postal ? postal.postalCode : "";
      order.adresa = cleanup(maybeAddress.join(" "));
    }
  } else {
    const main = articleLine ? lines.slice(0, -1) : lines;

    if (main.length >= 4) {
      order.primalac = titleCase(main[0] || "");
      order.adresa = cleanup(main[1] || "");
      order.brojTelefona = findPhone(main[2] || "") || findPhone(main[3] || "");

      const cityCandidate = findPhone(main[2] || "") ? main[3] || "" : main[2] || "";
      const postal = detectPostal(cityCandidate);
      order.grad = postal ? postal.postalCode : cleanup(cityCandidate);
    } else {
      const joined = cleanup(main.join(" "));
      order.brojTelefona = findPhone(joined);
      const postal = detectPostal(joined);
      order.grad = postal ? postal.postalCode : "";

      if (main.length >= 2 && postal && cleanup(main[1] || "").toLowerCase().includes(postal.city.toLowerCase())) {
        order.primalac = titleCase(main[0] || "");
        order.adresa = cleanup((main[1] || "").replace(new RegExp(escapeRegExp(postal.city), "i"), ""));
      } else {
        let working = joined;
        if (order.brojTelefona) working = working.replace(/(\+?387[\d\s/-]{6,}|06[\d\s/-]{6,})/i, " ");
        if (postal?.city) working = working.replace(new RegExp(escapeRegExp(postal.city), "i"), " ");
        if (postal?.postalCode) working = working.replace(new RegExp(postal.postalCode, "g"), " ");
        working = cleanup(working.replace(/\b(?:mob|br tel|br\. tel|tel|telefon)\b\s*:?/gi, " "));
        const tokens = working.split(" ").filter(Boolean);
        order.primalac = tokens.length >= 2 ? titleCase(`${tokens[0]} ${tokens[1]}`) : titleCase(tokens[0] || "");
        order.adresa = cleanup(working.replace(order.primalac, " "));
      }
    }
  }

  return order;
}

export function formatTelegramOrderPreview(order: TelegramOrderDraft) {
  return [
    "Provjeri narudžbu:",
    `Primalac: ${order.primalac || "-"}`,
    `Broj telefona: ${order.brojTelefona || "-"}`,
    `Grad: ${order.grad || "-"}`,
    `Adresa: ${order.adresa || "-"}`,
    `Artikal: ${order.artikal || "-"}`,
    `Otkupnina: ${order.otkupnina || "-"}`,
    `Vrijednost posiljke: ${order.vrijednostPosiljke || "-"}`,
    `DOP: ${order.dop || "1"}`,
    `Zamjena: ${order.zamjena || "0"}`,
  ].join("\n");
}
