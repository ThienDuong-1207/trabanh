import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGE_PATHS = ["/login", "/auth/callback"];
// Called by the hourly GitHub Actions workflow with its own SYNC_SECRET
// bearer check (app/api/sync-sheet/route.ts) — not a signed-in user, so it
// must stay reachable without a session.
const PUBLIC_API_PATHS = ["/api/sync-sheet"];

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        req.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: req });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        req.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request: req });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  // Also refreshes the session cookie if it's close to expiring.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const isPublicPage = PUBLIC_PAGE_PATHS.some((p) => path.startsWith(p));
  const isPublicApi = PUBLIC_API_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublicPage && !isPublicApi) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|woff|woff2)$).*)"],
};
