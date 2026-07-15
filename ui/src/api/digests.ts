/**
 * FILE: ui/src/api/digests.ts
 * ABOUT: digests.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - digests.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: digests.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/digests.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { api } from "./client";

export type DigestSection = { key: string; title: string; lines: string[] };
export type DigestPayload = { headline: string; sections: DigestSection[]; text: string };
export type Digest = {
  id: string;
  companyId: string;
  periodStart: string | null;
  periodEnd: string | null;
  payload: DigestPayload;
  generatedAt: string;
};

export const digestsApi = {
  latest: (companyId: string) => api.get<Digest>(`/companies/${companyId}/digests/latest`),
  list: (companyId: string) => api.get<Digest[]>(`/companies/${companyId}/digests`),
  generate: (companyId: string) => api.post<Digest>(`/companies/${companyId}/digests/generate`, {}),
};
// [END: module]
