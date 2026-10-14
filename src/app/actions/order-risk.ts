"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_COOKIE } from "@/lib/auth";
import {
  setOrderRiskDecision,
  setOrderRiskDecisions,
  type OrderRiskDecision,
  type OrderRiskReference,
} from "@/lib/google-orders";

function parseReference(value: FormDataEntryValue): OrderRiskReference | null {
  if (typeof value !== "string" || value.length > 900) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OrderRiskReference>;
    if (!Number.isInteger(parsed.sheetRowNumber) || Number(parsed.sheetRowNumber) < 2) return null;
    if (typeof parsed.fingerprint !== "string" || !/^[a-f0-9]{24}$/.test(parsed.fingerprint)) return null;
    if (typeof parsed.dateLabel !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(parsed.dateLabel)) return null;
    if (parsed.sourceId !== undefined && (typeof parsed.sourceId !== "string" || parsed.sourceId.length > 220)) return null;
    return {
      sheetRowNumber: Number(parsed.sheetRowNumber),
      fingerprint: parsed.fingerprint,
      dateLabel: parsed.dateLabel,
      sourceId: parsed.sourceId || "",
    };
  } catch {
    return null;
  }
}

function parseDecision(value: FormDataEntryValue | null): OrderRiskDecision | null {
  return value === "approve" || value === "duplicate" || value === "restore" ? value : null;
}

export async function setOrderRiskDecisionAction(formData: FormData) {
  if ((await cookies()).get(AUTH_COOKIE)?.value !== "ok") redirect("/login");
  const reference = parseReference(formData.get("order") ?? "");
  const decision = parseDecision(formData.get("decision"));
  if (!reference || !decision) redirect("/orders?error=invalid-risk-decision");

  try {
    await setOrderRiskDecision(reference, decision);
  } catch (error) {
    console.error("Order risk decision failed", error);
    redirect("/orders?refresh=1&error=risk-update-failed");
  }

  revalidatePath("/");
  revalidatePath("/orders");
  revalidatePath("/in-transit");
  redirect(`/orders?risk=${decision}`);
}

export async function approveAllOrderRisksAction(formData: FormData) {
  if ((await cookies()).get(AUTH_COOKIE)?.value !== "ok") redirect("/login");
  const values = formData.getAll("order");
  if (values.length === 0 || values.length > 1000) redirect("/orders?error=invalid-risk-decision");
  const references = values.map(parseReference);
  if (references.some((reference) => !reference)
    || new Set(references.map((reference) => reference?.dateLabel)).size !== 1) {
    redirect("/orders?error=invalid-risk-decision");
  }

  let count: number;
  try {
    const result = await setOrderRiskDecisions(references as OrderRiskReference[], "approve");
    count = result.count;
  } catch (error) {
    console.error("Bulk order risk decision failed", error);
    redirect("/orders?refresh=1&error=risk-update-failed");
  }

  revalidatePath("/");
  revalidatePath("/orders");
  revalidatePath("/in-transit");
  redirect(`/orders?risk=approve-all&count=${count}`);
}
