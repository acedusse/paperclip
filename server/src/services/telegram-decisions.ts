/**
 * FILE: server/src/services/telegram-decisions.ts
 * ABOUT: telegram-decisions.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - turn a tapped Telegram inline button into a governed approval decision.
 */
// ==========================================
// [META: module]
// INTENT: The A2H half of the channel. A button tap is only ever a decision by the *bound* user of the
//   *bound* company; everything else the control plane already enforces for a board decision — the risk
//   gate, the domain event, the requester wakeup, the decision audit — happens identically here.
// PSEUDOCODE: 1. Resolve the chat's live binding for the company, else not_bound.
//   2. Load the approval and confirm it belongs to that company, else not_found.
//   3. Refuse an approval that is already resolved to the other outcome (already_decided).
//   4. Gate on canDecide(band, explicit_human). 5. approve/reject as the bound user.
//   6. Apply the shared effects and record the audit row tagged channel: "telegram".
// JSON_FLOW: {"file": "server/src/services/telegram-decisions.ts", "imports": "@paperclipai/db, ./approvals.js, ./approval-*.js, ./telegram-link.js", "exports": "telegramDecisionService, TelegramDecisionResult"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import { approvalService } from "./approvals.js";
import { approvalRiskService, type RiskBand } from "./approval-risk.js";
import { approvalEffectsService } from "./approval-effects.js";
import { canDecide } from "./approval-authority.js";
import { recordDecision } from "./approval-decision-audit.js";
import { telegramLinkService } from "./telegram-link.js";
import type { ApprovalOutcome } from "./telegram-format.js";
import { logger } from "../middleware/logger.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";

/** Statuses a pending approval can still be moved out of; mirrors approvalService.resolveApproval. */
const OPEN_STATUSES = new Set(["pending", "revision_requested"]);

export type TelegramDecisionResult =
  | { ok: true; outcome: ApprovalOutcome; applied: boolean; status: string }
  | { ok: false; reason: "not_bound" }
  | { ok: false; reason: "not_the_bound_user" }
  | { ok: false; reason: "binding_predates_user_identity" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_decided"; status: string }
  | { ok: false; reason: "forbidden"; detail: string };

export function telegramDecisionService(db: Db, options: { pluginWorkerManager?: PluginWorkerManager } = {}) {
  const approvalsSvc = approvalService(db);
  const riskSvc = approvalRiskService(db);
  const links = telegramLinkService(db);
  const effects = approvalEffectsService(db, { pluginWorkerManager: options.pluginWorkerManager });

  return {
    async decideFromChat(input: {
      companyId: string;
      chatId: string;
      /** The Telegram account that pressed the button — `callback_query.from.id`. */
      fromTelegramUserId: string | null;
      approvalId: string;
      outcome: ApprovalOutcome;
    }): Promise<TelegramDecisionResult> {
      const binding = await links.resolveBinding({ companyId: input.companyId, chatId: input.chatId });
      if (!binding) return { ok: false, reason: "not_bound" };

      // The chat proves only *where* the card is, never *who* tapped it. A bound group chat is
      // readable and tappable by every member, so without this check any of them would decide as the
      // person who redeemed the code — with the audit row naming that person.
      if (!binding.telegramUserId) {
        // Pre-0125 binding: there is no recorded identity to compare against, and treating "unknown"
        // as "allowed" would preserve the very hole this check closes. Fail closed; re-linking the
        // chat records the identity and restores it.
        return { ok: false, reason: "binding_predates_user_identity" };
      }
      if (!input.fromTelegramUserId || input.fromTelegramUserId !== binding.telegramUserId) {
        return { ok: false, reason: "not_the_bound_user" };
      }

      const approval = await approvalsSvc.getById(input.approvalId);
      // A chat bound to one company must never reach another company's approval, even by guessing an id.
      if (!approval || approval.companyId !== input.companyId) return { ok: false, reason: "not_found" };

      const targetStatus = input.outcome === "approve" ? "approved" : "rejected";
      if (!OPEN_STATUSES.has(approval.status) && approval.status !== targetStatus) {
        return { ok: false, reason: "already_decided", status: approval.status };
      }

      const risk = await riskSvc.getSnapshot(input.approvalId);
      const band = ((risk?.band as RiskBand) ?? "low") as RiskBand;
      const gate = canDecide({ band, method: "explicit_human" });
      if (!gate.allow) return { ok: false, reason: "forbidden", detail: gate.deny ?? "not permitted" };

      const actor = { actorType: "user" as const, actorId: binding.userId };
      const note = "Decided from Telegram";
      const { approval: decided, applied } =
        input.outcome === "approve"
          ? await approvalsSvc.approve(input.approvalId, actor.actorId, note)
          : await approvalsSvc.reject(input.approvalId, actor.actorId, note);

      if (applied) {
        if (input.outcome === "approve") {
          await effects.applyApprovalApprovedEffects(decided, actor);
        } else {
          await effects.applyApprovalRejectedEffects(decided, actor);
        }

        try {
          await recordDecision(db, {
            approvalId: decided.id,
            companyId: decided.companyId,
            actor,
            method: "explicit_human",
            outcome: input.outcome === "approve" ? "approved" : "rejected",
            risk: risk ? { score: risk.score, band: risk.band as RiskBand } : null,
            note,
            details: { channel: "telegram", chatId: input.chatId, bindingId: binding.id },
          });
        } catch (auditErr) {
          logger.warn({ err: auditErr, approvalId: decided.id }, "telegram recordDecision failed");
        }

        await links.touchBinding(binding.id);
      }

      return { ok: true, outcome: input.outcome, applied, status: decided.status };
    },
  };
}
// [END: module]
