import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  bosniaPostalCodes,
  detectPostal,
  normalizePhone,
  parseTelegramArticleAndAmount,
  type TelegramOrderDraft,
} from "@/lib/telegram-orders";

const DEFAULT_MODEL = "gpt-5.6-luna";
const API_TIMEOUT_MS = 45_000;

const telegramOrderSchema = z
  .object({
    primalac: z.string().describe("Customer full name. Empty string if not visible."),
    brojTelefona: z.string().describe("Customer phone number, preferably normalized to Bosnia format 387..."),
    grad: z.string().describe("Bosnia ZIP/postal code only when known; otherwise the visible city/place."),
    adresa: z.string().describe("Shipping street/address, without city/ZIP when separable."),
    artikal: z.string().describe("Product name from the last user-provided item text, without its trailing price."),
    ukupanIznos: z.string().describe("Final customer payment amount from the item caption/text, without currency; empty if absent."),
  })
  .strict();

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nije podešen na Hostingeru.");
  }

  return new OpenAI({ apiKey });
}

function cleanup(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function imageDataUrl(imageBytes: ArrayBuffer, mimeType: string) {
  return `data:${mimeType};base64,${Buffer.from(imageBytes).toString("base64")}`;
}

function normalizePostalCode(value: string) {
  const cleaned = cleanup(value);
  const postal = detectPostal(cleaned);
  if (postal) return postal.postalCode;

  const zip = cleaned.match(/\b\d{5}\b/)?.[0] || "";
  return zip || cleaned;
}

function normalizeDraft(order: z.infer<typeof telegramOrderSchema>, artikalOverride: string): TelegramOrderDraft {
  const override = parseTelegramArticleAndAmount(artikalOverride);
  const extracted = parseTelegramArticleAndAmount(order.artikal);
  const modelAmount = cleanup(order.ukupanIznos).match(/\d+(?:[.,]\d{1,2})?/)?.[0]?.replace(",", ".") || "";
  const amount = override.amount || modelAmount || extracted.amount;

  return {
    primalac: cleanup(order.primalac),
    brojTelefona: normalizePhone(order.brojTelefona),
    grad: normalizePostalCode(order.grad),
    adresa: cleanup(order.adresa),
    artikal: override.artikal || extracted.artikal,
    brojPaketa: "",
    otkupnina: amount,
    vrijednostPosiljke: amount,
    dop: "1",
    zamjena: "0",
  };
}

function assertUsableOrder(order: TelegramOrderDraft) {
  if (!order.primalac && !order.brojTelefona && !order.adresa) {
    throw new Error("OpenAI nije pronašao dovoljno podataka za narudžbu.");
  }
}

function openAIErrorMessage(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? (error as { status?: unknown }).status : undefined;
  if (status === 401) return "OpenAI API key nije ispravan.";
  if (status === 429) return "OpenAI quota/billing limit je potrošen. Provjeri credits/billing.";
  if (status === 400) return "OpenAI nije prihvatio sliku ili format poruke.";
  return error instanceof Error ? error.message : "OpenAI obrada nije uspjela.";
}

function postalHints() {
  return Object.entries(bosniaPostalCodes)
    .map(([city, zip]) => `${city}=${zip}`)
    .join(", ");
}

function lastMeaningfulLine(value: string) {
  return String(value || "")
    .split(/\n+/)
    .map(cleanup)
    .filter(Boolean)
    .at(-1) || "";
}

function getArtikalOverride(input: { text?: string; caption?: string }) {
  return cleanup(input.caption) || (input.text ? lastMeaningfulLine(input.text) : "");
}

function systemPrompt() {
  return `You extract one Galago delivery order for Google Sheets.

Return only the structured JSON fields. Do not include explanations.

Rules:
- Intake language is Bosnian/Croatian/Serbian; preserve names and addresses in Latin script.
- Primalac is the customer full name, not page/admin labels unless it is also the customer name.
- Broj telefona must be normalized to digits only. Bosnia mobile examples: 061417206 -> 38761417206, +387 61 417 206 -> 38761417206.
- Grad must be ZIP/postal code when known. Common mappings: ${postalHints()}.
- Adresa is the street/place/address only, without ZIP/city when separable.
- Artikal must be the product portion of the final user-provided item text. If an image caption or text below the image is provided separately, treat it as authoritative.
- The authoritative item text may end with the customer's total payment amount. Examples: "SDS 89", "SDS 89 KM", or "SDS - 89" mean Artikal="SDS" and ukupanIznos="89".
- ukupanIznos is the final amount the customer pays, not an older offer price or delivery fee. Leave it empty when the final item text has no amount.
- Do not infer Artikal from older price/offer discussion when a later item caption/text exists.
- Extract Primalac, Broj telefona, Grad, Adresa, Artikal, and ukupanIznos.
- Do not extract package count, DOP, or zamjena. The app supplies those defaults.`;
}

async function extractWithOpenAI(input: {
  text?: string;
  imageBytes?: ArrayBuffer;
  mimeType?: string;
  caption?: string;
}) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_ORDER_MODEL || DEFAULT_MODEL;
  const artikalOverride = getArtikalOverride(input);
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: [
        "Extract the order from this Telegram/Facebook intake message.",
        artikalOverride ? `Authoritative Artikal text:\n${artikalOverride}` : "",
        input.text ? `Message text:\n${input.text}` : "",
        input.caption ? `Image caption:\n${input.caption}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  if (input.imageBytes && input.mimeType) {
    content.push({
      type: "image_url",
      image_url: {
        url: imageDataUrl(input.imageBytes, input.mimeType),
        detail: "high",
      },
    });
  }

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        reasoning_effort: "none",
        max_completion_tokens: 500,
        messages: [
          { role: "developer", content: systemPrompt() },
          { role: "user", content },
        ],
        response_format: zodResponseFormat(telegramOrderSchema, "telegram_order"),
      },
      { timeout: API_TIMEOUT_MS }
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI nije vratio narudžbu.");

    const parsed = telegramOrderSchema.parse(JSON.parse(raw));
    const order = normalizeDraft(parsed, artikalOverride);
    assertUsableOrder(order);
    return order;
  } catch (error) {
    throw new Error(openAIErrorMessage(error));
  }
}

export function extractTelegramOrderFromText(text: string) {
  return extractWithOpenAI({ text });
}

export function extractTelegramOrderFromImage(input: {
  imageBytes: ArrayBuffer;
  mimeType: string;
  caption?: string;
}) {
  return extractWithOpenAI(input);
}
