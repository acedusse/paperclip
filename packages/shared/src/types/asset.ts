/**
 * FILE: packages/shared/src/types/asset.ts
 * ABOUT: asset.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - asset.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: asset.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/asset.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export interface AssetImage {
  assetId: string;
  companyId: string;
  provider: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  contentPath: string;
}
// [END: module]
