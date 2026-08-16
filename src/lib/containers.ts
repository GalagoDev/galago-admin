import crypto from "node:crypto";

import { inferContainerCarrier, isValidContainerNumber, normalizeContainerNumber } from "@/lib/container-number";
import { getDb } from "@/lib/db";

export { inferContainerCarrier, isValidContainerNumber, normalizeContainerNumber } from "@/lib/container-number";

const SHIPSGO_BASE_URL = "https://shipsgo.com/api/v1.2/ContainerService";
const RIJEKA_NAME = "Rijeka";
const RIJEKA_UNLOCODE = "HRRJK";
const PROVIDER_TIMEOUT_MS = 20_000;

type ContainerDbRow = {
  id: number;
  container_number: string;
  carrier_code: string;
  carrier_name: string | null;
  destination_port: string;
  destination_unlocode: string;
  provider: string;
  provider_request_id: string | null;
  tracking_status: string;
  status_label: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  departure_port: string | null;
  reported_destination_port: string | null;
  departure_at: string | null;
  eta: string | null;
  actual_arrival_at: string | null;
  last_location: string | null;
  latitude: number | null;
  longitude: number | null;
  delay_days: number | null;
  provider_updated_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type ContainerUpdateDbRow = {
  id: number;
  container_id: number;
  status_label: string | null;
  eta: string | null;
  location: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  provider_updated_at: string | null;
  created_at: string;
};

export type ContainerUpdate = {
  id: number;
  statusLabel: string;
  eta: string;
  location: string;
  vesselName: string;
  voyageNumber: string;
  providerUpdatedAt: string;
  createdAt: string;
};

export type TrackedContainer = {
  id: number;
  containerNumber: string;
  carrierCode: string;
  carrierName: string;
  destinationPort: string;
  destinationUnlocode: string;
  provider: string;
  providerRequestId: string;
  trackingStatus: string;
  statusLabel: string;
  vesselName: string;
  voyageNumber: string;
  departurePort: string;
  reportedDestinationPort: string;
  departureAt: string;
  eta: string;
  actualArrivalAt: string;
  lastLocation: string;
  latitude: number | null;
  longitude: number | null;
  delayDays: number | null;
  providerUpdatedAt: string;
  lastCheckedAt: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
  updates: ContainerUpdate[];
};

type NormalizedTracking = {
  statusLabel: string;
  vesselName: string;
  voyageNumber: string;
  departurePort: string;
  reportedDestinationPort: string;
  departureAt: string;
  eta: string;
  actualArrivalAt: string;
  lastLocation: string;
  latitude: number | null;
  longitude: number | null;
  delayDays: number | null;
  providerUpdatedAt: string;
  trackingStatus: string;
};

export class ContainerTrackingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContainerTrackingError";
  }
}

function mapUpdate(row: ContainerUpdateDbRow): ContainerUpdate {
  return {
    id: row.id,
    statusLabel: row.status_label || "",
    eta: row.eta || "",
    location: row.location || "",
    vesselName: row.vessel_name || "",
    voyageNumber: row.voyage_number || "",
    providerUpdatedAt: row.provider_updated_at || "",
    createdAt: row.created_at,
  };
}

function mapContainer(row: ContainerDbRow, updates: ContainerUpdate[] = []): TrackedContainer {
  return {
    id: row.id,
    containerNumber: row.container_number,
    carrierCode: row.carrier_code,
    carrierName: row.carrier_name || "",
    destinationPort: row.destination_port,
    destinationUnlocode: row.destination_unlocode,
    provider: row.provider,
    providerRequestId: row.provider_request_id || "",
    trackingStatus: row.tracking_status,
    statusLabel: row.status_label || "",
    vesselName: row.vessel_name || "",
    voyageNumber: row.voyage_number || "",
    departurePort: row.departure_port || "",
    reportedDestinationPort: row.reported_destination_port || "",
    departureAt: row.departure_at || "",
    eta: row.eta || "",
    actualArrivalAt: row.actual_arrival_at || "",
    lastLocation: row.last_location || "",
    latitude: row.latitude,
    longitude: row.longitude,
    delayDays: row.delay_days,
    providerUpdatedAt: row.provider_updated_at || "",
    lastCheckedAt: row.last_checked_at || "",
    lastError: row.last_error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updates,
  };
}

export function isContainerTrackingConfigured() {
  return Boolean(process.env.SHIPSGO_AUTH_CODE?.trim());
}

function getContainerRow(id: number) {
  return getDb().prepare("SELECT * FROM containers WHERE id = ?").get(id) as ContainerDbRow | undefined;
}

export function getTrackedContainers(query = "") {
  const db = getDb();
  const normalizedQuery = query.trim().toUpperCase();
  const rows = (normalizedQuery
    ? db
        .prepare(
          `SELECT * FROM containers
           WHERE container_number LIKE ?
              OR UPPER(COALESCE(carrier_name, '')) LIKE ?
              OR UPPER(COALESCE(vessel_name, '')) LIKE ?
           ORDER BY
             CASE tracking_status WHEN 'arrived' THEN 2 ELSE 1 END,
             CASE WHEN eta IS NULL OR eta = '' THEN 1 ELSE 0 END,
             eta ASC,
             id DESC`,
        )
        .all(`%${normalizedQuery}%`, `%${normalizedQuery}%`, `%${normalizedQuery}%`)
    : db
        .prepare(
          `SELECT * FROM containers
           ORDER BY
             CASE tracking_status WHEN 'arrived' THEN 2 ELSE 1 END,
             CASE WHEN eta IS NULL OR eta = '' THEN 1 ELSE 0 END,
             eta ASC,
             id DESC`,
        )
        .all()) as ContainerDbRow[];

  if (rows.length === 0) return [];

  const placeholders = rows.map(() => "?").join(",");
  const updateRows = db
    .prepare(
      `SELECT * FROM container_updates
       WHERE container_id IN (${placeholders})
       ORDER BY container_id, id DESC`,
    )
    .all(...rows.map((row) => row.id)) as ContainerUpdateDbRow[];
  const updatesByContainer = new Map<number, ContainerUpdate[]>();
  for (const row of updateRows) {
    const updates = updatesByContainer.get(row.container_id) || [];
    if (updates.length < 8) updates.push(mapUpdate(row));
    updatesByContainer.set(row.container_id, updates);
  }

  return rows.map((row) => mapContainer(row, updatesByContainer.get(row.id) || []));
}

export function getContainerStats() {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN tracking_status = 'arrived' THEN 1 ELSE 0 END) AS arrived,
         SUM(CASE WHEN tracking_status != 'arrived' AND delay_days > 0 THEN 1 ELSE 0 END) AS delayed,
         MIN(CASE
           WHEN tracking_status != 'arrived'
             AND eta IS NOT NULL
             AND eta != ''
             AND (
               reported_destination_port IS NULL
               OR reported_destination_port = ''
               OR LOWER(reported_destination_port) LIKE '%rijeka%'
               OR UPPER(reported_destination_port) LIKE '%HRRJK%'
             )
           THEN eta
         END) AS next_eta
       FROM containers`,
    )
    .get() as { total: number; arrived: number | null; delayed: number | null; next_eta: string | null };

  return {
    total: row.total,
    active: Math.max(row.total - (row.arrived || 0), 0),
    arrived: row.arrived || 0,
    delayed: row.delayed || 0,
    nextEta: row.next_eta || "",
  };
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collectValues(payload: unknown) {
  const values = new Map<string, unknown[]>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 7 || current.value === null || typeof current.value !== "object") continue;

    if (Array.isArray(current.value)) {
      for (const item of current.value) queue.push({ value: item, depth: current.depth + 1 });
      continue;
    }

    for (const [key, value] of Object.entries(current.value as Record<string, unknown>)) {
      const normalized = normalizeKey(key);
      const existing = values.get(normalized) || [];
      existing.push(value);
      values.set(normalized, existing);
      if (value !== null && typeof value === "object") queue.push({ value, depth: current.depth + 1 });
    }
  }

  return values;
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const key of ["value", "date", "name", "description", "code"]) {
      const entry = Object.entries(object).find(([name]) => normalizeKey(name) === key);
      const text = entry ? scalarText(entry[1]) : "";
      if (text) return text;
    }
  }
  return "";
}

function firstText(values: Map<string, unknown[]>, aliases: string[]) {
  for (const alias of aliases) {
    const candidates = values.get(normalizeKey(alias)) || [];
    for (const candidate of candidates) {
      const text = scalarText(candidate);
      if (text) return text;
    }
  }
  return "";
}

function firstNumber(values: Map<string, unknown[]>, aliases: string[]) {
  const text = firstText(values, aliases).replace(",", ".");
  if (!text) return null;
  const numericText = text.replace(/[^\d.-]/g, "");
  if (!/\d/.test(numericText)) return null;
  const number = Number(numericText);
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value: string) {
  const text = value.trim();
  if (!text) return "";

  const dayFirst = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(.*)$/);
  if (dayFirst) {
    const [, day, month, year, suffix] = dayFirst;
    const candidate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}${suffix || ""}`;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function normalizeTrackingPayload(payload: unknown): NormalizedTracking {
  const values = collectValues(payload);
  const statusLabel = firstText(values, ["shipmentStatus", "currentStatus", "statusDescription", "status"]);
  const actualArrivalAt = normalizeDate(firstText(values, ["actualArrivalDate", "actualDischargeDate", "ata"]));
  const eta = normalizeDate(
    firstText(values, ["eta", "estimatedTimeOfArrival", "portOfDischargeEta", "podEta", "dischargeDate", "arrivalDate"]),
  );
  const normalizedStatus = statusLabel.toLowerCase();
  const arrived = Boolean(actualArrivalAt) || /arrived|discharged|gate.?out|completed/.test(normalizedStatus);

  return {
    statusLabel: statusLabel || (arrived ? "Stigao" : eta ? "Na putu" : "Čeka podatke"),
    vesselName: firstText(values, ["vesselName", "vessel"]),
    voyageNumber: firstText(values, ["voyageNumber", "voyageNo", "voyage"]),
    departurePort: firstText(values, ["portOfLoading", "pol", "loadingPort", "originPort"]),
    reportedDestinationPort: firstText(values, ["portOfDischarge", "pod", "dischargePort", "destinationPort"]),
    departureAt: normalizeDate(firstText(values, ["etd", "departureDate", "sailingDate"])),
    eta,
    actualArrivalAt,
    lastLocation: firstText(values, ["lastLocation", "currentLocation", "location"]),
    latitude: firstNumber(values, ["latitude", "lat"]),
    longitude: firstNumber(values, ["longitude", "lng", "lon"]),
    delayDays: firstNumber(values, ["delayDays", "delay"]),
    providerUpdatedAt: normalizeDate(firstText(values, ["updatedAt", "lastUpdate", "lastUpdated"])),
    trackingStatus: arrived ? "arrived" : "tracking",
  };
}

async function readProviderResponse(response: Response) {
  const text = await response.text();
  let payload: unknown = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = scalarText(payload) || `HTTP ${response.status}`;
    throw new ContainerTrackingError("provider-error", `ShipsGo nije prihvatio zahtjev: ${message.slice(0, 240)}`);
  }
  return payload;
}

function providerRequestId(payload: unknown) {
  const direct = scalarText(payload);
  if (direct && direct.length <= 80) return direct.replace(/^"|"$/g, "");
  const values = collectValues(payload);
  return firstText(values, ["requestId", "requestID", "id"]);
}

async function registerWithShipsGo(container: ContainerDbRow, authCode: string) {
  const body = new URLSearchParams({
    authCode,
    containerNumber: container.container_number,
    shippingLine: container.carrier_code || "OTHERS",
  });
  const response = await fetch(`${SHIPSGO_BASE_URL}/PostContainerInfo`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const payload = await readProviderResponse(response);
  const requestId = providerRequestId(payload);
  if (!requestId) throw new ContainerTrackingError("provider-response", "ShipsGo nije vratio ID za praćenje.");
  return requestId;
}

async function getShipsGoTracking(requestId: string, authCode: string) {
  const url = new URL(`${SHIPSGO_BASE_URL}/GetContainerInfo/`);
  url.searchParams.set("authCode", authCode);
  url.searchParams.set("requestId", requestId);
  url.searchParams.set("mapPoint", "true");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  return readProviderResponse(response);
}

function safeProviderError(error: unknown) {
  if (error instanceof ContainerTrackingError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "ShipsGo nije odgovorio na vrijeme.";
  if (error instanceof Error) return error.message.slice(0, 240);
  return "Praćenje trenutno nije dostupno.";
}

function saveTrackingSnapshot(containerId: number, tracking: NormalizedTracking) {
  const snapshot = {
    statusLabel: tracking.statusLabel,
    eta: tracking.eta,
    location: tracking.lastLocation,
    vesselName: tracking.vesselName,
    voyageNumber: tracking.voyageNumber,
    providerUpdatedAt: tracking.providerUpdatedAt,
  };
  const hasData = Object.values(snapshot).some(Boolean);
  if (!hasData) return;

  const hash = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO container_updates (
         container_id, snapshot_hash, status_label, eta, location,
         vessel_name, voyage_number, provider_updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      containerId,
      hash,
      tracking.statusLabel || null,
      tracking.eta || null,
      tracking.lastLocation || null,
      tracking.vesselName || null,
      tracking.voyageNumber || null,
      tracking.providerUpdatedAt || null,
    );
}

export async function refreshTrackedContainer(id: number) {
  const db = getDb();
  let row = getContainerRow(id);
  if (!row) throw new ContainerTrackingError("not-found", "Kontejner nije pronađen.");

  const authCode = process.env.SHIPSGO_AUTH_CODE?.trim();
  if (!authCode) {
    db.prepare(
      `UPDATE containers
       SET tracking_status = 'not_configured',
           last_error = 'SHIPSGO_AUTH_CODE nije postavljen.',
           last_checked_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), new Date().toISOString(), id);
    return { ok: false, error: "not-configured" } as const;
  }

  try {
    let requestId = row.provider_request_id;
    if (!requestId) {
      requestId = await registerWithShipsGo(row, authCode);
      db.prepare(
        `UPDATE containers
         SET provider_request_id = ?, tracking_status = 'pending', last_error = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(requestId, new Date().toISOString(), id);
      row = getContainerRow(id) || row;
    }

    const payload = await getShipsGoTracking(requestId, authCode);
    const tracking = normalizeTrackingPayload(payload);
    const now = new Date().toISOString();
    const rawSnapshot = JSON.stringify(payload).slice(0, 500_000);
    db.prepare(
      `UPDATE containers SET
         tracking_status = ?, status_label = ?, vessel_name = ?, voyage_number = ?,
         departure_port = ?, reported_destination_port = ?, departure_at = ?, eta = ?,
         actual_arrival_at = ?, last_location = ?, latitude = ?, longitude = ?, delay_days = ?,
         provider_updated_at = ?, last_checked_at = ?, last_error = NULL,
         raw_snapshot = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      tracking.trackingStatus,
      tracking.statusLabel || null,
      tracking.vesselName || null,
      tracking.voyageNumber || null,
      tracking.departurePort || null,
      tracking.reportedDestinationPort || null,
      tracking.departureAt || null,
      tracking.eta || null,
      tracking.actualArrivalAt || null,
      tracking.lastLocation || null,
      tracking.latitude,
      tracking.longitude,
      tracking.delayDays,
      tracking.providerUpdatedAt || null,
      now,
      rawSnapshot,
      now,
      id,
    );
    saveTrackingSnapshot(id, tracking);
    return { ok: true, error: "" } as const;
  } catch (error) {
    const message = safeProviderError(error);
    const now = new Date().toISOString();
    const nextStatus = row.eta || row.status_label ? row.tracking_status : "error";
    db.prepare(
      `UPDATE containers
       SET tracking_status = ?, last_error = ?, last_checked_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(nextStatus, message, now, now, id);
    return { ok: false, error: "tracking-failed", message } as const;
  }
}

export async function createTrackedContainer(value: string) {
  const containerNumber = normalizeContainerNumber(value);
  if (!isValidContainerNumber(containerNumber)) {
    throw new ContainerTrackingError("invalid-number", "Broj kontejnera nije ispravan.");
  }

  const db = getDb();
  const existing = db.prepare("SELECT * FROM containers WHERE container_number = ?").get(containerNumber) as ContainerDbRow | undefined;
  if (existing) return { created: false, container: mapContainer(existing), refresh: null };

  const carrier = inferContainerCarrier(containerNumber);
  const result = db
    .prepare(
      `INSERT INTO containers (
         container_number, carrier_code, carrier_name, destination_port,
         destination_unlocode, tracking_status, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      containerNumber,
      carrier.code,
      carrier.name,
      RIJEKA_NAME,
      RIJEKA_UNLOCODE,
      isContainerTrackingConfigured() ? "pending" : "not_configured",
      new Date().toISOString(),
    );
  const id = Number(result.lastInsertRowid);
  const refresh = await refreshTrackedContainer(id);
  const row = getContainerRow(id);
  if (!row) throw new ContainerTrackingError("save-failed", "Kontejner nije sačuvan.");
  return { created: true, container: mapContainer(row), refresh };
}

export function deleteTrackedContainer(id: number) {
  const result = getDb().prepare("DELETE FROM containers WHERE id = ?").run(id);
  if (result.changes === 0) throw new ContainerTrackingError("not-found", "Kontejner nije pronađen.");
}

export async function refreshDueContainers(options: { force?: boolean; limit?: number } = {}) {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);
  const rows = db
    .prepare(
      `SELECT id FROM containers
       WHERE tracking_status != 'arrived'
         AND (? = 1 OR last_checked_at IS NULL OR datetime(last_checked_at) <= datetime('now', '-6 hours'))
       ORDER BY COALESCE(last_checked_at, created_at) ASC
       LIMIT ?`,
    )
    .all(options.force ? 1 : 0, limit) as Array<{ id: number }>;

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await refreshTrackedContainer(row.id);
    if (result.ok) updated += 1;
    else failed += 1;
  }

  return { checked: rows.length, updated, failed };
}
