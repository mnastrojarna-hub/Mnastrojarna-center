"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Počáteční heslo od super admina (např. „123456") se musí změnit hned po
 * prvním přihlášení. Mimo „Můj účet" zakryje aplikaci výzvou, na stránce účtu
 * ukáže upozornění nad formulářem.
 */
export function PasswordChangeGate({ required }: { required: boolean }) {
  const pathname = usePathname();
  if (!required) return null;

  if (pathname.startsWith("/account")) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          <b>Nastav si vlastní heslo.</b> Počáteční heslo ti zadal super admin — změň ho níže v sekci „Heslo“.
        </span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
          <KeyRound className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold">Vítej! Nejdřív si nastav vlastní heslo</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Přihlásil(a) ses počátečním heslem od super admina. Z bezpečnostních důvodů si ho teď změň —
          zabere to půl minuty.
        </p>
        <Button asChild size="lg" className="mt-5 w-full">
          <Link href="/account#zmena-hesla">
            <KeyRound className="h-4 w-4" /> Nastavit vlastní heslo
          </Link>
        </Button>
      </div>
    </div>
  );
}
