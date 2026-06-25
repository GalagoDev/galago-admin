"use server";

import { redirect } from "next/navigation";


async function handlePdfUpload(formData: FormData, type: "sent" | "delivered") {
  const file = formData.get("pdf");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/?error=missing-${type}-pdf`);
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    redirect(`/?error=invalid-${type}-pdf`);
  }

  const { importPdfSegments, savePdfDocument } = await import("@/lib/documents");
  const documentType = type as "sent" | "delivered";
  const saved = await savePdfDocument(file, documentType);
  const imported = importPdfSegments(saved.documentId, documentType, saved.segments);

  redirect(`/?success=${type}-pdf-uploaded&imported=${imported}`);
}

export async function uploadSentPdfAction(formData: FormData) {
  return handlePdfUpload(formData, "sent");
}

export async function uploadDeliveredPdfAction(formData: FormData) {
  return handlePdfUpload(formData, "delivered");
}
