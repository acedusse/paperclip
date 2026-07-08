/**
 * FILE: ui/storybook/.storybook/main.ts
 * ABOUT: main.ts (.storybook module).
 *
 * SECTIONS:
 *   [TAG: module] - main.ts (.storybook module).
 */
// ==========================================
// [META: module]
// INTENT: main.ts (.storybook module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/storybook/.storybook/main.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { mergeConfig } from "vite";

const storybookConfigDir = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx|mdx)"],
  staticDirs: ["../../public"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: true,
  },
  viteFinal: async (baseConfig) =>
    mergeConfig(baseConfig, {
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          "@": path.resolve(storybookConfigDir, "../../src"),
          lexical: path.resolve(storybookConfigDir, "../../node_modules/lexical/Lexical.mjs"),
        },
      },
    }),
};

export default config;
// [END: module]
