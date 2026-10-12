"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircleIcon, XCircleIcon, ArrowPathIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import {
  getAuditSession,
  listSessionScans,
  scanAsset,
  completeAuditSession,
  type AuditSession,
  type ScanRecord,
} from "@/lib/audit";
import { useAuditWebSocket } from "@/lib/realtime";

export default function AuditSessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = typeof params.id === "string" ? params.id : "";

  const [session, setSession] = useState<AuditSession | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState("");
  // window.confirm() is unavailable in embedded browsers, so completing asks
  // for a second click instead.
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [completing, setCompleting] = useState(false);
  const seenScanIds = useRef<Set<string>>(new Set());

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const [data, scanData] = await Promise.all([getAuditSession(sessionId), listSessionScans(sessionId)]);
      setSession(data);
      setScans(scanData);
      seenScanIds.current = new Set(scanData.map((scan) => scan.id));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load session");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Real-time scan updates
  useAuditWebSocket(sessionId, (scan) => {
    // Skip scans already loaded by the initial fetch.
    if (seenScanIds.current.has(scan.id)) return;
    seenScanIds.current.add(scan.id);
    setScans((prev) => [scan, ...prev]);
    // Update counts
    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        verified_count: scan.is_verified ? prev.verified_count + 1 : prev.verified_count,
        exception_count: !scan.is_verified ? prev.exception_count + 1 : prev.exception_count,
      };
    });
  });

  const handleScan = async (assetTag: string) => {
    if (!sessionId || !assetTag.trim()) return;
    setScanning(true);
    try {
      await scanAsset(sessionId, assetTag.trim());
      setNotice(`Scanned: ${assetTag}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleComplete = async () => {
    if (!sessionId) return;
    setCompleting(true);
    try {
      await completeAuditSession(sessionId);
      setNotice("Audit session completed");
      setConfirmingComplete(false);
      fetchSession();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Failed to complete session");
    } finally {
      setCompleting(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl space-y-5">
        <p className="text-sm text-slate-500">Loading audit session…</p>
      </main>
    );
  }

  if (error || !session) {
    return (
      <main className="mx-auto max-w-7xl space-y-4">
        <Link href="/assets/audit" className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
          ← Back to audit sessions
        </Link>
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          {error || "Session not found."}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/assets/audit"
            className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700 mb-2"
          >
            ← Back to audit sessions
          </Link>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · Audit</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">{session.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Location: {session.location_id ?? "All locations"} · Started {formatDate(session.started_at)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${getStatusStyle(session.status)}`}>
            {session.status === "IN_PROGRESS" && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />}
            {session.status === "COMPLETED" && <CheckCircleIcon className="h-3.5 w-3.5" />}
            {session.status === "CANCELLED" && <XCircleIcon className="h-3.5 w-3.5" />}
            {session.status}
          </span>
          {session.status === "IN_PROGRESS" && !confirmingComplete && (
            <button
              type="button"
              onClick={() => setConfirmingComplete(true)}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Complete Session
            </button>
          )}
          {session.status === "IN_PROGRESS" && confirmingComplete && (
            <div role="group" aria-label="Confirm completing this session" className="flex items-center gap-2">
              <span className="text-sm text-slate-600">No more scans after this.</span>
              <button
                type="button"
                onClick={handleComplete}
                disabled={completing}
                className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {completing ? "Completing…" : "Yes, complete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingComplete(false)}
                disabled={completing}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {/* Quick Stats */}
      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Verified</p>
          <p className="mt-1 text-3xl font-bold text-emerald-700">{session.verified_count}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Exceptions</p>
          <p className="mt-1 text-3xl font-bold text-amber-700">{session.exception_count}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total Scans</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{session.verified_count + session.exception_count}</p>
        </article>
      </section>

      {/* Scan Input */}
      {session.status === "IN_PROGRESS" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Scan Asset</h2>
          <p className="mt-1 text-sm text-slate-500">Enter asset tag or scan QR/barcode</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget as HTMLFormElement;
              const input = form.elements.namedItem("assetTag") as HTMLInputElement;
              handleScan(input.value);
              input.value = "";
              input.focus();
            }}
            className="mt-4 flex gap-3"
          >
            <label className="flex-1">
              <input
                name="assetTag"
                type="text"
                autoFocus
                placeholder="Asset tag (e.g. AST-00123)"
                className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                disabled={scanning}
              />
            </label>
            <button
              type="submit"
              disabled={scanning}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {scanning ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning…
                </>
              ) : (
                <>
                  <QrCodeIcon className="h-4 w-4" />
                  Scan
                </>
              )}
            </button>
          </form>
        </section>
      )}

      {/* Scans List */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Scan History</h2>
            <p className="mt-1 text-xs text-slate-500">Real-time updates via WebSocket</p>
          </div>
          <QrCodeIcon className="h-5 w-5 text-brand-500" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[800px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3">Asset Tag</th>
                <th className="px-5 py-3">Asset</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Scanned By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scans.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    No scans yet. Start scanning assets.
                  </td>
                </tr>
              ) : (
                scans.map((scan) => (
                  <tr key={scan.id} className="text-sm hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-600">{formatDate(scan.scanned_at)}</td>
                    <td className="px-5 py-3 font-mono font-semibold text-slate-800">{scan.scanned_tag}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {scan.asset_id ? (
                        <>
                          <span className="font-medium">Asset ID: {scan.asset_id.slice(0, 8)}…</span>
                        </>
                      ) : (
                        <span className="text-slate-400">Unrecognized tag</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
                          scan.is_verified
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {scan.is_verified ? (
                          <>
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                            Verified
                          </>
                        ) : (
                          <>
                            <XCircleIcon className="h-3.5 w-3.5" />
                            Exception
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{scan.scanned_by.slice(0, 8)}…</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}