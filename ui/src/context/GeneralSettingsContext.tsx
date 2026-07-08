/**
 * FILE: ui/src/context/GeneralSettingsContext.tsx
 * ABOUT: GeneralSettingsContext.tsx (context module).
 *
 * SECTIONS:
 *   [TAG: module] - GeneralSettingsContext.tsx (context module).
 */
// ==========================================
// [META: module]
// INTENT: GeneralSettingsContext.tsx (context module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/context/GeneralSettingsContext.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { ReactNode } from "react";
import { createContext, useContext } from "react";

export interface GeneralSettingsContextValue {
  keyboardShortcutsEnabled: boolean;
}

const GeneralSettingsContext = createContext<GeneralSettingsContextValue>({
  keyboardShortcutsEnabled: false,
});

export function GeneralSettingsProvider({
  value,
  children,
}: {
  value: GeneralSettingsContextValue;
  children: ReactNode;
}) {
  return (
    <GeneralSettingsContext.Provider value={value}>
      {children}
    </GeneralSettingsContext.Provider>
  );
}

export function useGeneralSettings() {
  return useContext(GeneralSettingsContext);
}
// [END: module]
