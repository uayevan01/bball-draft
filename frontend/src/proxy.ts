import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Next.js 16+ uses `proxy.ts` instead of `middleware.ts`.
// This avoids the compatibility proxy wrapper that Next generates for deprecated middleware files.
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;
  await auth.protect();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next (static files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next|favicon.ico|.*\\..*).*)",
  ],
};


