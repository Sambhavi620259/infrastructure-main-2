"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PlusIcon, UserPlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { listUsers, listDepartments, inviteAgent } from "@/lib/users";
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

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [inviting, setInviting] = useState(false);

  const load = () => {
    setLoading(true);
    listUsers({ limit: 200 })
      .then((data) => {
        setUsers(data);
        setError("");
      })
      .catch((caught) => {
        setUsers([]);
        setError(caught instanceof Error ? caught.message : "Unable to load users.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    listDepartments()
      .then(setDepartments)
      .catch(() => undefined);
  }, []);

  const departmentName = (id: string | null) =>
    departments.find((department) => department.id === id)?.name ?? "\u2014";

  // GET /api/users has no search parameter, so this filters the loaded page only.
  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesRole = role === "all" || user.role === role;
      const haystack = `${user.full_name} ${user.email} ${roleLabel(user.role)}`.toLowerCase();
      return matchesRole && haystack.includes(needle);
    });
  }, [users, query, role]);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    const department = String(form.get("department") ?? "IT Support").trim() || "IT Support";
    if (!email) return;

    setInviting(true);
    try {
      const data = await inviteAgent(email, department);
      setDialogOpen(false);
      setNotice(`Invitation created for ${email}. Give them this token to register: ${data.invitationToken}`);
      load();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Unable to create the invitation.");
    } finally {
      setInviting(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">
            Users \u00b7 Directory
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everyone with access to this organization&rsquo;s workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setNotice("");
              setDialogOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <UserPlusIcon className="h-4 w-4" /> Invite IT Agent
          </button>
          <Link
            href="/users/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
          >
            <PlusIcon className="h-4 w-4" /> Create user
          </Link>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <span className="break-all">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="font-bold" aria-label="Dismiss">
            \u00d7
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Directory</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {loading ? "Loading\u2026" : `${visibleUsers.length} of ${users.length} loaded`}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search users"
              placeholder="Search name or email"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 sm:w-60"
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
          <table className="min-w-[760px] w-full text-left">
            <thead className="bg-blue-50/70 text-[11px] font-bold text-slate-600">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Status</th>
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
                      <span className="font-semibold text-slate-900">{user.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-bold ${roleBadgeClass(user.role)}`}
                    >
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
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusBadgeClass(user.status)}`}
                    >
                      {user.status}
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

      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-title"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
        >
          <form onSubmit={invite} className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 id="invite-title" className="text-lg font-semibold text-slate-900">
                  Invite an IT Agent
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Generates a token the person uses to register themselves. This flow supports the IT Agent
                  role only \u2014 use Create user for any other role.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setDialogOpen(false)}
                className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-5 p-6">
              <label className="text-sm font-medium text-slate-700">
                Work email
                <input
                  required
                  type="email"
                  name="email"
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
                  placeholder="name@company.com"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Department
                <input
                  name="department"
                  defaultValue="IT Support"
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-5">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={inviting}
                className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {inviting ? "Creating\u2026" : "Create invitation"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
