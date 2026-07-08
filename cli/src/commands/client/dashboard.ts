/**
 * FILE: cli/src/commands/client/dashboard.ts
 * ABOUT: dashboard.ts (client module).
 *
 * SECTIONS:
 *   [TAG: module] - dashboard.ts (client module).
 */
// ==========================================
// [META: module]
// INTENT: dashboard.ts (client module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/commands/client/dashboard.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Command } from "commander";
import type { DashboardSummary } from "@paperclipai/shared";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface DashboardGetOptions extends BaseClientOptions {
  companyId?: string;
}

export function registerDashboardCommands(program: Command): void {
  const dashboard = program.command("dashboard").description("Dashboard summary operations");

  addCommonClientOptions(
    dashboard
      .command("get")
      .description("Get dashboard summary for a company")
      .requiredOption("-C, --company-id <id>", "Company ID")
      .action(async (opts: DashboardGetOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireCompany: true });
          const row = await ctx.api.get<DashboardSummary>(apiPath`/api/companies/${ctx.companyId}/dashboard`);
          printOutput(row, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeCompany: false },
  );
}
// [END: module]
