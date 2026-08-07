/**
 * FILE: server/src/services/approval-triage.ts
 * ABOUT: approval-triage.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - approval-triage.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: approval-triage.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/approval-triage.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, approvalRisk } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { approvalService } from "./approvals.js";
import { approvalRiskService } from "./approval-risk.js";
import { approvalEffectsService } from "./approval-effects.js";
import { canDecide } from "./approval-authority.js";
import { recordDecision } from "./approval-decision-audit.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";

const OPEN_STATUSES = ["pending", "revision_requested"];

/** The post-decision effects a bulk resolve needs; the route injects its own configured instance. */
export type ApprovalTriageEffects = Pick<
  ReturnType<typeof approvalEffectsService>,
  "applyApprovalApprovedEffects" | "applyApprovalRejectedEffects"
>;

export function approvalTriageService(
  db: Db,
  options: { effects?: ApprovalTriageEffects; pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const svc = approvalService(db);
  const riskSvc = approvalRiskService(db);
  // A bulk decision must be indistinguishable from a single one, so it runs the same effects the HTTP
  // route, auto-approve and the Telegram inline buttons run. Callers that already own a configured
  // instance pass it in rather than building a second one.
  const effects =
    options.effects ?? approvalEffectsService(db, { pluginWorkerManager: options.pluginWorkerManager });

  return {
    async listTriage(companyId: string) {
      const rows = await db
        .select({
          approval: approvals,
          score: approvalRisk.score,
          band: approvalRisk.band,
          reasons: approvalRisk.reasons,
        })
        .from(approvals)
        .leftJoin(approvalRisk, eq(approvalRisk.approvalId, approvals.id))
        .where(and(eq(approvals.companyId, companyId), inArray(approvals.status, OPEN_STATUSES)));

      const items = rows
        .map((r) => ({ ...r.approval, risk: { score: r.score ?? 0, band: r.band ?? "low", reasons: r.reasons ?? [] } }))
        .sort((a, b) => b.risk.score - a.risk.score);

      const groupMap = new Map<string, { key: string; type: string; agentId: string | null; ids: string[] }>();
      for (const it of items) {
        const key = `${it.type}::${it.requestedByAgentId ?? "none"}`;
        const g = groupMap.get(key) ?? { key, type: it.type, agentId: it.requestedByAgentId ?? null, ids: [] };
        g.ids.push(it.id);
        groupMap.set(key, g);
      }
      return { items, groups: [...groupMap.values()] };
    },

    async bulkResolve(
      companyId: string,
      input: { ids: string[]; action: "approve" | "reject" | "request_changes"; note?: string | null; actor: { actorId: string } },
    ) {
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const id of input.ids) {
        try {
          const approval = await svc.getById(id);
          if (!approval || approval.companyId !== companyId) {
            results.push({ id, ok: false, error: "not found" });
            continue;
          }
          const risk = await riskSvc.getSnapshot(id);
          const gate = canDecide({ band: (risk?.band as any) ?? "low", method: "explicit_human" });
          if (!gate.allow) {
            results.push({ id, ok: false, error: gate.deny });
            continue;
          }

          const outcome =
            input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "revision_requested";

          // FIX 1: respect the `applied` flag so a no-op transition (e.g. a
          // duplicate id already decided earlier in this same batch) does not
          // write a second audit row. requestRevision has no `applied` flag —
          // it throws unless the approval is pending, so reaching here means it
          // actually transitioned (applied === true).
          let applied = true;
          let decided = approval;
          if (input.action === "approve") ({ approval: decided, applied } = await svc.approve(id, input.actor.actorId, input.note));
          else if (input.action === "reject") ({ approval: decided, applied } = await svc.reject(id, input.actor.actorId, input.note));
          else await svc.requestRevision(id, input.actor.actorId, input.note);

          if (applied) {
            // FIX 3: emit the domain event and wake the requesting agent, exactly as the single-item
            // routes do. Without this a bulk approve leaves every requester asleep — the stall the
            // triage surface exists to clear. request_changes has no effects owner anywhere yet, so
            // it stays a status transition here too rather than inventing one path out of step.
            const effectsActor = { actorType: "user" as const, actorId: input.actor.actorId };
            if (input.action === "approve") await effects.applyApprovalApprovedEffects(decided, effectsActor);
            else if (input.action === "reject") await effects.applyApprovalRejectedEffects(decided, effectsActor);

            // FIX 2: the mutation has already committed, so the decision is real.
            // Isolate the audit write: if recordDecision throws, log it but keep
            // the item ok:true (it truly succeeded) rather than misreporting a
            // failed decision.
            try {
              await recordDecision(db, {
                approvalId: id,
                companyId,
                actor: { actorType: "user", actorId: input.actor.actorId },
                method: "explicit_human",
                outcome,
                risk: risk ? { score: risk.score, band: risk.band as any } : null,
                note: input.note ?? null,
              });
            } catch (auditErr) {
              logger.warn(
                { err: auditErr, approvalId: id, companyId, outcome },
                "bulkResolve: decision audit write failed after successful mutation",
              );
            }
          }
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { results };
    },
  };
}
// [END: module]
