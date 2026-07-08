import type { AdmissionStatus } from "../api/instanceSettings";

export function AdmissionStatusLine({
  status,
  isError,
}: {
  status: AdmissionStatus | undefined;
  isError: boolean;
}) {
  if (isError || !status) {
    return <span className="text-xs text-muted-foreground">status unavailable</span>;
  }
  const cap = status.cap === null ? "unlimited" : String(status.cap);
  return (
    <span className="text-xs text-muted-foreground">
      running {status.running} / cap {cap} · {status.queued} queued
    </span>
  );
}
