"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowDownTrayIcon,
  BookmarkIcon,
  DocumentChartBarIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  createReport,
  deleteSavedReport,
  downloadReport,
  getReportSummary,
  listReportRuns,
  listReportTypes,
  listSavedReports,
  runSavedReport,
  type ReportFilterKey,
  type ReportFilters,
  type ReportRun,
  type ReportSummary,
  type ReportType,
  type SavedReport,
} from "@/lib/reports";
import { listDepartments } from "@/lib/users";
import { listAuditSessions, type AuditSession } from "@/lib/audit";
import { ASSET_STATUSES, assetStatusLabel } from "@/types/asset";
import type { Department } from "@/types/user";

const COVERAGE_OPTIONS = [
  ["ACTIVE", "Covered"],
  ["EXPIRING", "Expiring soon"],
  ["EXPIRED", "Expired"],
  ["NONE", "No warranty"],
] as const;

const ACTION_OPTIONS = [
  ["CREATED", "Registered"],
  ["ASSIGNED", "Assigned"],
  ["UNASSIGNED", "Returned to stock"],
  ["STATUS_CHANGE", "Status change"],
] as const;

const FILTER_LABELS: Record<ReportFilterKey, string> = {
  status: "Status",
  category: "Category",
  department_id: "Department",
  coverage: "Coverage",
  expiring_days: "Expiring within (days)",
  action: "Event",
  date_from: "From",
  date_to: "To",
  session_id: "Audit session",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "status: In stock · category: Laptop" for display next to a saved or generated report. */
function describeFilters(filters: ReportFilters): string {
  const parts = Object.entries(filters).map(([key, value]) => {
    const label = FILTER_LABELS[key as ReportFilterKey] ?? key;
    const shown =
      key === "status"
        ? assetStatusLabel(String(value))
        : key === "date_from" || key === "date_to"
          ? String(value).slice(0, 10)
          : String(value);
    return `${label}: ${shown}`;
  });
  return parts.length ? parts.join(" · ") : "All records";
}

export default function ReportsPage() {
  const [types, setTypes] = useState<ReportType[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([getReportSummary(), listReportRuns(10), listSavedReports()])
      .then(([summaryData, runData, savedData]) => {
        setSummary(summaryData);
        setRuns(runData);
        setSaved(savedData);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load reports."));
  }, []);

  useEffect(() => {
    listReportTypes()
      .then(setTypes)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load report types."));
    refresh();
  }, [refresh]);

  const typeLabel = (key: string) => types.find((type) => type.key === key)?.label ?? key;

  /** Generate (or re-run), download the CSV, then refresh the lists. */
  const generateAndDownload = async (key: string, make: () => Promise<ReportRun>) => {
    setBusy(key);
    setNotice("");
    try {
      const run = await make();
      await downloadReport(run);
      setNotice(`${run.name} generated with ${run.row_count} row${run.row_count === 1 ? "" : "s"}. Download started.`);
      refresh();
      return run;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Report generation failed.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const download = async (run: ReportRun) => {
    setBusy(run.id);
    try {
      await downloadReport(run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  };

  const removeSaved = async (report: SavedReport) => {
    setBusy(report.id);
    try {
      await deleteSavedReport(report.id);
      setNotice(`Saved report "${report.name}" deleted. Reports already generated from it are kept.`);
      setConfirmDelete(null);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed.");
    } finally {
      setBusy(null);
    }
  };

  const tiles: [string, string, string][] = [
    [summary ? String(summary.generated_this_month) : "—", "Reports generated", "This month"],
    [summary ? String(summary.saved_reports) : "—", "Saved reports", "Ready to re-run"],
    [summary ? formatDateTime(summary.last_generated_at) : "—", "Last generated", "Most recent export"],
    [String(types.length || "—"), "Report types", "Available to your team"],
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-brand-600">Reporting & analytics</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Reports</h1>
          <p className="mt-2 text-slate-500">Create audit-ready CSV exports and save them to re-run any time.</p>
        </div>
        <button
          type="button"
          onClick={() => setBuilderOpen(true)}
          disabled={builderOpen}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
        >
          <PlusIcon className="h-4 w-4" /> Create report
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} className="ml-4 font-semibold">
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="ml-4 font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {builderOpen && types.length > 0 && (
        <ReportBuilder
          types={types}
          busy={busy === "builder"}
          onCancel={() => setBuilderOpen(false)}
          onSubmit={async (input) => {
            const run = await generateAndDownload("builder", () => createReport(input));
            if (run) setBuilderOpen(false);
          }}
        />
      )}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(([value, label, hint]) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-2xl font-bold tracking-tight text-slate-950">{value}</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{label}</p>
            <p className="mt-2 text-xs text-slate-500">{hint}</p>
          </article>
        ))}
      </section>

      <section>
        <div className="mb-4">
          <h2 className="font-semibold text-slate-900">Quick reports</h2>
          <p className="mt-1 text-sm text-slate-500">
            Generate any report with all records. Use Create report to add filters or save it.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {types.map((type) => (
            <article
              key={type.key}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-200 hover:shadow-md"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <DocumentChartBarIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-semibold text-slate-900">{type.label}</h3>
              <p className="mt-1 flex-1 text-sm leading-5 text-slate-500">{type.description}</p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => generateAndDownload(type.key, () => createReport({ report_type: type.key }))}
                className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
                {busy === type.key ? "Generating…" : "Generate CSV"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="font-semibold text-slate-900">Saved reports</h2>
          <p className="mt-1 text-sm text-slate-500">
            Reports saved from Create report. Re-running uses current data with the same filters.
          </p>
        </div>
        {saved.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">
            No saved reports yet. Tick &ldquo;Save for re-use&rdquo; when creating a report.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[780px] w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-semibold">Report</th>
                  <th className="px-6 py-3 font-semibold">Type</th>
                  <th className="px-6 py-3 font-semibold">Filters</th>
                  <th className="px-6 py-3 font-semibold">Last run</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {saved.map((report) => (
                  <tr key={report.id} className="text-sm hover:bg-slate-50">
                    <td className="px-6 py-4 font-semibold text-slate-800">{report.name}</td>
                    <td className="px-6 py-4 text-slate-600">{typeLabel(report.report_type)}</td>
                    <td className="px-6 py-4 text-slate-600">{describeFilters(report.filters)}</td>
                    <td className="px-6 py-4 text-slate-600">{formatDateTime(report.last_run_at)}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      {confirmDelete === report.id ? (
                        <span className="inline-flex items-center gap-3">
                          <span className="text-slate-500">Delete?</span>
                          <button
                            type="button"
                            onClick={() => removeSaved(report)}
                            disabled={busy === report.id}
                            className="font-semibold text-red-600 hover:text-red-700"
                          >
                            Yes, delete
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="font-semibold text-slate-600">
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-4">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => generateAndDownload(report.id, () => runSavedReport(report.id))}
                            className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50"
                          >
                            <PlayIcon className="h-4 w-4" aria-hidden="true" />
                            {busy === report.id ? "Running…" : "Run"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(report.id)}
                            aria-label={`Delete saved report ${report.name}`}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="font-semibold text-slate-900">Recent exports</h2>
          <p className="mt-1 text-sm text-slate-500">
            Reports generated across your organization. Each download is the file exactly as it was generated.
          </p>
        </div>
        {runs.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">No reports generated yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {runs.map((run) => (
              <div key={run.id} className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:gap-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
                  {run.format}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">
                    {run.name}
                    {run.report_config_id && (
                      <BookmarkIcon className="ml-1.5 inline h-3.5 w-3.5 text-brand-500" aria-label="From a saved report" />
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {typeLabel(run.report_type)} · {run.row_count} row{run.row_count === 1 ? "" : "s"} ·{" "}
                    {describeFilters(run.filters)} · by {run.generated_by_name ?? "unknown"}
                  </p>
                </div>
                <p className="text-sm text-slate-500">{formatDateTime(run.created_at)}</p>
                <button
                  type="button"
                  onClick={() => download(run)}
                  disabled={busy === run.id}
                  className="inline-flex items-center gap-1 text-left text-sm font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" /> Download
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ReportBuilder({
  types,
  busy,
  onCancel,
  onSubmit,
}: {
  types: ReportType[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { report_type: string; name?: string; filters: ReportFilters; save: boolean }) => void;
}) {
  const [reportType, setReportType] = useState(types[0].key);
  const [name, setName] = useState("");
  const [filters, setFilters] = useState<ReportFilters>({});
  const [save, setSave] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sessions, setSessions] = useState<AuditSession[]>([]);

  const selected = types.find((type) => type.key === reportType) ?? types[0];

  // Load option lists only for the filters this report type uses.
  useEffect(() => {
    if (selected.filters.includes("department_id") && departments.length === 0) {
      listDepartments().then(setDepartments).catch(() => undefined);
    }
    if (selected.filters.includes("session_id") && sessions.length === 0) {
      listAuditSessions().then(setSessions).catch(() => undefined);
    }
  }, [selected, departments.length, sessions.length]);

  const setFilter = (key: ReportFilterKey, value: string) =>
    setFilters((current) => {
      const next = { ...current };
      if (value === "") delete next[key];
      else next[key] = value;
      return next;
    });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sent: ReportFilters = {};
    for (const key of selected.filters) {
      const value = filters[key];
      if (value === undefined || value === "") continue;
      // Date inputs are whole days: "to" covers the end of that day.
      if (key === "date_from") sent[key] = `${value}T00:00:00`;
      else if (key === "date_to") sent[key] = `${value}T23:59:59`;
      else sent[key] = value;
    }
    onSubmit({ report_type: reportType, name: name.trim() || undefined, filters: sent, save });
  };

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

  const field = (key: ReportFilterKey) => {
    const value = String(filters[key] ?? "");
    const control = (() => {
      switch (key) {
        case "status":
          return (
            <select value={value} onChange={(e) => setFilter(key, e.target.value)} className={inputClass}>
              <option value="">Any status</option>
              {ASSET_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {assetStatusLabel(status)}
                </option>
              ))}
            </select>
          );
        case "department_id":
          return (
            <>
              <select
                value={value}
                onChange={(e) => setFilter(key, e.target.value)}
                disabled={departments.length === 0}
                className={inputClass}
              >
                <option value="">{departments.length === 0 ? "No departments yet" : "All departments"}</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
              {departments.length === 0 && (
                <span className="mt-1 block font-normal text-slate-500">
                  Add them under{" "}
                  <Link href="/users/departments" className="font-semibold text-brand-600 hover:text-brand-700">
                    Users → Departments
                  </Link>
                  .
                </span>
              )}
            </>
          );
        case "coverage":
          return (
            <select value={value} onChange={(e) => setFilter(key, e.target.value)} className={inputClass}>
              <option value="">Any coverage</option>
              {COVERAGE_OPTIONS.map(([option, label]) => (
                <option key={option} value={option}>
                  {label}
                </option>
              ))}
            </select>
          );
        case "action":
          return (
            <select value={value} onChange={(e) => setFilter(key, e.target.value)} className={inputClass}>
              <option value="">All events</option>
              {ACTION_OPTIONS.map(([option, label]) => (
                <option key={option} value={option}>
                  {label}
                </option>
              ))}
            </select>
          );
        case "session_id":
          return (
            <select value={value} onChange={(e) => setFilter(key, e.target.value)} className={inputClass}>
              <option value="">All sessions</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          );
        case "expiring_days":
          return (
            <input
              type="number"
              min={1}
              max={365}
              value={value}
              placeholder="60"
              onChange={(e) => setFilter(key, e.target.value)}
              className={inputClass}
            />
          );
        case "date_from":
        case "date_to":
          return <input type="date" value={value} onChange={(e) => setFilter(key, e.target.value)} className={inputClass} />;
        default:
          return (
            <input
              value={value}
              onChange={(e) => setFilter(key, e.target.value)}
              placeholder="e.g. Laptop"
              className={inputClass}
            />
          );
      }
    })();
    return (
      <label key={key} className="block text-xs font-semibold text-slate-600">
        {FILTER_LABELS[key]}
        {control}
      </label>
    );
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="builder-title">
      <div className="flex items-start justify-between">
        <div>
          <h2 id="builder-title" className="font-semibold text-slate-900">
            Create report
          </h2>
          <p className="mt-1 text-sm text-slate-500">{selected.description}</p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-600">
          Report type
          <select
            value={reportType}
            onChange={(e) => {
              setReportType(e.target.value);
              setFilters({});
            }}
            className={inputClass}
          >
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Report name <span className="font-normal text-slate-400">(optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={150}
            placeholder={selected.label}
            className={inputClass}
          />
        </label>
      </div>

      {selected.filters.length > 0 ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{selected.filters.map(field)}</div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">This report has no filters; it includes all records.</p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={save}
            onChange={(e) => setSave(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
          />
          Save for re-use
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
            {busy ? "Generating…" : "Generate & download"}
          </button>
        </div>
      </div>
    </form>
  );
}
