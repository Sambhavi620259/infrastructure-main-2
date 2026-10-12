"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { createDepartment, deleteDepartment, listDepartments } from "@/lib/users";
import type { Department } from "@/types/user";

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [head, setHead] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listDepartments()
      .then((data) => {
        setDepartments(data);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load departments."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a department name.");
    setSaving(true);
    try {
      const created = await createDepartment({
        name: name.trim(),
        department_head: head.trim() || undefined,
        description: description.trim() || undefined,
      });
      setNotice(`Department "${created.name}" added.`);
      setName("");
      setHead("");
      setDescription("");
      setError("");
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the department.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (department: Department) => {
    try {
      await deleteDepartment(department.id);
      setNotice(`Department "${department.name}" deleted.`);
      setError("");
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the department.");
    } finally {
      setConfirmDelete(null);
    }
  };

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Users · Organization</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Departments / Teams</h1>
        <p className="mt-1 text-sm text-slate-500">
          Departments are used when creating users, assigning assets, and filtering reports.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
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

      <form onSubmit={add} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-extrabold text-slate-900">Add department</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block text-xs font-semibold text-slate-600">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="e.g. Engineering"
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Department head <span className="font-normal text-slate-400">(optional)</span>
            <input
              value={head}
              onChange={(event) => setHead(event.target.value)}
              maxLength={150}
              placeholder="e.g. Priya Sharma"
              className={inputClass}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Description <span className="font-normal text-slate-400">(optional)</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this team does"
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          {saving ? "Adding…" : "Add department"}
        </button>
      </form>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-extrabold text-slate-900">All departments</h2>
          <p className="mt-1 text-xs text-slate-500">
            {loading ? "Loading…" : `${departments.length} department${departments.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {!loading && departments.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No departments yet. Add your first one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-left">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-5 py-3">Department</th>
                  <th className="px-5 py-3">Head</th>
                  <th className="px-5 py-3">Users</th>
                  <th className="px-5 py-3">Assets</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.map((department) => {
                  const inUse = department.user_count > 0 || department.asset_count > 0;
                  return (
                    <tr key={department.id} className="text-sm hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-slate-800">{department.name}</p>
                        {department.description && <p className="text-xs text-slate-500">{department.description}</p>}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{department.department_head ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-600">{department.user_count}</td>
                      <td className="px-5 py-3 text-slate-600">{department.asset_count}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        {confirmDelete === department.id ? (
                          <span className="inline-flex items-center gap-3">
                            <span className="text-slate-500">Delete?</span>
                            <button
                              type="button"
                              onClick={() => remove(department)}
                              className="font-semibold text-red-600 hover:text-red-700"
                            >
                              Yes, delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              className="font-semibold text-slate-600"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(department.id)}
                            disabled={inUse}
                            title={inUse ? "Move its users and assets to another department first" : undefined}
                            aria-label={`Delete ${department.name}`}
                            className="text-slate-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Link href="/users" className="inline-flex text-sm font-bold text-brand-600 hover:text-brand-700">
        ← Back to users
      </Link>
    </main>
  );
}
