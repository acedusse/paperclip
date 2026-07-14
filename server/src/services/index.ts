/**
 * FILE: server/src/services/index.ts
 * ABOUT: index.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export { companyService } from "./companies.js";
export { companyArtifactsService } from "./company-artifacts.js";
export { companySearchService } from "./company-search.js";
export { feedbackService } from "./feedback.js";
export { companySkillService } from "./company-skills.js";
export { agentService, deduplicateAgentName } from "./agents.js";
export { agentInstructionsService, syncInstructionsBundleConfigFromFilePath } from "./agent-instructions.js";
export { assetService } from "./assets.js";
export { documentService, extractLegacyPlanBody } from "./documents.js";
export { documentAnnotationService } from "./document-annotations.js";
export {
  ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
  buildContinuationSummaryMarkdown,
  getIssueContinuationSummaryDocument,
  refreshIssueContinuationSummary,
} from "./issue-continuation-summary.js";
export { projectService } from "./projects.js";
export {
  clampIssueListLimit,
  ISSUE_LIST_DEFAULT_LIMIT,
  ISSUE_LIST_MAX_LIMIT,
  issueService,
  type IssueFilters,
} from "./issues.js";
export { issueThreadInteractionService } from "./issue-thread-interactions.js";
export { issueTreeControlService } from "./issue-tree-control.js";
export { issueApprovalService } from "./issue-approvals.js";
export { issueReferenceService } from "./issue-references.js";
export { issueRecoveryActionService } from "./issue-recovery-actions.js";
export { taskWatchdogService } from "./task-watchdogs.js";
export {
  issueIsInTaskWatchdogSubtree,
  resolveTaskWatchdogMutationScope,
  taskWatchdogScopeAllowsIssueMutation,
} from "./task-watchdog-scope.js";
export { goalService } from "./goals.js";
export { activityService, type ActivityFilters } from "./activity.js";
export { approvalService } from "./approvals.js";
export { approvalRiskService, riskScore, RISK_BAND_ORDER, type RiskBand } from "./approval-risk.js";
export { canDecide, METHOD_PRECEDENCE, type DecisionMethod } from "./approval-authority.js";
export { recordDecision } from "./approval-decision-audit.js";
export { evaluateAutoApprove, autoApprovePolicyService, type AutoApprovePolicy } from "./auto-approve-policy.js";
export { approvalTriageService } from "./approval-triage.js";
export { registerChannel, getChannels, type DeliveryChannel } from "./notification-delivery.js";
export { digestService, DIGEST_MIN_INTERVAL_HOURS } from "./digest.js";
export { collectDigestSignals, type DigestSignals } from "./digest-signals.js";
export { narrateDigest, deterministicNarrator, type DigestPayload } from "./digest-narration.js";
export { createInboxDigestChannel } from "./notification-delivery.js";
export { budgetService } from "./budgets.js";
export { secretService } from "./secrets.js";
export { routineService } from "./routines.js";
export { costService } from "./costs.js";
export { financeService } from "./finance.js";
export { heartbeatService } from "./heartbeat.js";
export {
  productivityReviewService,
  PRODUCTIVITY_REVIEW_ORIGIN_KIND,
} from "./productivity-review.js";
export { classifyIssueGraphLiveness, type IssueLivenessFinding } from "./recovery/index.js";
export { dashboardService } from "./dashboard.js";
export { sidebarBadgeService } from "./sidebar-badges.js";
export { sidebarPreferenceService } from "./sidebar-preferences.js";
export { resourceMembershipService, type ResourceMembershipPolicyHook } from "./resource-memberships.js";
export { inboxDismissalService } from "./inbox-dismissals.js";
export { accessService } from "./access.js";
export {
  backfillPrincipalAccessCompatibility,
  ensureHumanRoleDefaultGrants,
  insertMissingPrincipalGrants,
  type PrincipalAccessCompatibilityBackfillStats,
} from "./principal-access-compatibility.js";
export { authorizationService } from "./authorization.js";
export type {
  AuthorizationAction,
  AuthorizationActor,
  AuthorizationDecision,
  AuthorizationResource,
} from "./authorization.js";
export { boardAuthService } from "./board-auth.js";
export { instanceSettingsService } from "./instance-settings.js";
export { bootstrapExecutionPolicyFromEnv } from "./execution-policy-bootstrap.js";
export { cloudUpstreamService, reconcileCloudUpstreamRunsOnStartup } from "./cloud-upstreams.js";
export { companyPortabilityService } from "./company-portability.js";
export { teamsCatalogService } from "./teams-catalog.js";
export { environmentService } from "./environments.js";
export { executionWorkspaceService } from "./execution-workspaces.js";
export { workspaceOperationService } from "./workspace-operations.js";
export { runChangesetService } from "./run-changeset.js";
export { workspaceFileResourceService } from "./workspace-file-resources.js";
export { workProductService } from "./work-products.js";
export { logActivity, type LogActivityInput } from "./activity-log.js";
export { notifyHireApproved, type NotifyHireApprovedInput } from "./hire-hook.js";
export { publishLiveEvent, subscribeCompanyLiveEvents } from "./live-events.js";
export {
  reconcileCodexLocalManagedHomesOnStartup,
  type CodexAuthReconciliationSummary,
} from "./codex-auth-reconciliation.js";
export { reconcilePersistedRuntimeServicesOnStartup, restartDesiredRuntimeServicesOnStartup } from "./workspace-runtime.js";
export { createStorageServiceFromConfig, getStorageService } from "../storage/index.js";
// [END: module]
