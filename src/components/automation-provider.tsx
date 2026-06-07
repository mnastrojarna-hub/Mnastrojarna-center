"use client";

import * as React from "react";

export type AutomationMode = "full" | "approval";

interface AutomationContextValue {
  mode: AutomationMode;
  setMode: (mode: AutomationMode) => void;
  toggle: () => void;
}

const AutomationContext = React.createContext<AutomationContextValue | null>(null);

const STORAGE_KEY = "cnc-automation-mode";

export function AutomationProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<AutomationMode>("approval");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as AutomationMode | null;
    if (stored === "full" || stored === "approval") setModeState(stored);
  }, []);

  const setMode = React.useCallback((next: AutomationMode) => {
    setModeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggle = React.useCallback(() => {
    setMode(mode === "full" ? "approval" : "full");
  }, [mode, setMode]);

  return (
    <AutomationContext.Provider value={{ mode, setMode, toggle }}>
      {children}
    </AutomationContext.Provider>
  );
}

export function useAutomation() {
  const ctx = React.useContext(AutomationContext);
  if (!ctx) throw new Error("useAutomation must be used within AutomationProvider");
  return ctx;
}
