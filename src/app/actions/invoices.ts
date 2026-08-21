"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createInvoice,
  currentInvoiceMonth,
  deleteInvoice,
  InvoiceError,
  normalizeInvoiceMonth,
  setInvoicePaid,
} from "@/lib/invoices";

function parseInvoiceId(value: FormDataEntryValue | null) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function uploadInvoiceAction(formData: FormData) {
  const month = normalizeInvoiceMonth(formData.get("month")) || currentInvoiceMonth();
  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) redirect(`/fakture?month=${month}&error=file-missing`);

  try {
    const result = await createInvoice({
      month,
      title: String(formData.get("title") || ""),
      amount: String(formData.get("amount") || ""),
      file,
    });
    revalidatePath("/fakture");
    redirect(`/fakture?month=${month}&${result.created ? "added=1" : "duplicate=1"}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Invoice upload failed", error);
    const code = error instanceof InvoiceError ? error.code : "upload-failed";
    redirect(`/fakture?month=${month}&error=${code}`);
  }
}

export async function setInvoicePaidAction(formData: FormData) {
  const id = parseInvoiceId(formData.get("invoiceId"));
  const paid = formData.get("paid") === "1";
  if (!id) throw new Error("Neispravna faktura.");

  setInvoicePaid(id, paid);
  revalidatePath("/fakture");
}

export async function deleteInvoiceAction(formData: FormData) {
  const id = parseInvoiceId(formData.get("invoiceId"));
  if (!id) throw new Error("Neispravna faktura.");

  deleteInvoice(id);
  revalidatePath("/fakture");
}
