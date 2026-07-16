/**
 * FILE: ui/src/pages/Delegations.tsx
 * ABOUT: Delegations.tsx (pages module).
 *
 * SECTIONS:
 *   [TAG: module] - Delegations.tsx (pages module).
 */
// ==========================================
// [META: module]
// INTENT: Delegations.tsx (pages module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/pages/Delegations.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { APPROVAL_TYPES } from "@paperclipai/shared";
import {
  delegationsApi,
  type CoverageConfig,
  type CoverageConfigUpdate,
  type DelegationBand,
  type OutOfOfficeUpdate,
} from "../api/delegations";
import { useCompany } from "../context/CompanyContext";

const BANDS: DelegationBand[] = ["low", "medium", "high", "critical"];

function toIsoDateTime(dateValue: string): string | undefined {
  if (!dateValue) return undefined;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

const defaultCoverage: CoverageConfigUpdate = {
  enabled: false,
  backupUserId: "",
  slaCriticalMinutes: 60,
  slaHighMinutes: 240,
  slaMediumMinutes: 1440,
  slaLowMinutes: 4320,
};

type OooForm = {
  enabled: boolean;
  backupUserId: string;
  maxBand: DelegationBand;
  until: string;
};

const defaultOoo: OooForm = {
  enabled: false,
  backupUserId: "",
  maxBand: "high",
  until: "",
};

type GrantForm = {
  delegateUserId: string;
  approvalTypes: string[];
  maxBand: DelegationBand;
  maxSpendCents: string;
  validUntil: string;
};

const defaultGrantForm: GrantForm = {
  delegateUserId: "",
  approvalTypes: [],
  maxBand: "high",
  maxSpendCents: "",
  validUntil: "",
};

function coverageFromConfig(config: CoverageConfig | null | undefined): CoverageConfigUpdate {
  if (!config) return defaultCoverage;
  return {
    enabled: config.enabled,
    backupUserId: config.backupUserId ?? "",
    slaCriticalMinutes: config.slaCriticalMinutes,
    slaHighMinutes: config.slaHighMinutes,
    slaMediumMinutes: config.slaMediumMinutes,
    slaLowMinutes: config.slaLowMinutes,
  };
}

export function Delegations() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? "";
  const qc = useQueryClient();

  const { data: config } = useQuery({
    queryKey: ["coverage-config", companyId],
    queryFn: () => delegationsApi.getCoverageConfig(companyId),
    enabled: !!companyId,
    retry: false,
  });
  const { data: grants } = useQuery({
    queryKey: ["delegation-grants", companyId],
    queryFn: () => delegationsApi.listGrants(companyId),
    enabled: !!companyId,
    retry: false,
  });

  const [coverageForm, setCoverageForm] = useState<CoverageConfigUpdate | null>(null);
  const coverage = coverageForm ?? coverageFromConfig(config);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  const [oooForm, setOooForm] = useState<OooForm>(defaultOoo);
  const [oooError, setOooError] = useState<string | null>(null);

  const [grantForm, setGrantForm] = useState<GrantForm>(defaultGrantForm);
  const [grantError, setGrantError] = useState<string | null>(null);

  const saveCoverage = useMutation({
    mutationFn: (body: CoverageConfigUpdate) => delegationsApi.updateCoverageConfig(companyId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coverage-config", companyId] }),
    onError: () => setCoverageError("Couldn't save coverage settings. Please try again."),
  });

  const saveOoo = useMutation({
    mutationFn: (body: OutOfOfficeUpdate) => delegationsApi.setOutOfOffice(companyId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delegation-grants", companyId] });
      setOooForm(defaultOoo);
    },
    onError: () => setOooError("Couldn't save out-of-office settings. Please try again."),
  });

  const createGrant = useMutation({
    mutationFn: () =>
      delegationsApi.createGrant(companyId, {
        delegateUserId: grantForm.delegateUserId,
        approvalTypes: grantForm.approvalTypes,
        maxBand: grantForm.maxBand,
        maxSpendCents: grantForm.maxSpendCents ? Number(grantForm.maxSpendCents) : null,
        validUntil: toIsoDateTime(grantForm.validUntil) ?? "",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delegation-grants", companyId] });
      setGrantForm(defaultGrantForm);
      setGrantError(null);
    },
    onError: () => setGrantError("Couldn't create the delegation grant. Please try again."),
  });

  const revokeGrant = useMutation({
    mutationFn: (id: string) => delegationsApi.revokeGrant(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["delegation-grants", companyId] }),
  });

  const toggleApprovalType = (type: string) => {
    setGrantForm((f) => ({
      ...f,
      approvalTypes: f.approvalTypes.includes(type)
        ? f.approvalTypes.filter((t) => t !== type)
        : [...f.approvalTypes, type],
    }));
  };

  const activeGrants = (grants ?? []).filter((g) => !g.revokedAt);

  return (
    <div className="delegations-page space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Delegations</h1>
      </div>

      <section className="coverage border-t pt-4">
        <h2 className="text-lg font-medium">Coverage</h2>
        <label className="block mt-2">
          <input
            type="checkbox"
            name="coverageEnabled"
            checked={!!coverage.enabled}
            onChange={(e) => setCoverageForm({ ...coverage, enabled: e.target.checked })}
          />{" "}
          Coverage enabled
        </label>
        <label className="block mt-2">
          Backup user
          <input
            type="text"
            name="coverageBackupUserId"
            value={coverage.backupUserId ?? ""}
            onChange={(e) => setCoverageForm({ ...coverage, backupUserId: e.target.value })}
          />
        </label>
        <label className="block mt-2">
          Critical SLA (minutes)
          <input
            type="number"
            name="slaCriticalMinutes"
            value={coverage.slaCriticalMinutes ?? 0}
            onChange={(e) => setCoverageForm({ ...coverage, slaCriticalMinutes: Number(e.target.value) })}
          />
        </label>
        <label className="block mt-2">
          High SLA (minutes)
          <input
            type="number"
            name="slaHighMinutes"
            value={coverage.slaHighMinutes ?? 0}
            onChange={(e) => setCoverageForm({ ...coverage, slaHighMinutes: Number(e.target.value) })}
          />
        </label>
        <label className="block mt-2">
          Medium SLA (minutes)
          <input
            type="number"
            name="slaMediumMinutes"
            value={coverage.slaMediumMinutes ?? 0}
            onChange={(e) => setCoverageForm({ ...coverage, slaMediumMinutes: Number(e.target.value) })}
          />
        </label>
        <label className="block mt-2">
          Low SLA (minutes)
          <input
            type="number"
            name="slaLowMinutes"
            value={coverage.slaLowMinutes ?? 0}
            onChange={(e) => setCoverageForm({ ...coverage, slaLowMinutes: Number(e.target.value) })}
          />
        </label>
        <button
          className="mt-2"
          onClick={() => {
            setCoverageError(null);
            saveCoverage.mutate(coverage);
          }}
          disabled={!companyId || saveCoverage.isPending}
        >
          {saveCoverage.isPending ? "Saving…" : "Save coverage"}
        </button>
        {coverageError && <p className="text-xs text-destructive mt-1">{coverageError}</p>}
      </section>

      <section className="out-of-office border-t pt-4">
        <h2 className="text-lg font-medium">Out of office</h2>
        <label className="block mt-2">
          <input
            type="checkbox"
            name="oooEnabled"
            checked={oooForm.enabled}
            onChange={(e) => setOooForm({ ...oooForm, enabled: e.target.checked })}
          />{" "}
          Out of office
        </label>
        <label className="block mt-2">
          Backup user
          <input
            type="text"
            name="oooBackupUserId"
            value={oooForm.backupUserId}
            onChange={(e) => setOooForm({ ...oooForm, backupUserId: e.target.value })}
          />
        </label>
        <label className="block mt-2">
          Maximum band
          <select
            name="oooMaxBand"
            value={oooForm.maxBand}
            onChange={(e) => setOooForm({ ...oooForm, maxBand: e.target.value as DelegationBand })}
          >
            {BANDS.map((band) => (
              <option key={band} value={band}>
                {band}
              </option>
            ))}
          </select>
        </label>
        <label className="block mt-2">
          Return date
          <input
            type="date"
            name="oooUntil"
            value={oooForm.until}
            onChange={(e) => setOooForm({ ...oooForm, until: e.target.value })}
          />
        </label>
        <button
          className="mt-2"
          onClick={() => {
            setOooError(null);
            saveOoo.mutate({
              enabled: oooForm.enabled,
              backupUserId: oooForm.backupUserId || undefined,
              maxBand: oooForm.maxBand,
              until: toIsoDateTime(oooForm.until),
            });
          }}
          disabled={!companyId || saveOoo.isPending}
        >
          {saveOoo.isPending ? "Saving…" : "Save out-of-office"}
        </button>
        {oooError && <p className="text-xs text-destructive mt-1">{oooError}</p>}
      </section>

      <section className="delegations mt-6 border-t pt-4">
        <h2 className="text-lg font-medium">Delegations</h2>
        <label className="block mt-2">
          Delegate
          <input
            type="text"
            name="delegateUserId"
            value={grantForm.delegateUserId}
            onChange={(e) => setGrantForm({ ...grantForm, delegateUserId: e.target.value })}
          />
        </label>
        <fieldset className="mt-2">
          <legend>Approval types</legend>
          {APPROVAL_TYPES.map((type) => (
            <label key={type} className="block">
              <input
                type="checkbox"
                value={type}
                checked={grantForm.approvalTypes.includes(type)}
                onChange={() => toggleApprovalType(type)}
              />{" "}
              {type}
            </label>
          ))}
        </fieldset>
        <label className="block mt-2">
          Band ceiling
          <select
            name="grantMaxBand"
            value={grantForm.maxBand}
            onChange={(e) => setGrantForm({ ...grantForm, maxBand: e.target.value as DelegationBand })}
          >
            {BANDS.map((band) => (
              <option key={band} value={band}>
                {band}
              </option>
            ))}
          </select>
        </label>
        <label className="block mt-2">
          Spend cap (cents)
          <input
            type="number"
            name="maxSpendCents"
            value={grantForm.maxSpendCents}
            onChange={(e) => setGrantForm({ ...grantForm, maxSpendCents: e.target.value })}
          />
        </label>
        <label className="block mt-2">
          Valid until
          <input
            type="date"
            name="validUntil"
            value={grantForm.validUntil}
            onChange={(e) => setGrantForm({ ...grantForm, validUntil: e.target.value })}
          />
        </label>
        <button
          className="mt-2"
          onClick={() => {
            setGrantError(null);
            createGrant.mutate();
          }}
          disabled={
            !companyId ||
            createGrant.isPending ||
            !grantForm.delegateUserId ||
            !grantForm.validUntil
          }
        >
          {createGrant.isPending ? "Creating…" : "Create grant"}
        </button>
        {grantError && <p className="text-xs text-destructive mt-1">{grantError}</p>}

        <h3 className="font-medium mt-4">Active grants</h3>
        <ul className="list-disc pl-5">
          {activeGrants.map((g) => (
            <li key={g.id}>
              {g.delegateUserId}{" "}
              <span className="text-xs text-muted-foreground">
                ({g.maxBand}, expires {new Date(g.validUntil).toLocaleDateString()})
              </span>{" "}
              <button onClick={() => revokeGrant.mutate(g.id)} disabled={revokeGrant.isPending}>
                Revoke
              </button>
            </li>
          ))}
          {activeGrants.length === 0 && (
            <p className="text-sm text-muted-foreground">No active grants.</p>
          )}
        </ul>
      </section>
    </div>
  );
}
// [END: module]
