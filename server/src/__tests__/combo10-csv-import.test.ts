/**
 * FILE: server/src/__tests__/combo10-csv-import.test.ts
 * ABOUT: combo10-csv-import.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - combo10-csv-import.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: combo10-csv-import.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/combo10-csv-import.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  mapImportRows,
  normalizeStatus,
  parseCsv,
  resolveColumns,
} from "../services/issue-import/csv.ts";

describe("parseCsv", () => {
  it("parses a simple table", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual([
      ["a", "b"],
      ["x,y", "2"],
    ]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a\n"line1\nline2"')).toEqual([["a"], ["line1\nline2"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a UTF-8 BOM so the first header still matches", () => {
    // Excel writes one, and it otherwise corrupts the first column name.
    expect(parseCsv("﻿title,status\nx,todo")[0]).toEqual(["title", "status"]);
  });

  it("ignores trailing blank lines", () => {
    expect(parseCsv("a\n1\n\n")).toEqual([["a"], ["1"]]);
  });

  it("preserves empty fields", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("resolveColumns", () => {
  it("matches canonical names", () => {
    expect(resolveColumns(["title", "description", "status", "assignee"])).toEqual({
      title: 0,
      description: 1,
      status: 2,
      assignee: 3,
    });
  });

  it("matches per-tool aliases case-insensitively", () => {
    // Jira uses Summary; GitHub uses Body; Linear uses Assignee.
    const mapping = resolveColumns(["Summary", "Body", "State", "Assigned To"]);
    expect(mapping).toEqual({ title: 0, description: 1, status: 2, assignee: 3 });
  });

  it("omits columns that are absent", () => {
    expect(resolveColumns(["title"])).toEqual({ title: 0 });
  });
});

describe("normalizeStatus", () => {
  it("maps common done-ish statuses", () => {
    for (const raw of ["Done", "Closed", "Resolved", "Complete"]) {
      expect(normalizeStatus(raw)).toEqual({ status: "done", recognized: true });
    }
  });

  it("maps in-progress variants", () => {
    for (const raw of ["In Progress", "Doing", "Started"]) {
      expect(normalizeStatus(raw).status).toBe("in_progress");
    }
  });

  it("reports an unknown status instead of silently coercing it", () => {
    // A status quietly mapped to the wrong bucket is how an import looks
    // successful and is wrong.
    expect(normalizeStatus("Awaiting Legal")).toEqual({ status: "backlog", recognized: false });
  });
});

describe("mapImportRows", () => {
  const header = ["Summary", "Description", "Status", "Assignee"];

  it("maps a well-formed file", () => {
    const preview = mapImportRows([
      header,
      ["Build login", "With SSO", "In Progress", "Ada"],
    ]);

    expect(preview.problems).toEqual([]);
    expect(preview.drafts).toHaveLength(1);
    expect(preview.drafts[0]).toMatchObject({
      rowNumber: 2,
      title: "Build login",
      description: "With SSO",
      status: "in_progress",
      sourceAssignee: "Ada",
      assigneeAgentId: null,
    });
  });

  it("numbers rows the way a spreadsheet does", () => {
    const preview = mapImportRows([header, ["A", "", "", ""], ["B", "", "", ""]]);
    expect(preview.drafts.map((d) => d.rowNumber)).toEqual([2, 3]);
  });

  it("resolves an assignee to an agent when mapped", () => {
    const preview = mapImportRows(
      [header, ["Build login", "", "todo", "Ada"]],
      new Map([["ada", "agent-1"]]),
    );

    expect(preview.drafts[0]!.assigneeAgentId).toBe("agent-1");
    expect(preview.unmappedAssignees).toEqual([]);
  });

  it("surfaces the human-to-agent gap rather than dropping the assignee", () => {
    const preview = mapImportRows([header, ["Build login", "", "todo", "Grace"]]);
    expect(preview.unmappedAssignees).toEqual(["Grace"]);
    expect(preview.drafts[0]!.sourceAssignee).toBe("Grace");
  });

  it("deduplicates and sorts unmapped assignees", () => {
    const preview = mapImportRows([
      header,
      ["A", "", "", "Zoe"],
      ["B", "", "", "Ada"],
      ["C", "", "", "Zoe"],
    ]);
    expect(preview.unmappedAssignees).toEqual(["Ada", "Zoe"]);
  });

  it("reports unrecognised statuses", () => {
    const preview = mapImportRows([header, ["A", "", "Awaiting Legal", ""]]);
    expect(preview.unrecognizedStatuses).toEqual(["Awaiting Legal"]);
    expect(preview.drafts[0]!.status).toBe("backlog");
  });

  it("does not report a blank status as unrecognised", () => {
    const preview = mapImportRows([header, ["A", "", "", ""]]);
    expect(preview.unrecognizedStatuses).toEqual([]);
  });

  it("skips a titleless row and says which one", () => {
    const preview = mapImportRows([header, ["", "orphan", "todo", ""], ["Real", "", "todo", ""]]);

    expect(preview.drafts).toHaveLength(1);
    expect(preview.problems).toEqual([{ rowNumber: 2, message: "Skipped: no title." }]);
  });

  it("fails clearly when there is no title column", () => {
    const preview = mapImportRows([["Foo", "Bar"], ["1", "2"]]);
    expect(preview.drafts).toEqual([]);
    expect(preview.problems[0]!.message).toContain("No title column");
  });

  it("fails clearly on an empty file", () => {
    expect(mapImportRows([]).problems[0]!.message).toBe("The file is empty.");
  });

  it("treats a header-only file as zero issues, not an error", () => {
    const preview = mapImportRows([header]);
    expect(preview.drafts).toEqual([]);
    expect(preview.problems).toEqual([]);
  });

  it("works end to end from raw CSV text", () => {
    const csv = 'Summary,Status,Assignee\n"Fix, urgently",Done,Ada\n';
    const preview = mapImportRows(parseCsv(csv), new Map([["ada", "agent-1"]]));

    expect(preview.drafts).toHaveLength(1);
    expect(preview.drafts[0]!.title).toBe("Fix, urgently");
    expect(preview.drafts[0]!.status).toBe("done");
    expect(preview.drafts[0]!.assigneeAgentId).toBe("agent-1");
  });
});
// [END: module]
