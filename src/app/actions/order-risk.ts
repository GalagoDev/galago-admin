"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAuthenticated } from "@/lib/auth";
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

function returnToOrders(formData: FormData, params: string) {
  return `/orders?${formData.get("view") === "export" ? "view=export&" : ""}${params}`;
}

export async function setOrderRiskDecisionAction(formData: FormData) {
  if (!await isAuthenticated()) redirect("/login");
  const reference = parseReference(formData.get("order") ?? "");
  const decision = parseDecision(formData.get("decision"));
  if (!reference || !decision) redirect(returnToOrders(formData, "error=invalid-risk-decision"));

  try {
    await setOrderRiskDecision(reference, decision);
  } catch (error) {
    console.error("Order risk decision failed", error);
    redirect(returnToOrders(formData, "refresh=1&error=risk-update-failed"));
  }

  revalidatePath("/");
  revalidatePath("/orders");
  revalidatePath("/in-transit");
  redirect(returnToOrders(formData, `risk=${decision}`));
}

export async function approveAllOrderRisksAction(formData: FormData) {
  if (!await isAuthenticated()) redirect("/login");
  const values = formData.getAll("order");
  if (values.length === 0 || values.length > 1000) redirect(returnToOrders(formData, "error=invalid-risk-decision"));
  const references = values.map(parseReference);
  if (references.some((reference) => !reference)
    || (formData.get("view") !== "export" && new Set(references.map((reference) => reference?.dateLabel)).size !== 1)) {
    redirect(returnToOrders(formData, "error=invalid-risk-decision"));
  }

  let count: number;
  try {
    const result = await setOrderRiskDecisions(references as OrderRiskReference[], "approve");
    count = result.count;
  } catch (error) {
    console.error("Bulk order risk decision failed", error);
    redirect(returnToOrders(formData, "refresh=1&error=risk-update-failed"));
  }

  revalidatePath("/");
  revalidatePath("/orders");
  revalidatePath("/in-transit");
  redirect(returnToOrders(formData, `risk=approve-all&count=${count}`));
}
