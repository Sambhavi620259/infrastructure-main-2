"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  PLANS,
  changeSuperAdminKey,
  getPlanFeatures,
  getProvisioningDefaults,
  planLabel,
  updatePlanFeatures,
  updateProvisioningDefaults,
  type Plan,
  type PlanFeatures,
  type ProvisioningDefaults,
} from "@/lib/super-admin";

export default function PlatformSettingsPage() {
  const [defaults, setDefaults] = useState<ProvisioningDefaults | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProvisioningDefaults()
      .then(setDefaults)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load platform settings."));
  }, []);

  const saveDefaults = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!defaults) return;
    if (!(defaults.user_limit >= 1) || !(defaults.asset_limit >= 1)) return setError("Limits must be at least 1.");
    setSaving(true);
    try {
      setDefaults(await updateProvisioningDefaults(defaults));
      setNotice("Provisioning defaults saved. New IT Admin sign-ups will get this plan.");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the defaults.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal";

  return (
    <main className="mx-auto max-w-[1100px] space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Platform settings</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Platform settings</h1>
        <p className="mt-1 text-sm text-slate-500">Features per plan, defaults for new organizations and the Super Admin key.</p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <PlanFeaturesCard onSaved={(message) => { setNotice(message); setError(""); }} onError={setError} />

      <section className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={saveDefaults} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">Provisioning defaults</h2>
          <p className="mt-1 text-xs text-slate-500">
            The plan and limits given to the organization created when an IT Admin signs up. You can change any
            organization afterwards under Subscriptions.
          </p>
          <div className="mt-4 space-y-4">
            <label className="block text-xs font-semibold text-slate-700">
              Default plan
              <select
                value={defaults?.plan ?? "ENTERPRISE"}
                onChange={(e) => defaults && setDefaults({ ...defaults, plan: e.target.value as Plan })}
                disabled={!defaults}
                className={inputClass}
              >
                {PLANS.map((plan) => (
                  <option key={plan} value={plan}>
                    {planLabel(plan)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-slate-700">
                User limit
                <input
                  type="number"
                  min={1}
                  value={defaults?.user_limit ?? ""}
                  onChange={(e) => defaults && setDefaults({ ...defaults, user_limit: Number(e.target.value) })}
                  disabled={!defaults}
                  className={inputClass}
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Asset limit
                <input
                  type="number"
                  min={1}
                  value={defaults?.asset_limit ?? ""}
                  onChange={(e) => defaults && setDefaults({ ...defaults, asset_limit: Number(e.target.value) })}
                  disabled={!defaults}
                  className={inputClass}
                />
              </label>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || !defaults}
            className="mt-5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save defaults"}
          </button>
        </form>

        <SuperKeyForm
          onChanged={() => {
            setNotice("Super Admin key changed. Share the new key only with people who should become Super Admins.");
            setError("");
          }}
          onError={setError}
        />
      </section>
    </main>
  );
}

function SuperKeyForm({ onChanged, onError }: { onChanged: () => void; onError: (message: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (next.length < 8) return onError("The new key needs at least 8 characters.");
    if (next !== confirm) return onError("The new keys do not match.");
    setBusy(true);
    try {
      await changeSuperAdminKey(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      onChanged();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not change the key.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal";

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">Super Admin key</h2>
      <p className="mt-1 text-xs text-slate-500">
        Required to register as a Super Admin. Changing it does not affect existing Super Admins.
      </p>
      <div className="mt-4 space-y-3">
        <label className="block text-xs font-semibold text-slate-700">
          Current key
          <input type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          New key
          <input type="password" autoComplete="off" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Confirm new key
          <input type="password" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </label>
      </div>
      <button
        type="submit"
        disabled={busy || !current}
        className="mt-5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Change key"}
      </button>
    </form>
  );
}

/** Which modules each plan includes. Organizations reach only their plan's modules (the API enforces it). */
function PlanFeaturesCard({ onSaved, onError }: { onSaved: (message: string) => void; onError: (message: string) => void }) {
  const [data, setData] = useState<PlanFeatures | null>(null);
  const [plans, setPlans] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPlanFeatures()
      .then((loaded) => {
        setData(loaded);
        setPlans(loaded.plans);
      })
      .catch((caught) => onError(caught instanceof Error ? caught.message : "Unable to load plan features."));
  }, [onError]);

  const toggle = (plan: string, feature: string) =>
    setPlans((current) => {
      const has = current[plan]?.includes(feature);
      return { ...current, [plan]: has ? current[plan].filter((f) => f !== feature) : [...(current[plan] ?? []), feature] };
    });

  const changed = data !== null && PLANS.some((plan) => [...(plans[plan] ?? [])].sort().join() !== [...(data.plans[plan] ?? [])].sort().join());

  const save = async () => {
    setSaving(true);
    try {
      const saved = await updatePlanFeatures(plans);
      setData(saved);
      setPlans(saved.plans);
      onSaved("Plan features saved. Organizations now see only the modules their plan includes.");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not save plan features.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">Features per plan</h2>
      <p className="mt-1 text-xs text-slate-500">
        Choose which modules each plan includes. Assets, tickets, users and settings are always included. An organization&rsquo;s IT
        Admins and users see only the modules on its plan.
      </p>
      {!data ? (
        <p className="mt-4 text-xs text-slate-500">Loading…</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-2 pr-4">Feature</th>
                {PLANS.map((plan) => (
                  <th key={plan} className="px-3 py-2 text-center">
                    {planLabel(plan)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(data.features).map(([feature, label]) => (
                <tr key={feature}>
                  <td className="py-2.5 pr-4 font-semibold text-slate-700">{label}</td>
                  {PLANS.map((plan) => (
                    <td key={plan} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={plans[plan]?.includes(feature) ?? false}
                        onChange={() => toggle(plan, feature)}
                        aria-label={`${label} on the ${planLabel(plan)} plan`}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={save}
        disabled={!changed || saving}
        className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save plan features"}
      </button>
    </section>
  );
}
