import { createRequire } from "node:module";
import path from "node:path";

import { createWorker, PSM } from "tesseract.js";

import { parseTelegramOrderText, type TelegramOrderDraft } from "@/lib/telegram-orders";

const require = createRequire(import.meta.url);
const OCR_TIMEOUT_MS = 25_000;

function normalizeOcrText(value: string) {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function hasUsefulOrderSignal(text: string) {
  return /(?:\+?387|06\d|tel|telefon|mob|adresa|grad|mjesto|km|sds|\b\d{5}\b)/i.test(text);
}

function fillDefaults(order: TelegramOrderDraft): TelegramOrderDraft {
  return {
    ...order,
    dop: order.dop || "1",
    zamjena: order.zamjena || "0",
  };
}

function getTesseractPaths() {
  const tesseractDir = path.dirname(require.resolve("tesseract.js/package.json"));
  const coreDir = path.dirname(require.resolve("tesseract.js-core/package.json"));

  return {
    workerPath: path.join(tesseractDir, "src", "worker-script", "node", "index.js"),
    corePath: coreDir,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function recognizeImageText(imageBytes: ArrayBuffer) {
  const tesseractPaths = getTesseractPaths();
  const worker = await createWorker("eng", 1, {
    cachePath: "/tmp/tesseract-cache",
    ...tesseractPaths,
  });

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: "300",
    });

    const result = await worker.recognize(Buffer.from(imageBytes));
    return normalizeOcrText(result.data.text || "");
  } finally {
    await worker.terminate();
  }
}

export async function extractTelegramOrderFromImage(input: {
  imageBytes: ArrayBuffer;
  mimeType: string;
  caption?: string;
}) {
  const ocrText = await withTimeout(
    recognizeImageText(input.imageBytes),
    OCR_TIMEOUT_MS,
    "OCR je prespor na Hostingeru. Pošalji jasniju/manju sliku ili prepiši tekst."
  );
  const combinedText = normalizeOcrText([ocrText, input.caption || ""].filter(Boolean).join("\n"));

  if (!hasUsefulOrderSignal(combinedText)) {
    throw new Error("OCR nije pronašao dovoljno teksta za narudžbu. Pošalji jasniju sliku ili prepiši tekst.");
  }

  return fillDefaults(parseTelegramOrderText(combinedText));
}
