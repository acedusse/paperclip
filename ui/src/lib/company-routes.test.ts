/**
 * FILE: ui/src/lib/company-routes.test.ts
 * ABOUT: company-routes.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - company-routes.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: company-routes.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/company-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  isBoardPathWithoutPrefix,
  toCompanyRelativePath,
} from "./company-routes";

describe("company routes", () => {
  it("treats execution workspace paths as board routes that need a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123")).toBe(true);
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123/routines")).toBe(true);
    expect(extractCompanyPrefixFromPath("/execution-workspaces/workspace-123")).toBeNull();
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123",
    );
    expect(applyCompanyPrefix("/execution-workspaces/workspace-123/routines", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123/routines",
    );
  });

  it("normalizes prefixed execution workspace paths back to company-relative paths", () => {
    expect(toCompanyRelativePath("/PAP/execution-workspaces/workspace-123")).toBe(
      "/execution-workspaces/workspace-123",
    );
    expect(toCompanyRelativePath("/PAP/execution-workspaces/workspace-123/routines")).toBe(
      "/execution-workspaces/workspace-123/routines",
    );
  });

  it("treats /search as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/search")).toBe(true);
    expect(extractCompanyPrefixFromPath("/search")).toBeNull();
    expect(applyCompanyPrefix("/search", "PAP")).toBe("/PAP/search");
    expect(applyCompanyPrefix("/search?q=hello%20world", "PAP")).toBe("/PAP/search?q=hello%20world");
    expect(toCompanyRelativePath("/PAP/search?q=foo")).toBe("/search?q=foo");
  });

  // Regression for PAP-10257: Team Catalog navigation (auto-select + row/file
  // clicks) produces company-relative `/teams-catalog/<key>` paths. Without
  // `teams-catalog` in the board-route allowlist, `extractCompanyPrefixFromPath`
  // misread the first segment as a company prefix and `useNavigate` skipped the
  // rewrite, dropping the `/PAP/` prefix and crashing into "Company not found".
  it("re-prefixes team catalog routes so navigate preserves the company prefix", () => {
    expect(isBoardPathWithoutPrefix("/teams")).toBe(false);
    expect(isBoardPathWithoutPrefix("/teams-catalog")).toBe(true);
    expect(isBoardPathWithoutPrefix("/teams-catalog/core-exec-team")).toBe(true);
    expect(extractCompanyPrefixFromPath("/teams-catalog/core-exec-team")).toBeNull();

    // Auto-select effect: `/teams-catalog/<first-key>` must gain the `/PAP/` prefix.
    expect(applyCompanyPrefix("/teams-catalog/core-exec-team", "PAP")).toBe(
      "/PAP/teams-catalog/core-exec-team",
    );
    // File-tree click: nested `/files/<encoded>` path is preserved under the prefix.
    expect(applyCompanyPrefix("/teams-catalog/core-exec-team/files/TEAM.md", "PAP")).toBe(
      "/PAP/teams-catalog/core-exec-team/files/TEAM.md",
    );
    // Already-prefixed paths are left untouched (idempotent — no double prefix).
    expect(applyCompanyPrefix("/PAP/teams-catalog/core-exec-team", "PAP")).toBe(
      "/PAP/teams-catalog/core-exec-team",
    );
    // Round-trips back to a company-relative path.
    expect(toCompanyRelativePath("/PAP/teams-catalog/core-exec-team")).toBe(
      "/teams-catalog/core-exec-team",
    );
  });

  it("treats /artifacts as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/artifacts")).toBe(true);
    expect(extractCompanyPrefixFromPath("/artifacts")).toBeNull();
    expect(applyCompanyPrefix("/artifacts", "PAP")).toBe("/PAP/artifacts");
    expect(toCompanyRelativePath("/PAP/artifacts")).toBe("/artifacts");
  });

  it("preserves artifact deep-link anchors when applying the company prefix", () => {
    expect(applyCompanyPrefix("/issues/PAP-10205#work-product-wp-1", "PAP")).toBe(
      "/PAP/issues/PAP-10205#work-product-wp-1",
    );
    expect(applyCompanyPrefix("/issues/PAP-10306#attachment-att-1", "PAP")).toBe(
      "/PAP/issues/PAP-10306#attachment-att-1",
    );
    // Already-prefixed paths are returned untouched.
    expect(applyCompanyPrefix("/PAP/artifacts", "PAP")).toBe("/PAP/artifacts");
  });

  // Every route root rendered inside boardRoutes() is company-scoped. A root missing from
  // BOARD_ROUTE_ROOTS is read as a company prefix instead, so its sidebar link never gets the
  // company segment and the router hunts for a company by that name ("No company matches
  // prefix DIGEST"). Regression for the /digest, /delegations and /onboarding nav links.
  it.each(["digest", "delegations", "onboarding"])(
    "treats /%s as a board route that needs a company prefix",
    (root) => {
      expect(isBoardPathWithoutPrefix(`/${root}`)).toBe(true);
      expect(extractCompanyPrefixFromPath(`/${root}`)).toBeNull();
      expect(applyCompanyPrefix(`/${root}`, "PAP")).toBe(`/PAP/${root}`);
      expect(toCompanyRelativePath(`/PAP/${root}`)).toBe(`/${root}`);
    },
  );

  // Regression for the Telegram Mini App bottom nav (task 7, idea 066): TelegramBottomNav's Wikis item
  // links to `/plugins/<pluginId>` — a real boardRoutes() entry (App.tsx `plugins/:pluginId`) — through
  // the @/lib/router NavLink shim. Without "plugins" in BOARD_ROUTE_ROOTS, extractCompanyPrefixFromPath
  // misread "plugins" itself as an already-present company prefix, so applyCompanyPrefix left the link
  // unprefixed and it 404'd. Same failure mode as the digest/delegations/onboarding case above.
  it("treats /plugins/:pluginId as a board route that needs a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/plugins/plg_abc123")).toBe(true);
    expect(extractCompanyPrefixFromPath("/plugins/plg_abc123")).toBeNull();
    expect(applyCompanyPrefix("/plugins/plg_abc123", "PAP")).toBe("/PAP/plugins/plg_abc123");
    expect(toCompanyRelativePath("/PAP/plugins/plg_abc123")).toBe("/plugins/plg_abc123");
  });
});
// [END: module]

