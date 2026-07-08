/**
 * FILE: packages/plugins/plugin-llm-wiki/tests/screenshots/entry.tsx
 * ABOUT: entry.tsx (screenshots module).
 *
 * SECTIONS:
 *   [TAG: module] - entry.tsx (screenshots module).
 */
// ==========================================
// [META: module]
// INTENT: entry.tsx (screenshots module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/plugin-llm-wiki/tests/screenshots/entry.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { createRoot } from "react-dom/client";
import { App } from "./harness.js";

const container = document.getElementById("root");
if (!container) throw new Error("No #root in harness host");
createRoot(container).render(<App />);
// [END: module]
