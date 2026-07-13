/**
 * FILE: ui/src/components/RunChangesetView.tsx
 * ABOUT: RunChangesetView.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - RunChangesetView.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: RunChangesetView.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/RunChangesetView.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { RunChangeset } from "../api/runChangesets";

const STATUS_LABEL: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "?",
};

export function RunChangesetView({ changeset }: { changeset: RunChangeset }) {
  return (
    <div className="run-changeset">
      {changeset.warning ? <p className="run-changeset__warning">{changeset.warning}</p> : null}
      <p className="run-changeset__summary">
        {changeset.summaryStats.filesChanged} files · +{changeset.summaryStats.additions} −
        {changeset.summaryStats.deletions}
      </p>
      <ul className="run-changeset__files">
        {changeset.files.map((f) => (
          <li key={f.path} className="run-changeset__file">
            <span className="run-changeset__status" aria-label={f.status}>
              {STATUS_LABEL[f.status] ?? "?"}
            </span>
            <span className="run-changeset__path">{f.path}</span>
            <span className="run-changeset__counts">
              +{f.additions} −{f.deletions}
            </span>
            {f.binary ? <span className="run-changeset__note">binary — download to view</span> : null}
            {f.truncated ? (
              <span className="run-changeset__note">diff too large — download to view</span>
            ) : null}
            {f.diff ? <pre className="run-changeset__diff">{f.diff}</pre> : null}
          </li>
        ))}
      </ul>
      {changeset.commands.length ? (
        <ul className="run-changeset__commands">
          {changeset.commands.map((c, i) => (
            <li key={i}>
              {c.command} — {c.status}
              {c.exitCode != null ? ` (exit ${c.exitCode})` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
// [END: module]
