/**
 * FILE: server/src/services/stakeholder-share-policy.ts
 * ABOUT: Pure policy core for Combo-05 Phase 4c stakeholder transparency shares.
 *
 * SECTIONS:
 *   [TAG: module] - stakeholder-share-policy.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: Decide whether a share may be viewed, and project only the sections
//         its owner explicitly curated. No db, no clock — `now` is injected so
//         every decision is reproducible in tests.
// PSEUDOCODE: 1. Gate on status/expiry. 2. Project enabled sections only.
//             3. Narrate over the already-filtered signals.
// JSON_FLOW: {"file": "server/src/services/stakeholder-share-policy.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]

/** Exposure toggles. Mirrors the `show_*` columns on `stakeholder_shares`. */
export type StakeholderToggles = {
  showGoalProgress: boolean;
  showShippedWork: boolean;
  showNarrative: boolean;
  showActivityTimeline: boolean;
};

export type StakeholderGoalProgress = {
  byStatus: Record<string, number>;
  goals: Array<{ title: string; status: string }>;
};

export type StakeholderShippedItem = { title: string; completedAt: string };
export type StakeholderTimelineItem = { at: string; label: string };

/**
 * Stakeholder-safe signals. Each optional key is present only when the
 * corresponding toggle was enabled at gather time — see stakeholder-signals.ts,
 * which never queries for a disabled section.
 */
export type StakeholderSignals = {
  companyName: string;
  goalProgress?: StakeholderGoalProgress;
  shippedWork?: StakeholderShippedItem[];
  activityTimeline?: StakeholderTimelineItem[];
};

export type StakeholderNarrative = { headline: string; sections: string[]; text: string };

export type StakeholderPayload = {
  companyName: string;
  goalProgress?: StakeholderGoalProgress;
  shippedWork?: StakeholderShippedItem[];
  narrative?: StakeholderNarrative;
  activityTimeline?: StakeholderTimelineItem[];
};

export type ShareViewability = { ok: true } | { ok: false; reason: "revoked" | "expired" };

/**
 * Default-deny: only an explicitly `active`, unexpired share is viewable. Any
 * unrecognised status denies. Expiry is inclusive, so a link expiring at this
 * instant is already dead.
 */
export function assertShareViewable(
  share: { status: string; expiresAt: Date | null },
  now: Date,
): ShareViewability {
  if (share.status !== "active") return { ok: false, reason: "revoked" };
  if (share.expiresAt && share.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/**
 * Pure narrator over stakeholder-safe signals — the Phase-2b `deterministicNarrator`
 * shape, but a separate audience. The operator digest reports approvals waiting and
 * stuck runs; none of that may reach an external stakeholder, so the two narrators
 * stay distinct rather than sharing a payload.
 *
 * It reads ONLY the signals it is handed. Because the caller passes already-filtered
 * signals, the narrative can never describe a section whose toggle is off.
 */
export function narrateStakeholder(signals: StakeholderSignals): StakeholderNarrative {
  const sections: string[] = [];

  if (signals.goalProgress) {
    const { byStatus } = signals.goalProgress;
    const achieved = byStatus.achieved ?? 0;
    const active = byStatus.active ?? 0;
    sections.push(`${achieved} goal${achieved === 1 ? "" : "s"} achieved, ${active} in progress`);
  }

  if (signals.shippedWork) {
    const n = signals.shippedWork.length;
    sections.push(`${n} item${n === 1 ? "" : "s"} shipped recently`);
  }

  if (signals.activityTimeline) {
    const n = signals.activityTimeline.length;
    sections.push(`${n} update${n === 1 ? "" : "s"} in the timeline`);
  }

  const headline =
    sections.length > 0
      ? `${signals.companyName} — latest progress`
      : `${signals.companyName} — no shared updates yet`;

  return { headline, sections, text: [headline, ...sections].join("\n") };
}

/**
 * Project the public payload. A section appears only when its toggle is on AND a
 * signal was actually gathered for it — so a renderer bug alone cannot expose a
 * field whose data was never loaded.
 */
export function projectStakeholderPayload(
  toggles: StakeholderToggles,
  signals: StakeholderSignals,
): StakeholderPayload {
  const payload: StakeholderPayload = { companyName: signals.companyName };

  if (toggles.showGoalProgress && signals.goalProgress) {
    payload.goalProgress = signals.goalProgress;
  }
  if (toggles.showShippedWork && signals.shippedWork) {
    payload.shippedWork = signals.shippedWork;
  }
  if (toggles.showActivityTimeline && signals.activityTimeline) {
    payload.activityTimeline = signals.activityTimeline;
  }
  if (toggles.showNarrative) {
    // Narrate over the projected view, never the raw signals, so a disabled
    // section cannot leak through the generated prose.
    payload.narrative = narrateStakeholder({
      companyName: signals.companyName,
      ...(payload.goalProgress ? { goalProgress: payload.goalProgress } : {}),
      ...(payload.shippedWork ? { shippedWork: payload.shippedWork } : {}),
      ...(payload.activityTimeline ? { activityTimeline: payload.activityTimeline } : {}),
    });
  }

  return payload;
}
// [END: module]
