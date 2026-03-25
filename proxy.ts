import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth(function proxy(req) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/blocked") ||
    pathname.startsWith("/api/auth");

  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
