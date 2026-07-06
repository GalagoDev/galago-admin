import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  bosniaPostalCodes,
  detectPostal,
  normalizePhone,
  type TelegramOrderDraft,
} from "@/lib/telegram-orders";

const DEFAULT_MODEL = "gpt-4.1-mini";
const API_TIMEOUT_MS = 45_000;

const telegramOrderSchema = z
  .object({
    primalac: z.string().describe("Customer full name. Empty string if not visible."),
    brojTelefona: z.string().describe("Customer phone number, preferably normalized to Bosnia format 387..."),
    grad: z.string().describe("Bosnia ZIP/postal code only when known; otherwise the visible city/place."),
    adresa: z.string().describe("Shipping street/address, without city/ZIP when separable."),
    artikal: z.string().describe("Ordered product names or visible offer text."),
    brojPaketa: z.string().describe("Total package/item quantity. Default to 1 when not visible."),
    otkupnina: z.string().describe("Final cash-on-delivery amount, without currency text."),
    vrijednostPosiljke: z.string().describe("Same final amount as otkupnina unless a different shipment value is explicit."),
    dop: z.string().describe("Always 1 unless explicitly different."),
    zamjena: z.string().describe("Always 0 unless explicitly marked as exchange/replacement."),
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

function normalizeAmount(value: string) {
  const match = cleanup(value)
    .replace(/\//g, " ")
    .match(/\d+(?:[.,]\d+)?/);
  if (!match) return "";

  const amount = Number((match[0] || "").replace(",", "."));
  return Number.isFinite(amount) ? String(amount) : "";
}

function normalizePostalCode(value: string) {
  const cleaned = cleanup(value);
  const postal = detectPostal(cleaned);
  if (postal) return postal.postalCode;

  const zip = cleaned.match(/\b\d{5}\b/)?.[0] || "";
  return zip || cleaned;
}

function normalizeDraft(order: z.infer<typeof telegramOrderSchema>): TelegramOrderDraft {
  const amount = normalizeAmount(order.otkupnina) || normalizeAmount(order.vrijednostPosiljke);

  return {
    primalac: cleanup(order.primalac),
    brojTelefona: normalizePhone(order.brojTelefona),
    grad: normalizePostalCode(order.grad),
    adresa: cleanup(order.adresa),
    artikal: cleanup(order.artikal),
    brojPaketa: cleanup(order.brojPaketa) || "1",
    otkupnina: amount,
    vrijednostPosiljke: amount,
    dop: cleanup(order.dop) || "1",
    zamjena: cleanup(order.zamjena) || "0",
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

function systemPrompt() {
  return `You extract one Galago delivery order for Google Sheets.

Return only the structured JSON fields. Do not include explanations.

Rules:
- Intake language is Bosnian/Croatian/Serbian; preserve names and addresses in Latin script.
- Primalac is the customer full name, not page/admin labels unless it is also the customer name.
- Broj telefona must be normalized to digits only. Bosnia mobile examples: 061417206 -> 38761417206, +387 61 417 206 -> 38761417206.
- Grad must be ZIP/postal code when known. Common mappings: ${postalHints()}.
- Adresa is the street/place/address only, without ZIP/city when separable.
- Artikal is the ordered product name(s). If the exact product is not visible, use the visible offer text such as "1 kupis 2 gratis".
- Broj paketa defaults to 1 unless quantity is explicit.
- Otkupnina and Vrijednost posiljke are the final total collection amount without currency text.
- Prefer explicit final totals like "ukupno", "sve ukupno", "otkupnina", or seller-confirmed total.
- Do not use delivery-only text like "Dostava je 10 km" as the final amount when another total is visible.
- If product price and delivery are visible but no final total is visible, add them.
- DOP defaults to 1.
- Zamjena defaults to 0 unless the order is explicitly an exchange/replacement.`;
}

async function extractWithOpenAI(input: {
  text?: string;
  imageBytes?: ArrayBuffer;
  mimeType?: string;
  caption?: string;
}) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_ORDER_MODEL || DEFAULT_MODEL;
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: [
        "Extract the order from this Telegram/Facebook intake message.",
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
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content },
        ],
        response_format: zodResponseFormat(telegramOrderSchema, "telegram_order"),
      },
      { timeout: API_TIMEOUT_MS }
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI nije vratio narudžbu.");

    const parsed = telegramOrderSchema.parse(JSON.parse(raw));
    const order = normalizeDraft(parsed);
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
