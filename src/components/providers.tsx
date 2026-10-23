"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AutomationProvider } from "@/components/automation-provider";
import { CommandPaletteProvider } from "@/components/command-palette";
import { DebugBar } from "@/components/debug/debug-bar";
import { AccessProvider } from "@/components/access-provider";
import { installRscFetchBuffer } from "@/lib/rsc-fetch-buffer";

// Odpovědi RSC (navigace, refresh, server akce) předat routeru celé — jinak Next 15.5
// občas nevykreslí nová data (viz rsc-fetch-buffer.ts). Hned při načtení modulu, před první navigací.
installRscFetchBuffer();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <AutomationProvider>
        <TooltipProvider delayDuration={200}>
          <AccessProvider>
            <CommandPaletteProvider>{children}</CommandPaletteProvider>
          </AccessProvider>
          {/* Trvalá debug lišta dole — na všech stránkách, pro report a kopírování chyb */}
          <DebugBar />
        </TooltipProvider>
      </AutomationProvider>
    </NextThemesProvider>
  );
}
