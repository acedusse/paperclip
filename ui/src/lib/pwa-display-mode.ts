/**
 * FILE: ui/src/lib/pwa-display-mode.ts
 * ABOUT: pwa-display-mode.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - pwa-display-mode.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: pwa-display-mode.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/pwa-display-mode.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export const CHROMELESS_DISPLAY_MODES = ["standalone", "fullscreen", "window-controls-overlay"] as const;

type DisplayMode = (typeof CHROMELESS_DISPLAY_MODES)[number];
type MatchDisplayMode = (query: string) => Pick<MediaQueryList, "matches">;

function displayModeQuery(mode: DisplayMode) {
  return `(display-mode: ${mode})`;
}

function defaultMatchMedia(): MatchDisplayMode | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return window.matchMedia.bind(window);
}

export function isChromelessDisplayMode(
  matchMedia: MatchDisplayMode | undefined = defaultMatchMedia(),
  iosStandalone: boolean | undefined =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { standalone?: boolean }).standalone,
) {
  if (iosStandalone === true) return true;
  if (!matchMedia) return false;

  return CHROMELESS_DISPLAY_MODES.some((mode) => matchMedia(displayModeQuery(mode)).matches);
}
// [END: module]
