"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { updateAsset } from "@/lib/assets";
import {
  CLAIM_STATUSES,
  COVERAGE_STATES,
  claimStyle,
  coverageLabel,
  coverageStyle,
  listWarrantyClaims,
  listWarrantyCoverage,
  submitWarrantyClaim,
  updateWarrantyClaim,
  type ClaimStatus,
  type CoverageState,
  type WarrantyClaim,
  type WarrantyCoverage,
} from "@/lib/warranty";
import { formatDate } from "@/types/asset";

const EXPIRING_DAYS = 60;

/** "2027-01-12T00:00:00" -> "2027-01-12" for <input type="date">. */
function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function claimLabel(status: ClaimStatus): string {
  return status.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default function AssetWarrantyPage() {
  const [coverageFilter, setCoverageFilter] = useState<CoverageState | "">("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [coverage, setCoverage] = useState<WarrantyCoverage[]>([]);
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [claimFor, setClaimFor] = useState<WarrantyCoverage | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listWarrantyCoverage({
        coverage: coverageFilter || undefined,
        search: search || undefined,
        expiring_days: EXPIRING_DAYS,
      }),
      listWarrantyClaims(),
    ])
      .then(([coverageData, claimData]) => {
        if (cancelled) return;
        setCoverage(coverageData);
        setClaims(claimData);
        setError("");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load warranty data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coverageFilter, search, refreshKey]);

  const refresh = (message: string) => {
    setNotice(message);
    setRefreshKey((key) => key + 1);
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · Warranty</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Warranty</h1>
        <p className="mt-1 text-sm text-slate-500">
          Monitor warranty coverage and manage claims. &ldquo;Expiring soon&rdquo; means within {EXPIRING_DAYS} days.
        </p>
      </header>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {claimFor && (
        <ClaimForm
          asset={claimFor}
          onCancel={() => setClaimFor(null)}
          onSubmitted={(claim) => {
            setClaimFor(null);
            refresh(`Claim filed for ${claim.asset_tag ?? "asset"}.`);
          }}
        />
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filter by coverage" className="flex flex-wrap gap-2">
            {(["", ...COVERAGE_STATES] as const).map((state) => (
              <button
                key={state || "all"}
                type="button"
                onClick={() => setCoverageFilter(state)}
                aria-pressed={coverageFilter === state}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${
                  coverageFilter === state
                    ? "bg-brand-600 text-white ring-brand-600"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {state ? coverageLabel(state) : "All"}
              </button>
            ))}
          </div>
          <label>
            <span className="sr-only">Search assets</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or tag"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:w-64"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-5 py-3">Asset</th>
                <th className="px-5 py-3">Coverage</th>
                <th className="px-5 py-3">Start</th>
                <th className="px-5 py-3">End</th>
                <th className="px-5 py-3">Remaining</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coverage.map((row) => (
                <CoverageRow
                  key={row.asset_id}
                  row={row}
                  onSaved={() => refresh(`Coverage updated for ${row.asset_tag ?? "untagged asset"}.`)}
                  onFileClaim={() => setClaimFor(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && coverage.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">No assets match this filter.</p>
        )}
      </section>

      <ClaimsTable claims={claims} onChanged={(claim) => refresh(`Claim for ${claim.asset_tag ?? "asset"} is now ${claimLabel(claim.status)}.`)} />
    </main>
  );
}

function CoverageRow({
  row,
  onSaved,
  onFileClaim,
}: {
  row: WarrantyCoverage;
  onSaved: () => void;
  onFileClaim: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toDateInput(row.warranty_start));
  const [end, setEnd] = useState(toDateInput(row.warranty_end));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (start && end && end < start) {
      setError("End date must be after the start date.");
      return;
    }
    setSaving(true);
    try {
      await updateAsset(row.asset_id, {
        warranty_start: start ? `${start}T00:00:00` : null,
        warranty_end: end ? `${end}T00:00:00` : null,
      });
      setEditing(false);
      setError("");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="align-top text-sm hover:bg-slate-50">
      <td className="px-5 py-3">
        <Link href={`/assets/${row.asset_id}`} className="font-semibold text-slate-800 hover:text-brand-700">
          {row.name}
        </Link>
        <p className="text-xs text-slate-500">
          {row.asset_tag ?? "Untagged"} · {row.category}
        </p>
      </td>
      <td className="px-5 py-3">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${coverageStyle(row.coverage)}`}>
          {coverageLabel(row.coverage)}
        </span>
      </td>
      {editing ? (
        <>
          <td className="px-5 py-3">
            <label>
              <span className="sr-only">Warranty start for {row.asset_tag ?? "Untagged"}</span>
              <input
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
          </td>
          <td className="px-5 py-3">
            <label>
              <span className="sr-only">Warranty end for {row.asset_tag ?? "Untagged"}</span>
              <input
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
            {error && (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {error}
              </p>
            )}
          </td>
          <td className="px-5 py-3" />
          <td className="space-x-2 whitespace-nowrap px-5 py-3 text-right">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setStart(toDateInput(row.warranty_start));
                setEnd(toDateInput(row.warranty_end));
                setError("");
              }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </td>
        </>
      ) : (
        <>
          <td className="px-5 py-3 text-slate-600">{formatDate(row.warranty_start)}</td>
          <td className="px-5 py-3 text-slate-600">{formatDate(row.warranty_end)}</td>
          <td className="px-5 py-3 text-slate-600">
            {row.days_remaining === null ? "—" : row.days_remaining >= 0 ? `${row.days_remaining} days` : "Expired"}
          </td>
          <td className="space-x-3 whitespace-nowrap px-5 py-3 text-right">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              {row.coverage === "NONE" ? "Add coverage" : "Edit"}
            </button>
            {(row.coverage === "ACTIVE" || row.coverage === "EXPIRING") && (
              <button type="button" onClick={onFileClaim} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                File claim
              </button>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

function ClaimForm({
  asset,
  onCancel,
  onSubmitted,
}: {
  asset: WarrantyCoverage;
  onCancel: () => void;
  onSubmitted: (claim: WarrantyClaim) => void;
}) {
  const [issue, setIssue] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!issue.trim()) {
      setError("Describe the issue being claimed.");
      return;
    }
    setSaving(true);
    try {
      onSubmitted(
        await submitWarrantyClaim({
          asset_id: asset.asset_id,
          issue_description: issue.trim(),
          claim_number: claimNumber.trim() || undefined,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not file the claim.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-extrabold text-slate-900">File a warranty claim</h2>
        <p className="mt-1 text-xs text-slate-500">
          {asset.asset_tag ?? "Untagged"} · {asset.name} · covered until {formatDate(asset.warranty_end)}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <label className="block text-sm">
          <span className="font-semibold text-slate-700">Issue</span>
          <textarea
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
            rows={2}
            autoFocus
            placeholder="e.g. Display flickers when the lid is moved"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-slate-700">
            Vendor claim no. <span className="font-normal text-slate-400">(optional)</span>
          </span>
          <input
            value={claimNumber}
            onChange={(event) => setClaimNumber(event.target.value)}
            maxLength={100}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Filing…" : "File claim"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ClaimsTable({ claims, onChanged }: { claims: WarrantyClaim[]; onChanged: (claim: WarrantyClaim) => void }) {
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  const changeStatus = async (claim: WarrantyClaim, status: ClaimStatus) => {
    setSavingId(claim.id);
    try {
      onChanged(await updateWarrantyClaim(claim.id, { status }));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-extrabold text-slate-900">Warranty claims</h2>
        <p className="mt-1 text-xs text-slate-500">File a claim from a covered asset above, then track it here.</p>
      </div>
      {error && (
        <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {claims.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">No warranty claims yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-5 py-3">Filed</th>
                <th className="px-5 py-3">Asset</th>
                <th className="px-5 py-3">Issue</th>
                <th className="px-5 py-3">Claim no.</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {claims.map((claim) => (
                <tr key={claim.id} className="align-top text-sm hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(claim.created_at)}</td>
                  <td className="px-5 py-3">
                    <Link href={`/assets/${claim.asset_id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                      {claim.asset_tag ?? claim.asset_id.slice(0, 8)}
                    </Link>
                    {claim.asset_name && <p className="text-xs text-slate-500">{claim.asset_name}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-700">{claim.issue_description}</td>
                  <td className="px-5 py-3 text-slate-600">{claim.claim_number ?? "—"}</td>
                  <td className="px-5 py-3">
                    <label>
                      <span className="sr-only">Status of claim for {claim.asset_tag ?? "untagged asset"}</span>
                      <select
                        value={claim.status}
                        disabled={savingId === claim.id}
                        onChange={(event) => changeStatus(claim, event.target.value as ClaimStatus)}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${claimStyle(claim.status)}`}
                      >
                        {CLAIM_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {claimLabel(status)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
