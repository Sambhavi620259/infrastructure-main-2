"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listUsers, reactivateUser, removeUser } from "@/lib/users";
import { initialsOf, roleBadgeClass, roleLabel, statusBadgeClass, type AppUser } from "@/types/user";

/** Roles whose work the Super Admin reviews: IT Admins (and their sub-admins) and users. */
const ROLE_FILTERS: [string, string, string[]][] = [
  ["all", "IT Admins & users", ["IT_ADMIN", "SUB_ADMIN", "REPORTING_USER", "EMPLOYEE"]],
  ["admins", "IT Admins", ["IT_ADMIN", "SUB_ADMIN", "REPORTING_USER"]],
  ["users", "Users", ["EMPLOYEE"]],
];

/** Super Admin: the company's IT Admins and users, their work, and adding or removing them. */
export default function TeamWorkPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roleFilter, setRoleFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState("");
  const [busyId, setBusyId] = useState("");

  // Removing deactivates the account: it can no longer sign in, its history is kept, and it can be reactivated.
  const setStatus = async (person: AppUser, active: boolean) => {
    setBusyId(person.id);
    setError("");
    setNotice("");
    try {
      if (active) await reactivateUser(person.id);
      else await removeUser(person.id);
      setUsers((current) => current.map((u) => (u.id === person.id ? { ...u, status: active ? "ACTIVE" : "INACTIVE" } : u)));
      setNotice(active ? `${person.full_name} can sign in again.` : `${person.full_name} has been removed and can no longer sign in.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change this account.");
    } finally {
      setBusyId("");
      setConfirmRemove("");
    }
  };

  useEffect(() => {
    listUsers({ limit: 2000 })
      .then(setUsers)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load users."))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const roles = ROLE_FILTERS.find(([value]) => value === roleFilter)?.[2] ?? [];
    const needle = query.trim().toLowerCase();
    return users
      .filter((u) => roles.includes(u.role))
      .filter((u) => !needle || `${u.full_name} ${u.email} ${u.agent_id ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [users, roleFilter, query]);

  const admins = users.filter((u) => u.role !== "EMPLOYEE" && u.role !== "SUPER_ADMIN").length;
  const members = users.filter((u) => u.role === "EMPLOYEE").length;

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Super Admin</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Team work</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review what IT Admins and users have done: tickets raised and handled, assets assigned, stock and
          reports. Add IT Admins and users from their own pages, and remove them here; a removed account can no longer sign in and can be reactivated.
        </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/super-admin/add-it-admin" className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-violet-700">
              + Add IT Admin
            </Link>
            <Link href="/super-admin/add-user" className="inline-flex items-center justify-center rounded-lg border border-violet-200 bg-white px-4 py-2.5 text-sm font-bold text-violet-700 shadow-sm hover:bg-violet-50">
              + Add User
            </Link>
          </div>
        </div>
      </header>

      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}


      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="grid grid-cols-2 gap-3">
        {[
          ["IT Admins", admins],
          ["Users", members],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{loading ? "—" : value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5 text-sm font-semibold">
            {ROLE_FILTERS.map(([value, text]) => (
              <button
                key={value}
                type="button"
                onClick={() => setRoleFilter(value)}
                aria-pressed={roleFilter === value}
                className={`flex-1 rounded-md px-3 py-1.5 ${roleFilter === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {text}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or ID"
            aria-label="Search people"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-500 lg:max-w-xs"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {["Person", "Role", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                        {initialsOf(u.full_name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-800">{u.full_name}</span>
                        <span className="block truncate text-xs text-slate-500">{u.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${roleBadgeClass(u.role)}`}>{roleLabel(u.role)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(u.status)}`}>{u.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-4">
                      <Link href={`/super-admin/work/${u.id}`} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                        View work
                      </Link>
                      {u.status !== "ACTIVE" ? (
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => setStatus(u, true)}
                          className="text-sm font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      ) : confirmRemove === u.id ? (
                        <span className="inline-flex items-center gap-3">
                          <span className="text-xs text-slate-500">Remove {roleLabel(u.role)}?</span>
                          <button
                            type="button"
                            disabled={busyId === u.id}
                            onClick={() => setStatus(u, false)}
                            className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            Yes, remove
                          </button>
                          <button type="button" onClick={() => setConfirmRemove("")} className="text-sm font-semibold text-slate-600">
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmRemove(u.id)} className="text-sm font-semibold text-red-600 hover:text-red-700">
                          Remove
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && visible.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Nobody matches these filters.</p>}
      </section>
    </main>
  );
}
