/**
 * FILE: packages/shared/src/types/workspace-file-resource.ts
 * ABOUT: workspace-file-resource.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-file-resource.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-file-resource.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/workspace-file-resource.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export type WorkspaceFileWorkspaceKind = "execution_workspace" | "project_workspace";
export type WorkspaceFileSelector = "auto" | "execution" | "project";
export type WorkspaceFileListMode = "all" | "recent" | "changed";
export type WorkspaceFilePreviewKind = "text" | "image" | "video" | "pdf" | "unsupported";
export type WorkspaceFileResourceKind = "file" | "directory" | "remote_resource";
export type WorkspaceFileContentEncoding = "utf8" | "base64";

export interface WorkspaceFileRef {
  kind: "workspace_file";
  issueId?: string;
  projectId?: string;
  projectName?: string;
  workspaceKind: WorkspaceFileWorkspaceKind;
  workspaceId: string;
  relativePath: string;
  line?: number | null;
  column?: number | null;
  displayPath: string;
}

export interface ResolvedWorkspaceResource {
  kind: WorkspaceFileResourceKind;
  provider: "local_fs" | "git_worktree" | "remote_managed" | string;
  title: string;
  displayPath: string;
  workspaceLabel: string;
  workspaceKind: WorkspaceFileWorkspaceKind;
  workspaceId: string;
  projectId?: string | null;
  projectName?: string | null;
  contentType?: string | null;
  byteSize?: number | null;
  previewKind: WorkspaceFilePreviewKind;
  denialReason?: string | null;
  capabilities: {
    preview: boolean;
    download: false;
    listChildren: boolean;
  };
}

export interface WorkspaceFileContent {
  resource: ResolvedWorkspaceResource;
  content: {
    encoding: WorkspaceFileContentEncoding;
    data: string;
  };
}

export interface WorkspaceFileListFileItem {
  kind: "file";
  provider: "local_fs" | "git_worktree" | string;
  title: string;
  relativePath: string;
  displayPath: string;
  workspaceLabel: string;
  workspaceKind: WorkspaceFileWorkspaceKind;
  workspaceId: string;
  projectId?: string | null;
  projectName?: string | null;
  contentType?: string | null;
  byteSize?: number | null;
  modifiedAt?: string | null;
  previewKind: Exclude<WorkspaceFilePreviewKind, "unsupported">;
  capabilities: {
    preview: true;
    download: false;
    listChildren: false;
  };
}

export interface WorkspaceFileListDirectoryItem {
  kind: "directory";
  provider: "local_fs" | "git_worktree" | string;
  title: string;
  relativePath: string;
  displayPath: string;
  workspaceLabel: string;
  workspaceKind: WorkspaceFileWorkspaceKind;
  workspaceId: string;
  projectId?: string | null;
  projectName?: string | null;
  contentType: null;
  byteSize: null;
  modifiedAt?: string | null;
  previewKind: "unsupported";
  capabilities: {
    preview: false;
    download: false;
    listChildren: true;
  };
}

export type WorkspaceFileListItem = WorkspaceFileListFileItem | WorkspaceFileListDirectoryItem;

export interface WorkspaceFileListResponse {
  kind: "workspace_file_list";
  state: "available" | "unavailable";
  unavailableReason?: string | null;
  workspace: {
    provider: "local_fs" | "git_worktree" | string;
    workspaceLabel: string;
    workspaceKind: WorkspaceFileWorkspaceKind;
    workspaceId: string;
    projectId?: string | null;
    projectName?: string | null;
  } | null;
  query: {
    workspace: WorkspaceFileSelector;
    mode: WorkspaceFileListMode;
    path?: string | null;
    q: string | null;
    limit: number;
    offset: number;
  };
  items: WorkspaceFileListItem[];
  scannedCount: number;
  truncated: boolean;
}
// [END: module]
