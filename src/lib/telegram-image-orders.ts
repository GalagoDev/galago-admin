import { createWorker, PSM } from "tesseract.js";

import { parseTelegramOrderText, type TelegramOrderDraft } from "@/lib/telegram-orders";

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

async function recognizeImageText(imageBytes: ArrayBuffer) {
  const worker = await createWorker("eng", 1, {
    cachePath: "/tmp/tesseract-cache",
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
  const ocrText = await recognizeImageText(input.imageBytes);
  const combinedText = normalizeOcrText([ocrText, input.caption || ""].filter(Boolean).join("\n"));

  if (!hasUsefulOrderSignal(combinedText)) {
    throw new Error("OCR nije pronašao dovoljno teksta za narudžbu. Pošalji jasniju sliku ili prepiši tekst.");
  }

  return fillDefaults(parseTelegramOrderText(combinedText));
}
