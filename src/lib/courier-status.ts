import { createHash } from "node:crypto";
import type { SheetOrderRow } from "./google-sheets";
import { createOrderFingerprint } from "./order-fingerprint";

export type CourierCategory = "active" | "registered" | "partial" | "review" | "delivered" | "returned";
export type CourierTrace = { date: string; time: string; location: string; status: string; code: string };
export type CourierParcelData = { tracking: string; shippingDate: string; traces: CourierTrace[] };
export type CourierParcelState = { tracking: string; category: CourierCategory; checkedAt: number; lastStatus: string };
export type CourierOrderState = {
  key: string; category: CourierCategory; reason: string; checkedAt: number;
  expectedPackages: number; parcels: CourierParcelState[];
};
export const COURIER_MAX_AGE = 36 * 60 * 60_000;

export function courierOrderKey(order: SheetOrderRow) {
  const numeric = (value: string) => /^-?\d+(?:[.,]\d{1,2})?$/.test(value.trim())
    ? String(Number(value.trim().replace(",", "."))) : value.trim();
  const identity = { ...order, brojPaketa: numeric(order.brojPaketa), otkupnina: numeric(order.otkupnina),
    vrijednostPosiljke: numeric(order.vrijednostPosiljke), dop: numeric(order.dop), zamjena: numeric(order.zamjena) };
  return createHash("sha256").update(["v2", createOrderFingerprint(identity), order.dateLabel, order.receivedAt || "", order.sourceId || ""].join("\u001f")).digest("hex");
}
export function legacyCourierOrderKey(order: SheetOrderRow) {
  return createHash("sha256").update([createOrderFingerprint(order), order.dateLabel, order.receivedAt || "", order.sourceId || ""].join("\u001f")).digest("hex");
}
export function courierPackageCount(order: SheetOrderRow) {
  const value = Number(String(order.brojPaketa || "1").replace(",", "."));
  return Number.isInteger(value) && value > 0 ? value : 1;
}
export function normalizeCourierTracking(value: string) {
  const v = value.trim();
  if (/^\d{8}$/.test(v)) return v;
  if (/^001-?\d{8}$/.test(v)) return v.slice(-8);
  if (/^70001\d{8}$/.test(v)) return v.slice(-8);
  return null;
}
function norm(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
export function classifyCourierParcel(data: CourierParcelData): CourierCategory {
  if (!data.traces.length) return "review";
  const rows = data.traces.map(t => ({ ...t, normalized: norm(t.status) }));
  // A delivery scan after RETS may be delivery back to the sender, not to the buyer.
  if (rows.some(t => t.code === "RETS" || t.normalized === "povrat posiljaocu")) return "returned";
  if (rows.some(t => t.code === "DELY" || t.normalized === "potvrda dostave" || t.normalized === "otkup placen gotovinom")) return "delivered";
  const metadata = new Set(["definicija podataka", "izmjena", "greska stampaca za nalepnice"]);
  if (rows.every(t => metadata.has(t.normalized))) return "registered";
  const physical = new Set(["init", "utovareno za dostavu", "vanredna isporuka", "stavljeno na skladiste", "vraceno u centar",
    "odlozena isporuka(primalac odsutan)", "deliveryfailed", "odsutan", "nije lociran", "odbijeno", "tranzit (hub - izlaz)",
    "pogresno sortiranje kod isporuke", "prerutiranje (pogresno rutirano)"]);
  return rows.some(t => physical.has(t.normalized)) ? "active" : "review";
}
export function aggregateCourierParcels(parcels: CourierParcelState[], expected: number): CourierCategory {
  if (parcels.length !== expected || parcels.some(p => p.category === "review")) return "review";
  const categories = new Set(parcels.map(p => p.category));
  if (categories.size === 1) return parcels[0]?.category || "review";
  if (categories.has("returned")) return "partial";
  return categories.has("active") ? "active" : "partial";
}
