/**
 * FILE: ui/src/pages/Digest.tsx
 * ABOUT: Digest.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - Digest.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: Digest.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/Digest.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { digestsApi } from "../api/digests";
import { useCompany } from "../context/CompanyContext";
import { timeAgo } from "../lib/timeAgo";

export function Digest() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? "";
  const qc = useQueryClient();
  const { data: digest } = useQuery({
    queryKey: ["digest-latest", companyId],
    queryFn: () => digestsApi.latest(companyId),
    enabled: !!companyId,
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => digestsApi.generate(companyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["digest-latest", companyId] }),
  });

  return (
    <div className="digest-page space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Digest</h1>
        <button onClick={() => generate.mutate()} disabled={!companyId || generate.isPending}>
          {generate.isPending ? "Generating…" : "Generate now"}
        </button>
      </div>
      {digest ? (
        <div className="digest">
          <h2 className="text-lg font-medium">{digest.payload.headline}</h2>
          <p className="text-xs text-muted-foreground">
            generated {timeAgo(digest.generatedAt)}
          </p>
          {digest.payload.sections.map((section) => (
            <section key={section.key} className="mt-3">
              <h3 className="font-medium">{section.title}</h3>
              <ul className="list-disc pl-5">
                {section.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No digest yet.</p>
      )}
    </div>
  );
}
// [END: module]
