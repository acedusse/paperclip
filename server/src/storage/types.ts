/**
 * FILE: server/src/storage/types.ts
 * ABOUT: types.ts (storage module).
 *
 * SECTIONS:
 *   [TAG: module] - types.ts (storage module).
 */
// ==========================================
// [META: module]
// INTENT: types.ts (storage module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/storage/types.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { StorageProvider as StorageProviderId } from "@paperclipai/shared";
import type { Readable } from "node:stream";

export interface PutObjectInput {
  objectKey: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
}

export interface GetObjectInput {
  objectKey: string;
  range?: {
    start: number;
    end: number;
  };
}

export interface GetObjectResult {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
}

export interface HeadObjectResult {
  exists: boolean;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
}

export interface StorageProvider {
  id: StorageProviderId;
  putObject(input: PutObjectInput): Promise<void>;
  getObject(input: GetObjectInput): Promise<GetObjectResult>;
  headObject(input: GetObjectInput): Promise<HeadObjectResult>;
  deleteObject(input: GetObjectInput): Promise<void>;
}

export interface PutFileInput {
  companyId: string;
  namespace: string;
  originalFilename: string | null;
  contentType: string;
  body: Buffer;
}

export interface PutFileResult {
  provider: StorageProviderId;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string | null;
}

export interface StorageService {
  provider: StorageProviderId;
  putFile(input: PutFileInput): Promise<PutFileResult>;
  getObject(companyId: string, objectKey: string, options?: Pick<GetObjectInput, "range">): Promise<GetObjectResult>;
  headObject(companyId: string, objectKey: string): Promise<HeadObjectResult>;
  deleteObject(companyId: string, objectKey: string): Promise<void>;
}
// [END: module]
