/**
 * FILE: ui/src/lib/main-content-focus.ts
 * ABOUT: main-content-focus.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - main-content-focus.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: main-content-focus.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/main-content-focus.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function shouldFocusMainContentAfterNavigation(
  mainElement: HTMLElement | null,
  activeElement: Element | null,
): boolean {
  if (!(mainElement instanceof HTMLElement)) return false;
  if (!(activeElement instanceof HTMLElement)) return true;
  if (!document.contains(activeElement)) return true;
  if (activeElement === document.body || activeElement === document.documentElement) return true;
  return !mainElement.contains(activeElement);
}

export function scheduleMainContentFocus(mainElement: HTMLElement | null): () => void {
  if (!(mainElement instanceof HTMLElement)) return () => {};

  const frame = window.requestAnimationFrame(() => {
    if (!shouldFocusMainContentAfterNavigation(mainElement, document.activeElement)) return;
    mainElement.focus({ preventScroll: true });
  });

  return () => window.cancelAnimationFrame(frame);
}
// [END: module]
