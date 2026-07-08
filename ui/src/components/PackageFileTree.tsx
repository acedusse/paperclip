/**
 * FILE: ui/src/components/PackageFileTree.tsx
 * ABOUT: PackageFileTree.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - PackageFileTree.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: PackageFileTree.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/PackageFileTree.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { FileTree } from "./FileTree";
import type { FileTreeProps } from "./FileTree";

export function PackageFileTree({ wrapLabels = false, ...props }: FileTreeProps) {
  return <FileTree {...props} wrapLabels={wrapLabels} />;
}

export {
  FRONTMATTER_FIELD_LABELS,
  buildFileTree,
  collectAllPaths,
  countFiles,
  parseFrontmatter,
} from "./FileTree";
export type {
  FileTreeBadge,
  FileTreeBadgeVariant,
  FileTreeEmptyState,
  FileTreeErrorState,
  FileTreeNode,
  FileTreeProps,
  FileTreeTone,
  FrontmatterData,
} from "./FileTree";
// [END: module]
