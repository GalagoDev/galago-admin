"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { allocateImportPayment, classifyImportPayment, getImportsOverview, removeImportAllocation, removeImportContainer, saveImportContainer, saveImportInvoice, removeImportInvoice } from "@/lib/import-payments";
import { syncImportPayments } from "@/lib/import-payments-sync";
import { z } from "zod";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("saveContainer"), id: z.string().uuid().optional(), name: z.string().max(80), notes: z.string().max(1000), status: z.enum(["planned", "in_transit", "received"]) }),
  z.object({ action: z.literal("removeContainer"), id: z.string().uuid() }),
  z.object({ action: z.literal("classify"), id: z.string().min(1).max(64), supplier: z.enum(["TADEX", "SHENGFENG", "OTHER", ""]) }),
  z.object({ action: z.literal("allocate"), paymentId: z.string().min(1).max(64), containerId: z.string().uuid(), amount: z.string().max(30), requestId: z.string().uuid() }),
  z.object({ action: z.literal("removeAllocation"), id: z.string().uuid() }),
  z.object({ action: z.literal("saveInvoice"), containerId: z.string().uuid(), fileId: z.string().uuid(), number: z.string().max(100), amount: z.string().max(30), currency: z.enum(["USD", "EUR", "BAM"]), supplier: z.enum(["TADEX", "SHENGFENG"]) }),
  z.object({ action: z.literal("removeInvoice"), containerId: z.string().uuid() }),
]);
export type ImportCommand = z.infer<typeof commandSchema>;

export async function updateImportsAction(input: ImportCommand) {
  if (!await isAuthenticated()) return { ok: false as const, error: "Sesija je istekla. Prijavite se ponovo." };
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Provjerite unesene podatke." };
  const command = parsed.data;
  try {
    let message = "Sačuvano.";
    switch (command.action) {
      case "sync": {
        const result = await syncImportPayments(true);
        message = result.skipped ? "Osvježavanje je već pokrenuto ili je završeno u posljednjoj minuti." : `Preuzeto ${result.count} zapisa iz Nalta.`;
        break;
      }
      case "saveContainer": saveImportContainer(command); break;
      case "removeContainer": removeImportContainer(command.id); break;
      case "classify": classifyImportPayment(command.id, command.supplier); break;
      case "allocate": allocateImportPayment(command); break;
      case "removeAllocation": removeImportAllocation(command.id); break;
      case "saveInvoice": saveImportInvoice(command); message = "Faktura je potvrđena."; break;
      case "removeInvoice": removeImportInvoice(command.containerId); break;
    }
    revalidatePath("/imports");
    return { ok: true as const, data: getImportsOverview(), message };
  } catch (error) {
    const expected = error instanceof Error && !('code' in error) && !(error instanceof z.ZodError);
    return { ok: false as const, error: expected ? error.message : "Promjena nije sačuvana. Provjerite podatke i pokušajte ponovo." };
  }
}
