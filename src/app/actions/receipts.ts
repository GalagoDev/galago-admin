"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getOrdersSheetRows } from "@/lib/google-sheets";
import {
  createReceiptBatch,
  deleteReceiptBatch,
  ReceiptBatchError,
  refreshReceiptBatchPhones,
  saveReceiptPdfs,
  updateReceiptManualSendStatus,
} from "@/lib/receipt-batches";
import { parseReceiptWorkbook } from "@/lib/receipt-workbook";

function parseBatchId(value: FormDataEntryValue | null) {
  const batchId = Number(value);
  return Number.isInteger(batchId) && batchId > 0 ? batchId : null;
}

export async function uploadReceiptWorkbookAction(formData: FormData) {
  const file = formData.get("workbook");
  if (!(file instanceof File) || file.size === 0) redirect("/receipts?error=missing-workbook");

  let result: ReturnType<typeof createReceiptBatch>;
  try {
    const [rows, orders, bytes] = await Promise.all([
      parseReceiptWorkbook(file),
      getOrdersSheetRows({ fresh: true }),
      file.arrayBuffer(),
    ]);
    const fileHash = crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    result = createReceiptBatch(file.name, fileHash, rows, orders);
  } catch (error) {
    console.error("Receipt workbook import failed", error);
    redirect("/receipts?error=workbook-invalid");
  }

  revalidatePath("/receipts");
  redirect(`/receipts?batch=${result.batch.id}&imported=1${result.created ? "" : "&duplicate=1"}`);
}

export async function uploadReceiptPdfsAction(formData: FormData) {
  const batchId = parseBatchId(formData.get("batchId"));
  if (!batchId) redirect("/receipts?error=batch-not-found");
  const files = formData.getAll("pdfs").filter((entry): entry is File => entry instanceof File);

  let uploaded = 0;
  try {
    uploaded = await saveReceiptPdfs(batchId, files);
  } catch (error) {
    console.error("Receipt PDF upload failed", error);
    const code = error instanceof ReceiptBatchError ? error.code : "pdf-upload-failed";
    redirect(`/receipts?batch=${batchId}&error=${code}`);
  }

  revalidatePath("/receipts");
  redirect(`/receipts?batch=${batchId}&pdfs=${uploaded}`);
}

export async function refreshReceiptPhonesAction(formData: FormData) {
  const batchId = parseBatchId(formData.get("batchId"));
  if (!batchId) redirect("/receipts?error=batch-not-found");

  let matched = 0;
  try {
    const orders = await getOrdersSheetRows({ fresh: true });
    matched = refreshReceiptBatchPhones(batchId, orders);
  } catch (error) {
    console.error("Receipt phone refresh failed", error);
    redirect(`/receipts?batch=${batchId}&error=phone-refresh-failed`);
  }

  revalidatePath("/receipts");
  redirect(`/receipts?batch=${batchId}&phones=${matched}`);
}

export async function deleteReceiptBatchAction(formData: FormData) {
  const batchId = parseBatchId(formData.get("batchId"));
  if (!batchId) redirect("/receipts?error=batch-not-found");

  try {
    await deleteReceiptBatch(batchId);
  } catch (error) {
    console.error("Receipt batch deletion failed", error);
    const code = error instanceof ReceiptBatchError ? error.code : "delete-failed";
    redirect(`/receipts?batch=${batchId}&error=${code}`);
  }

  revalidatePath("/receipts");
  redirect("/receipts?removed=1");
}

export async function updateReceiptManualSendStatusAction(formData: FormData) {
  const recipientId = Number(formData.get("recipientId"));
  const status = String(formData.get("status") || "");
  if (!Number.isInteger(recipientId) || recipientId < 1 || !["sent", "ready"].includes(status)) {
    throw new Error("Neispravan zahtjev za status računa.");
  }

  updateReceiptManualSendStatus(recipientId, status === "sent");
  revalidatePath("/receipts");
}
