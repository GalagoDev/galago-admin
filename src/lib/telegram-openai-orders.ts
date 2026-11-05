import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  bosniaPostalCodes,
  getTelegramArticleOverrideText,
  parseTelegramArticleAndAmount,
  parseTelegramPackageCount,
  resolveTelegramPostalCode,
  type TelegramOrderDraft,
} from "@/lib/telegram-orders";
import { phoneCandidatesFromText, resolveOrderPhone, verifyImagePhone } from "@/lib/order-phone";

const DEFAULT_MODEL = "gpt-5.6-luna";
const API_TIMEOUT_MS = 45_000;

const telegramOrderSchema = z
  .object({
    primalac: z.string().describe("Customer full name. Empty string if not visible."),
    brojTelefona: z.string().describe("Copy the complete phone exactly as written, including all final digits. Do not normalize, shorten, correct or guess. Empty if unreadable."),
    grad: z.string().describe("Bosnia ZIP/postal code only when known; otherwise the visible city/place."),
    adresa: z.string().describe("Shipping street/address, without city/ZIP when separable."),
    artikal: z.string().describe("Product name from the last user-provided item text, without its trailing price."),
    brojPaketa: z.string().describe("Number of packages when explicitly stated; otherwise 1."),
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

function normalizeDraft(
  order: z.infer<typeof telegramOrderSchema>,
  artikalOverride: string,
  sourceText: string,
  image: boolean,
): TelegramOrderDraft {
  const override = parseTelegramArticleAndAmount(artikalOverride);
  const extracted = parseTelegramArticleAndAmount(order.artikal);
  const modelAmount = cleanup(order.ukupanIznos).match(/\d+(?:[.,]\d{1,2})?/)?.[0]?.replace(",", ".") || "";
  const amount = override.amount || modelAmount || extracted.amount;
  const grad = resolveTelegramPostalCode(order.grad, order.adresa, sourceText);
  const modelPackageCount = cleanup(order.brojPaketa).match(/^\d{1,2}$/)?.[0] || "";
  const parsedModelPackageCount = Number(modelPackageCount);
  const brojPaketa = parseTelegramPackageCount(sourceText)
    || (Number.isInteger(parsedModelPackageCount) && parsedModelPackageCount > 0 ? modelPackageCount : "")
    || "1";

  return {
    primalac: cleanup(order.primalac),
    brojTelefona: resolveOrderPhone(sourceText, order.brojTelefona, image),
    grad,
    adresa: cleanup(order.adresa),
    artikal: override.artikal || extracted.artikal,
    brojPaketa,
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
  if (!/^\d{5}$/.test(order.grad)) {
    throw new Error("Nisam mogao odrediti ZIP. Dodaj poštanski broj uz grad i pošalji ponovo.");
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
  const commonPlaces = [
    "sarajevo",
    "banja luka",
    "tuzla",
    "zenica",
    "mostar",
    "bijeljina",
    "brcko",
    "bihac",
    "cazin",
    "travnik",
    "doboj",
    "prijedor",
    "zivinice",
    "gorazde",
    "sanski most",
    "kljuc",
    "kozarska dubica",
  ];

  return commonPlaces
    .map((city) => `${city}=${bosniaPostalCodes[city]}`)
    .join(", ");
}

function getArtikalOverride(input: { text?: string; caption?: string }) {
  return getTelegramArticleOverrideText(input.caption || input.text || "");
}

function systemPrompt() {
  return `You extract one Galago delivery order for Google Sheets.

Return only the structured JSON fields. Do not include explanations.

Rules:
- Intake language is Bosnian/Croatian/Serbian; preserve names and addresses in Latin script.
- Primalac is the customer full name, not page/admin labels unless it is also the customer name.
- Copy Broj telefona EXACTLY as written, digit by digit, including the last digit. Do not normalize country prefixes, shorten to a standard length, correct, or guess missing digits. Bosnia numbers may have 9 OR 10 digits including the initial zero. The app handles normalization. If unclear or missing, return an empty string.
- Grad should be a five-digit ZIP/postal code when known. Common mappings: ${postalHints()}.
- If a city/place is visible but you do not know its ZIP reliably, return the visible city/place in Grad. The app resolves it through its Bosnia postal directory.
- Adresa is the street/place/address only, without ZIP/city when separable.
- Artikal must be the product portion of the final user-provided item text. If an image caption or text below the image is provided separately, treat it as authoritative.
- "SDS" is an amount marker and must never be included in Artikal. Example: "Komoda serena\nSDS 139" means Artikal="Komoda serena" and ukupanIznos="139".
- Broj paketa is the explicitly written package count, such as "Paketa 2", "Paket: 2", or "2 paketa". Use 1 when it is not written.
- A package-count line is metadata and must never become Artikal or ukupanIznos.
- The authoritative item text may also end with a plain total, such as "Komoda serena - 139 KM".
- ukupanIznos is the final amount the customer pays, not an older offer price or delivery fee. Leave it empty when the final item text has no amount.
- Do not infer Artikal from older price/offer discussion when a later item caption/text exists.
- Extract Primalac, Broj telefona, Grad, Adresa, Artikal, Broj paketa, and ukupanIznos.
- Do not extract DOP or zamjena. The app supplies those defaults.`;
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
  const sourceText = [input.text, input.caption].filter(Boolean).join("\n");
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
    const order = normalizeDraft(parsed, artikalOverride, sourceText, Boolean(input.imageBytes));
    assertUsableOrder(order);
    if (input.imageBytes && input.mimeType && !phoneCandidatesFromText(sourceText).length) {
      // Read independently, without showing the first reading, so a plausible wrong digit is not silently accepted.
      const verification = await client.chat.completions.create({
        model,
        reasoning_effort: "none",
        max_completion_tokens: 150,
        messages: [{ role: "user", content: [
          { type: "text", text: "Read ONLY the customer's delivery phone number in this image. Transcribe every digit exactly as printed, including the last digit. Do not normalize or correct it. It can have 9 or 10 digits with a leading zero. Return an empty string if any digit is unclear or there are multiple possible customer phone numbers." },
          { type: "image_url", image_url: { url: imageDataUrl(input.imageBytes, input.mimeType), detail: "high" } },
        ] }],
        response_format: zodResponseFormat(z.object({ phone: z.string() }).strict(), "phone_check"),
      }, { timeout: API_TIMEOUT_MS });
      const checked = z.object({ phone: z.string() }).parse(JSON.parse(verification.choices[0]?.message?.content || "{}"));
      verifyImagePhone(parsed.brojTelefona, checked.phone);
    }
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
