export const importBankParserVersion = "intesa-v1";

export type ImportBankRow = {
  account: string; currency: string; reference: string; date: string;
  debitMinor: number; description: string; supplier: "TADEX" | "SHENGFENG" | "GARMA" | "OTHER" | null;
};

export function parseImportBankLines(lines: string[]): ImportBankRow[] {
  let account = "", currency = "", current: ImportBankRow | null = null;
  const rows: ImportBankRow[] = [];
  const flush = () => {
    if (!current) return;
    const text = current.description.toUpperCase();
    const matches = [ /\bTADEX\b/.test(text) ? "TADEX" : null, /\bSHENGFENG\b|\bSHENGFEN\b/.test(text) ? "SHENGFENG" : null, /\bGARMA\b/.test(text) ? "GARMA" : null, /\bPETRA\s+DIZAJN\b/.test(text) ? "OTHER" : null ].filter(Boolean);
    current.supplier = matches.length === 1 ? matches[0] as ImportBankRow["supplier"] : null;
    rows.push(current); current = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const konto = line.match(/^Konto\s+(\d{8})\b/i);
    if (konto) { flush(); account = konto[1]; currency = ""; continue; }
    const valuta = line.match(/^Valuta\s+\d+\s+(USD|EUR|BAM)\b/i);
    if (valuta) { flush(); currency = valuta[1].toUpperCase(); continue; }
    const row = line.match(/^(\d{2}\.\d{2}\.\d{4})\s+\d{2}\.\d{2}\.\d{4}\s+(.*?)\s+(\d{6,20})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/);
    if (row) {
      flush();
      const amount = row[4].replaceAll(",", "").split(".");
      current = { account, currency, date: row[1].split(".").reverse().join("-"), reference: row[3],
        debitMinor: Number(amount[0]) * 100 + Number(amount[1]), description: row[2], supplier: null };
      continue;
    }
    if (/^(?:PROMET NA DAN|UKUPAN PROMET|NOVO STANJE|STARO STANJE|INTESA|Iznosi navedeni|Ovaj dokument|ZA PERIOD|Dat\. obrade|\d{2}\.\d{2}\.\d{4}\s+IZVOD)/i.test(line)) { flush(); continue; }
    if (current) current.description = `${current.description} ${line}`.trim().slice(0, 1000);
  }
  flush();
  return rows;
}
