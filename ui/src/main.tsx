/**
 * FILE: ui/src/main.tsx
 * ABOUT: main.tsx (src module).
 *
 * SECTIONS:
 *   [TAG: module] - main.tsx (src module).
 */
// ==========================================
// [META: module]
// INTENT: main.tsx (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/main.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import * as React from "react";
import { StrictMode, useEffect } from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "@/lib/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { CompanyProvider, useCompany } from "./context/CompanyContext";
import { LiveUpdatesProvider } from "./context/LiveUpdatesProvider";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { PanelProvider } from "./context/PanelContext";
import { SidebarProvider } from "./context/SidebarContext";
import { DialogProvider } from "./context/DialogContext";
import { EditorAutocompleteProvider } from "./context/EditorAutocompleteContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initPluginBridge } from "./plugins/bridge-init";
import { PluginLauncherProvider } from "./plugins/launchers";
import { getTelegramWebApp, applyTelegramTheme } from "./telegram/webapp";
import { useTelegramSession } from "./telegram/useTelegramSession";
import "@mdxeditor/editor/style.css";
import "./index.css";

initPluginBridge(React, ReactDOM);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

function CompanyAwareBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const { selectedCompany } = useCompany();
  return <BreadcrumbProvider companyName={selectedCompany?.name ?? null}>{children}</BreadcrumbProvider>;
}

/**
 * Holds the board back from rendering until the Mini App has a bearer token, and paints Telegram's
 * theme onto the board's CSS variables. Placed outside the router (rather than inside App.tsx) so that
 * nothing beneath it -- including CompanyProvider's own data fetching -- starts making board API calls
 * before there is a token for them to carry. Outside Telegram, getTelegramWebApp() is null on every
 * render and this is a pure pass-through, so the ordinary board is untouched.
 */
function TelegramGate({ children }: { children: React.ReactNode }) {
  const { status, error } = useTelegramSession();

  useEffect(() => {
    const app = getTelegramWebApp();
    if (!app) return;
    app.ready?.();
    app.expand?.();
    applyTelegramTheme(app, document.documentElement);
    app.onEvent?.("themeChanged", () => applyTelegramTheme(app, document.documentElement));
  }, []);

  // Outside Telegram this is a pass-through, so the ordinary board is untouched.
  if (!getTelegramWebApp()) return <>{children}</>;
  if (status === "failed") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }
  if (status !== "ready") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Connecting…
      </div>
    );
  }
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TelegramGate>
          <BrowserRouter>
            <CompanyProvider>
              <EditorAutocompleteProvider>
                <ToastProvider>
                  <LiveUpdatesProvider>
                    <TooltipProvider>
                      <CompanyAwareBreadcrumbProvider>
                        <SidebarProvider>
                          <PanelProvider>
                            <PluginLauncherProvider>
                              <DialogProvider>
                                <App />
                              </DialogProvider>
                            </PluginLauncherProvider>
                          </PanelProvider>
                        </SidebarProvider>
                      </CompanyAwareBreadcrumbProvider>
                    </TooltipProvider>
                  </LiveUpdatesProvider>
                </ToastProvider>
              </EditorAutocompleteProvider>
            </CompanyProvider>
          </BrowserRouter>
        </TelegramGate>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
// [END: module]
