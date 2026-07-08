/**
 * FILE: packages/plugins/examples/plugin-authoring-smoke-example/src/ui/index.tsx
 * ABOUT: index.tsx (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - index.tsx (ui module).
 */
// ==========================================
// [META: module]
// INTENT: index.tsx (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/examples/plugin-authoring-smoke-example/src/ui/index.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { usePluginAction, usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";

type HealthData = {
  status: "ok" | "degraded" | "error";
  checkedAt: string;
};

export function DashboardWidget(_props: PluginWidgetProps) {
  const { data, loading, error } = usePluginData<HealthData>("health");
  const ping = usePluginAction("ping");

  if (loading) return <div>Loading plugin health...</div>;
  if (error) return <div>Plugin error: {error.message}</div>;

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <strong>Plugin Authoring Smoke Example</strong>
      <div>Health: {data?.status ?? "unknown"}</div>
      <div>Checked: {data?.checkedAt ?? "never"}</div>
      <button onClick={() => void ping()}>Ping Worker</button>
    </div>
  );
}
// [END: module]
