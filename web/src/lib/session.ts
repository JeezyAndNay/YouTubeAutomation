import "server-only";
import { cookies } from "next/headers";
import { encrypt, decrypt } from "./session-crypto";

export { decrypt };

const COOKIE_NAME = "ru_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession() {
  const expires = new Date(Date.now() + SESSION_DURATION_MS);
  const token = await encrypt({ auth: true });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: false,
    expires,
    sameSite: "lax",
    path: "/",
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return decrypt(token);
}

export { COOKIE_NAME };
