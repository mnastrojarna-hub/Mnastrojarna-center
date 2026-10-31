import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // vendor/ (OpenCascade, LibreDWG — wasm prohlížeče výkresů) a fonts/ jsou veřejné statické soubory:
  // bez kontroly přihlášení (rychlejší načtení, cache)
  matcher: [
    "/((?!_next/static|_next/image|vendor/|fonts/|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
