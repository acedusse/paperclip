/**
 * FILE: ui/src/api/document-annotations.ts
 * ABOUT: document-annotations.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - document-annotations.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: document-annotations.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/document-annotations.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type {
  CreateDocumentAnnotationCommentRequest,
  CreateDocumentAnnotationThreadRequest,
  DocumentAnnotationComment,
  DocumentAnnotationThread,
  DocumentAnnotationThreadStatus,
  DocumentAnnotationThreadWithComments,
  UpdateDocumentAnnotationThreadRequest,
} from "@paperclipai/shared";
import { api } from "./client";

export type DocumentAnnotationListFilter = "open" | "resolved" | "all";

export const documentAnnotationsApi = {
  list: (
    issueId: string,
    key: string,
    options: { status?: DocumentAnnotationListFilter; includeComments?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.includeComments) params.set("includeComments", "true");
    const qs = params.toString();
    return api.get<DocumentAnnotationThreadWithComments[]>(
      `/issues/${issueId}/documents/${encodeURIComponent(key)}/annotations${qs ? `?${qs}` : ""}`,
    );
  },
  get: (issueId: string, key: string, threadId: string) =>
    api.get<DocumentAnnotationThreadWithComments>(
      `/issues/${issueId}/documents/${encodeURIComponent(key)}/annotations/${threadId}`,
    ),
  create: (issueId: string, key: string, data: CreateDocumentAnnotationThreadRequest) =>
    api.post<DocumentAnnotationThreadWithComments>(
      `/issues/${issueId}/documents/${encodeURIComponent(key)}/annotations`,
      data,
    ),
  addComment: (
    issueId: string,
    key: string,
    threadId: string,
    data: CreateDocumentAnnotationCommentRequest,
  ) =>
    api.post<DocumentAnnotationComment>(
      `/issues/${issueId}/documents/${encodeURIComponent(key)}/annotations/${threadId}/comments`,
      data,
    ),
  updateStatus: (
    issueId: string,
    key: string,
    threadId: string,
    status: DocumentAnnotationThreadStatus,
  ) => {
    const payload: UpdateDocumentAnnotationThreadRequest = { status };
    return api.patch<DocumentAnnotationThread>(
      `/issues/${issueId}/documents/${encodeURIComponent(key)}/annotations/${threadId}`,
      payload,
    );
  },
};
// [END: module]
