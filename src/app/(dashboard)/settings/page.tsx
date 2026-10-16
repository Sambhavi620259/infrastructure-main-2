"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { createAssetCategory, listAssetCategories, type AssetCategory } from "@/lib/tickets";
import { LocationMap } from "@/components/maps/location-map";

const FEATURE_LABEL: Record<string, string> = {
  INVENTORY: "Inventory & vendors",
  SOFTWARE: "Software assets & licenses",
  REPORTS: "Reports & analytics",
  CLOUD: "Cloud",
};

/** Mirrors OrganizationResponse in backend/app/routers/organization.py. */
interface Organization {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string | null;
  plan: string | null;
  user_limit: number | null;
  asset_limit: number | null;
  active_users: number;
  assets: number;
  departments: number;
  asset_categories: number;
  users_by_role: Record<string, number>;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  plan_features: string[];
}

const ROLE_ROWS: [string, string, string][] = [
  ["IT_ADMIN", "IT Admin", "Organization settings, users, and every ITAM module."],
  ["SUB_ADMIN", "Sub-admin", "Administers the modules assigned to them."],
  ["IT_AGENT", "User", "Raises tickets, requests stock, updates asset status and runs reports."],
  ["REPORTING_USER", "Reporting User", "Read-only access to reports and exports."],
];

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-semibold text-slate-800">{used.toLocaleString()}</span>
        <span className="text-slate-500">{limit ? `of ${limit.toLocaleString()}` : "No limit"}</span>
      </div>
      {limit ? (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" role="presentation">
          <div className={`h-full rounded-full ${percent >= 90 ? "bg-rose-500" : "bg-brand-600"}`} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<Organization>("/api/organization")
      .then((data) => {
        setOrg(data);
        setName(data.name);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load organization settings."));
    listAssetCategories()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!org || name.trim() === org.name) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Organization>("/api/organization", {
        method: "PUT",
        body: JSON.stringify({ name: name.trim() }),
      });
      setOrg(updated);
      setName(updated.name);
      setNotice("Organization name saved.");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the name.");
    } finally {
      setSaving(false);
    }
  };

  const addCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newCategory.trim()) return;
    try {
      const created = await createAssetCategory(newCategory.trim());
      setCategories((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCategory("");
      setNotice(`Category "${created.name}" added.`);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the category.");
    }
  };

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header>
        <p className="text-sm font-medium text-brand-600">IT administration</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Organization settings</h1>
        <p className="mt-2 text-slate-500">Your organization&rsquo;s profile, plan usage, people and asset catalog.</p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          {error}
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

      <section className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <form onSubmit={saveName} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Organization profile</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Organization name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={150} className={inputClass} />
            </label>
            <div className="text-sm">
              <p className="font-medium text-slate-700">Organization code</p>
              <p className="mt-1.5 font-mono text-slate-600">{org?.code ?? "—"}</p>
            </div>
            <div className="text-sm">
              <p className="font-medium text-slate-700">Created</p>
              <p className="mt-1.5 text-slate-600">{formatDay(org?.created_at ?? null)}</p>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || !org || name.trim() === org.name || name.trim().length < 2}
            className="mt-6 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save name"}
          </button>
        </form>

        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Plan &amp; usage</h2>
            {org?.plan && (
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">{org.plan}</span>
            )}
          </div>
          <div className="mt-5 space-y-5">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Active users</p>
              <UsageBar used={org?.active_users ?? 0} limit={org?.user_limit ?? null} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Assets</p>
              <UsageBar used={org?.assets ?? 0} limit={org?.asset_limit ?? null} />
            </div>
          </div>
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Included in your plan</p>
            <ul className="flex flex-wrap gap-2 text-xs">
              {Object.entries(FEATURE_LABEL).map(([feature, label]) => {
                const included = org?.plan_features.includes(feature);
                return (
                  <li
                    key={feature}
                    className={`rounded-full px-2.5 py-1 font-semibold ${included ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400 line-through"}`}
                  >
                    {label}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="mt-5 text-xs text-slate-500">Plan limits and features are managed by the platform Super Admin.</p>
        </article>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-slate-900">Contact details &amp; location</h2>
        <p className="mt-1 text-sm text-slate-500">Set by the platform Super Admin. Ask them to update anything that has changed.</p>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-700">Contact email</dt>
              <dd className="mt-1 text-slate-600">{org?.contact_email ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Contact phone</dt>
              <dd className="mt-1 text-slate-600">{org?.contact_phone ?? "Not set"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-medium text-slate-700">Office address</dt>
              <dd className="mt-1 whitespace-pre-line text-slate-600">{org?.address ?? "Not set"}</dd>
            </div>
          </dl>
          {org && org.latitude !== null && org.longitude !== null ? (
            <LocationMap latitude={org.latitude} longitude={org.longitude} label={org.name} />
          ) : (
            <div className="grid h-48 place-items-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
              No office location pin yet.
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="font-semibold text-slate-900">Roles &amp; people</h2>
            <p className="mt-1 text-sm text-slate-500">Active users in each role.</p>
          </div>
          <Link href="/users" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            Manage users →
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {ROLE_ROWS.map(([key, label, description]) => (
            <li key={key} className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="flex items-center gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">
                  {label[0]}
                </span>
                <div>
                  <p className="font-semibold text-slate-800">{label}</p>
                  <p className="text-sm text-slate-500">{description}</p>
                </div>
              </div>
              <span className="whitespace-nowrap text-sm font-medium text-slate-600">
                {org ? `${org.users_by_role[key] ?? 0} user${(org.users_by_role[key] ?? 0) === 1 ? "" : "s"}` : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Asset categories ({categories.length})</h2>
          <p className="mt-1 text-sm text-slate-500">Used when raising tickets and classifying requests.</p>
          <form onSubmit={addCategory} className="mt-4 flex gap-2">
            <label className="flex-1">
              <span className="sr-only">New category</span>
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                maxLength={100}
                placeholder="e.g. Docking Station"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={!newCategory.trim()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Add
            </button>
          </form>
          <ul className="mt-4 flex flex-wrap gap-2">
            {categories.map((category) => (
              <li key={category.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {category.name}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900">Departments ({org?.departments ?? "—"})</h2>
          <p className="mt-1 text-sm text-slate-500">Teams used for users, assets, tickets and report filters.</p>
          <Link
            href="/users/departments"
            className="mt-4 inline-flex rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Manage departments →
          </Link>
          <h3 className="mt-6 text-sm font-semibold text-slate-900">Activity &amp; audit</h3>
          <p className="mt-1 text-sm text-slate-500">
            Every ticket decision, asset hand-over and stock move is recorded. Open a user from{" "}
            <Link href="/users" className="font-semibold text-brand-600 hover:text-brand-700">
              Users
            </Link>{" "}
            and choose <strong>View work</strong> to review what they did.
          </p>
        </article>
      </section>
    </main>
  );
}
