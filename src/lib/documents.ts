import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { getDb } from "@/lib/db";
import { ensureStorage } from "@/lib/storage";

export type DocumentType = "sent" | "delivered";

type ParsedSentSegment = {
  recipient: string | null;
  phone: string | null;
  article: string | null;
  city: string | null;
  address: string | null;
  amount: number | null;
  packageNumbers: string | null;
  rawText: string;
};

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function normalizeWhitespace(text: string) {
  return text.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function splitSentPdfText(text: string) {
  return text
    .split(/(?=Ref\.\s*br\.\s*1:)/i)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 40 &&
        part.includes("Pošiljalac:") &&
        part.includes("Primalac") &&
        part.includes("SDS iznos:")
    );
}

function splitGenericPdfText(text: string) {
  const normalized = text.replace(/\r/g, "").trim();
  const doubleBreakParts = normalized
    .split(/\n\s*\n+/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 6);

  if (doubleBreakParts.length > 1) {
    return doubleBreakParts;
  }

  return normalized
    .split(/(?=\b(?:broj|ime|primalac|primatelj|kupac|pošiljka|pošiljatelj)\b)/i)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 20);
}

function extractBestPhone(text: string) {
  const match = text.match(/(\+?387[\d\s\/-]{6,}|06[\d\s\/-]{6,})/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

function compactVisible(line: string) {
  return line.replace(/\s{2,}/g, " ").trim();
}

function cleanTrailingNoise(value: string) {
  return value
    .replace(/Lice za kontakt:.*$/i, "")
    .replace(/Ukupan broj.*$/i, "")
    .replace(/SDS iznos:.*$/i, "")
    .replace(/Pošiljalac:.*$/i, "")
    .trim();
}

function parseSentSegment(text: string): ParsedSentSegment {
  const rawLines = text.replace(/\r/g, "").split("\n");
  const lines = rawLines.map((line) => line.replace(/\s+$/g, ""));
  const compactLines = lines.map(compactVisible).filter(Boolean);
  const normalized = normalizeWhitespace(text);

  const phone = extractBestPhone(normalized);
  const amountMatch = normalized.match(/SDS iznos:\s*(\d+(?:[.,]\d+)?)\s*KM/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(",", ".")) : null;
  const packageCountMatch = normalized.match(/paketa\/paleta:\s*(\d+)/i);
  const packageCount = packageCountMatch ? Number(packageCountMatch[1]) : 1;

  let article: string | null = null;
  const ref1Index = compactLines.findIndex((line) => line.includes("Ref. br. 1:"));
  if (ref1Index >= 0) {
    const line = compactLines[ref1Index];
    let firstPart = line.split("Ref. br. 1:")[1] ?? "";
    firstPart = firstPart.split("Primalac")[0]?.trim() ?? "";

    const articleParts = [firstPart].filter(Boolean);
    const nextLine = compactLines[ref1Index + 1] ?? "";
    if (
      nextLine &&
      !nextLine.startsWith("Ref. br. 2:") &&
      !nextLine.startsWith("Ref. br. 3:") &&
      !nextLine.startsWith("Pošiljalac:") &&
      !nextLine.includes("Lice za kontakt:") &&
      !/^\d/.test(nextLine)
    ) {
      articleParts.push(nextLine);
    }
    article = articleParts.join(" ").trim() || null;
  }

  let recipient: string | null = null;
  let address: string | null = null;
  let city: string | null = null;

  const ref2Line = compactLines.find((line) => line.startsWith("Ref. br. 2:"));
  if (ref2Line) {
    recipient = cleanTrailingNoise(ref2Line.replace(/^Ref\. br\. 2:\s*/i, "")) || null;
  }

  const ref3Index = compactLines.findIndex((line) => line.startsWith("Ref. br. 3:"));
  if (ref3Index >= 0) {
    const firstAddress = cleanTrailingNoise(compactLines[ref3Index].replace(/^Ref\. br\. 3:\s*/i, ""));
    const secondAddress = compactLines[ref3Index + 1] && !compactLines[ref3Index + 1].startsWith("Pošiljalac:")
      ? cleanTrailingNoise(compactLines[ref3Index + 1])
      : "";
    const cityCandidate = compactLines[ref3Index + 1]?.startsWith("Pošiljalac:")
      ? cleanTrailingNoise(compactLines[ref3Index + 1].replace(/^Pošiljalac:\s*EVER TECH DOO\s*/i, ""))
      : compactLines[ref3Index + 2]?.startsWith("Pošiljalac:")
        ? cleanTrailingNoise(compactLines[ref3Index + 2].replace(/^Pošiljalac:\s*EVER TECH DOO\s*/i, ""))
        : "";

    if (secondAddress && cityCandidate) {
      address = `${firstAddress} ${secondAddress}`.trim();
      city = cityCandidate || null;
    } else if (firstAddress && secondAddress && /^[A-ZČĆŽŠĐ\s-]+$/u.test(secondAddress)) {
      address = firstAddress;
      city = secondAddress;
    } else {
      address = firstAddress || null;
      city = cityCandidate || (secondAddress && /^[A-ZČĆŽŠĐ\s-]+$/u.test(secondAddress) ? secondAddress : null);
    }
  }

  const packageLine = compactLines.find((line) => /\b\d{6}\s+\d{8,}(?:\s+\d{1,3})?(?:\s+\d{8,}\s+\d{1,3})*/.test(line));
  let packageNumbers: string | null = null;
  if (packageLine) {
    const numbers = Array.from(packageLine.matchAll(/\b(\d{8,})\b/g)).map((m) => m[1]);
    packageNumbers = numbers.slice(0, Math.max(packageCount, 1)).join(", ") || null;
  }

  return {
    recipient,
    phone,
    article,
    city,
    address,
    amount,
    packageNumbers,
    rawText: normalizeWhitespace(compactLines.join(" ")),
  };
}

function extractBestName(text: string) {
  const labeled = text.match(/(?:ime|kupac|primalac|primatelj)\s*[:\-]?\s*([A-ZČĆŽŠĐ][^,\n]{3,60})/iu);
  if (labeled) return labeled[1].trim();

  const generic = text.match(/([A-ZČĆŽŠĐ][a-zčćžšđ]+(?:\s+[A-ZČĆŽŠĐ][a-zčćžšđ]+){1,2})/u);
  return generic ? generic[1].trim() : null;
}

function extractBestCity(text: string) {
  const labeled = text.match(/(?:grad|mjesto|op[cć]ina)\s*[:\-]?\s*([^,\n]+)/i);
  return labeled ? labeled[1].trim() : null;
}

function extractBestAddress(text: string) {
  const match = text.match(/(?:adresa|ulica)\s*[:\-]?\s*([^,\n]{4,80})/i);
  return match ? match[1].trim() : null;
}

function extractProductSummary(text: string) {
  const labeled = text.match(/(?:artikl|proizvod|sadr[zž]aj|roba)\s*[:\-]?\s*([^\n]+)/i);
  if (labeled) return labeled[1].trim().slice(0, 180);
  return text.slice(0, 180);
}

export async function savePdfDocument(file: File, type: DocumentType) {
  const storage = ensureStorage();
  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 12);
  const safeName = sanitizeFileName(file.name || `${type}.pdf`);
  const storedName = `${Date.now()}-${hash}-${safeName}`;
  const targetDir = type === "sent" ? storage.sentPdfs : storage.deliveredPdfs;
  const storedPath = path.join(targetDir, storedName);

  await fs.writeFile(storedPath, bytes);

  const pdftotextArgs = type === "sent" ? ["-layout", storedPath, "-"] : [storedPath, "-"];
  const extractedText = execFileSync("pdftotext", pdftotextArgs, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }).trim();

  const segments = type === "sent" ? splitSentPdfText(extractedText) : splitGenericPdfText(extractedText);

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO documents (
        type,
        original_name,
        stored_name,
        stored_path,
        extracted_text
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(type, file.name, storedName, storedPath, extractedText);

  return {
    documentId: Number(result.lastInsertRowid),
    storedName,
    storedPath,
    extractedText,
    segments,
  };
}

export function importPdfSegments(documentId: number, type: DocumentType, segments: string[]) {
  const db = getDb();
  let imported = 0;

  const insert = db.prepare(
    `INSERT INTO orders (
      source,
      customer_name,
      phone,
      city,
      address,
      product_summary,
      quantity,
      notes,
      raw_text,
      status,
      document_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction((items: string[]) => {
    for (const text of items) {
      if (type === "sent") {
        const parsed = parseSentSegment(text);
        const note = `SENT PDF import | Iznos: ${parsed.amount ?? "?"} KM | Broj paketa: ${parsed.packageNumbers ?? "?"}`;

        insert.run(
          "sent_pdf",
          parsed.recipient,
          parsed.phone,
          parsed.city,
          parsed.address,
          parsed.article,
          parsed.amount,
          note,
          parsed.rawText,
          "sent",
          documentId
        );
      } else {
        const phone = extractBestPhone(text);
        const customerName = extractBestName(text);
        const city = extractBestCity(text);
        const address = extractBestAddress(text);
        const productSummary = extractProductSummary(text);
        const note = "DELIVERED PDF import";

        insert.run(
          "delivered_pdf",
          customerName,
          phone,
          city,
          address,
          productSummary,
          null,
          note,
          normalizeWhitespace(text),
          "delivered",
          documentId
        );
      }

      imported += 1;
    }
  });

  transaction(segments);
  return imported;
}
