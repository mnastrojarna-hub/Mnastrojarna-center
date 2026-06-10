"use client";

import Link from "next/link";
import { Search, Bell } from "lucide-react";
import { useCommandPalette } from "@/components/command-palette";
import { AutomationModeToggle } from "@/components/automation-mode-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { signOut } from "@/app/auth/actions";
import type { CurrentUser } from "@/lib/data/current-user";

export function Topbar({ user }: { user: CurrentUser | null }) {
  const { setOpen } = useCommandPalette();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md">
      <button
        onClick={() => setOpen(true)}
        className="group flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Hledat všude…</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <AutomationModeToggle />
        <ThemeToggle />
        <Button variant="ghost" size="icon-sm" aria-label="Oznámení" className="relative">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full outline-none" aria-label="Uživatelské menu">
              <Avatar>
                <AvatarFallback>{user?.initials ?? "?"}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="font-medium text-foreground">{user?.fullName ?? "Nepřihlášen"}</div>
              <div className="text-xs font-normal text-muted-foreground">
                {user ? user.roleLabel : "Přihlas se pro plný přístup"}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/settings">Nastavení</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/setup">Průvodce nastavením</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            {user ? (
              <form action={signOut}>
                <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
                  <button type="submit" className="w-full cursor-pointer">Odhlásit se</button>
                </DropdownMenuItem>
              </form>
            ) : (
              <DropdownMenuItem asChild><Link href="/login">Přihlásit se</Link></DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
