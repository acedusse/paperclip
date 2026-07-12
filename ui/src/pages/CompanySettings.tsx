/**
 * FILE: ui/src/pages/CompanySettings.tsx
 * ABOUT: CompanySettings.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - CompanySettings.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: CompanySettings.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/CompanySettings.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { ChangeEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_COMPANY_ATTACHMENT_MAX_BYTES,
  MAX_COMPANY_ATTACHMENT_MAX_BYTES,
} from "@paperclipai/shared";
import type { ScheduleWindow } from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { assetsApi } from "../api/assets";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings, CloudUpload, Download, Upload } from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import { AdmissionStatusLine } from "../components/AdmissionStatusLine";
import {
  Field,
  ToggleField,
} from "../components/agent-config-primitives";

const BYTES_PER_MIB = 1024 * 1024;
const DEFAULT_COMPANY_ATTACHMENT_MAX_MIB = DEFAULT_COMPANY_ATTACHMENT_MAX_BYTES / BYTES_PER_MIB;
const MAX_COMPANY_ATTACHMENT_MAX_MIB = MAX_COMPANY_ATTACHMENT_MAX_BYTES / BYTES_PER_MIB;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Weekday convention: Sun=0 ... Sat=6.
type SchedulePreset = { key: string; label: string; windows: (throttleCap: number) => ScheduleWindow[] };

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { key: "always-full", label: "Always full", windows: () => [] },
  {
    key: "business-hours-throttle",
    label: "Business-hours throttle",
    windows: (cap) => [
      { id: "biz", label: "Business hours", days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020, maxConcurrentRuns: cap },
    ],
  },
  {
    key: "nights-weekends",
    label: "Nights & weekends only",
    windows: () => [
      { id: "weekday-day", label: "Weekday daytime (paused)", days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020, maxConcurrentRuns: 0 },
    ],
  },
  {
    key: "paused",
    label: "Paused",
    windows: () => [
      { id: "paused", label: "Paused", days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0, maxConcurrentRuns: 0 },
    ],
  },
];

export const minuteToTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const timeToMinute = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const CAP_OVERRIDE_DURATIONS = [
  { label: "30 minutes", minutes: 30 },
  { label: "2 hours", minutes: 120 },
  { label: "8 hours", minutes: 480 },
];

export function CompanySettings() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [attachmentMaxMiB, setAttachmentMaxMiB] = useState(String(DEFAULT_COMPANY_ATTACHMENT_MAX_MIB));
  const [maxRuns, setMaxRuns] = useState("");
  const [maxRunWallClockMs, setMaxRunWallClockMs] = useState("");
  const [maxRunCostCents, setMaxRunCostCents] = useState("");
  const [maxRunTurns, setMaxRunTurns] = useState("");
  const [predictiveBreakerEnabled, setPredictiveBreakerEnabled] = useState(false);
  const [breakerHorizonMinutes, setBreakerHorizonMinutes] = useState("");
  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [scheduleTimezone, setScheduleTimezone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [capOverrideValue, setCapOverrideValue] = useState("0");
  const [capOverrideDurationMinutes, setCapOverrideDurationMinutes] = useState(CAP_OVERRIDE_DURATIONS[0].minutes);

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
    setAttachmentMaxMiB(String(Math.round((selectedCompany.attachmentMaxBytes ?? DEFAULT_COMPANY_ATTACHMENT_MAX_BYTES) / BYTES_PER_MIB)));
    setMaxRuns(String(selectedCompany.maxConcurrentRuns ?? ""));
    setMaxRunWallClockMs(String(selectedCompany.maxRunWallClockMs ?? ""));
    setMaxRunCostCents(String(selectedCompany.maxRunCostCents ?? ""));
    setMaxRunTurns(String(selectedCompany.maxRunTurns ?? ""));
    setPredictiveBreakerEnabled(selectedCompany.predictiveBreakerEnabled ?? false);
    setBreakerHorizonMinutes(String(selectedCompany.breakerHorizonMinutes ?? ""));
    setScheduleWindows(selectedCompany.scheduleWindows ?? []);
    setScheduleTimezone(selectedCompany.scheduleTimezone ?? "");
    setLogoUrl(selectedCompany.logoUrl ?? "");
  }, [selectedCompany]);

  const attachmentMaxBytes = Number.parseInt(attachmentMaxMiB, 10) * BYTES_PER_MIB;
  const attachmentMaxValid =
    Number.isInteger(attachmentMaxBytes)
    && attachmentMaxBytes >= BYTES_PER_MIB
    && attachmentMaxBytes <= MAX_COMPANY_ATTACHMENT_MAX_BYTES;
  const trimmedMaxRuns = maxRuns.trim();
  const maxRunsValid =
    trimmedMaxRuns === "" || (Number.isInteger(Number(trimmedMaxRuns)) && Number(trimmedMaxRuns) > 0);
  const maxRunsPayload = trimmedMaxRuns === "" ? null : Number(trimmedMaxRuns);
  const trimmedMaxRunWallClockMs = maxRunWallClockMs.trim();
  const maxRunWallClockMsValid =
    trimmedMaxRunWallClockMs === "" ||
    (Number.isInteger(Number(trimmedMaxRunWallClockMs)) && Number(trimmedMaxRunWallClockMs) > 0);
  const maxRunWallClockMsPayload =
    trimmedMaxRunWallClockMs === "" ? null : Number(trimmedMaxRunWallClockMs);
  const trimmedMaxRunCostCents = maxRunCostCents.trim();
  const maxRunCostCentsValid =
    trimmedMaxRunCostCents === "" ||
    (Number.isInteger(Number(trimmedMaxRunCostCents)) && Number(trimmedMaxRunCostCents) > 0);
  const maxRunCostCentsPayload =
    trimmedMaxRunCostCents === "" ? null : Number(trimmedMaxRunCostCents);
  const trimmedMaxRunTurns = maxRunTurns.trim();
  const maxRunTurnsValid =
    trimmedMaxRunTurns === "" ||
    (Number.isInteger(Number(trimmedMaxRunTurns)) && Number(trimmedMaxRunTurns) > 0);
  const maxRunTurnsPayload = trimmedMaxRunTurns === "" ? null : Number(trimmedMaxRunTurns);
  const trimmedBreakerHorizonMinutes = breakerHorizonMinutes.trim();
  const breakerHorizonMinutesValid =
    trimmedBreakerHorizonMinutes === "" ||
    (Number.isInteger(Number(trimmedBreakerHorizonMinutes)) && Number(trimmedBreakerHorizonMinutes) > 0);
  const breakerHorizonMinutesPayload =
    trimmedBreakerHorizonMinutes === "" ? null : Number(trimmedBreakerHorizonMinutes);
  const cloudSyncEnabled = experimentalSettings?.enableCloudSync === true;

  const admissionStatusQuery = useQuery({
    queryKey: queryKeys.companies.admissionStatus(selectedCompanyId ?? ""),
    queryFn: () => companiesApi.getAdmissionStatus(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const executionStateMutation = useMutation({
    mutationFn: (state: "running" | "draining" | "halted") =>
      companiesApi.setExecutionState(selectedCompanyId!, state),
    onSuccess: async () => {
      if (selectedCompanyId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.companies.admissionStatus(selectedCompanyId) });
      }
    },
  });
  const executionState = admissionStatusQuery.data?.runExecutionState ?? "running";

  const capOverrideMutation = useMutation({
    mutationFn: ({ cap, durationMinutes }: { cap: number; durationMinutes: number }) =>
      companiesApi.setCapOverride(selectedCompanyId!, cap, durationMinutes),
    onSuccess: async () => {
      if (selectedCompanyId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.companies.admissionStatus(selectedCompanyId) });
      }
    },
  });

  const clearCapOverrideMutation = useMutation({
    mutationFn: () => companiesApi.clearCapOverride(selectedCompanyId!),
    onSuccess: async () => {
      if (selectedCompanyId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.companies.admissionStatus(selectedCompanyId) });
      }
    },
  });

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? "") ||
      attachmentMaxBytes !== (selectedCompany.attachmentMaxBytes ?? DEFAULT_COMPANY_ATTACHMENT_MAX_BYTES) ||
      maxRunsPayload !== (selectedCompany.maxConcurrentRuns ?? null) ||
      maxRunWallClockMsPayload !== (selectedCompany.maxRunWallClockMs ?? null) ||
      maxRunCostCentsPayload !== (selectedCompany.maxRunCostCents ?? null) ||
      maxRunTurnsPayload !== (selectedCompany.maxRunTurns ?? null) ||
      predictiveBreakerEnabled !== (selectedCompany.predictiveBreakerEnabled ?? false) ||
      breakerHorizonMinutesPayload !== (selectedCompany.breakerHorizonMinutes ?? null) ||
      JSON.stringify(scheduleWindows) !== JSON.stringify(selectedCompany.scheduleWindows ?? []) ||
      (scheduleTimezone.trim() === "" ? null : scheduleTimezone.trim()) !== (selectedCompany.scheduleTimezone ?? null));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
      attachmentMaxBytes: number;
      maxConcurrentRuns: number | null;
      maxRunWallClockMs: number | null;
      maxRunCostCents: number | null;
      maxRunTurns: number | null;
      predictiveBreakerEnabled: boolean;
      breakerHorizonMinutes: number | null;
      scheduleWindows: ScheduleWindow[];
      scheduleTimezone: string | null;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.admissionStatus(selectedCompanyId) });
      }
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) => companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })),
    onSuccess: (company) => {
      syncLogoState(company.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUploadError(null);
      syncLogoState(company.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null,
      attachmentMaxBytes,
      maxConcurrentRuns: maxRunsPayload,
      maxRunWallClockMs: maxRunWallClockMsPayload,
      maxRunCostCents: maxRunCostCentsPayload,
      maxRunTurns: maxRunTurnsPayload,
      predictiveBreakerEnabled,
      breakerHorizonMinutes: breakerHorizonMinutesPayload,
      scheduleWindows,
      scheduleTimezone: scheduleTimezone.trim() === "" ? null : scheduleTimezone.trim()
    });
  }

  function handleAddScheduleWindow() {
    setScheduleWindows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: "New window",
        days: [1, 2, 3, 4, 5],
        startMinute: 540,
        endMinute: 1020,
        maxConcurrentRuns: 2
      }
    ]);
  }

  function handleRemoveScheduleWindow(id: string) {
    setScheduleWindows((prev) => prev.filter((w) => w.id !== id));
  }

  function updateScheduleWindow(id: string, patch: Partial<ScheduleWindow>) {
    setScheduleWindows((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }

  function toggleScheduleWindowDay(id: string, day: number) {
    setScheduleWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const days = w.days.includes(day)
          ? w.days.filter((d) => d !== day)
          : [...w.days, day].sort((a, b) => a - b);
        return { ...w, days };
      })
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Company Settings</h1>
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the company profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                logoUrl={logoUrl || null}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label="Logo"
                hint="Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
              >
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoFileChange}
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                  />
                  {logoUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearLogo}
                        disabled={clearLogoMutation.isPending}
                      >
                        {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                      </Button>
                    </div>
                  )}
                  {(logoUploadMutation.isError || logoUploadError) && (
                    <span className="text-xs text-destructive">
                      {logoUploadError ??
                        (logoUploadMutation.error instanceof Error
                          ? logoUploadMutation.error.message
                          : "Logo upload failed")}
                    </span>
                  )}
                  {clearLogoMutation.isError && (
                    <span className="text-xs text-destructive">
                      {clearLogoMutation.error.message}
                    </span>
                  )}
                  {logoUploadMutation.isPending && (
                    <span className="text-xs text-muted-foreground">Uploading logo...</span>
                  )}
                </div>
              </Field>
              <Field
                label="Brand color"
                hint="Sets the hue for the company icon. Leave empty for auto-generated color."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
              <Field
                label="Attachment size limit"
                hint={`Accepted range: 1-${MAX_COMPANY_ATTACHMENT_MAX_MIB} MiB.`}
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={MAX_COMPANY_ATTACHMENT_MAX_MIB}
                      step={1}
                      value={attachmentMaxMiB}
                      onChange={(e) => setAttachmentMaxMiB(e.target.value)}
                      className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    />
                    <span className="text-xs text-muted-foreground">MiB</span>
                  </div>
                  {!attachmentMaxValid && (
                    <span className="text-xs text-destructive">
                      Enter a whole number from 1 to {MAX_COMPANY_ATTACHMENT_MAX_MIB}.
                    </span>
                  )}
                </div>
              </Field>
              <Field
                label="Max concurrent runs"
                hint="Cap on this company's running agent runs. Empty = unlimited."
              >
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    value={maxRuns}
                    onChange={(e) => setMaxRuns(e.target.value)}
                    aria-invalid={!maxRunsValid}
                    data-testid="company-max-runs-input"
                    className="w-28"
                  />
                  {!maxRunsValid && (
                    <span className="text-xs text-destructive">
                      Enter a positive whole number, or leave empty for unlimited.
                    </span>
                  )}
                  <AdmissionStatusLine
                    status={admissionStatusQuery.data}
                    isError={admissionStatusQuery.isError}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={executionState === "draining" || executionStateMutation.isPending}
                      onClick={() => executionStateMutation.mutate("draining")}
                    >
                      Drain
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={executionState === "halted" || executionStateMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Panic will cancel all in-flight runs (checkpointed, resumable). Continue?",
                          )
                        ) {
                          executionStateMutation.mutate("halted");
                        }
                      }}
                    >
                      Panic
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={executionState === "running" || executionStateMutation.isPending}
                      onClick={() => executionStateMutation.mutate("running")}
                    >
                      Resume
                    </Button>
                  </div>
                </div>
              </Field>
              <Field
                label="Max run wall-clock time"
                hint="Cap on how long a single run may execute, in milliseconds. Empty = unlimited."
              >
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    value={maxRunWallClockMs}
                    onChange={(e) => setMaxRunWallClockMs(e.target.value)}
                    aria-invalid={!maxRunWallClockMsValid}
                    data-testid="company-max-run-wall-clock-ms-input"
                    className="w-28"
                  />
                  {!maxRunWallClockMsValid && (
                    <span className="text-xs text-destructive">
                      Enter a positive whole number, or leave empty for unlimited.
                    </span>
                  )}
                </div>
              </Field>
              <Field
                label="Max run cost"
                hint="Cap on how much a single run may spend, in cents. Empty = unlimited."
              >
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    value={maxRunCostCents}
                    onChange={(e) => setMaxRunCostCents(e.target.value)}
                    aria-invalid={!maxRunCostCentsValid}
                    data-testid="company-max-run-cost-cents-input"
                    className="w-28"
                  />
                  {!maxRunCostCentsValid && (
                    <span className="text-xs text-destructive">
                      Enter a positive whole number, or leave empty for unlimited.
                    </span>
                  )}
                </div>
              </Field>
              <Field
                label="Max run turns"
                hint="Cap on agent turns for a single run. Only enforced for adapters that support turn limits (Claude, Grok). Empty = unlimited."
              >
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    value={maxRunTurns}
                    onChange={(e) => setMaxRunTurns(e.target.value)}
                    aria-invalid={!maxRunTurnsValid}
                    data-testid="company-max-run-turns-input"
                    className="w-28"
                  />
                  {!maxRunTurnsValid && (
                    <span className="text-xs text-destructive">
                      Enter a positive whole number, or leave empty for unlimited.
                    </span>
                  )}
                </div>
              </Field>
              <Field label="Predictive budget breaker">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={predictiveBreakerEnabled}
                    onChange={(e) => setPredictiveBreakerEnabled(e.target.checked)}
                    data-testid="company-predictive-breaker-enabled-checkbox"
                  />
                  Enable predictive budget breaker
                </label>
              </Field>
              <Field
                label="Budget breaker horizon (minutes)"
                hint="Lower the cap when the budget is forecast to run out within this many minutes."
              >
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    value={breakerHorizonMinutes}
                    onChange={(e) => setBreakerHorizonMinutes(e.target.value)}
                    aria-invalid={!breakerHorizonMinutesValid}
                    data-testid="company-breaker-horizon-minutes-input"
                    className="w-28"
                  />
                  {!breakerHorizonMinutesValid && (
                    <span className="text-xs text-destructive">
                      Enter a positive whole number, or leave empty for unset.
                    </span>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Spend schedule / quiet hours */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Spend schedule / quiet hours
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <Field
            label="Timezone"
            hint="IANA timezone (e.g. America/New_York). Required for the windows below to take effect."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={scheduleTimezone}
              placeholder="America/New_York"
              onChange={(e) => setScheduleTimezone(e.target.value)}
              data-testid="company-schedule-timezone-input"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {SCHEDULE_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setScheduleWindows(preset.windows(2))}
                data-testid={`company-schedule-preset-${preset.key}`}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="space-y-3">
            {scheduleWindows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No windows configured — the company runs at full capacity at all times.
              </p>
            )}
            {scheduleWindows.map((window) => (
              <div
                key={window.id}
                className="space-y-2 rounded-md border border-border px-3 py-3"
                data-testid={`company-schedule-window-${window.id}`}
              >
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    type="text"
                    value={window.label}
                    onChange={(e) => updateScheduleWindow(window.id, { label: e.target.value })}
                    placeholder="Window label"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveScheduleWindow(window.id)}
                  >
                    Remove
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {DAY_LABELS.map((dayLabel, dayIndex) => (
                    <label
                      key={dayIndex}
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-border"
                        checked={window.days.includes(dayIndex)}
                        onChange={() => toggleScheduleWindowDay(window.id, dayIndex)}
                      />
                      {dayLabel}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Start
                    <input
                      type="time"
                      className="rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none"
                      value={minuteToTime(window.startMinute)}
                      onChange={(e) =>
                        updateScheduleWindow(window.id, { startMinute: timeToMinute(e.target.value) })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    End
                    <input
                      type="time"
                      className="rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none"
                      value={minuteToTime(window.endMinute)}
                      onChange={(e) =>
                        updateScheduleWindow(window.id, { endMinute: timeToMinute(e.target.value) })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Max concurrent runs
                    <input
                      type="number"
                      min={0}
                      className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none"
                      value={window.maxConcurrentRuns}
                      onChange={(e) =>
                        updateScheduleWindow(window.id, {
                          maxConcurrentRuns: Number.parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={handleAddScheduleWindow}>
              Add window
            </Button>
          </div>

          <Field
            label="Manual override"
            hint="Temporarily boost or quiet the admission cap, overriding the schedule above."
          >
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={capOverrideValue}
                  onChange={(e) => setCapOverrideValue(e.target.value)}
                  className="w-20"
                  data-testid="company-cap-override-value-input"
                />
                <select
                  className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                  value={capOverrideDurationMinutes}
                  onChange={(e) => setCapOverrideDurationMinutes(Number(e.target.value))}
                  data-testid="company-cap-override-duration-select"
                >
                  {CAP_OVERRIDE_DURATIONS.map((option) => (
                    <option key={option.minutes} value={option.minutes}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={capOverrideMutation.isPending}
                  onClick={() => {
                    const cap = Number.parseInt(capOverrideValue, 10);
                    if (!Number.isInteger(cap) || cap < 0) return;
                    capOverrideMutation.mutate({ cap, durationMinutes: capOverrideDurationMinutes });
                  }}
                  data-testid="company-cap-override-boost-button"
                >
                  Boost
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={capOverrideMutation.isPending}
                  onClick={() =>
                    capOverrideMutation.mutate({ cap: 0, durationMinutes: capOverrideDurationMinutes })
                  }
                  data-testid="company-cap-override-quiet-now-button"
                >
                  Quiet now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={clearCapOverrideMutation.isPending}
                  onClick={() => clearCapOverrideMutation.mutate()}
                  data-testid="company-cap-override-clear-button"
                >
                  Clear override
                </Button>
              </div>
              {(capOverrideMutation.isError || clearCapOverrideMutation.isError) && (
                <span className="text-xs text-destructive">
                  {(capOverrideMutation.error ?? clearCapOverrideMutation.error) instanceof Error
                    ? (capOverrideMutation.error ?? clearCapOverrideMutation.error)?.message
                    : "Failed to update override"}
                </span>
              )}
            </div>
          </Field>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={
              generalMutation.isPending ||
              !companyName.trim() ||
              !attachmentMaxValid ||
              !maxRunsValid ||
              !maxRunWallClockMsValid ||
              !maxRunCostCentsValid ||
              !maxRunTurnsValid ||
              !breakerHorizonMinutesValid
            }
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                  ? generalMutation.error.message
                  : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4" data-testid="company-settings-team-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
            toggleTestId="company-settings-team-approval-toggle"
          />
        </div>
      </div>

      {/* Import / Export */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Company Packages
        </div>
        <div className="rounded-md border border-border px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Import and export have moved to dedicated pages accessible from the{" "}
            <a href="/org" className="underline hover:text-foreground">Org Chart</a> header.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {cloudSyncEnabled ? (
              <Button size="sm" asChild>
                <a href="/company/settings/cloud-upstream">
                  <CloudUpload className="mr-1.5 h-3.5 w-3.5" />
                  Send to Paperclip Cloud
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="outline" asChild>
              <a href="/company/export">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href="/company/import">
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive company "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                const nextCompanyId =
                  companies.find(
                    (company) =>
                      company.id !== selectedCompanyId &&
                      company.status !== "archived"
                  )?.id ?? null;
                archiveMutation.mutate({
                  companyId: selectedCompanyId,
                  nextCompanyId
                });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                ? "Already archived"
                : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
// [END: module]
