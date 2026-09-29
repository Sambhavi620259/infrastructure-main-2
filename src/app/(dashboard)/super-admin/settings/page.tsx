"use client";

import { useState } from "react";

type SecuritySetting = {
  title: string;
  description: string;
  enabled: boolean;
};

export default function PlatformSettings() {
  const [security, setSecurity] = useState<SecuritySetting[]>([
    { title: "Require MFA for platform admins", description: "Protect privileged access.", enabled: true },
    { title: "Immutable platform audit log", description: "Record subscription, tenant and role changes.", enabled: true },
  ]);
  const [saved, setSaved] = useState(false);

  const toggleSetting = (title: string) => {
    setSaved(false);
    setSecurity((current) => current.map((setting) => setting.title === title ? { ...setting, enabled: !setting.enabled } : setting));
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Platform</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Platform settings</h1>
        <p className="mt-1 text-sm text-slate-500">Global defaults that apply across all Bold And Wise tenants.</p>
      </header>

      {saved && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">Platform defaults saved in the current UI session.</div>}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold">Global security</h2>
          <div className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
            {security.map((setting) => (
              <div key={setting.title} className="flex items-center gap-3 py-4">
                <div className="flex-1">
                  <p className="text-xs font-bold text-slate-800">{setting.title}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{setting.description}</p>
                </div>
                <button
                  type="button"
                  aria-label={`${setting.title}: ${setting.enabled ? "enabled" : "disabled"}`}
                  aria-pressed={setting.enabled}
                  onClick={() => toggleSetting(setting.title)}
                  className={`relative h-6 w-11 rounded-full transition ${setting.enabled ? "bg-brand-600" : "bg-slate-200"}`}
                >
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${setting.enabled ? "left-6" : "left-1"}`} />
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold">Provisioning defaults</h2>
          <div className="mt-4 space-y-4">
            <label className="block text-xs font-semibold text-slate-700">
              Default region
              <select defaultValue="India" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                <option>India</option><option>Singapore</option><option>Europe</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Default tenant plan
              <select defaultValue="Business" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                <option>Starter</option><option>Business</option><option>Enterprise</option>
              </select>
            </label>
            <button type="button" onClick={() => setSaved(true)} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700">Save defaults</button>
          </div>
        </article>
      </section>
    </main>
  );
}
