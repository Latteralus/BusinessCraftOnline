import { verifyCustomJwt } from "@/lib/auth-jwt";
import { CUSTOM_SESSION_COOKIE_NAME } from "@/lib/session";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_PATHS = ["/login", "/register"];
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
  const customToken = request.cookies.get(CUSTOM_SESSION_COOKIE_NAME)?.value;
  const payload = customToken ? await verifyCustomJwt(customToken) : null;
  const isAuthenticated = Boolean(payload?.sub);

  const pathname = request.nextUrl.pathname;
  const isAuthPath = AUTH_PATHS.some((path) => pathname.startsWith(path));

  if (isAuthenticated && isAuthPath) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (customToken && !isAuthenticated) {
    response.cookies.delete(CUSTOM_SESSION_COOKIE_NAME);
  }

  return response;
}

export const config = {
  matcher: ["/login", "/register"],
};
