/** Normalize a claim path to POSIX, no leading/trailing slashes, no "."/empty segments. Root → "". */
export function normalizeClaimPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter((s) => s.length > 0 && s !== ".");
  return segments.join("/");
}

/** Two normalized paths overlap iff equal or one is a segment-aware ancestor of the other. Root ("") overlaps all. */
export function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeClaimPath(a);
  const nb = normalizeClaimPath(b);
  if (na === "" || nb === "") return true;
  if (na === nb) return true;
  return nb.startsWith(na + "/") || na.startsWith(nb + "/");
}

export interface ClaimLike {
  path: string;
  heartbeatRunId: string | null;
}

/** Existing claims that overlap newPath, excluding any claim from excludeRunId. */
export function detectClaimOverlap(newPath: string, existing: ClaimLike[], excludeRunId?: string): ClaimLike[] {
  return existing.filter(
    (c) => c.heartbeatRunId !== excludeRunId && pathsOverlap(newPath, c.path),
  );
}
