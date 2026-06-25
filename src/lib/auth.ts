import { cookies } from "next/headers";

export const AUTH_COOKIE = "store-admin-session";

export async function isAuthenticated() {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE)?.value === "ok";
}

export async function requireAuth() {
  const authed = await isAuthenticated();
  return authed;
}
