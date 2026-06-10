"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AutomationProvider } from "@/components/automation-provider";
import { CommandPaletteProvider } from "@/components/command-palette";
import { DebugBar } from "@/components/debug/debug-bar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <AutomationProvider>
        <TooltipProvider delayDuration={200}>
          <CommandPaletteProvider>{children}</CommandPaletteProvider>
          {/* Trvalá debug lišta dole — na všech stránkách, pro report a kopírování chyb */}
          <DebugBar />
        </TooltipProvider>
      </AutomationProvider>
    </NextThemesProvider>
  );
}
