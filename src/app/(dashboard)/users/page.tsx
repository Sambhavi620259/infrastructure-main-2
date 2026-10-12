"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PlusIcon } from "@heroicons/react/24/outline";
import { apiFetch } from "@/lib/api";
import {
  addToOrganization,
  listDepartments,
  listUnassignedAgents,
  listUsers,
  reactivateUser,
  removeUser,
} from "@/lib/users";
import {
  BACKEND_ROLES,
  initialsOf,
  moduleLabel,
  roleBadgeClass,
  roleLabel,
  statusBadgeClass,
  type AppUser,
  type Department,
} from "@/types/user";

function formatDay(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [signups, setSignups] = useState<AppUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [confirmRemove, setConfirmRemove] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([listUsers({ limit: 200 }), listUnassignedAgents()])
      .then(([userData, signupData]) => {
        setUsers(userData);
        setSignups(signupData);
        setError("");
      })
      .catch((caught) => {
        setUsers([]);
        setError(caught instanceof Error ? caught.message : "Unable to load users.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    listDepartments()
      .then(setDepartments)
      .catch(() => undefined);
    // Used to hide Remove on your own row.
    apiFetch<{ user: { id: string } }>("/api/profile")
      .then((data) => setCurrentUserId(data.user.id))
      .catch(() => undefined);
  }, [load]);

  const departmentName = (id: string | null) =>
    departments.find((department) => department.id === id)?.name ?? "—";

  // GET /api/users has no search parameter, so this filters the loaded page only.
  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesRole = role === "all" || user.role === role;
      const haystack = `${user.full_name} ${user.email} ${user.agent_id ?? ""} ${roleLabel(user.role)}`.toLowerCase();
      return matchesRole && haystack.includes(needle);
    });
  }, [users, query, role]);

  /** Run a row action, then reload both lists. */
  const act = async (userId: string, action: () => Promise<unknown>, success: string) => {
    setBusyId(userId);
    setNotice("");
    try {
      await action();
      setNotice(success);
      setError("");
      setConfirmRemove("");
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusyId("");
    }
  };

  const removeControls = (user: AppUser) => {
    if (user.id === currentUserId) return <span className="text-xs text-slate-400">You</span>;
    if (user.status !== "ACTIVE") {
      return (
        <button
          type="button"
          disabled={busyId === user.id}
          onClick={() => act(user.id, () => reactivateUser(user.id), `${user.full_name} can sign in again.`)}
          className="text-sm font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50"
        >
          Reactivate
        </button>
      );
    }
    if (confirmRemove === user.id) {
      return (
        <span className="inline-flex items-center gap-3">
          <span className="text-xs text-slate-500">Remove access?</span>
          <button
            type="button"
            disabled={busyId === user.id}
            onClick={() => act(user.id, () => removeUser(user.id), `${user.full_name} has been removed and can no longer sign in.`)}
            className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            Yes, remove
          </button>
          <button type="button" onClick={() => setConfirmRemove("")} className="text-sm font-semibold text-slate-600">
            Cancel
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setConfirmRemove(user.id)}
        className="text-sm font-semibold text-red-600 hover:text-red-700"
      >
        Remove
      </button>
    );
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Users · Directory</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everyone with access to this organization&rsquo;s workspace, plus IT Agents waiting to be added.
          </p>
        </div>
        <Link
          href="/users/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
        >
          <PlusIcon className="h-4 w-4" /> Create user
        </Link>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="font-bold" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {signups.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
          <div className="border-b border-amber-100 bg-amber-50/60 px-5 py-4">
            <h2 className="font-semibold text-slate-900">New IT Agent sign-ups ({signups.length})</h2>
            <p className="mt-1 text-sm text-slate-600">
              These agents registered on their own and are not in any organization yet. Add them to yours to give
              them access, or remove them.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left">
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Agent ID</th>
                  <th className="px-4 py-3">Signed up</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {signups.map((agent) => (
                  <tr key={agent.id} className="text-sm hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{agent.full_name}</td>
                    <td className="px-4 py-3 text-slate-600">{agent.email}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{agent.agent_id ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDay(agent.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusBadgeClass(agent.status)}`}>
                        {agent.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-4">
                        {agent.status === "ACTIVE" && confirmRemove !== agent.id && (
                          <button
                            type="button"
                            disabled={busyId === agent.id}
                            onClick={() =>
                              act(
                                agent.id,
                                () => addToOrganization(agent.id),
                                `${agent.full_name} added to your organization. They can now use the IT Agent dashboard.`,
                              )
                            }
                            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
                          >
                            Add to organization
                          </button>
                        )}
                        {removeControls(agent)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Organization users</h2>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? "Loading…" : `${visibleUsers.length} of ${users.length} loaded`}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search users"
              placeholder="Search name, email or Agent ID"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 sm:w-64"
            />
            <select
              aria-label="Filter users by role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-brand-500"
            >
              <option value="all">All roles</option>
              {BACKEND_ROLES.map((value) => (
                <option key={value} value={value}>
                  {roleLabel(value)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full text-left">
            <thead className="bg-blue-50/70 text-[11px] font-bold text-slate-600">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleUsers.map((user) => (
                <tr key={user.id} className="text-sm hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">
                        {initialsOf(user.full_name)}
                      </span>
                      <span>
                        <Link href={`/users/${user.id}`} className="block font-semibold text-slate-900 hover:text-brand-700">
                        {user.full_name}
                      </Link>
                        {user.agent_id && (
                          <span className="block font-mono text-[11px] text-slate-500">{user.agent_id}</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${roleBadgeClass(user.role)}`}>
                      {roleLabel(user.role)}
                    </span>
                    {user.modules && user.modules.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {user.modules.map((value) => (
                          <span
                            key={value}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600"
                          >
                            {moduleLabel(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{departmentName(user.department_id)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusBadgeClass(user.status)}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-4">
                      <Link href={`/users/${user.id}`} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                        View work
                      </Link>
                      {removeControls(user)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && visibleUsers.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">
            {users.length === 0 ? "No users in this organization yet." : "No users match your filters."}
          </p>
        )}
      </section>
    </main>
  );
}
