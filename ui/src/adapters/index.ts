/**
 * FILE: ui/src/adapters/index.ts
 * ABOUT: index.ts (adapters module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (adapters module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (adapters module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export {
  getUIAdapter,
  listUIAdapters,
  findUIAdapter,
  registerUIAdapter,
  unregisterUIAdapter,
  syncExternalAdapters,
  onAdapterChange,
} from "./registry";
export { buildTranscript } from "./transcript";
export type {
  TranscriptEntry,
  StdoutLineParser,
  UIAdapterModule,
  AdapterConfigFieldsProps,
} from "./types";
export type { RunLogChunk } from "./transcript";
// [END: module]
