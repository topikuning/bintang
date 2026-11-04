import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/masuk", "/mulai", "/api/health"];
const SESSION_COOKIE = "bintang_session";

/**
 * Proxy (dulu "middleware") ringan: hanya cek keberadaan cookie sesi. Validasi sesi
 * sesungguhnya + capability terjadi di data layer (requireUser /
 * requireCapability) – proxy bukan satu-satunya pagar.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/masuk";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.*|apple-icon.*|.*\\.(?:svg|png|jpg|jpeg|webp|ico|css|js)$).*)"],
};
