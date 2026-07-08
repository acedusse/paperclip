/**
 * FILE: ui/vite.config.ts
 * ABOUT: vite.config.ts (ui module).
 *
 * SECTIONS:
 *   [TAG: module] - vite.config.ts (ui module).
 */
// ==========================================
// [META: module]
// INTENT: vite.config.ts (ui module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/vite.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createUiDevWatchOptions } from "./src/lib/vite-watch";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  build: {
    minify: "esbuild",
  },
  esbuild:
    mode === "production"
      ? {
          drop: ["console", "debugger"],
          legalComments: "none",
        }
      : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/Lexical.mjs"),
    },
  },
  server: {
    port: 5173,
    watch: createUiDevWatchOptions(process.cwd()),
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        ws: true,
      },
    },
  },
}));
// [END: module]
