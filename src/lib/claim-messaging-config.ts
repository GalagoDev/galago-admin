import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ensureStorage } from "@/lib/storage";

const schema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/),
  webhookSecret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  chatId: z.string().regex(/^-\d+$/),
  allowedUserIds: z.array(z.string().regex(/^[1-9]\d*$/)).min(1),
  publicUrl: z.url().refine((v) => new URL(v).protocol === "https:" && new URL(v).origin === v),
  encryptionKey: z.string().refine((v) => Buffer.from(v, "base64").length === 32),
  gmailClientId: z.string().default(""),
  gmailClientSecret: z.string().default(""),
  gmailAddress: z.literal("galagodoo@gmail.com").default("galagodoo@gmail.com"),
});
export type ClaimMessagingConfig = z.infer<typeof schema>;

export function getClaimMessagingConfig(): ClaimMessagingConfig | null {
  const filename = path.join(ensureStorage().data, "claims-config.json");
  try {
    const config = schema.parse(JSON.parse(fs.readFileSync(filename, "utf8")));
    if (config.botToken === process.env.TELEGRAM_ORDERS_BOT_TOKEN) throw new Error("Separate bot required");
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Never log validation input: it contains long-lived credentials.
      console.error("Claims messaging configuration is invalid");
    }
    return null;
  }
}

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function sameSecret(a: string, b: string) {
  return !!a && !!b && timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
}
export function encryptClaimSecret(value: string, config: ClaimMessagingConfig) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(config.encryptionKey, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64url")).join(".");
}
export function decryptClaimSecret(value: string, config: ClaimMessagingConfig) {
  const [iv, tag, ciphertext] = value.split(".").map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(config.encryptionKey, "base64"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
