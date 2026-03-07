import { verifyCustomJwt } from "@/lib/auth-jwt";
import { CUSTOM_SESSION_COOKIE_NAME } from "@/lib/session";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_PATHS = ["/login", "/register"];
const PROTECTED_PATHS = [
  "/dashboard",
  "/character-setup",
  "/travel",
  "/banking",
  "/inventory",
  "/businesses",
  "/employees",
  "/production",
  "/contracts",
  "/market",
];
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
  const isProtectedPath = PROTECTED_PATHS.some((path) =>
    pathname.startsWith(path)
  );

  if (!isAuthenticated && isProtectedPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    if (customToken) {
      redirectResponse.cookies.delete(CUSTOM_SESSION_COOKIE_NAME);
    }
    return redirectResponse;
  }

  if (isAuthenticated && isAuthPath) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (customToken && !isAuthenticated) {
    response.cookies.delete(CUSTOM_SESSION_COOKIE_NAME);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
