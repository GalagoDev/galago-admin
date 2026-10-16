import { cookies } from "next/headers";
import { AUTH_COOKIE, verifySession } from "@/lib/session";

export { AUTH_COOKIE } from "@/lib/session";

export async function isAuthenticated() {
  const cookieStore = await cookies();
  return verifySession(cookieStore.get(AUTH_COOKIE)?.value);
}

export async function requireAuth() {
  const authed = await isAuthenticated();
  return authed;
}
