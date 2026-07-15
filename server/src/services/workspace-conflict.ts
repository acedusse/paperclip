export interface ConcurrentSharedActivity {
  isConcurrent: boolean;
  otherRunIds: string[];
}

/**
 * A run "collides" (risk sense) when it executes in a shared workspace that
 * other runs are already active in. Isolated/per-issue workspaces are never
 * flagged — separate trees cannot clobber each other. This detects concurrent
 * occupancy (the risk condition), not a confirmed byte-level file clobber.
 */
export function detectConcurrentSharedActivity(input: {
  workspaceMode: string | null | undefined;
  otherActiveRunIds: string[];
}): ConcurrentSharedActivity {
  if (input.workspaceMode !== "shared_workspace") return { isConcurrent: false, otherRunIds: [] };
  const otherRunIds = [...new Set(input.otherActiveRunIds)];
  return { isConcurrent: otherRunIds.length > 0, otherRunIds };
}
