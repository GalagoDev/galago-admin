import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";

const STATISTICS_ACCESS_COOKIE = "daily-statistics-access";
const ACCESS_DURATION_SECONDS = 4 * 60 * 60;

function expectedPassword() {
  return process.env.STATISTICS_ACCESS_PASSWORD || "Kesh";
}

export function isDailyStatisticsPasswordValid(value: unknown) {
  const supplied = Buffer.from(String(value ?? ""));
  const expected = Buffer.from(expectedPassword());
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

export async function hasDailyStatisticsAccess() {
  const cookieStore = await cookies();
  return cookieStore.get(STATISTICS_ACCESS_COOKIE)?.value === "ok";
}

export async function grantDailyStatisticsAccess() {
  const cookieStore = await cookies();
  cookieStore.set(STATISTICS_ACCESS_COOKIE, "ok", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/stats/today",
    maxAge: ACCESS_DURATION_SECONDS,
  });
}

export async function clearDailyStatisticsAccess() {
  const cookieStore = await cookies();
  cookieStore.set(STATISTICS_ACCESS_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/stats/today",
    maxAge: 0,
  });
}
