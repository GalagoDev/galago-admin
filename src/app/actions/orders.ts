"use server";

import { redirect } from "next/navigation";

import { getDb } from "@/lib/db";
import { appendOrderToOrdersSheet } from "@/lib/google-orders";
import { parsedOrderToConfirmableOrder } from "@/lib/order-format";
import { parseOrderText } from "@/lib/parse-order";

function encode(value: string) {
  return encodeURIComponent(value);
}

export async function previewIncomingOrderAction(formData: FormData) {
  const rawText = String(formData.get("rawText") ?? "").trim();

  if (!rawText) {
    redirect("/?error=missing-order-text");
  }

  const parsed = parseOrderText(rawText);
  const draft = parsedOrderToConfirmableOrder(parsed);

  redirect(
    `/?draft=1&rawText=${encode(rawText)}&primalac=${encode(draft.primalac)}&brojTelefona=${encode(draft.brojTelefona)}&grad=${encode(draft.grad)}&adresa=${encode(draft.adresa)}&artikal=${encode(draft.artikal)}&brojPaketa=${encode(draft.brojPaketa)}&otkupnina=${encode(draft.otkupnina)}&vrijednostPosiljke=${encode(draft.vrijednostPosiljke)}&dop=${encode(draft.dop)}&zamjena=${encode(draft.zamjena)}&confidence=${parsed.confidence}`
  );
}

export async function saveConfirmedOrderAction(formData: FormData) {
  const rawText = String(formData.get("rawText") ?? "").trim();
  const primalac = String(formData.get("primalac") ?? "").trim();
  const brojTelefona = String(formData.get("brojTelefona") ?? "").trim();
  const grad = String(formData.get("grad") ?? "").trim();
  const adresa = String(formData.get("adresa") ?? "").trim();
  const artikal = String(formData.get("artikal") ?? "").trim();
  const brojPaketa = String(formData.get("brojPaketa") ?? "1").trim() || "1";
  const otkupnina = String(formData.get("otkupnina") ?? "").trim();
  const vrijednostPosiljke = String(formData.get("vrijednostPosiljke") ?? otkupnina).trim();
  const dop = String(formData.get("dop") ?? "1").trim() || "1";
  const zamjena = String(formData.get("zamjena") ?? "0").trim() || "0";

  if (!primalac && !brojTelefona && !artikal) {
    redirect("/?error=missing-confirmed-fields");
  }

  const db = getDb();
  db.prepare(
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
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "message_confirmed",
    primalac,
    brojTelefona,
    grad,
    adresa,
    artikal,
    otkupnina ? Number(otkupnina.replace(/[^\d.,]/g, "").replace(",", ".")) || null : null,
    `Confirmed by admin | Broj paketa: ${brojPaketa} | DOP: ${dop} | Zamjena: ${zamjena}`,
    rawText,
    "incoming"
  );

  await appendOrderToOrdersSheet({
    primalac,
    brojTelefona,
    grad,
    adresa,
    artikal,
    brojPaketa,
    otkupnina,
    vrijednostPosiljke,
    dop,
    zamjena,
  });

  redirect("/?success=order-saved");
}
