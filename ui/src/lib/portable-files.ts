/**
 * FILE: ui/src/lib/portable-files.ts
 * ABOUT: portable-files.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - portable-files.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: portable-files.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/portable-files.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { CompanyPortabilityFileEntry } from "@paperclipai/shared";

const contentTypeByExtension: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function getPortableFileText(entry: CompanyPortabilityFileEntry | null | undefined) {
  return typeof entry === "string" ? entry : null;
}

export function getPortableFileContentType(
  filePath: string,
  entry: CompanyPortabilityFileEntry | null | undefined,
) {
  if (entry && typeof entry === "object" && entry.contentType) return entry.contentType;
  const extensionIndex = filePath.toLowerCase().lastIndexOf(".");
  if (extensionIndex === -1) return null;
  return contentTypeByExtension[filePath.toLowerCase().slice(extensionIndex)] ?? null;
}

export function getPortableFileDataUrl(
  filePath: string,
  entry: CompanyPortabilityFileEntry | null | undefined,
) {
  if (!entry || typeof entry === "string") return null;
  const contentType = getPortableFileContentType(filePath, entry) ?? "application/octet-stream";
  return `data:${contentType};base64,${entry.data}`;
}

export function isPortableImageFile(
  filePath: string,
  entry: CompanyPortabilityFileEntry | null | undefined,
) {
  const contentType = getPortableFileContentType(filePath, entry);
  return typeof contentType === "string" && contentType.startsWith("image/");
}
// [END: module]
