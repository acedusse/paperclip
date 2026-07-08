/**
 * FILE: packages/plugins/examples/plugin-hello-world-example/src/ui/index.tsx
 * ABOUT: index.tsx (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - index.tsx (ui module).
 */
// ==========================================
// [META: module]
// INTENT: index.tsx (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/examples/plugin-hello-world-example/src/ui/index.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";

const WIDGET_LABEL = "Hello world plugin widget";

/**
 * Example dashboard widget showing the smallest possible UI contribution.
 */
export function HelloWorldDashboardWidget({ context }: PluginWidgetProps) {
  return (
    <section aria-label={WIDGET_LABEL}>
      <strong>Hello world</strong>
      <div>This widget was added by @paperclipai/plugin-hello-world-example.</div>
      {/* Include host context so authors can see where scoped IDs come from. */}
      <div>Company context: {context.companyId}</div>
    </section>
  );
}
// [END: module]
