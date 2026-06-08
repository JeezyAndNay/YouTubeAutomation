import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decrypt } from "@/lib/session-crypto";

const COOKIE_NAME = "ru_session";
const PIPELINE_TOKEN_HEADER = "x-pipeline-token";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (isPublic) return NextResponse.next();

  // Internal pipeline callback bypass — lets n8n PATCH an episode's status
  // (e.g. "ready_for_phase3", "error") without a browser session cookie.
  // Scoped tightly: only /api/episodes/<slug>/status, and only with the
  // correct shared-secret header. Everything else still requires a session.
  const isStatusCallback = /^\/api\/episodes\/[^/]+\/status$/.test(pathname);
  if (isStatusCallback) {
    const token = request.headers.get(PIPELINE_TOKEN_HEADER);
    const expected = process.env.PIPELINE_API_TOKEN;
    if (expected && token === expected) {
      return NextResponse.next();
    }
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = await decrypt(token);

  if (!session?.auth) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
