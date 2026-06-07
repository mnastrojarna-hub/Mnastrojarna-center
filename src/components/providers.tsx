"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AutomationProvider } from "@/components/automation-provider";
import { CommandPaletteProvider } from "@/components/command-palette";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <AutomationProvider>
        <TooltipProvider delayDuration={200}>
          <CommandPaletteProvider>{children}</CommandPaletteProvider>
        </TooltipProvider>
      </AutomationProvider>
    </NextThemesProvider>
  );
}
