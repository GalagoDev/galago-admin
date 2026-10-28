import { z } from "zod";
import { normalizeCourierTracking, type CourierParcelData } from "@/lib/courier-status";

const trace = z.object({ ParcelNumber: z.string().optional(), ScanDate: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/),
  ScanTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/), CenterName: z.string().default(""),
  StatusDescription: z.string().min(1), StatusCode: z.string().default("") });
const payload = z.object({ ShipmentNumber: z.string(), ShippingDate: z.string(),
  Traces: z.object({ Trace: z.union([z.array(trace).min(1).max(1000), trace]) }) });

export function parseCourierTrackingResponse(value: unknown, tracking: string): CourierParcelData {
  const input = payload.parse(value);
  if (normalizeCourierTracking(input.ShipmentNumber) !== tracking) throw new Error("Courier response identity mismatch");
  const traces = Array.isArray(input.Traces.Trace) ? input.Traces.Trace : [input.Traces.Trace];
  if (traces.some(t => t.ParcelNumber && normalizeCourierTracking(t.ParcelNumber) !== tracking)) throw new Error("Courier parcel identity mismatch");
  return { tracking, shippingDate: input.ShippingDate, traces: traces.map(t => ({ date: t.ScanDate, time: t.ScanTime,
    location: t.CenterName, status: t.StatusDescription, code: t.StatusCode })).sort((a, b) =>
      (b.date.split(".").reverse().join("-") + b.time).localeCompare(a.date.split(".").reverse().join("-") + a.time)) };
}
export async function fetchCourierTracking(tracking: string) {
  if (normalizeCourierTracking(tracking) !== tracking) throw new Error("Invalid parcel number");
  const response = await fetch("https://expressone.ba/api/track", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipmentNumber: `001-${tracking}` }), signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Courier unavailable (${response.status})`);
  return parseCourierTrackingResponse(await response.json(), tracking);
}
