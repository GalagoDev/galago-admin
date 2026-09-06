import crypto from "node:crypto";
import path from "node:path";

import { NextRequest } from "next/server";

import {
  createCustomerRequest,
  isCustomerRequestRateLimited,
  recordCustomerRequestAttempt,
  type PreparedClaimFile,
} from "@/lib/reklamacije";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const REQUEST_TYPES = [
  "Pitanje o proizvodu",
  "Pomoć pri narudžbi",
  "Dostava i status narudžbe",
  "Izmjena ili otkazivanje narudžbe",
  "Povrat proizvoda",
  "Zamjena proizvoda",
  "Reklamacija ili oštećenje",
  "Predračun ili faktura za pravno lice",
  "Ostalo",
] as const;

const RETURN_TYPES = new Set([
  "Povrat proizvoda",
  "Zamjena proizvoda",
  "Reklamacija ili oštećenje",
]);
const DAMAGE_TYPE = "Reklamacija ili oštećenje";
const BUSINESS_TYPE = "Predračun ili faktura za pravno lice";
const MAX_FILE_COUNT = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_FILE_SIZE = 25 * 1024 * 1024;
const MAX_REQUEST_SIZE = 28 * 1024 * 1024;

const allowedOrigins = new Set([
  "https://galago.ba",
  "https://www.galago.ba",
  "https://wktcnu-i5.myshopify.com",
]);

type FieldName =
  | "requestType"
  | "orderNumber"
  | "customerName"
  | "email"
  | "address"
  | "city"
  | "phone"
  | "description"
  | "companyName"
  | "companyIdNumber"
  | "companyVatNumber"
  | "companyAddress";

class InputError extends Error {
  constructor(
    message: string,
    public field?: FieldName | "images",
    public status = 400,
  ) {
    super(message);
  }
}

function isAllowedOrigin(origin: string | null) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname.endsWith(".shopifypreview.com") || hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
  return headers;
}

function json(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function textField(formData: FormData, name: FieldName, maxLength: number, required = false) {
  const value = String(formData.get(name) || "").replace(/\0/g, "").trim();
  if (required && !value) throw new InputError("Ovo polje je obavezno.", name);
  if (value.length > maxLength) throw new InputError("Uneseni tekst je predug.", name);
  return value;
}

function cleanOriginalName(value: string) {
  return path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "prilog";
}

function detectImage(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }
  return null;
}

async function prepareFiles(formData: FormData) {
  const files = formData
    .getAll("images")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length > MAX_FILE_COUNT) {
    throw new InputError(`Možete dodati najviše ${MAX_FILE_COUNT} fotografija.`, "images");
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_FILE_SIZE) {
    throw new InputError("Ukupna veličina fotografija ne smije biti veća od 25 MB.", "images");
  }

  const prepared: PreparedClaimFile[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      throw new InputError(`Fotografija ${cleanOriginalName(file.name)} je veća od 10 MB.`, "images");
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const detected = detectImage(bytes);
    if (!detected || file.type !== detected.mimeType) {
      throw new InputError("Dozvoljene su samo ispravne JPG, PNG i WebP fotografije.", "images");
    }
    const id = crypto.randomUUID();
    prepared.push({
      id,
      originalName: cleanOriginalName(file.name),
      storedName: `${id}.${detected.extension}`,
      mimeType: detected.mimeType,
      sizeBytes: bytes.length,
      bytes,
    });
  }
  return prepared;
}

function requestIpHash(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip") || forwarded || "unknown";
  const salt = process.env.RECEIPT_LINK_SECRET || process.env.TELEGRAM_ORDERS_WEBHOOK_SECRET || "galago-requests-v1";
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

export function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) return json(origin, { ok: false }, 403);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return json(origin, { ok: false, message: "Zahtjev nije dozvoljen." }, 403);
  }

  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_SIZE) {
    return json(origin, { ok: false, field: "images", message: "Fotografije su prevelike." }, 413);
  }

  const ipHash = requestIpHash(request);
  if (isCustomerRequestRateLimited(ipHash)) {
    return json(origin, { ok: false, message: "Poslano je previše zahtjeva. Pokušajte ponovo za jedan sat." }, 429);
  }

  try {
    const formData = await request.formData();
    if (String(formData.get("company") || "").trim()) {
      return json(origin, { ok: true, reference: "GAL-PRIMLJENO" });
    }

    const requestType = textField(formData, "requestType", 80, true);
    if (!REQUEST_TYPES.includes(requestType as (typeof REQUEST_TYPES)[number])) {
      throw new InputError("Odaberite ispravnu vrstu zahtjeva.", "requestType");
    }

    const source = String(formData.get("source") || "returns");
    const isReturnsForm = source !== "support" && RETURN_TYPES.has(requestType);
    const input = {
      requestType,
      orderNumber: textField(formData, "orderNumber", 80, isReturnsForm),
      customerName: textField(formData, "customerName", 120, true),
      email: textField(formData, "email", 254, true),
      address: textField(formData, "address", 220, isReturnsForm),
      city: textField(formData, "city", 120, isReturnsForm),
      phone: textField(formData, "phone", 40, true),
      description: textField(formData, "description", 4000, true),
      companyName: textField(formData, "companyName", 180, requestType === BUSINESS_TYPE),
      companyIdNumber: textField(formData, "companyIdNumber", 80, requestType === BUSINESS_TYPE),
      companyVatNumber: textField(formData, "companyVatNumber", 80),
      companyAddress: textField(formData, "companyAddress", 260, requestType === BUSINESS_TYPE),
      files: await prepareFiles(formData),
    };

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      throw new InputError("Unesite ispravnu email adresu.", "email");
    }
    if (String(formData.get("consent") || "") !== "yes") {
      throw new InputError("Potvrdite saglasnost za obradu zahtjeva.");
    }
    if (requestType === DAMAGE_TYPE && input.files.length === 0) {
      throw new InputError("Za reklamaciju ili oštećenje dodajte najmanje jednu fotografiju.", "images");
    }

    recordCustomerRequestAttempt(ipHash);
    const claim = createCustomerRequest(input);
    return json(origin, {
      ok: true,
      reference: claim.reference,
      message: "Zahtjev je uspješno poslan.",
    });
  } catch (error) {
    if (error instanceof InputError) {
      return json(origin, { ok: false, field: error.field, message: error.message }, error.status);
    }
    console.error("Customer request submission failed:", error);
    return json(origin, { ok: false, message: "Zahtjev trenutno nije moguće poslati. Pokušajte ponovo malo kasnije." }, 500);
  }
}
