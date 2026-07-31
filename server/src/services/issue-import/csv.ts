/**
 * FILE: server/src/services/issue-import/csv.ts
 * ABOUT: Combo-10 Phase 4 — CSV issue import parsing and mapping (idea 064).
 *
 * SECTIONS:
 *   [TAG: module] - csv.ts (issue-import module).
 */
// ==========================================
// [META: module]
// INTENT: Turn a foreign CSV export into mapped issue drafts, previewable before commit.
// PSEUDOCODE: 1. Parse CSV. 2. Map columns + statuses. 3. Map assignees. 4. Report.
// JSON_FLOW: {"file": "server/src/services/issue-import/csv.ts", "imports": "none", "exports": "parseCsv, mapImportRows"}
// ==========================================
// [START: module]

/**
 * Minimal RFC-4180 parser: quoted fields, embedded commas, embedded newlines,
 * and doubled quotes as an escape. Written rather than pulled in as a
 * dependency because the import surface must not add a supply-chain edge for
 * ~60 lines of well-specified parsing.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  // Strip a UTF-8 BOM — Excel writes one and it otherwise corrupts the first
  // header name, which then fails to match any known column.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip rows that are entirely empty — trailing newlines are near-universal.
    if (!(row.length === 1 && row[0]!.trim() === "")) rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

export type ImportIssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";

/**
 * Status vocabularies differ per tool. Anything unrecognised lands in
 * `backlog` and is *reported*, never silently coerced — a status quietly
 * mapped to the wrong bucket is how an import looks successful and is wrong.
 */
const STATUS_ALIASES: Record<string, ImportIssueStatus> = {
  backlog: "backlog",
  "to do": "todo",
  todo: "todo",
  open: "todo",
  new: "todo",
  "in progress": "in_progress",
  in_progress: "in_progress",
  doing: "in_progress",
  started: "in_progress",
  "in review": "in_review",
  in_review: "in_review",
  review: "in_review",
  done: "done",
  closed: "done",
  complete: "done",
  completed: "done",
  resolved: "done",
  cancelled: "cancelled",
  canceled: "cancelled",
  "won't do": "cancelled",
  wontfix: "cancelled",
};

export function normalizeStatus(raw: string): { status: ImportIssueStatus; recognized: boolean } {
  const key = raw.trim().toLowerCase();
  const mapped = STATUS_ALIASES[key];
  if (mapped) return { status: mapped, recognized: true };
  return { status: "backlog", recognized: false };
}

/** Column aliases per source tool, matched case-insensitively. */
const COLUMN_ALIASES: Record<string, string[]> = {
  title: ["title", "summary", "name", "subject"],
  description: ["description", "body", "details", "notes"],
  status: ["status", "state"],
  assignee: ["assignee", "assigned to", "owner"],
};

export function resolveColumns(header: string[]): Record<string, number> {
  const normalized = header.map((cell) => cell.trim().toLowerCase());
  const mapping: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = normalized.findIndex((cell) => aliases.includes(cell));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

export interface ImportedIssueDraft {
  rowNumber: number;
  title: string;
  description: string | null;
  status: ImportIssueStatus;
  /** The foreign assignee name, before agent mapping. */
  sourceAssignee: string | null;
  /** Resolved Paperclip agent, or null when unmapped. */
  assigneeAgentId: string | null;
}

export interface ImportRowProblem {
  rowNumber: number;
  message: string;
}

export interface ImportPreview {
  drafts: ImportedIssueDraft[];
  problems: ImportRowProblem[];
  /** Foreign assignee names with no agent mapping — the human→agent gap. */
  unmappedAssignees: string[];
  /** Statuses that were not recognised and defaulted to backlog. */
  unrecognizedStatuses: string[];
}

/**
 * Build a preview from parsed CSV rows. Pure and non-committing: this is the
 * dry run the operator inspects before anything is written.
 */
export function mapImportRows(
  rows: string[][],
  assigneeToAgentId: Map<string, string> = new Map(),
): ImportPreview {
  const drafts: ImportedIssueDraft[] = [];
  const problems: ImportRowProblem[] = [];
  const unmappedAssignees = new Set<string>();
  const unrecognizedStatuses = new Set<string>();

  if (rows.length === 0) {
    return { drafts, problems: [{ rowNumber: 0, message: "The file is empty." }], unmappedAssignees: [], unrecognizedStatuses: [] };
  }

  const columns = resolveColumns(rows[0]!);
  if (columns.title === undefined) {
    return {
      drafts,
      problems: [
        {
          rowNumber: 1,
          message: `No title column found. Expected one of: ${COLUMN_ALIASES.title!.join(", ")}.`,
        },
      ],
      unmappedAssignees: [],
      unrecognizedStatuses: [],
    };
  }

  // Row 1 is the header, so data rows are numbered from 2 — matching what the
  // operator sees in a spreadsheet.
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const rowNumber = i + 1;
    const title = (row[columns.title] ?? "").trim();

    if (title === "") {
      problems.push({ rowNumber, message: "Skipped: no title." });
      continue;
    }

    const rawStatus = columns.status === undefined ? "" : (row[columns.status] ?? "");
    const { status, recognized } = normalizeStatus(rawStatus);
    if (rawStatus.trim() !== "" && !recognized) unrecognizedStatuses.add(rawStatus.trim());

    const rawAssignee = columns.assignee === undefined ? "" : (row[columns.assignee] ?? "").trim();
    const sourceAssignee = rawAssignee === "" ? null : rawAssignee;
    const assigneeAgentId = sourceAssignee
      ? assigneeToAgentId.get(sourceAssignee.toLowerCase()) ?? null
      : null;
    if (sourceAssignee && !assigneeAgentId) unmappedAssignees.add(sourceAssignee);

    const description = columns.description === undefined ? null : (row[columns.description] ?? "").trim() || null;

    drafts.push({ rowNumber, title, description, status, sourceAssignee, assigneeAgentId });
  }

  return {
    drafts,
    problems,
    unmappedAssignees: [...unmappedAssignees].sort(),
    unrecognizedStatuses: [...unrecognizedStatuses].sort(),
  };
}
// [END: module]
