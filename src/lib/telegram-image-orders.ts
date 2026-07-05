import OpenAI from "openai";

import type { TelegramOrderDraft } from "@/lib/telegram-orders";

const IMAGE_ORDER_MODEL = process.env.OPENAI_IMAGE_ORDER_MODEL || "gpt-5.4-mini";

const orderSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    primalac: { type: "string" },
    brojTelefona: { type: "string" },
    grad: { type: "string" },
    adresa: { type: "string" },
    artikal: { type: "string" },
    brojPaketa: { type: "string" },
    otkupnina: { type: "string" },
    vrijednostPosiljke: { type: "string" },
    dop: { type: "string" },
    zamjena: { type: "string" },
  },
  required: [
    "primalac",
    "brojTelefona",
    "grad",
    "adresa",
    "artikal",
    "brojPaketa",
    "otkupnina",
    "vrijednostPosiljke",
    "dop",
    "zamjena",
  ],
};

function normalizePhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("387")) return digits;
  if (digits.startsWith("0")) return `387${digits.slice(1)}`;
  if (digits.startsWith("6")) return `387${digits}`;
  return digits;
}

function normalizeAmount(value: string) {
  const match = String(value || "").match(/\d+(?:[.,]\d+)?/);
  return match ? match[0].replace(",", ".") : "";
}

function normalizeZip(value: string) {
  const match = String(value || "").match(/\b\d{5}\b/);
  return match ? match[0] : String(value || "").trim();
}

function toDraft(value: Partial<TelegramOrderDraft>): TelegramOrderDraft {
  const otkupnina = normalizeAmount(value.otkupnina || "");
  const vrijednostPosiljke = normalizeAmount(value.vrijednostPosiljke || "") || otkupnina;

  return {
    primalac: String(value.primalac || "").trim(),
    brojTelefona: normalizePhone(value.brojTelefona || ""),
    grad: normalizeZip(value.grad || ""),
    adresa: String(value.adresa || "").trim(),
    artikal: String(value.artikal || "").trim(),
    brojPaketa: String(value.brojPaketa || "").trim(),
    otkupnina,
    vrijednostPosiljke,
    dop: String(value.dop || "1").trim() || "1",
    zamjena: String(value.zamjena || "0").trim() || "0",
  };
}

export async function extractTelegramOrderFromImage(input: {
  imageBytes: ArrayBuffer;
  mimeType: string;
  caption?: string;
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured for image order extraction.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imageBase64 = Buffer.from(input.imageBytes).toString("base64");
  const imageUrl = `data:${input.mimeType};base64,${imageBase64}`;

  const completion = await client.chat.completions.create({
    model: IMAGE_ORDER_MODEL,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "telegram_order_image",
        strict: true,
        schema: orderSchema,
      },
    },
    messages: [
      {
        role: "system",
        content:
          "You extract customer order data from Telegram images for a Bosnia operations workflow. Return only the requested JSON fields. If a field is missing, use an empty string. Grad must be a ZIP/postal code only when possible. Normalize Bosnia phone numbers to 387 format. DOP defaults to 1 and Zamjena defaults to 0.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Read this order image and extract:",
              "Primalac = customer full name.",
              "Broj telefona = normalized phone.",
              "Grad = ZIP only if visible or clearly inferable.",
              "Adresa = shipping address.",
              "Artikal = product names/details.",
              "Broj paketa = quantity/package count if visible.",
              "Otkupnina and Vrijednost posiljke = subtotal/amount if visible.",
              input.caption ? `Telegram caption/context: ${input.caption}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
          {
            type: "image_url",
            image_url: { url: imageUrl },
          },
        ],
      },
    ],
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("Image extraction returned no order data.");
  }

  return toDraft(JSON.parse(content) as Partial<TelegramOrderDraft>);
}
