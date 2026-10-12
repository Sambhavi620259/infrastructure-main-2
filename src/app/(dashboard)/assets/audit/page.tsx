"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { PlusIcon, ArrowPathIcon, ClipboardDocumentCheckIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { listAuditSessions, startAuditSession, type AuditSession } from "@/lib/audit";

export default function AssetAuditPage() {
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [locationId, setLocationId] = useState("");
  const [formError, setFormError] = useState("");

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const data = await listAuditSessions();
      setSessions(data);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load audit sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // window.prompt() is unavailable in embedded browsers (e.g. the VS Code
  // preview), so the session details are collected with an inline form.
  const closeForm = () => {
    setFormOpen(false);
    setTitle("");
    setLocationId("");
    setFormError("");
  };

  const handleStartAudit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("Enter a title for the audit session.");
      return;
    }

    setCreating(true);
    try {
      await startAuditSession({ title: trimmedTitle, location_id: locationId.trim() || undefined });
      setNotice("Audit session started successfully");
      closeForm();
      fetchSessions();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Failed to start audit session");
    } finally {
      setCreating(false);
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "IN_PROGRESS":
        return "bg-blue-50 text-blue-700 ring-blue-600/20";
      case "COMPLETED":
        return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
      case "CANCELLED":
        return "bg-slate-100 text-slate-600 ring-slate-500/20";
      default:
        return "bg-slate-100 text-slate-600 ring-slate-500/20";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "IN_PROGRESS":
        return <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />;
      case "COMPLETED":
        return <CheckCircleIcon className="h-3.5 w-3.5" />;
      case "CANCELLED":
        return <ExclamationTriangleIcon className="h-3.5 w-3.5" />;
      default:
        return <CheckCircleIcon className="h-3.5 w-3.5" />;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl space-y-5">
        <p className="text-sm text-slate-500">Loading audit sessions…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · Audit</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Asset Audit</h1>
          <p className="mt-1 text-sm text-slate-500">Track physical verification and reconcile audit exceptions.</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Start audit
        </button>
      </header>

      {formOpen && (
        <form
          onSubmit={handleStartAudit}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="start-audit-heading"
        >
          <h2 id="start-audit-heading" className="text-base font-extrabold text-slate-900">
            Start a new audit session
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
                maxLength={150}
                placeholder="e.g. Q4 HQ floor audit"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">
                Location <span className="font-normal text-slate-400">(optional)</span>
              </span>
              <input
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                placeholder="Leave blank to audit all locations"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
          </div>
          {formError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {formError}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {creating ? "Starting…" : "Start session"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={creating}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

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
          <button onClick={fetchSessions} className="ml-4 underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Audit Sessions</h2>
            <p className="mt-1 text-xs text-slate-500">Physical inventory scan sessions.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchSessions}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Refresh
            </button>
            <ClipboardDocumentCheckIcon className="h-5 w-5 text-brand-500" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[800px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-5 py-3">Session</th>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Verified</th>
                <th className="px-5 py-3">Exceptions</th>
                <th className="px-5 py-3">Started</th>
                <th className="px-5 py-3">Completed</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-500">
                    No audit sessions yet. Click &ldquo;Start audit&rdquo; to begin.
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr key={session.id} className="text-sm hover:bg-slate-50">
                    <td className="px-5 py-3 font-semibold text-slate-800">{session.title}</td>
                    <td className="px-5 py-3 text-slate-600">{session.location_id ?? "All locations"}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${getStatusStyle(session.status)}`}>
                        {getStatusIcon(session.status)}
                        {session.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{session.verified_count}</td>
                    <td className="px-5 py-3">
                      <span className={session.exception_count > 0 ? "font-semibold text-amber-700" : "text-slate-600"}>
                        {session.exception_count}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(session.started_at)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(session.completed_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/assets/audit/${session.id}`}
                        className="text-sm font-semibold text-brand-600 hover:text-brand-700"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Link href="/assets" className="inline-flex text-sm font-bold text-brand-600 hover:text-brand-700">
        ← Back to all assets
      </Link>
    </main>
  );
}